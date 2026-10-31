// Stage: owns the transparent WebGL canvas, the frame loop, and per-pixel hit testing.

import { CubismFramework, LogLevel, Option } from "@framework/live2dcubismframework";
import { CubismMatrix44 } from "@framework/math/cubismmatrix44";
import { CubismWebGLOffscreenManager } from "@framework/rendering/cubismoffscreenmanager";
import type { PetModel } from "./petModel";
import type { Still } from "./stills";

let cubismStarted = false;

export function startCubism(): void {
  if (cubismStarted) return;
  if (typeof Live2DCubismCore === "undefined") {
    throw new Error("Cubism Core is not loaded: run pnpm sync:cubism (needs vendor/cubism)");
  }
  const option = new Option();
  option.logFunction = (msg: string) => console.warn(`[cubism] ${msg}`);
  option.loggingLevel = LogLevel.LogLevel_Warning;
  CubismFramework.startUp(option);
  CubismFramework.initialize();
  cubismStarted = true;
}

export interface FrameHooks {
  /** Runs before the model updates; dt in seconds. */
  beforeUpdate?: (dt: number) => void;
  /** Runs right after drawing, while the frame's pixels can still be read. */
  afterDraw?: () => void;
}

export class Stage {
  readonly canvas: HTMLCanvasElement;
  readonly gl: WebGL2RenderingContext;
  model: PetModel | null = null;
  hooks: FrameHooks = {};
  /** Lower when the pet is idle and nobody is looking, to save power. */
  maxFps = 60;
  /** Development: switch parts of the frame off to find what costs time or memory. */
  readonly debugParts = { hooks: true, update: true, render: true, after: true };

  private last = 0;
  private raf = 0;
  private pixel = new Uint8Array(4);
  private stats = { frames: 0, since: 0, hooks: 0, update: 0, render: 0, after: 0 };
  private stills: { pose: () => void; done: (s: Still) => void }[] = [];
  private proj = new CubismMatrix44();

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    // No MSAA: the canvas is already at device resolution, and multisampling costs GPU bandwidth
    // on every frame of a window that is always on screen.
    const gl = canvas.getContext("webgl2", { alpha: true, premultipliedAlpha: true, antialias: false });
    if (!gl) throw new Error("WebGL2 is not available");
    this.gl = gl;
  }

  get dpr(): number {
    return window.devicePixelRatio || 1;
  }

  resize(): void {
    const w = Math.max(1, Math.round(this.canvas.clientWidth * this.dpr));
    const h = Math.max(1, Math.round(this.canvas.clientHeight * this.dpr));
    if (this.canvas.width === w && this.canvas.height === h) return;
    this.canvas.width = w;
    this.canvas.height = h;
    this.model?.setRenderTargetSize(w, h);
  }

  start(): void {
    const tick = (now: number) => {
      this.raf = requestAnimationFrame(tick);
      const interval = 1000 / this.maxFps;
      const elapsed = now - this.last;
      // A little slack for display timing jitter (120 Hz ProMotion delivers 8.3 ms steps).
      if (elapsed < interval - 2) return;
      const dt = this.last === 0 ? 1 / 60 : Math.min(elapsed / 1000, 0.1);
      // Keep the cadence instead of drifting by the overshoot.
      this.last = elapsed > interval * 2 ? now : now - (elapsed % interval);
      this.frame(dt);
      if (import.meta.env.DEV) this.countFrame(now);
    };
    this.raf = requestAnimationFrame(tick);
    // Nothing to draw while the window is hidden.
    document.addEventListener("visibilitychange", () => {
      cancelAnimationFrame(this.raf);
      if (!document.hidden) {
        this.last = 0;
        this.raf = requestAnimationFrame(tick);
      }
    });
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
  }

  private countFrame(now: number): void {
    this.stats.frames++;
    if (now - this.stats.since < 10_000) return;
    const st = this.stats;
    const per = (ms: number) => (ms / Math.max(1, st.frames)).toFixed(2);
    if (st.since) {
      console.info(
        `[pet] ${((st.frames * 1000) / (now - st.since)).toFixed(1)} fps (cap ${this.maxFps}) · ms/frame: ` +
          `hooks ${per(st.hooks)} update ${per(st.update)} render ${per(st.render)} hit ${per(st.after)} · ${this.canvas.width}×${this.canvas.height}`,
      );
    }
    this.stats = { frames: 0, since: now, hooks: 0, update: 0, render: 0, after: 0 };
  }

  /**
   * Renders a still: `pose` sets the model up (see PetModel.poseStill), the frame is drawn and read
   * back, and the live frame drawn right after replaces it before anything reaches the screen.
   * One still per frame, so the pet keeps moving smoothly.
   */
  still(pose: () => void): Promise<Still> {
    return new Promise((done) => this.stills.push({ pose, done }));
  }

  private frame(dt: number): void {
    const { gl, model } = this;
    if (gl.isContextLost()) return;
    this.resize();
    if (!model) return this.clear();

    const job = this.stills.shift();
    if (job) {
      this.clear();
      job.pose();
      this.render(model);
      job.done(this.readFrame());
    }

    this.clear();
    const parts = this.debugParts;
    const t0 = performance.now();
    if (parts.hooks) this.hooks.beforeUpdate?.(dt);
    const t1 = performance.now();
    if (parts.update) model.update(dt);
    const t2 = performance.now();
    if (parts.render) this.render(model);
    const t3 = performance.now();
    if (parts.after) this.hooks.afterDraw?.();
    const t4 = performance.now();
    this.stats.hooks += t1 - t0;
    this.stats.update += t2 - t1;
    this.stats.render += t3 - t2;
    this.stats.after += t4 - t3;
  }

  private clear(): void {
    const { gl, canvas } = this;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  }

  private render(model: PetModel): void {
    const { gl, canvas } = this;
    const offscreen = CubismWebGLOffscreenManager.getInstance();
    offscreen.beginFrameProcess(gl);
    model.draw(this.projection(model), [0, 0, canvas.width, canvas.height]);
    offscreen.endFrameProcess(gl);
    offscreen.releaseStaleRenderTextures(gl);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /** The whole canvas, top row first. */
  private readFrame(): Still {
    const { gl, canvas } = this;
    const w = canvas.width;
    const h = canvas.height;
    const flipped = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, flipped);
    const pixels = new Uint8Array(w * h * 4);
    const row = w * 4;
    for (let y = 0; y < h; y++) pixels.set(flipped.subarray((h - 1 - y) * row, (h - y) * row), y * row);
    return { width: w, height: h, pixels };
  }

  /** Fits the whole model canvas inside the window, keeping its aspect ratio. */
  private projection(model: PetModel): CubismMatrix44 {
    const winAspect = this.canvas.width / this.canvas.height;
    const fit = Math.min(1, winAspect / model.aspect()) * 0.98;
    // Reused; drawing multiplies the model matrix into it, so it is reset every frame.
    this.proj.loadIdentity();
    this.proj.scale(fit / winAspect, fit);
    return this.proj;
  }

  /** Alpha (0-255) of the last drawn frame at a CSS-pixel point; only valid inside afterDraw. */
  alphaAt(cssX: number, cssY: number): number {
    const x = Math.floor(cssX * this.dpr);
    const y = this.canvas.height - 1 - Math.floor(cssY * this.dpr);
    if (x < 0 || y < 0 || x >= this.canvas.width || y >= this.canvas.height) return 0;
    this.gl.readPixels(x, y, 1, 1, this.gl.RGBA, this.gl.UNSIGNED_BYTE, this.pixel);
    return this.pixel[3];
  }
}

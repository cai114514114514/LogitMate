// Pointer handling for a click-through pet window: per-pixel hit testing, drag and tap, and the
// cursor as seen from her face (behavior/life.ts decides where she actually looks).

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Stage } from "../renderer/stage";
import type { PointerState } from "./life";

/** Pixels with less alpha than this let clicks fall through. */
const HIT_ALPHA = 16;
/** Pointer travel (CSS px) before a press becomes a drag. */
const DRAG_SLOP = 4;
/** Where the face sits, as a fraction of the model's height; the gaze is aimed from here. */
const FACE_Y = 0.22;
/** Frame rate while someone is interacting, and when nobody is. */
const ACTIVE_FPS = 60;
const IDLE_FPS = 30;
/** How long after the last pointer movement we stay at the active frame rate. */
const ACTIVE_MS = 2000;
/** With a still cursor over the pet, re-check the pixel this often (the model keeps moving). */
const HIT_RECHECK_FRAMES = 6;

export interface WindowBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface InteractionHandlers {
  /** A click on the model that was not a drag; `fy` is its height on the model, 0 = top. */
  onTap: (fy: number) => void;
  /** Moves the window; called at most once per frame while dragging. */
  moveTo: (x: number, y: number) => void;
  onDragEnd: () => void;
}

export class Interaction {
  private cursor = { x: -1e5, y: -1e5 };
  private ignoring: boolean | null = null;
  private press: { sx: number; sy: number; wx: number; wy: number; dragging: boolean } | null = null;
  private pendingMove: { x: number; y: number } | null = null;
  private lastMove = { x: 0, t: 0, vx: 0 };
  private swayVelocity = 0;
  private lastCursorChange = 0;
  private cursorDirty = true;
  private framesSinceHitTest = 0;
  private hit = false;
  /** The cursor as she sees it, updated every frame. */
  pointer: PointerState = { x: 0, y: 0, fx: -1, fy: -1, stillMs: 1e9, near: false, over: false };

  constructor(
    private stage: Stage,
    private box: WindowBox,
    private handlers: InteractionHandlers,
  ) {}

  async attach(): Promise<void> {
    await listen<{ x: number; y: number }>("pet://cursor", (e) => {
      if (!this.press) this.setCursor(e.payload.x, e.payload.y);
    });
    const canvas = this.stage.canvas;
    canvas.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      canvas.setPointerCapture(e.pointerId);
      this.press = { sx: e.screenX, sy: e.screenY, wx: this.box.x, wy: this.box.y, dragging: false };
    });
    canvas.addEventListener("pointermove", (e) => {
      const p = this.press;
      if (!p) return;
      this.setCursor(e.clientX, e.clientY);
      const dx = e.screenX - p.sx;
      const dy = e.screenY - p.sy;
      if (!p.dragging && Math.hypot(dx, dy) > DRAG_SLOP) {
        p.dragging = true;
        canvas.classList.add("grabbing");
      }
      if (p.dragging) this.pendingMove = { x: p.wx + dx, y: p.wy + dy };
    });
    const end = (e: PointerEvent) => {
      const p = this.press;
      if (!p) return;
      this.press = null;
      canvas.classList.remove("grabbing");
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
      if (p.dragging) this.handlers.onDragEnd();
      else if (e.type === "pointerup") this.handlers.onTap(e.offsetY / canvas.clientHeight);
    };
    canvas.addEventListener("pointerup", end);
    canvas.addEventListener("pointercancel", end);
  }

  /** Frame hook: window movement, drag sway, the cursor relative to her. */
  beforeUpdate(dt: number): void {
    const model = this.stage.model;
    if (!model) return;
    const now = performance.now();

    if (this.pendingMove) {
      const { x, y } = this.pendingMove;
      this.pendingMove = null;
      const elapsed = Math.max(1, now - this.lastMove.t) / 1000;
      this.lastMove = { x, t: now, vx: (x - this.lastMove.x) / elapsed };
      this.handlers.moveTo(x, y);
    } else if (now - this.lastMove.t > 60) {
      this.lastMove.vx = 0;
    }

    // Spring toward a lean opposite to the drag direction; it overshoots a little on release.
    const target = this.press?.dragging ? Math.max(-1, Math.min(1, -this.lastMove.vx / 1500)) : 0;
    const accel = 60 * (target - model.sway) - 7 * this.swayVelocity;
    this.swayVelocity += accel * dt;
    model.sway += this.swayVelocity * dt;
    if (Math.abs(model.sway) < 1e-4 && Math.abs(this.swayVelocity) < 1e-4) model.sway = 0;

    // Gaze and proximity are measured on the model, which sits below the speech-bubble area.
    const { x, y, w, h } = this.onModel();
    // Far away the gaze is already saturated, so smooth tracking only matters near the pet.
    const near = Math.hypot(x - w / 2, y - h / 2) < h * 1.5;
    const active = !!this.press || model.sway !== 0 || (near && now - this.lastCursorChange < ACTIVE_MS);
    this.stage.maxFps = active ? ACTIVE_FPS : IDLE_FPS;

    const reach = h * 0.5;
    this.pointer = {
      x: Math.tanh((x - w / 2) / reach),
      y: Math.tanh((h * FACE_Y - y) / reach),
      fx: x / w,
      fy: y / h,
      stillMs: this.press ? 0 : now - this.lastCursorChange,
      near,
      over: this.hit && !this.press,
    };
  }

  /** Frame hook: decide click-through from what is under the cursor (model pixel or UI). */
  afterDraw(): void {
    const { x, y } = this.cursor;
    const inside = x >= 0 && y >= 0 && x < this.box.width && y < this.box.height;
    if (this.press) this.hit = true;
    else if (!inside) this.hit = false;
    else if (this.cursorDirty || ++this.framesSinceHitTest >= HIT_RECHECK_FRAMES) {
      // readPixels stalls the GPU pipeline, so only look when the answer may have changed.
      const m = this.onModel();
      this.hit = !!document.elementFromPoint(x, y)?.closest(".ui") || this.stage.alphaAt(m.x, m.y) > HIT_ALPHA;
      this.framesSinceHitTest = 0;
    }
    this.cursorDirty = false;
    this.setIgnore(!this.hit);
  }

  /** The cursor in model-canvas coordinates, with the canvas size. */
  private onModel(): { x: number; y: number; w: number; h: number } {
    const c = this.stage.canvas;
    return { x: this.cursor.x - c.offsetLeft, y: this.cursor.y - c.offsetTop, w: c.clientWidth, h: c.clientHeight };
  }

  private setCursor(x: number, y: number): void {
    this.cursor = { x, y };
    this.cursorDirty = true;
    this.lastCursorChange = performance.now();
  }

  private setIgnore(ignore: boolean): void {
    if (this.ignoring === ignore) return;
    this.ignoring = ignore;
    invoke("set_ignore_cursor", { ignore }).catch((e) => console.error("set_ignore_cursor", e));
  }
}

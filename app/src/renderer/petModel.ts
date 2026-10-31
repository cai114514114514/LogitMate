// PetModel: a CubismUserModel driven by a NormalizedModel instead of a raw model3.json on disk.
// Follows the official sample (LAppModel) but loads with async/await and adds pet-specific inputs.

import { CubismDefaultParameterId as P } from "@framework/cubismdefaultparameterid";
import { CubismModelSettingJson } from "@framework/cubismmodelsettingjson";
import { BreathParameterData, CubismBreath } from "@framework/effect/cubismbreath";
import { CubismEyeBlink } from "@framework/effect/cubismeyeblink";
import { CubismLook, LookParameterData } from "@framework/effect/cubismlook";
import type { ICubismModelSetting } from "@framework/icubismmodelsetting";
import type { CubismIdHandle } from "@framework/id/cubismid";
import { CubismFramework } from "@framework/live2dcubismframework";
import { CubismMatrix44 } from "@framework/math/cubismmatrix44";
import { CubismUserModel } from "@framework/model/cubismusermodel";
import { ACubismMotion, type FinishedMotionCallback } from "@framework/motion/acubismmotion";
import { CubismBreathUpdater } from "@framework/motion/cubismbreathupdater";
import { CubismExpressionUpdater } from "@framework/motion/cubismexpressionupdater";
import { CubismEyeBlinkUpdater } from "@framework/motion/cubismeyeblinkupdater";
import { CubismLookUpdater } from "@framework/motion/cubismlookupdater";
import { CubismMotion } from "@framework/motion/cubismmotion";
import { InvalidMotionQueueEntryHandleValue } from "@framework/motion/cubismmotionqueuemanager";
import { CubismPhysicsUpdater } from "@framework/motion/cubismphysicsupdater";
import { CubismPoseUpdater } from "@framework/motion/cubismposeupdater";
import { CubismUpdateScheduler } from "@framework/motion/cubismupdatescheduler";
import { physicsOutputs, physicsRoutes, type Route } from "../model/physicsRoutes";
import type { Exp3Parameter } from "../model/semantics";
import type { NormalizedModel } from "../model/types";
import { Priority } from "./priority";
import { loadTexture } from "./textures";

export { Priority };

export const SHADER_PATH = "/cubism/shaders/";
/**
 * Physics steps per second. Rigs often ask for 60; Cubism interpolates between steps, so 30
 * looks the same on a desktop pet and halves the cost of the second-largest part of a frame.
 */
const PHYSICS_FPS = 30;

const NEUTRAL_EXPRESSION = "__neutral";

/**
 * Logical limbs used by procedural gestures, -1..1 (+ = away from the body), and the parameter
 * names common rigs use for them: Cubism samples, then VTube Studio-style rigs.
 */
const LIMBS: Record<string, string[]> = {
  ArmL: ["ParamArmLA", "ParamArmL", "LArm"],
  ArmR: ["ParamArmRA", "ParamArmR", "RArm"],
  ForearmL: ["ParamArmLB", "LForearm"],
  ForearmR: ["ParamArmRB", "RForearm"],
  HandL: ["ParamHandL", "LHand"],
  HandR: ["ParamHandR", "RHand"],
};

/** What the procedural layer (behavior/life.ts) wants this frame. */
export interface ProceduralPose {
  offsets: Record<string, number>;
  /** Eye openness multiplier after blinking, 0..1. */
  eyeOpen: number;
  /** Where the eyes point (-1..1); they lead the head, which follows through CubismLook. */
  gaze: { x: number; y: number } | null;
}

export interface LoadOptions {
  /** Converts a path relative to the model folder into a URL the webview can fetch. */
  url: (relativePath: string) => string;
  canvasWidth: number;
  canvasHeight: number;
  /** On-screen model height in device pixels; textures are decoded at 1.5× that. */
  maxDisplayHeightPx: number;
  onProgress?: (step: string) => void;
}

async function fetchBuffer(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.arrayBuffer();
}

function jsonBuffer(value: unknown): ArrayBuffer {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export class PetModel extends CubismUserModel {
  readonly normalized: NormalizedModel;
  private setting: ICubismModelSetting;
  private scheduler = new CubismUpdateScheduler();
  private look: CubismLook | null = null;
  private motionUpdated = false;
  private eyeBlinkIds: CubismIdHandle[] = [];
  private lipSyncIds: CubismIdHandle[] = [];
  private motions = new Map<string, CubismMotion>();
  private expressions = new Map<string, ACubismMotion>();
  private expressionParams = new Map<string, Exp3Parameter[]>();
  private routes = new Map<string, Route>();
  /** Physics outputs; offsets to them that can't be routed are added after physics runs. */
  private physicsOut = new Set<string>();
  /** Logical limb -> this model's parameter and the value of a full (1.0) movement. */
  private limbs = new Map<string, Route>();
  private idCache = new Map<string, CubismIdHandle>();

  /** Horizontal sway from being dragged around, -1..1. Physics turns it into hair/skirt motion. */
  sway = 0;
  procedural: ProceduralPose = { offsets: {}, eyeOpen: 1, gaze: null };
  textureMemoryBytes = 0;

  private constructor(normalized: NormalizedModel) {
    super();
    this.normalized = normalized;
    const buf = jsonBuffer(normalized.model3);
    this.setting = new CubismModelSettingJson(buf, buf.byteLength);
  }

  private id(name: string): CubismIdHandle {
    let h = this.idCache.get(name);
    if (!h) {
      h = CubismFramework.getIdManager().getId(name);
      this.idCache.set(name, h);
    }
    return h;
  }

  /** The parameter to write for `name`: itself, or the physics input that drives it. */
  private route(name: string): Route {
    let r = this.routes.get(name);
    if (!r) {
      r = { id: name, scale: 1 };
      this.routes.set(name, r);
    }
    return r;
  }

  private addRouted(name: string, value: number): void {
    const r = this.route(name);
    this._model.addParameterValueById(this.id(r.id), value * r.scale);
  }

  /**
   * Offsets added after physics: physics outputs with no input to route to, and limbs that are
   * physics outputs (their inputs move the whole body, so limbs are never routed).
   */
  private afterPhysics(name: string): boolean {
    const limb = this.limbs.get(name);
    if (limb) return this.physicsOut.has(limb.id);
    const r = this.routes.get(name);
    return (!r || r.id === name) && this.physicsOut.has(name);
  }

  private hasParameter(name: string): boolean {
    const i = this._model.getParameterIndex(this.id(name));
    return i >= 0 && i < this._model.getParameterCount();
  }

  /** Finds each logical limb on this rig and how far a full movement goes. */
  private resolveLimbs(): void {
    const m = this._model;
    for (const [limb, names] of Object.entries(LIMBS)) {
      const name = names.find((n) => this.hasParameter(n));
      if (!name) continue;
      const i = m.getParameterIndex(this.id(name));
      this.limbs.set(limb, { id: name, scale: (m.getParameterMaximumValue(i) - m.getParameterMinimumValue(i)) / 2 });
    }
  }

  static async load(gl: WebGL2RenderingContext, normalized: NormalizedModel, opts: LoadOptions): Promise<PetModel> {
    const m = new PetModel(normalized);
    await m.setup(gl, opts);
    return m;
  }

  private async setup(gl: WebGL2RenderingContext, opts: LoadOptions): Promise<void> {
    const s = this.setting;

    const progress = opts.onProgress ?? (() => {});
    const mocBuffer = await fetchBuffer(opts.url(s.getModelFileName()));
    progress(`moc fetched (${(mocBuffer.byteLength / 2 ** 20).toFixed(1)} MB)`);
    this.loadModel(mocBuffer);
    progress("moc parsed");

    const expressionFiles = Array.from({ length: s.getExpressionCount() }, (_, i) => ({
      name: s.getExpressionName(i),
      file: s.getExpressionFileName(i),
    }));
    const expBuffers = await Promise.all(expressionFiles.map((e) => fetchBuffer(opts.url(e.file))));
    const decoder = new TextDecoder();
    expressionFiles.forEach((e, i) => {
      const motion = this.loadExpression(expBuffers[i], expBuffers[i].byteLength, e.name);
      if (motion) this.expressions.set(e.name, motion);
      try {
        const json = JSON.parse(decoder.decode(expBuffers[i])) as { Parameters?: Exp3Parameter[] };
        this.expressionParams.set(e.name, json.Parameters ?? []);
      } catch {
        this.expressionParams.set(e.name, []);
      }
    });
    const neutral = jsonBuffer({ Type: "Live2D Expression", Parameters: [] });
    this.expressions.set(NEUTRAL_EXPRESSION, this.loadExpression(neutral, neutral.byteLength, NEUTRAL_EXPRESSION));
    this.scheduler.addUpdatableList(new CubismExpressionUpdater(this._expressionManager));
    progress(`${this.expressions.size - 1} expressions`);

    if (s.getPhysicsFileName()) {
      let buf = await fetchBuffer(opts.url(s.getPhysicsFileName()));
      try {
        const json = JSON.parse(decoder.decode(buf));
        this.routes = physicsRoutes(json);
        this.physicsOut = physicsOutputs(json);
        if (json.Meta && !(json.Meta.Fps > 0 && json.Meta.Fps <= PHYSICS_FPS)) {
          json.Meta.Fps = PHYSICS_FPS;
          buf = jsonBuffer(json);
        }
      } catch {
        this.routes.clear();
        this.physicsOut.clear();
      }
      const head = [P.ParamAngleX, P.ParamBodyAngleX].filter((id) => this.routes.has(id));
      progress(`physics routes: ${this.routes.size}${head.length ? ` (${head.map((id) => `${id}→${this.routes.get(id)!.id}`).join(", ")})` : ""}`);
      this.loadPhysics(buf, buf.byteLength);
      if (this._physics) this.scheduler.addUpdatableList(new CubismPhysicsUpdater(this._physics));
    }
    if (s.getPoseFileName()) {
      const buf = await fetchBuffer(opts.url(s.getPoseFileName()));
      this.loadPose(buf, buf.byteLength);
      if (this._pose) this.scheduler.addUpdatableList(new CubismPoseUpdater(this._pose));
    }

    if (s.getEyeBlinkParameterCount() > 0) {
      this._eyeBlink = CubismEyeBlink.create(s);
      this.scheduler.addUpdatableList(new CubismEyeBlinkUpdater(() => this.motionUpdated, this._eyeBlink));
    }
    for (let i = 0; i < s.getEyeBlinkParameterCount(); i++) this.eyeBlinkIds.push(s.getEyeBlinkParameterId(i));
    for (let i = 0; i < s.getLipSyncParameterCount(); i++) this.lipSyncIds.push(s.getLipSyncParameterId(i));

    // Breath and gaze write through physics routes, so physics-smoothed rigs move too.
    const routed = (name: string) => ({ id: this.id(this.route(name).id), scale: this.route(name).scale });
    const breath = (name: string, offset: number, peak: number, cycle: number, weight: number) =>
      new BreathParameterData(routed(name).id, offset, peak, cycle, weight);
    // Gentler than the official sample's sway (15/8/10 degrees): the life layer adds its own drift.
    this._breath = CubismBreath.create();
    this._breath.setParameters([
      breath(P.ParamAngleX, 0.0, 3.0, 6.5345, 0.5),
      breath(P.ParamAngleY, 0.0, 2.0, 3.5345, 0.5),
      breath(P.ParamAngleZ, 0.0, 2.0, 5.5345, 0.5),
      breath(P.ParamBodyAngleX, 0.0, 2.0, 15.5345, 0.5),
      breath(P.ParamBreath, 0.5, 0.5, 3.2345, 1),
    ]);
    this.scheduler.addUpdatableList(new CubismBreathUpdater(this._breath));

    const look = (name: string, x: number, y: number, xy: number) => {
      const r = routed(name);
      return new LookParameterData(r.id, x * r.scale, y * r.scale, xy * r.scale);
    };
    this.look = CubismLook.create();
    this.look.setParameters([
      look(P.ParamAngleX, 30.0, 0.0, 0.0),
      look(P.ParamAngleY, 0.0, 30.0, 0.0),
      look(P.ParamAngleZ, 0.0, 0.0, -30.0),
      look(P.ParamBodyAngleX, 10.0, 0.0, 0.0),
      look(P.ParamEyeBallX, 1.0, 0.0, 0.0),
      look(P.ParamEyeBallY, 0.0, 1.0, 0.0),
    ]);
    this.scheduler.addUpdatableList(new CubismLookUpdater(this.look, this._dragManager));
    this.scheduler.sortUpdatableList();

    this.resolveLimbs();
    progress(`limbs: ${[...this.limbs.keys()].join(" ") || "none"}`);

    const layout = new Map<string, number>();
    s.getLayoutMap(layout);
    this._modelMatrix.setupFromLayout(layout);

    await this.preloadMotions(opts);
    progress(`${this.motions.size} motions`);
    this._motionManager.stopAllMotions();

    // Renderer and textures. Texture resolution follows the largest size the pet will be shown at.
    this.createRenderer(opts.canvasWidth, opts.canvasHeight, this.maskBufferCount());
    this.getRenderer().startUp(gl);
    this.getRenderer().loadShaders(SHADER_PATH);
    this.getRenderer().setIsPremultipliedAlpha(true);
    const canvasPx = this._model.getCanvasHeight() * this._model.getPixelsPerUnit();
    const detail = Math.min(1, (opts.maxDisplayHeightPx * 1.5) / canvasPx);
    const textures = await Promise.all(
      Array.from({ length: s.getTextureCount() }, async (_, i) => {
        const file = s.getTextureFileName(i);
        if (!file) return null;
        // Atlas pixels map roughly 1:1 to canvas pixels, so scale the atlas by the same detail factor.
        return { i, t: await loadTexture(gl, opts.url(file), detail) };
      }),
    );
    progress(`textures decoded (detail ${detail.toFixed(2)})`);
    for (const entry of textures) {
      if (!entry) continue;
      this.getRenderer().bindTexture(entry.i, entry.t.texture);
      this.textureMemoryBytes += Math.round(entry.t.width * entry.t.height * 4 * 1.33);
    }

    this._initialized = true;
  }

  private async preloadMotions(opts: LoadOptions): Promise<void> {
    const s = this.setting;
    const jobs: Promise<void>[] = [];
    for (let g = 0; g < s.getMotionGroupCount(); g++) {
      const group = s.getMotionGroupName(g);
      for (let i = 0; i < s.getMotionCount(group); i++) {
        jobs.push(
          fetchBuffer(opts.url(s.getMotionFileName(group, i))).then((buf) => {
            const motion = this.loadMotion(buf, buf.byteLength, `${group}_${i}`, undefined, undefined, s, group, i);
            if (!motion) return;
            motion.setEffectIds(this.eyeBlinkIds, this.lipSyncIds);
            this.motions.set(`${group}_${i}`, motion);
          }),
        );
      }
    }
    await Promise.all(jobs);
  }

  /**
   * One mask texture holds 36 clipping masks (4 channels x 9 tiles). Rigs with more masks need
   * more textures, or the extra masked parts are drawn unclipped (mouth interiors showing, etc.).
   * Counting masked drawables gives an upper bound, since identical masks share a slot.
   */
  private maskBufferCount(): number {
    const counts = this._model.getDrawableMaskCounts();
    let masked = 0;
    for (let i = 0; i < this._model.getDrawableCount(); i++) if (counts[i] > 0) masked++;
    return Math.min(8, Math.max(1, Math.ceil(masked / 36)));
  }

  /** Debug: min/default/max/current of the given parameters. */
  describeParameters(ids: string[]): string {
    const m = this._model;
    const idm = CubismFramework.getIdManager();
    return ids
      .map((id) => {
        const i = m.getParameterIndex(idm.getId(id));
        if (i < 0 || i >= m.getParameterCount()) return `${id}=missing`;
        const f = (v: number) => v.toFixed(2);
        return `${id}=${f(m.getParameterValueByIndex(i))} [${f(m.getParameterMinimumValue(i))}..${f(m.getParameterMaximumValue(i))} d${f(m.getParameterDefaultValue(i))}]`;
      })
      .join("\n");
  }

  /** Model canvas aspect ratio (width / height), used to size the window. */
  aspect(): number {
    return this._model.getCanvasWidth() / this._model.getCanvasHeight();
  }

  /** Where the model looks, in -1..1 on both axes (y up). */
  lookAt(x: number, y: number): void {
    this.setDragging(x, y);
  }

  startMotion(group: string, index: number, priority: number, onFinished?: FinishedMotionCallback): boolean {
    const motion = this.motions.get(`${group}_${index}`);
    if (!motion) return false;
    if (priority === Priority.Force) this._motionManager.setReservePriority(priority);
    else if (!this._motionManager.reserveMotion(priority)) return false;
    motion.setFinishedMotionHandler(onFinished as FinishedMotionCallback);
    return this._motionManager.startMotionPriority(motion, false, priority) !== InvalidMotionQueueEntryHandleValue;
  }

  startRandomMotion(group: string, priority: number): boolean {
    const count = this.setting.getMotionCount(group);
    if (count === 0) return false;
    return this.startMotion(group, Math.floor(Math.random() * count), priority);
  }

  setExpression(name: string): void {
    const motion = this.expressions.get(name);
    if (motion) this._expressionManager.startMotion(motion, false);
  }

  clearExpression(): void {
    this.setExpression(NEUTRAL_EXPRESSION);
  }

  /** The parameters an expression sets, as written in its exp3 file. */
  expressionParameters(name: string): Exp3Parameter[] {
    return this.expressionParams.get(name) ?? [];
  }

  /**
   * Poses the model for a still: every parameter at its default, then one expression at full
   * weight and any `extra` values. No motion, physics, breath or gaze. The next `update()` restores
   * the live pose, because it starts from the parameters saved by the previous frame.
   */
  poseStill(expression: string | null, extra: Record<string, number> = {}): void {
    const m = this._model;
    const ids = CubismFramework.getIdManager();
    for (let i = 0; i < m.getParameterCount(); i++) m.setParameterValueByIndex(i, m.getParameterDefaultValue(i));
    const set = (id: string, value: (current: number) => number) => {
      const i = m.getParameterIndex(ids.getId(id));
      if (i < 0 || i >= m.getParameterCount()) return;
      const v = value(m.getParameterValueByIndex(i));
      m.setParameterValueByIndex(i, Math.min(m.getParameterMaximumValue(i), Math.max(m.getParameterMinimumValue(i), v)));
    };
    for (const p of expression ? this.expressionParameters(expression) : []) {
      set(p.Id, (cur) => (p.Blend === "Multiply" ? cur * p.Value : p.Blend === "Overwrite" ? p.Value : cur + p.Value));
    }
    for (const [id, value] of Object.entries(extra)) set(id, () => value);
    m.update();
  }

  update(dt: number): void {
    if (!this._initialized) return;
    const model = this._model;

    model.loadParameters();
    this.motionUpdated = false;
    const idle = this.normalized.profile.idleGroup;
    if (this._motionManager.isFinished()) {
      if (idle) this.startRandomMotion(idle, Priority.Idle);
    } else {
      this.motionUpdated = this._motionManager.updateMotion(model, dt);
    }
    model.saveParameters();

    // Not saved: these add on top of the motion each frame and feed into physics below.
    if (this.sway !== 0) {
      this.addRouted(P.ParamAngleZ, this.sway * 12);
      this.addRouted(P.ParamBodyAngleZ, this.sway * 8);
      this.addRouted(P.ParamBodyAngleX, this.sway * 6);
    }
    const pose = this.procedural;
    // Before physics: everything except physics outputs nothing can route (those come after).
    for (const name in pose.offsets) {
      const v = pose.offsets[name];
      if (v === 0 || this.afterPhysics(name)) continue;
      const limb = this.limbs.get(name);
      if (limb) model.addParameterValueById(this.id(limb.id), v * limb.scale);
      else this.addRouted(name, v);
    }
    if (pose.gaze) {
      // Eyes jump ahead of the head, which catches up through the smoothed look target.
      const lead = (v: number) => Math.max(-1, Math.min(1, v));
      this.addRouted(P.ParamEyeBallX, lead(pose.gaze.x - this._dragManager.getX()));
      this.addRouted(P.ParamEyeBallY, lead(pose.gaze.y - this._dragManager.getY()));
    }

    this.scheduler.onLateUpdate(model, dt);
    for (const name in pose.offsets) {
      const v = pose.offsets[name];
      if (v === 0 || !this.afterPhysics(name)) continue;
      const limb = this.limbs.get(name);
      model.addParameterValueById(this.id(limb?.id ?? name), v * (limb?.scale ?? 1));
    }
    if (pose.eyeOpen < 1) {
      for (const id of this.eyeBlinkIds) model.multiplyParameterValueById(id, pose.eyeOpen);
    }
    model.update();
  }

  draw(projection: CubismMatrix44, viewport: number[]): void {
    if (!this._initialized) return;
    projection.multiplyByMatrix(this._modelMatrix);
    const r = this.getRenderer();
    r.setMvpMatrix(projection);
    r.setRenderState(null as unknown as WebGLFramebuffer, viewport);
    r.drawModel(SHADER_PATH);
  }

  release(): void {
    if (this.look) CubismLook.delete(this.look);
    this.scheduler.release();
    super.release();
  }
}

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
import type { NormalizedModel } from "../model/types";
import { Priority } from "./priority";
import { loadTexture } from "./textures";

export { Priority };

export const SHADER_PATH = "/cubism/shaders/";

const NEUTRAL_EXPRESSION = "__neutral";

export interface LoadOptions {
  /** Converts a path relative to the model folder into a URL the webview can fetch. */
  url: (relativePath: string) => string;
  canvasWidth: number;
  canvasHeight: number;
  /** Largest on-screen model height we expect, in device pixels; decides texture resolution. */
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
  private idAngleZ: CubismIdHandle;
  private idBodyAngleX: CubismIdHandle;
  private idBodyAngleZ: CubismIdHandle;

  /** Horizontal sway from being dragged around, -1..1. Physics turns it into hair/skirt motion. */
  sway = 0;
  textureMemoryBytes = 0;

  private constructor(normalized: NormalizedModel) {
    super();
    this.normalized = normalized;
    const buf = jsonBuffer(normalized.model3);
    this.setting = new CubismModelSettingJson(buf, buf.byteLength);
    const ids = CubismFramework.getIdManager();
    this.idAngleZ = ids.getId(P.ParamAngleZ);
    this.idBodyAngleX = ids.getId(P.ParamBodyAngleX);
    this.idBodyAngleZ = ids.getId(P.ParamBodyAngleZ);
  }

  static async load(gl: WebGL2RenderingContext, normalized: NormalizedModel, opts: LoadOptions): Promise<PetModel> {
    const m = new PetModel(normalized);
    await m.setup(gl, opts);
    return m;
  }

  private async setup(gl: WebGL2RenderingContext, opts: LoadOptions): Promise<void> {
    const s = this.setting;
    const ids = CubismFramework.getIdManager();

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
    expressionFiles.forEach((e, i) => {
      const motion = this.loadExpression(expBuffers[i], expBuffers[i].byteLength, e.name);
      if (motion) this.expressions.set(e.name, motion);
    });
    const neutral = jsonBuffer({ Type: "Live2D Expression", Parameters: [] });
    this.expressions.set(NEUTRAL_EXPRESSION, this.loadExpression(neutral, neutral.byteLength, NEUTRAL_EXPRESSION));
    this.scheduler.addUpdatableList(new CubismExpressionUpdater(this._expressionManager));
    progress(`${this.expressions.size - 1} expressions`);

    if (s.getPhysicsFileName()) {
      const buf = await fetchBuffer(opts.url(s.getPhysicsFileName()));
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

    this._breath = CubismBreath.create();
    this._breath.setParameters([
      new BreathParameterData(ids.getId(P.ParamAngleX), 0.0, 15.0, 6.5345, 0.5),
      new BreathParameterData(ids.getId(P.ParamAngleY), 0.0, 8.0, 3.5345, 0.5),
      new BreathParameterData(this.idAngleZ, 0.0, 10.0, 5.5345, 0.5),
      new BreathParameterData(this.idBodyAngleX, 0.0, 4.0, 15.5345, 0.5),
      new BreathParameterData(ids.getId(P.ParamBreath), 0.5, 0.5, 3.2345, 1),
    ]);
    this.scheduler.addUpdatableList(new CubismBreathUpdater(this._breath));

    this.look = CubismLook.create();
    this.look.setParameters([
      new LookParameterData(ids.getId(P.ParamAngleX), 30.0, 0.0, 0.0),
      new LookParameterData(ids.getId(P.ParamAngleY), 0.0, 30.0, 0.0),
      new LookParameterData(this.idAngleZ, 0.0, 0.0, -30.0),
      new LookParameterData(this.idBodyAngleX, 10.0, 0.0, 0.0),
      new LookParameterData(ids.getId(P.ParamEyeBallX), 1.0, 0.0, 0.0),
      new LookParameterData(ids.getId(P.ParamEyeBallY), 0.0, 1.0, 0.0),
    ]);
    this.scheduler.addUpdatableList(new CubismLookUpdater(this.look, this._dragManager));
    this.scheduler.sortUpdatableList();

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
      model.addParameterValueById(this.idAngleZ, this.sway * 12);
      model.addParameterValueById(this.idBodyAngleZ, this.sway * 8);
      model.addParameterValueById(this.idBodyAngleX, this.sway * 6);
    }

    this.scheduler.onLateUpdate(model, dt);
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

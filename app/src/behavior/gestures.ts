// Procedural gestures: short keyframed curves over standard parameters, so every model can nod,
// shake its head, tilt, hop or look away, whatever motion files it ships with. Values are offsets
// added on top of the current pose (degrees for angles, -1..1 or 0..1 for the rest). Parameters a
// model lacks are simply ignored, and physics-driven rigs get them through physicsRoutes.
//
// "EyeClose" is special: 0..1, multiplied out of the eye openness after blinking. ArmL/ArmR,
// ForearmL/ForearmR and HandL/HandR are logical limbs (-1..1, + = away from the body) that
// PetModel maps onto each rig's own arm parameters.

export type Track = [t: number, value: number][];

export interface ProceduralGesture {
  duration: number;
  tracks: Record<string, Track>;
}

const g = (duration: number, tracks: Record<string, Track>): ProceduralGesture => ({ duration, tracks });

export const GESTURES = {
  nod: g(0.9, {
    ParamAngleY: [[0, 0], [0.18, -10], [0.38, 2], [0.58, -6], [0.9, 0]],
    ParamBodyAngleY: [[0, 0], [0.2, -2], [0.6, -1], [0.9, 0]],
  }),
  shake: g(1.1, {
    ParamAngleX: [[0, 0], [0.18, -12], [0.42, 11], [0.66, -8], [0.88, 4], [1.1, 0]],
    ParamEyeBallX: [[0, 0], [0.18, 0.3], [0.42, -0.3], [0.66, 0.2], [1.1, 0]],
    ForearmL: [[0, 0], [0.3, 0.3], [0.9, 0.3], [1.1, 0]],
    ForearmR: [[0, 0], [0.3, 0.3], [0.9, 0.3], [1.1, 0]],
  }),
  tilt: g(1.8, {
    ParamAngleZ: [[0, 0], [0.35, 14], [1.3, 12], [1.8, 0]],
    ParamAngleX: [[0, 0], [0.35, 5], [1.3, 4], [1.8, 0]],
    ParamBrowLY: [[0, 0], [0.35, 0.5], [1.3, 0.4], [1.8, 0]],
    ParamBrowRY: [[0, 0], [0.35, 0.5], [1.3, 0.4], [1.8, 0]],
    ArmR: [[0, 0], [0.4, -0.3], [1.3, -0.3], [1.8, 0]],
  }),
  bounce: g(0.9, {
    PositionY: [[0, 0], [0.15, -6], [0.3, 8], [0.45, -4], [0.6, 5], [0.9, 0]],
    ParamBodyAngleY: [[0, 0], [0.15, -3], [0.3, 4], [0.45, -2], [0.6, 2], [0.9, 0]],
    ParamAngleY: [[0, 0], [0.3, 5], [0.6, 3], [0.9, 0]],
    ArmL: [[0, 0], [0.15, -0.2], [0.3, 0.7], [0.45, -0.1], [0.6, 0.5], [0.9, 0]],
    ArmR: [[0, 0], [0.15, -0.2], [0.3, 0.7], [0.45, -0.1], [0.6, 0.5], [0.9, 0]],
  }),
  hop: g(0.8, {
    PositionY: [[0, 0], [0.12, 10], [0.4, -3], [0.8, 0]],
    ParamBodyAngleY: [[0, 0], [0.12, 5], [0.4, -2], [0.8, 0]],
    ParamAngleY: [[0, 0], [0.12, 8], [0.5, 2], [0.8, 0]],
    ParamBrowLY: [[0, 0], [0.1, 0.8], [0.6, 0.6], [0.8, 0]],
    ParamBrowRY: [[0, 0], [0.1, 0.8], [0.6, 0.6], [0.8, 0]],
    ArmL: [[0, 0], [0.12, 0.9], [0.5, 0.4], [0.8, 0]],
    ArmR: [[0, 0], [0.12, 0.9], [0.5, 0.4], [0.8, 0]],
    ForearmL: [[0, 0], [0.12, 0.7], [0.5, 0.3], [0.8, 0]],
    ForearmR: [[0, 0], [0.12, 0.7], [0.5, 0.3], [0.8, 0]],
  }),
  lean: g(2.2, {
    ParamBodyAngleY: [[0, 0], [0.5, -8], [1.7, -7], [2.2, 0]],
    ParamAngleY: [[0, 0], [0.5, -4], [1.7, -3], [2.2, 0]],
    ParamAngleZ: [[0, 0], [0.5, 4], [1.7, 4], [2.2, 0]],
    ArmL: [[0, 0], [0.5, -0.4], [1.7, -0.4], [2.2, 0]],
    ArmR: [[0, 0], [0.5, -0.4], [1.7, -0.4], [2.2, 0]],
  }),
  wiggle: g(1.6, {
    ParamAngleZ: [[0, 0], [0.25, 9], [0.65, -9], [1.05, 7], [1.4, -3], [1.6, 0]],
    PositionX: [[0, 0], [0.25, -4], [0.65, 4], [1.05, -3], [1.6, 0]],
    ParamBodyAngleZ: [[0, 0], [0.25, 3], [0.65, -3], [1.05, 2], [1.6, 0]],
    ParamMouthForm: [[0, 0], [0.25, 0.5], [1.4, 0.5], [1.6, 0]],
    ArmL: [[0, 0], [0.25, 0.6], [0.65, -0.2], [1.05, 0.5], [1.6, 0]],
    ArmR: [[0, 0], [0.25, -0.2], [0.65, 0.6], [1.05, -0.1], [1.6, 0]],
  }),
  /** Swaying to a tune she hums: slow, rhythmic, both arms swinging gently. */
  sway: g(4.0, {
    ParamAngleZ: [[0, 0], [0.5, 6], [1.5, -6], [2.5, 6], [3.5, -4], [4.0, 0]],
    PositionX: [[0, 0], [0.5, -3], [1.5, 3], [2.5, -3], [3.5, 2], [4.0, 0]],
    ArmL: [[0, 0], [0.5, 0.4], [1.5, -0.1], [2.5, 0.4], [3.5, -0.1], [4.0, 0]],
    ArmR: [[0, 0], [0.5, -0.1], [1.5, 0.4], [2.5, -0.1], [3.5, 0.4], [4.0, 0]],
    ParamMouthForm: [[0, 0], [0.5, 0.4], [3.5, 0.4], [4.0, 0]],
  }),
  /** A small bow: hello, thanks, sorry. */
  bow: g(1.8, {
    ParamBodyAngleY: [[0, 0], [0.4, -20], [1.1, -20], [1.8, 0]],
    ParamAngleY: [[0, 0], [0.4, -22], [1.1, -20], [1.8, 0]],
    ArmL: [[0, 0], [0.4, -0.5], [1.1, -0.5], [1.8, 0]],
    ArmR: [[0, 0], [0.4, -0.5], [1.1, -0.5], [1.8, 0]],
    EyeClose: [[0, 0], [0.4, 0.6], [1.1, 0.6], [1.6, 0]],
  }),
  lookaway: g(2.4, {
    ParamAngleX: [[0, 0], [0.3, 16], [1.9, 14], [2.4, 0]],
    ParamAngleY: [[0, 0], [0.3, -8], [1.9, -7], [2.4, 0]],
    ParamEyeBallX: [[0, 0], [0.2, 0.7], [1.9, 0.6], [2.4, 0]],
    ParamEyeBallY: [[0, 0], [0.2, -0.4], [1.9, -0.4], [2.4, 0]],
    ArmL: [[0, 0], [0.3, -0.4], [1.9, -0.4], [2.4, 0]],
    ArmR: [[0, 0], [0.3, -0.4], [1.9, -0.4], [2.4, 0]],
  }),
  dizzy: g(2.2, {
    ParamAngleZ: [[0, 0], [0.3, 10], [0.7, -10], [1.1, 9], [1.5, -8], [1.9, 4], [2.2, 0]],
    ParamAngleX: [[0, 0], [0.5, 8], [0.9, -8], [1.3, 7], [1.7, -5], [2.2, 0]],
    ParamEyeBallX: [[0, 0], [0.25, 0.8], [0.5, 0], [0.75, -0.8], [1, 0], [1.25, 0.8], [1.5, 0], [1.75, -0.8], [2.2, 0]],
    ParamEyeBallY: [[0, 0], [0.25, 0], [0.5, 0.8], [0.75, 0], [1, -0.8], [1.25, 0], [1.5, 0.8], [1.75, 0], [2.2, 0]],
    ArmL: [[0, 0], [0.3, 0.7], [0.7, -0.2], [1.1, 0.6], [1.5, -0.1], [2.2, 0]],
    ArmR: [[0, 0], [0.3, -0.2], [0.7, 0.7], [1.1, -0.1], [1.5, 0.6], [2.2, 0]],
  }),
  sigh: g(2.4, {
    ParamAngleY: [[0, 0], [0.6, 4], [1.6, -8], [2.4, 0]],
    ParamBodyAngleY: [[0, 0], [0.6, 3], [1.6, -4], [2.4, 0]],
    ParamMouthOpenY: [[0, 0], [1.0, 0], [1.3, 0.35], [1.9, 0.1], [2.2, 0]],
    EyeClose: [[0, 0], [1.0, 0], [1.3, 0.5], [2.0, 0.4], [2.4, 0]],
    ArmL: [[0, 0], [0.6, 0.2], [1.6, -0.4], [2.4, 0]],
    ArmR: [[0, 0], [0.6, 0.2], [1.6, -0.4], [2.4, 0]],
  }),
  yawn: g(3.2, {
    ParamMouthOpenY: [[0, 0], [0.8, 1], [2.0, 1], [2.6, 0.1], [3.2, 0]],
    ParamA: [[0, 0], [0.8, 0.8], [2.0, 0.8], [2.6, 0], [3.2, 0]],
    ParamAngleY: [[0, 0], [0.8, 10], [2.0, 9], [3.2, 0]],
    ParamAngleZ: [[0, 0], [0.8, -6], [2.0, -5], [3.2, 0]],
    EyeClose: [[0, 0], [0.7, 0.85], [2.1, 0.85], [2.8, 0.2], [3.2, 0]],
    ArmL: [[0, 0], [0.8, 0.5], [2.0, 0.5], [3.2, 0]],
    ForearmL: [[0, 0], [0.8, 0.8], [2.0, 0.8], [3.2, 0]],
  }),
  stretch: g(2.6, {
    PositionY: [[0, 0], [0.7, 8], [1.8, 8], [2.6, 0]],
    ParamBodyAngleY: [[0, 0], [0.7, 6], [1.8, 6], [2.6, 0]],
    ParamAngleY: [[0, 0], [0.7, 12], [1.8, 11], [2.6, 0]],
    EyeClose: [[0, 0], [0.6, 0.9], [1.9, 0.9], [2.4, 0], [2.6, 0]],
    ParamMouthOpenY: [[0, 0], [0.7, 0.3], [1.8, 0.3], [2.4, 0]],
    ArmL: [[0, 0], [0.7, 1], [1.8, 1], [2.6, 0]],
    ArmR: [[0, 0], [0.7, 1], [1.8, 1], [2.6, 0]],
    ForearmL: [[0, 0], [0.7, 0.9], [1.8, 0.9], [2.6, 0]],
    ForearmR: [[0, 0], [0.7, 0.9], [1.8, 0.9], [2.6, 0]],
  }),
  /** A jolt while dozing. */
  jolt: g(0.7, {
    ParamAngleY: [[0, 0], [0.1, 12], [0.7, 0]],
    PositionY: [[0, 0], [0.1, 4], [0.7, 0]],
    ArmL: [[0, 0], [0.1, 0.5], [0.7, 0]],
    ArmR: [[0, 0], [0.1, 0.5], [0.7, 0]],
  }),
  /** Beat gestures while talking: a forearm lifts on a stressed syllable. */
  beatL: g(0.5, { ForearmL: [[0, 0], [0.15, 0.6], [0.5, 0]], ArmL: [[0, 0], [0.15, 0.2], [0.5, 0]] }),
  beatR: g(0.5, { ForearmR: [[0, 0], [0.15, 0.6], [0.5, 0]], ArmR: [[0, 0], [0.15, 0.2], [0.5, 0]] }),
} satisfies Record<string, ProceduralGesture>;

export type GestureName = keyof typeof GESTURES;

/** Gestures the LLM may ask for with [act:...]; they work on every model. */
export const SPOKEN_GESTURES: GestureName[] = ["nod", "shake", "tilt", "bounce", "lean", "wiggle", "lookaway", "bow"];

/** Smooth (cosine) interpolation through the keyframes; 0 outside them. */
export function sampleTrack(track: Track, t: number): number {
  if (t <= track[0][0] || t >= track[track.length - 1][0]) return t >= track[track.length - 1][0] ? track[track.length - 1][1] : track[0][1];
  let i = 1;
  while (track[i][0] < t) i++;
  const [t0, v0] = track[i - 1];
  const [t1, v1] = track[i];
  const k = (1 - Math.cos(((t - t0) / (t1 - t0)) * Math.PI)) / 2;
  return v0 + (v1 - v0) * k;
}

/** Every track of a gesture at time `t` (seconds since it started), scaled by `amount`. */
export function sampleGesture(gesture: ProceduralGesture, t: number, amount = 1): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, track] of Object.entries(gesture.tracks)) out[id] = sampleTrack(track, t) * amount;
  return out;
}

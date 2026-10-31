// Maps the fixed emotion/action vocabulary the LLM uses onto whatever this model actually has,
// by matching expression and motion labels (model3 names, VTS hotkeys, or file names).
// M4 replaces the keyword table with LLM-assisted labelling; the interface stays the same.

import { NOT_A_FEELING, pairGestures, type Gesture } from "../behavior/reactions";
import type { ModelProfile } from "../model/types";

const EMOTION_PATTERNS: Record<string, RegExp> = {
  happy: /＞＜|><|笑|开心|smile|happy|joy|grin/i,
  love: /爱心|心心|heart|love/i,
  shy: /脸红|害羞|blush|shy/i,
  sad: /流泪|哭|泪|cry|tear|sad/i,
  angry: /黑脸|生气|怒|angry|mad/i,
  confused: /圈圈|蚊香|晕|dizzy|confus|spiral/i,
  thinking: /加载|思考|loading|think/i,
  nervous: /冷汗|流汗|汗|sweat|nervous|panic/i,
  smug: /屑|得意|smug|tease/i,
  surprised: /惊|shock|surpris/i,
};

/** When a model lacks an emotion, borrow a neighbour. */
const FALLBACK: Record<string, string> = { surprised: "confused", smug: "happy", love: "happy", shy: "love" };

const ACTION_PATTERNS: Record<string, RegExp> = {
  point: /竖手指|竖食指|手指|finger|point/i,
  chest: /抚胸|胸口|chest/i,
  play: /狗尾|草|grass|toy|play/i,
  wave: /挥手|招手|wave/i,
  nod: /点头|nod/i,
};

export interface ExpressionMap {
  /** emotion -> expression name */
  emotions: Map<string, string>;
  /** action -> gesture */
  actions: Map<string, Gesture>;
}

export function buildExpressionMap(profile: ModelProfile): ExpressionMap {
  const feelings = profile.expressions.filter((e) => !NOT_A_FEELING.test(e.label));
  const emotions = new Map<string, string>();
  for (const [emotion, re] of Object.entries(EMOTION_PATTERNS)) {
    const hit = feelings.find((e) => re.test(e.label));
    if (hit) emotions.set(emotion, hit.name);
  }
  for (const [emotion, other] of Object.entries(FALLBACK)) {
    if (!emotions.has(emotion) && emotions.has(other)) emotions.set(emotion, emotions.get(other)!);
  }

  const gestures = pairGestures(profile.motions.filter((m) => m.group !== profile.idleGroup));
  const actions = new Map<string, Gesture>();
  for (const [action, re] of Object.entries(ACTION_PATTERNS)) {
    const hit = gestures.find((g) => re.test(g.open.label));
    if (hit) actions.set(action, hit);
  }
  return { emotions, actions };
}

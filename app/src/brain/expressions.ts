// Maps the fixed emotion/action vocabulary the LLM uses onto whatever this model actually has.
// With a learned profile (brain/labeler.ts) each expression's meaning comes from looking at it;
// before that, or for expressions it could not label, from keywords in the labels.

import { NOT_A_FEELING, pairGestures, type Gesture } from "../behavior/reactions";
import { EMOTIONS, type ExpressionMeaning, type LearnedProfile } from "../model/semantics";
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
  /** emotion -> what it looks like on this model, when learned ("heart-shaped pupils") */
  looks: Map<string, string>;
  /** Pleasant expressions for being patted; empty means "decide by label". */
  pats: string[];
}

export function buildExpressionMap(profile: ModelProfile, learned?: LearnedProfile | null): ExpressionMap {
  const meaning = new Map<string, ExpressionMeaning>((learned?.expressions ?? []).map((m) => [m.name, m]));
  // Learned non-feelings (props, outfits, nothing visible) never stand for an emotion.
  const feelings = profile.expressions.filter((e) => {
    const m = meaning.get(e.name);
    return m ? m.kind === "emotion" : !NOT_A_FEELING.test(e.label);
  });

  const emotions = new Map<string, string>();
  const looks = new Map<string, string>();
  for (const emotion of EMOTIONS) {
    const learnedHits = feelings.map((e) => meaning.get(e.name)).filter((m) => m?.emotion === emotion) as ExpressionMeaning[];
    const best = learnedHits.find((m) => m.intensity === "high") ?? learnedHits[0];
    if (best) {
      emotions.set(emotion, best.name);
      if (best.look) looks.set(emotion, best.look);
      continue;
    }
    // Keywords only for expressions the labeller did not claim for another emotion.
    const hit = feelings.find((e) => !meaning.get(e.name)?.emotion && EMOTION_PATTERNS[emotion].test(e.label));
    if (hit) emotions.set(emotion, hit.name);
  }
  for (const [emotion, other] of Object.entries(FALLBACK)) {
    if (!emotions.has(emotion) && emotions.has(other)) {
      emotions.set(emotion, emotions.get(other)!);
      if (looks.has(other)) looks.set(emotion, looks.get(other)!);
    }
  }

  const pats = feelings
    .map((e) => meaning.get(e.name))
    .filter((m): m is ExpressionMeaning => !!m && m.valence > 0.2 && m.emotion !== "thinking")
    .map((m) => m.name);

  const gestures = pairGestures(profile.motions.filter((m) => m.group !== profile.idleGroup));
  const actions = new Map<string, Gesture>();
  for (const [action, re] of Object.entries(ACTION_PATTERNS)) {
    const hit = gestures.find((g) => re.test(g.open.label));
    if (hit) actions.set(action, hit);
  }
  return { emotions, actions, looks, pats };
}

// What a model's expressions mean, learned once per model (see brain/labeler.ts) and cached.
//
// Each expression gets a kind, an emotion from our fixed vocabulary, intensity, valence/arousal and
// a few words on what it looks like. The bank-with-descriptions shape follows Xpress (arXiv
// 2503.00283); valence/arousal per expression follows Live Emoji (arXiv 1902.03529).

import type { ProfileExpression } from "./types";

export const EMOTIONS = [
  "happy",
  "love",
  "shy",
  "sad",
  "angry",
  "confused",
  "thinking",
  "nervous",
  "smug",
  "surprised",
] as const;

/** Hints for the labelling model, so neighbouring emotions are told apart the same way every time. */
const EMOTION_HINTS: Record<string, string> = {
  happy: "joy, laughing, >< eyes",
  love: "adoration, heart eyes",
  shy: "embarrassed, blushing",
  sad: "tears, crying",
  angry: "annoyed, dark face, veins",
  confused: "dizzy, puzzled, spiral eyes",
  thinking: "pondering, busy, loading spinner",
  nervous: "anxious, cold sweat",
  smug: "teasing, sly, mischievous",
  surprised: "shocked, wide eyes",
};

export const KINDS = ["emotion", "accessory", "outfit", "body", "none", "other"] as const;
export type Kind = (typeof KINDS)[number];

export interface ExpressionMeaning {
  name: string;
  kind: Kind;
  /** One of EMOTIONS for kind "emotion" when one fits, else null. */
  emotion: string | null;
  intensity: "low" | "high";
  /** -1 (unpleasant) .. 1 (pleasant). */
  valence: number;
  /** 0 (calm) .. 1 (excited). */
  arousal: number;
  /** What changes, in a few words ("heart-shaped pupils"). */
  look: string;
  /** "vision" when judged from rendered stills, "text" when only from names. */
  from: "vision" | "text";
}

export interface LearnedProfile {
  version: number;
  /** The LLM that labelled the expressions. */
  labeller: string;
  learnedAt: string;
  expressions: ExpressionMeaning[];
}

/** Bump when the labelling changes enough that cached profiles should be relearned. */
export const PROFILE_VERSION = 1;

/** Exp3 parameter entry, as stored in *.exp3.json. */
export interface Exp3Parameter {
  Id: string;
  Value: number;
  Blend?: string;
}

/** Stable cache key for a model: its path, its expressions and the labelling version. */
export function profileKey(modelPath: string, expressions: ProfileExpression[]): string {
  const text = [PROFILE_VERSION, modelPath, ...expressions.map((e) => `${e.name}\u0000${e.file}`)].join("\u0001");
  const fnv = (seed: number) => {
    let h = seed >>> 0;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, "0");
  };
  return fnv(0x811c9dc5) + fnv(0x2f6b8a3d);
}

const basename = (p: string) => p.slice(p.lastIndexOf("/") + 1);

/** One line of evidence per expression: its name, file and the parameters it moves, by display name. */
export function describeExpression(
  e: ProfileExpression,
  params: Exp3Parameter[],
  parameterNames: Record<string, string>,
): string {
  const moves = params.map((p) => {
    const op = p.Blend === "Multiply" ? "×" : p.Blend === "Overwrite" ? "=" : p.Value >= 0 ? "+" : "";
    const label = parameterNames[p.Id] && parameterNames[p.Id] !== p.Id ? `${parameterNames[p.Id]} (${p.Id})` : p.Id;
    return `${label} ${op}${+p.Value.toFixed(2)}`;
  });
  return `name "${e.name}", file ${basename(e.file)}, changes: ${moves.join(", ") || "nothing"}`;
}

export interface LabelItem {
  name: string;
  evidence: string;
  /** JPEG data URL: rest pose on the left, this expression on the right. */
  image?: string;
  /** False when the rendered still showed no change at all. */
  visible: boolean;
}

/** OpenAI-style chat messages asking for one JSON label per item. */
export function labelMessages(items: LabelItem[], withImages: boolean): unknown[] {
  const system = [
    "You label the expressions of a Live2D character so that an AI companion can use them while chatting.",
    "Each expression is a toggle the character can switch on. Answer with JSON only.",
  ].join(" ");
  const instructions = [
    withImages
      ? "For each expression you get its name and file (often Chinese or Japanese, sometimes meaningless like exp_03), the parameters it changes, and usually an image: the character at rest on the left, the same view with the expression switched on next to it, and for small changes a close-up of what changed on the far right. Judge mainly from the image; use names as hints. Small details matter: tears, blush, sweat drops and symbols are emotions."
      : "For each expression you get its name and file (often Chinese or Japanese, sometimes meaningless like exp_03) and the parameters it changes, with their display names. Judge from those.",
    "",
    'Return {"expressions":[{"name":..., "kind":..., "emotion":..., "intensity":..., "valence":..., "arousal":..., "look":...}]} with one entry per expression, in the given order, "name" copied exactly.',
    '- kind: "emotion" = shows a feeling or state of mind (face changes, blush, tears, sweat drops, symbols such as hearts or a loading spinner); "accessory" = adds or removes an item or prop (glasses, hat, held object); "outfit" = clothing changes; "body" = body shape, size or posture; "none" = nothing visible changes; "other".',
    `- emotion: for kind "emotion", the closest of: ${EMOTIONS.map((e) => `${e} (${EMOTION_HINTS[e]})`).join(", ")}; null if none fits or for other kinds.`,
    '- intensity: "low" or "high". valence: -1 (unpleasant) to 1 (pleasant). arousal: 0 (calm) to 1 (excited).',
    '- look: what changes, at most 6 English words, e.g. "heart-shaped pupils", "steel basin on head".',
    "",
    "Expressions:",
    ...items.map((it, i) => {
      const seen = !it.visible ? " — the rendered still shows no change at rest" : withImages && it.image ? ` — image ${i + 1}` : "";
      return `${i + 1}. ${it.evidence}${seen}`;
    }),
  ].join("\n");

  const content: unknown[] = [{ type: "text", text: instructions }];
  if (withImages) {
    items.forEach((it, i) => {
      if (!it.image) return;
      content.push({ type: "text", text: `Image ${i + 1} ("${it.name}"):` });
      content.push({ type: "image_url", image_url: { url: it.image } });
    });
  }
  return [
    { role: "system", content: system },
    { role: "user", content: withImages ? content : instructions },
  ];
}

const clamp = (v: unknown, lo: number, hi: number, fallback: number) =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;

/** Reads the labeller's JSON; keeps only entries naming one of `names`, with every field checked. */
export function parseMeanings(text: string, names: string[], from: ExpressionMeaning["from"]): Map<string, ExpressionMeaning> {
  const out = new Map<string, ExpressionMeaning>();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  let data: unknown;
  try {
    data = JSON.parse(start >= 0 && end > start ? text.slice(start, end + 1) : text);
  } catch {
    return out;
  }
  const list = (data as { expressions?: unknown })?.expressions;
  if (!Array.isArray(list)) return out;
  const wanted = new Set(names);
  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const name = typeof r.name === "string" ? r.name.trim() : "";
    if (!wanted.has(name) || out.has(name)) continue;
    const kind = (KINDS as readonly string[]).includes(String(r.kind)) ? (r.kind as Kind) : "other";
    const emotion = String(r.emotion ?? "").toLowerCase();
    out.set(name, {
      name,
      kind,
      emotion: kind === "emotion" && (EMOTIONS as readonly string[]).includes(emotion) ? emotion : null,
      intensity: r.intensity === "high" ? "high" : "low",
      valence: clamp(r.valence, -1, 1, 0),
      arousal: clamp(r.arousal, 0, 1, 0.5),
      look: typeof r.look === "string" ? r.look.trim().slice(0, 60) : "",
      from,
    });
  }
  return out;
}

// Director's notes for each line she speaks. MiMo performs far better when told who is speaking,
// what is happening and how to deliver it ("director mode": character, scene, direction) than
// from a bare emotion tag, which reads like someone reciting text.

export interface DirectionInput {
  name: string;
  /** What her voice is like (the designed voice's description), if known. */
  voice?: string | null;
  emotion: string | null;
  /** What the user just said, when she is answering them. */
  replyingTo?: string | null;
  /** Self-talk: quiet, to herself. */
  quiet: boolean;
  zh: boolean;
}

const HOW_ZH: Record<string, string> = {
  happy: "开心，语调轻快上扬，话里带着笑意",
  love: "温柔，声音放软，有点甜",
  shy: "害羞，声音放轻，有点不好意思，句尾收得很快",
  sad: "有点低落，语速放慢，声音轻一些",
  angry: "鼓着腮帮子的小生气，嘴硬，但不是真的凶",
  confused: "疑惑，尾音微微拖长上扬",
  thinking: "一边想一边说，中间自然地停顿",
  nervous: "有点慌，语速稍快，气息不太稳",
  smug: "得意又俏皮，带点小骄傲",
  surprised: "惊讶，开头音调突然升高",
};

const HOW_EN: Record<string, string> = {
  happy: "happy, light and rising, a smile in the voice",
  love: "tender, soft and a little sweet",
  shy: "shy, quieter, a bit embarrassed, trailing off quickly",
  sad: "a little down, slower and softer",
  angry: "pouting, playfully stubborn, never truly harsh",
  confused: "puzzled, ends drawn out and rising",
  thinking: "thinking while talking, natural pauses",
  nervous: "flustered, a bit fast, breath unsteady",
  smug: "pleased with herself, playful",
  surprised: "surprised, pitch jumps at the start",
};

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

export function direction(d: DirectionInput): string {
  if (d.zh) {
    const who = `角色：${d.name}，住在用户桌面上的陪伴角色${d.voice ? `。声音：${clip(d.voice, 160)}` : ""}。`;
    const scene = d.quiet
      ? "场景：一边忙自己的事一边小声自言自语，不是对着用户说。"
      : `场景：在桌面上和熟悉的朋友随口聊天${d.replyingTo ? `，正在回应对方说的「${clip(d.replyingTo, 60)}」` : ""}。`;
    const how = [
      "指导：像真的在说话，不是念稿；口语化，有轻重缓急和自然的停顿、换气",
      d.quiet ? "声音很轻" : "",
      d.emotion && HOW_ZH[d.emotion] ? `情绪：${HOW_ZH[d.emotion]}` : "",
    ]
      .filter(Boolean)
      .join("；");
    return `${who}\n${scene}\n${how}。`;
  }
  const who = `Character: ${d.name}, a companion living on the user's desktop${d.voice ? `. Voice: ${clip(d.voice, 160)}` : ""}.`;
  const scene = d.quiet
    ? "Scene: murmuring to herself while busy with her own thing, not addressing the user."
    : `Scene: chatting casually with a close friend at their desk${d.replyingTo ? `, answering "${clip(d.replyingTo, 60)}"` : ""}.`;
  const how = [
    "Direction: really talking, not reading; conversational, with natural emphasis, pauses and breaths",
    d.quiet ? "very soft" : "",
    d.emotion && HOW_EN[d.emotion] ? `emotion: ${HOW_EN[d.emotion]}` : "",
  ]
    .filter(Boolean)
    .join("; ");
  return `${who}\n${scene}\n${how}.`;
}

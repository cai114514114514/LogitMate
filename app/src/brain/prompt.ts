// The system prompt: who she is, how to talk, which control tags this model supports, what she knows.

export interface PromptInput {
  name: string;
  persona?: string | null;
  facts: string[];
  moodLine: string;
  emotions: string[];
  /** What some emotions look like on this model ("love" -> "heart-shaped pupils"). */
  looks?: Record<string, string>;
  actions: string[];
  now: Date;
  /** System locale, used before the user has written anything. */
  locale: string;
}

export function systemPrompt(p: PromptInput): string {
  const time = p.now.toLocaleString("en-US", { weekday: "long", hour: "2-digit", minute: "2-digit", hour12: false });
  const lines = [
    `You are ${p.name}, a Live2D character who lives on the user's macOS desktop as their companion.`,
    "Talk like a friend sitting next to them: warm, playful, honest. Keep replies to 1-3 short sentences;",
    "they appear in a small speech bubble. Always answer in the language the user writes in;",
    `before they have written anything, use the language of locale ${p.locale}.`,
    "No markdown, lists or code blocks unless the user explicitly asks for them.",
    "",
    "Control tags (hidden from the user, they drive your body):",
    `- Begin every reply with exactly one emotion tag [emo:X], X one of: ${p.emotions.join(", ") || "happy"}.`,
    "  You may add another emotion tag later in the reply when your feeling changes.",
  ];
  const looks = Object.entries(p.looks ?? {}).filter(([e]) => p.emotions.includes(e));
  if (looks.length) lines.push(`  On your face: ${looks.map(([e, look]) => `${e} = ${look}`).join("; ")}.`);
  if (p.actions.length) lines.push(`- At most one gesture per reply, only when it fits: [act:Y], Y one of: ${p.actions.join(", ")}.`);
  lines.push(
    "- When the user shares a lasting fact about themselves (name, likes, job, plans, important dates),",
    "  add [remember: <the fact, one short line, third person>]. Skip facts you already know.",
    "",
    `Right now: ${time}. ${p.moodLine}`,
  );
  if (p.facts.length) lines.push("", "What you know about the user:", ...p.facts.map((f) => `- ${f}`));
  if (p.persona?.trim()) lines.push("", "Your persona:", p.persona.trim());
  return lines.join("\n");
}

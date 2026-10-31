// Designing her voice: a vision model looks at the character and writes a voice description in
// MiMo's format, MiMo VoiceDesign turns it into a sample, the user keeps one, and from then on
// every line clones that sample, so any model gets a voice that fits it and stays the same.

import { invoke } from "@tauri-apps/api/core";

export interface VoiceBrief {
  /** One or two sentences describing only the voice (MiMo voice-design rules). */
  description: string;
  /** A short self-introduction to audition the voice with. */
  line: string;
}

/** The request to the vision model; `image` is a still of the character. */
export function briefMessages(name: string, persona: string | null | undefined, zh: boolean, image: string): unknown[] {
  const rules = [
    "You are a voice director casting a voice for a Live2D desktop companion.",
    `Look at the character in the image. Her name is ${name}.${persona?.trim() ? ` Persona: ${persona.trim()}` : ""}`,
    "Write a voice description for a text-to-speech voice designer, following these rules strictly:",
    "- In Chinese, one or two plain sentences, no lists.",
    "- Must include: age range and gender; the texture of the voice (breath, resonance, articulation, using concrete verbs or images rather than piles of adjectives); pace and rhythm; the default emotional state.",
    "- Optionally one style anchor and one memorable little habit (e.g. a soft giggle at the end of sentences).",
    "- Describe only the voice: no scene, no actions, no real actors or existing characters' names.",
    `Also write a 2-3 sentence self-introduction she would say on meeting the user, in ${zh ? "Chinese" : "English"}, in character and matching the voice.`,
    'Answer with JSON only: {"description": "...", "line": "..."}',
  ].join("\n");
  return [
    {
      role: "user",
      content: [
        { type: "text", text: rules },
        { type: "image_url", image_url: { url: image } },
      ],
    },
  ];
}

export function parseBrief(text: string): VoiceBrief | null {
  try {
    const start = text.indexOf("{");
    const data = JSON.parse(text.slice(start, text.lastIndexOf("}") + 1)) as Partial<VoiceBrief>;
    const description = data.description?.trim();
    const line = data.line?.trim();
    return description && line ? { description: description.slice(0, 300), line: line.slice(0, 200) } : null;
  } catch {
    return null;
  }
}

export async function writeBrief(name: string, persona: string | null | undefined, zh: boolean, image: string): Promise<VoiceBrief> {
  const reply = await invoke<string>("llm_complete", { messages: briefMessages(name, persona, zh, image), json: true, vision: true });
  const brief = parseBrief(reply);
  if (!brief) throw new Error("could not write a voice description");
  return brief;
}

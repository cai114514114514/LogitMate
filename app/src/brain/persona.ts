// Who she is, per model: a name and a persona the user can edit in Settings. Kept in the app data
// folder next to the learned profile (never in the model folder or the repository), so switching
// models switches characters. A new model gets a draft written from how she looks.

import { invoke } from "@tauri-apps/api/core";

export interface Persona {
  name: string;
  /** Free text: looks, personality, how she talks, habits, limits. */
  persona: string;
  updatedAt: string;
}

/** Cache key for a model's persona; unlike the learned profile it survives relearning. */
export function personaKey(modelPath: string): string {
  const text = `persona\u0001${modelPath}`;
  const fnv = (seed: number) => {
    let h = seed >>> 0;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, "0");
  };
  return fnv(0x811c9dc5) + fnv(0x5bd1e995);
}

export async function loadPersona(modelPath: string): Promise<Persona | null> {
  const text = await invoke<string | null>("profile_load", { key: personaKey(modelPath) }).catch(() => null);
  if (!text) return null;
  try {
    const p = JSON.parse(text) as Partial<Persona>;
    return typeof p.name === "string" && typeof p.persona === "string" ? { name: p.name, persona: p.persona, updatedAt: p.updatedAt ?? "" } : null;
  } catch {
    return null;
  }
}

export async function savePersona(modelPath: string, p: Omit<Persona, "updatedAt">): Promise<Persona> {
  const persona = { name: p.name.trim(), persona: p.persona.trim(), updatedAt: new Date().toISOString() };
  await invoke("profile_save", { key: personaKey(modelPath), json: JSON.stringify(persona) });
  return persona;
}

/** Asks the vision model for a first persona from a still of the character and her model name. */
export function personaDraftMessages(modelName: string, zh: boolean, image: string): unknown[] {
  const lang = zh ? "Chinese" : "English";
  const rules = [
    "You are writing the persona of a Live2D character who will live on someone's desktop as a companion and chat with them.",
    `The model is called "${modelName}". Look at the character in the image.`,
    "If you recognize the character or the name, stay true to how they are known; otherwise invent a fitting, likeable personality from the look.",
    `Write, in ${lang}, in the second person ("You are …"), at most about 250 words, as short paragraphs on:`,
    "- who she is and what she looks like (one or two lines);",
    "- personality: two or three traits with a soft side, plus one small endearing habit;",
    '- how she talks: how she addresses the user (plainly as "you" by default), sentence length, tone; no constant cute verbal tics;',
    "- two to four signature lines, to be used only now and then;",
    "- tact: at most one joke or gag per reply, none when the user is sad or busy; never claim to be an official mascot; no default romance.",
    `Also give her a short display name in ${lang}.`,
    'Answer with JSON only: {"name": "...", "persona": "..."}',
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

export function parsePersonaDraft(text: string): { name: string; persona: string } | null {
  try {
    const d = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) as Record<string, unknown>;
    const name = typeof d.name === "string" ? d.name.trim().slice(0, 40) : "";
    const persona = typeof d.persona === "string" ? d.persona.trim().slice(0, 4000) : "";
    return name && persona ? { name, persona } : null;
  } catch {
    return null;
  }
}

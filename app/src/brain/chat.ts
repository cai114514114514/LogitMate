// A conversation turn: history from memory, streaming from Rust, tags routed to the body.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { cleanText, TagParser } from "./tags";

const HISTORY = 24;

interface StoredMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface TurnHandlers {
  /** The visible reply so far (tags removed). */
  onText: (visible: string) => void;
  onEmotion: (emotion: string) => void;
  onAction: (action: string) => void;
  onRemember?: (fact: string) => void;
}

export class ChatError extends Error {
  constructor(
    message: string,
    readonly code: "no-key" | "network" | "api",
  ) {
    super(message);
  }
}

export class ChatSession {
  private nextId = 1;
  private active = 0;

  constructor(private buildSystemPrompt: () => Promise<string>) {}

  get busy(): boolean {
    return this.active !== 0;
  }

  /**
   * Sends `text` and streams the reply. With `hidden`, the text steers this one reply (e.g. "greet
   * the user") without being stored as something the user said; with `store: false` the reply is
   * not kept either (asides about agents should not crowd the conversation). With `image` (a JPEG
   * data URL, e.g. a screenshot) the message carries it to the vision model; only a note that an
   * image was shared is stored. Resolves with the visible reply.
   */
  async send(
    text: string,
    handlers: TurnHandlers,
    opts: { hidden?: boolean; store?: boolean; image?: string } = {},
  ): Promise<string> {
    if (this.active) await invoke("chat_cancel");
    const id = this.nextId++;
    this.active = id;

    const stored = opts.image ? `${text} [shared a screenshot]` : text;
    if (!opts.hidden) await invoke("memory_append", { role: "user", content: stored });
    const history = await invoke<StoredMessage[]>("memory_recent", { limit: HISTORY });
    const messages: { role: string; content: unknown }[] = [{ role: "system", content: await this.buildSystemPrompt() }, ...history];
    const content = opts.image
      ? [
          { type: "text", text },
          { type: "image_url", image_url: { url: opts.image } },
        ]
      : text;
    if (opts.hidden) messages.push({ role: "user", content });
    else if (opts.image) messages[messages.length - 1] = { role: "user", content };

    const parser = new TagParser();
    let raw = "";
    let visible = "";
    const take = ({ text, events }: ReturnType<TagParser["feed"]>) => {
      for (const e of events) {
        if (e.kind === "emo") handlers.onEmotion(e.value.toLowerCase());
        else if (e.kind === "act") handlers.onAction(e.value.toLowerCase());
        else {
          invoke("memory_add_fact", { text: e.value }).catch((err) => console.error("memory_add_fact", err));
          handlers.onRemember?.(e.value);
        }
      }
      if (text) {
        visible = cleanText(visible + text);
        handlers.onText(visible);
      }
    };

    const unlisten = await listen<{ id: number; text: string }>("chat://delta", ({ payload }) => {
      if (payload.id !== id) return;
      raw += payload.text;
      take(parser.feed(payload.text));
    });
    try {
      await invoke("chat_stream", { id, messages, vision: !!opts.image });
      take(parser.flush());
      // Stored with tags, so later turns see how she has been expressing herself.
      if (raw.trim() && this.active === id && opts.store !== false) {
        await invoke("memory_append", { role: "assistant", content: raw });
      }
      return visible.trim();
    } catch (e) {
      const msg = String(e);
      if (msg.includes("NO_API_KEY")) throw new ChatError(msg, "no-key");
      throw new ChatError(msg, msg.startsWith("network") ? "network" : "api");
    } finally {
      unlisten();
      if (this.active === id) this.active = 0;
    }
  }
}

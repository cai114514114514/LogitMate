// Ties the brain to the body: a chat turn drives the bubble, expressions, gestures and mood,
// and between turns she greets you and fidgets on her own.

import { ChatError, type ChatSession } from "../brain/chat";
import type { ExpressionMap } from "../brain/expressions";
import type { ChatUI } from "../ui/chatUi";
import type { Mood } from "./mood";
import type { Reactions } from "./reactions";

/** After a reply, hold the last expression this long before relaxing. */
const LINGER_MS = 4000;
/** Quiet time before she starts fidgeting on her own. */
const IDLE_BEFORE_FIDGET_MS = 4 * 60_000;

export interface CompanionDeps {
  chat: ChatSession;
  ui: ChatUI;
  reactions: Reactions;
  mood: Mood;
  map: ExpressionMap;
}

export class Companion {
  private lastInteraction = Date.now();

  constructor(private d: CompanionDeps) {}

  /** Something the user typed. */
  async talk(text: string): Promise<void> {
    this.noteInteraction();
    this.d.mood.onChat();
    await this.turn(text, false);
  }

  /** Says hello when the user comes back, or introduces herself the first time. */
  async greet(hoursAway: number, firstRun: boolean): Promise<void> {
    const note = firstRun
      ? "(System note, not from the user: this is the first time you meet the user. Introduce yourself in one or two short sentences and mention they can double-click you to chat.)"
      : `(System note, not from the user: the user is back after about ${Math.round(hoursAway)} hours away. Greet them in one short sentence.)`;
    await this.turn(note, true);
  }

  /**
   * A one-line aside in her own voice (agent finished, agent needs you…), not kept in the
   * conversation. While the user is talking to her she stays quiet. Falls back to `fallback`.
   */
  async remark(note: string, fallback: string, onClick?: () => void): Promise<void> {
    const { chat, ui, reactions, map } = this.d;
    if (chat.busy) return;
    try {
      const reply = await chat.send(
        note,
        {
          onText: (visible) => ui.say(visible, true, onClick),
          onEmotion: (emotion) => {
            const name = map.emotions.get(emotion);
            if (name) reactions.express(name, 0);
          },
          onAction: (action) => {
            const gesture = map.actions.get(action);
            if (gesture) reactions.gesture(gesture);
          },
        },
        { hidden: true, store: false },
      );
      if (!reply) ui.say(fallback, false, onClick);
      else ui.done();
    } catch {
      ui.say(fallback, false, onClick);
    }
    reactions.relax(LINGER_MS);
  }

  noteInteraction(): void {
    this.lastInteraction = Date.now();
  }

  /** Call periodically; lets mood drift and occasionally fidgets when nobody is around. */
  tick(seconds: number): void {
    this.d.mood.tick(seconds);
    const quiet = Date.now() - this.lastInteraction > IDLE_BEFORE_FIDGET_MS;
    if (quiet && !this.d.chat.busy && Math.random() < 0.15 * this.d.mood.energy()) {
      if (Math.random() < 0.5) this.d.reactions.gesture();
      else this.d.reactions.pat();
    }
  }

  private async turn(text: string, hidden: boolean): Promise<void> {
    const { chat, ui, reactions, mood, map } = this.d;
    ui.say("", true);
    const thinking = map.emotions.get("thinking");
    if (thinking) reactions.express(thinking, 0);

    try {
      const reply = await chat.send(
        text,
        {
          onText: (visible) => ui.say(visible, true),
          onEmotion: (emotion) => {
            mood.onEmotion(emotion);
            const name = map.emotions.get(emotion);
            if (name) reactions.express(name, 0);
            else reactions.relax();
          },
          onAction: (action) => {
            const gesture = map.actions.get(action);
            if (gesture) reactions.gesture(gesture);
          },
          onRemember: (fact) => console.info(`[pet] remembered: ${fact}`),
        },
        { hidden },
      );
      if (!reply) ui.say("…");
      ui.done();
      reactions.relax(LINGER_MS);
    } catch (e) {
      const nervous = map.emotions.get("nervous") ?? map.emotions.get("sad");
      if (nervous) reactions.express(nervous, LINGER_MS);
      ui.say(errorLine(e));
      console.error("[pet] chat failed", e);
    }
  }
}

function errorLine(e: unknown): string {
  if (e instanceof ChatError && e.code === "no-key") {
    return "I can't think without a DeepSeek API key. Put DEEPSEEK_API_KEY in .env, or save it to the Keychain.";
  }
  if (e instanceof ChatError && e.code === "network") return "I can't reach the internet right now…";
  return `Something went wrong: ${String(e instanceof Error ? e.message : e).slice(0, 120)}`;
}

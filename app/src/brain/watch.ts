// Watch Over Me (opt-in): now and then she glances at the screen and, rarely, says something.
//
// Default is silence. She speaks when it is welcome: an error or a stuck moment, something just
// finished, something fun on screen, working late. Never during meetings or screen sharing, with
// a password manager in front, or when nobody is at the computer. Screenshots are not kept.

import type { FrontApp } from "../behavior/focus";

/** Minutes between glances: a random point in this range, so it never feels like a timer. */
export const GLANCE_MIN = 4;
export const GLANCE_MAX = 8;
/** At least this long between remarks, unless something went wrong on screen. */
export const REMARK_COOLDOWN_MS = 15 * 60_000;
/** Nobody has moved the cursor for this long: nobody is there to talk to. */
export const AWAY_MS = 3 * 60_000;

/** Apps she never looks at: meetings and screen sharing, password managers. */
const PRIVATE_APPS =
  /zoom|teams|facetime|webex|meet|腾讯会议|tencent ?meeting|wemeet|飞书会议|lark meeting|钉钉会议|skype|discord|obs studio|obsproject|1password|bitwarden|keepass|dashlane|lastpass|keychain|钥匙串|passwords|密码/i;

export function isPrivateApp(app: FrontApp | null): boolean {
  return !!app && (PRIVATE_APPS.test(app.name) || PRIVATE_APPS.test(app.bundle));
}

export interface WatchState {
  nextGlance: number;
  lastRemark: number;
  /** Her last few remarks, so she doesn't repeat herself. */
  recent: string[];
}

export function initialWatch(now: number, random = Math.random): WatchState {
  return { nextGlance: now + glanceGap(random), lastRemark: 0, recent: [] };
}

export function glanceGap(random = Math.random): number {
  return (GLANCE_MIN + random() * (GLANCE_MAX - GLANCE_MIN)) * 60_000;
}

export interface WatchContext {
  name: string;
  persona?: string | null;
  zh: boolean;
  now: Date;
  app: string | null;
  /** Task of a focus session in progress. */
  focusTask?: string | null;
  recent: string[];
  emotions: string[];
}

export function watchMessages(ctx: WatchContext, image: string): unknown[] {
  const time = ctx.now.toLocaleString("en-US", { weekday: "long", hour: "2-digit", minute: "2-digit", hour12: false });
  const rules = [
    `You are ${ctx.name}, a companion living on the user's desktop.${ctx.persona?.trim() ? ` Persona: ${ctx.persona.trim()}` : ""}`,
    "The user asked you to keep them company by glancing at their screen now and then. This is one glance (the image).",
    `It is ${time}. Frontmost app: ${ctx.app ?? "unknown"}.`,
    ctx.focusTask
      ? `They are in a focus session working on "${ctx.focusTask}": speak only if they look stuck, hit an error, or have clearly drifted off the task (then a gentle nudge).`
      : "",
    "Decide whether to say something. Almost always stay quiet. Speak only when it is genuinely welcome:",
    "- they hit an error, a failing build or test, or look stuck (one concrete hint if it is obvious from the screen);",
    "- they just finished or shipped something;",
    "- something fun or interesting is on screen (one light reaction);",
    "- it is late at night and they are still working (gentle care).",
    "Never quote or mention private content: messages, names, emails, numbers, addresses, passwords.",
    ctx.recent.length ? `Don't repeat yourself; your recent remarks: ${ctx.recent.map((r) => `"${r}"`).join(", ")}.` : "",
    `If you speak: one short sentence in ${ctx.zh ? "Chinese" : "English"}, in character, like a friend sitting nearby.`,
    `Answer JSON only: {"say": true|false, "line": "...", "emotion": one of ${ctx.emotions.join(", ") || "happy"}, "urgent": true if they hit an error}`,
  ].filter(Boolean);
  return [
    {
      role: "user",
      content: [
        { type: "text", text: rules.join("\n") },
        { type: "image_url", image_url: { url: image } },
      ],
    },
  ];
}

export interface WatchDecision {
  say: boolean;
  line: string;
  emotion: string | null;
  urgent: boolean;
}

export function parseWatch(text: string): WatchDecision | null {
  try {
    const d = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) as Record<string, unknown>;
    const line = typeof d.line === "string" ? d.line.trim().slice(0, 120) : "";
    return {
      say: d.say === true && line !== "",
      line,
      emotion: typeof d.emotion === "string" ? d.emotion.toLowerCase() : null,
      urgent: d.urgent === true,
    };
  } catch {
    return null;
  }
}

/** Whether a decision to speak gets through the cooldown; errors always do. */
export function mayRemark(state: WatchState, decision: WatchDecision, now: number): boolean {
  return decision.say && (decision.urgent || now - state.lastRemark >= REMARK_COOLDOWN_MS);
}

export function noteRemark(state: WatchState, line: string, now: number): void {
  state.lastRemark = now;
  state.recent = [...state.recent, line].slice(-5);
}

// Agent Face: reacts to coding agents (Claude Code, Codex, Logit-Harness) reported by the Rust bridge.
// Working -> she thinks along. Waiting for you -> she tells you, and her bubble jumps to the terminal.
// Long task done -> she says so. Commands keep failing -> she cheers you up. Otherwise she stays quiet.

export type AgentEventKind =
  | "session-start"
  | "prompt"
  | "tool-start"
  | "tool-end"
  | "tool-failed"
  | "needs-input"
  | "turn-end"
  | "session-end";

export interface AgentEvent {
  agent: string;
  kind: AgentEventKind;
  session?: string | null;
  project?: string | null;
  tool?: string | null;
  detail?: string | null;
  terminal?: string | null;
}

/** What the face asks the body to do; kept abstract so the logic is testable. */
export type Reaction =
  | { type: "thinking"; on: boolean }
  | { type: "emotion"; emotion: string; ms: number }
  | { type: "remark"; note: string; fallback: string; terminal?: string | null };

const AGENT_NAMES: Record<string, string> = { "claude-code": "Claude Code", codex: "Codex", loh: "Logit-Harness" };
/** A turn longer than this is worth announcing when it ends. */
export const ANNOUNCE_AFTER_MS = 45_000;
/** Relax the thinking face after this long without agent activity. */
const IDLE_MS = 4000;
const NEEDS_INPUT_COOLDOWN_MS = 30_000;
const CHEER_AFTER_FAILURES = 3;
const CHEER_COOLDOWN_MS = 10 * 60_000;

interface SessionState {
  turnStartedAt: number | null;
  failuresInARow: number;
  lastNeedsInput: number;
  lastCheer: number;
}

export function agentName(agent: string): string {
  return AGENT_NAMES[agent] ?? agent;
}

export class AgentFace {
  private sessions = new Map<string, SessionState>();
  private lastActivity = 0;
  private thinking = false;

  constructor(
    private react: (r: Reaction) => void,
    private zh = false,
    private clock: () => number = Date.now,
  ) {}

  handle(ev: AgentEvent): void {
    const now = this.clock();
    const key = `${ev.agent}:${ev.session ?? ev.project ?? ""}`;
    let s = this.sessions.get(key);
    if (!s) {
      s = { turnStartedAt: null, failuresInARow: 0, lastNeedsInput: -Infinity, lastCheer: -Infinity };
      this.sessions.set(key, s);
    }
    const name = agentName(ev.agent);
    const where = ev.project ? (this.zh ? `（${ev.project}）` : ` in ${ev.project}`) : "";

    switch (ev.kind) {
      case "prompt":
        s.turnStartedAt = now;
        this.working(now);
        break;
      case "tool-start":
        s.turnStartedAt ??= now;
        this.working(now);
        break;
      case "tool-end":
        s.failuresInARow = 0;
        this.working(now);
        break;
      case "tool-failed":
        s.failuresInARow++;
        this.working(now);
        if (s.failuresInARow >= CHEER_AFTER_FAILURES && now - s.lastCheer > CHEER_COOLDOWN_MS) {
          s.lastCheer = now;
          this.react({
            type: "remark",
            note: `(System note, not from the user: ${name}'s commands keep failing${where}. Cheer the user up in one short sentence.)`,
            fallback: this.zh ? `${name} 一直报错呢${where}……别急，慢慢来。` : `${name} keeps hitting errors${where}… you've got this.`,
          });
        }
        break;
      case "needs-input": {
        this.stopThinking();
        if (now - s.lastNeedsInput < NEEDS_INPUT_COOLDOWN_MS) break;
        s.lastNeedsInput = now;
        const detail = ev.detail ? `: "${ev.detail}"` : "";
        this.react({
          type: "remark",
          note: `(System note, not from the user: ${name} is waiting for the user${where}${detail}. Tell them in one short sentence; clicking your speech bubble opens it.)`,
          fallback: this.zh ? `${name} 在等你${where}，点我的气泡过去看看～` : `${name} needs you${where} — click my bubble to jump there.`,
          terminal: ev.terminal,
        });
        break;
      }
      case "turn-end": {
        this.stopThinking();
        const took = s.turnStartedAt === null ? 0 : now - s.turnStartedAt;
        s.turnStartedAt = null;
        if (took >= ANNOUNCE_AFTER_MS) {
          const minutes = Math.max(1, Math.round(took / 60_000));
          this.react({
            type: "remark",
            note: `(System note, not from the user: ${name} just finished a task${where} after about ${minutes} minute(s). Tell the user in one short, upbeat sentence.)`,
            fallback: this.zh ? `${name} 做完啦${where}，用了大约 ${minutes} 分钟！` : `${name} is done${where} — took about ${minutes} min!`,
            terminal: ev.terminal,
          });
        } else {
          this.react({ type: "emotion", emotion: "happy", ms: 1500 });
        }
        break;
      }
      case "session-end":
        this.sessions.delete(key);
        break;
      case "session-start":
        break;
    }
  }

  /** Call every second or so; relaxes the thinking face once agents go quiet. */
  tick(): void {
    if (this.thinking && this.clock() - this.lastActivity > IDLE_MS) this.stopThinking();
  }

  private working(now: number): void {
    this.lastActivity = now;
    if (!this.thinking) {
      this.thinking = true;
      this.react({ type: "thinking", on: true });
    }
  }

  private stopThinking(): void {
    if (!this.thinking) return;
    this.thinking = false;
    this.react({ type: "thinking", on: false });
  }
}

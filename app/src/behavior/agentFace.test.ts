import { describe, expect, it } from "vitest";
import { AgentFace, ANNOUNCE_AFTER_MS, type AgentEvent, type Reaction } from "./agentFace";

function setup(zh = false) {
  let now = 1_000_000;
  const out: Reaction[] = [];
  const face = new AgentFace((r) => out.push(r), zh, () => now);
  const ev = (kind: AgentEvent["kind"], extra: Partial<AgentEvent> = {}) =>
    face.handle({ agent: "claude-code", session: "s1", project: "LogitMate", kind, ...extra });
  return { face, out, ev, advance: (ms: number) => (now += ms) };
}

describe("AgentFace", () => {
  it("thinks while the agent works and relaxes when it goes quiet", () => {
    const { face, out, ev, advance } = setup();
    ev("prompt");
    ev("tool-start", { tool: "Bash" });
    ev("tool-end", { tool: "Bash" });
    expect(out).toEqual([{ type: "thinking", on: true }]);
    advance(5000);
    face.tick();
    expect(out.at(-1)).toEqual({ type: "thinking", on: false });
  });

  it("only announces long turns", () => {
    const { out, ev, advance } = setup();
    ev("prompt");
    advance(10_000);
    ev("turn-end");
    expect(out.at(-1)).toEqual({ type: "emotion", emotion: "happy", ms: 1500 });

    ev("prompt");
    advance(ANNOUNCE_AFTER_MS + 120_000);
    ev("turn-end", { terminal: "iTerm.app" });
    const last = out.at(-1) as Extract<Reaction, { type: "remark" }>;
    expect(last.type).toBe("remark");
    expect(last.note).toContain("Claude Code just finished a task in LogitMate after about 3 minute(s)");
    expect(last.terminal).toBe("iTerm.app");
  });

  it("asks for attention once per cooldown, with the agent's own message", () => {
    const { out, ev, advance } = setup(true);
    ev("needs-input", { detail: "Claude needs your permission to use Bash", terminal: "vscode" });
    ev("needs-input");
    advance(31_000);
    ev("needs-input");
    const remarks = out.filter((r) => r.type === "remark") as Extract<Reaction, { type: "remark" }>[];
    expect(remarks).toHaveLength(2);
    expect(remarks[0].note).toContain('"Claude needs your permission to use Bash"');
    expect(remarks[0].fallback).toBe("Claude Code 在等你（LogitMate），点我的气泡过去看看～");
    expect(remarks[0].terminal).toBe("vscode");
  });

  it("cheers up after repeated failures, then not again for a while", () => {
    const { out, ev } = setup();
    for (let i = 0; i < 6; i++) ev("tool-failed", { tool: "Bash" });
    expect(out.filter((r) => r.type === "remark")).toHaveLength(1);
  });

  it("keeps sessions apart", () => {
    const { out, ev, advance } = setup();
    ev("prompt", { session: "a" });
    advance(ANNOUNCE_AFTER_MS + 1000);
    ev("turn-end", { session: "b" });
    expect(out.at(-1)?.type).toBe("emotion");
  });
});

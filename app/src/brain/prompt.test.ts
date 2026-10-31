import { describe, expect, it } from "vitest";
import { systemPrompt } from "./prompt";

const base = {
  name: "大肥鱼",
  facts: [],
  moodLine: "You feel content and lively; you have only just met.",
  emotions: ["happy", "shy"],
  actions: [],
  now: new Date(2026, 9, 31, 21, 5),
  locale: "zh-CN",
};

describe("systemPrompt", () => {
  it("lists only what this model can do", () => {
    const p = systemPrompt(base);
    expect(p).toContain("You are 大肥鱼");
    expect(p).toContain("[emo:X], X one of: happy, shy.");
    expect(p).not.toContain("[act:");
    expect(p).toContain("locale zh-CN");
    expect(p).not.toContain("What you know about the user");
  });

  it("includes gestures, facts and persona when present", () => {
    const p = systemPrompt({ ...base, actions: ["point"], facts: ["喜欢猫"], persona: "  Tsundere.  " });
    expect(p).toContain("[act:Y], Y one of: point.");
    expect(p).toContain("- 喜欢猫");
    expect(p).toContain("Your character (follow it closely; where it differs from the general style below, it wins):\nTsundere.\n");
    expect(p.indexOf("Tsundere")).toBeLessThan(p.indexOf("Control tags"));
  });

  it("tells her what her emotions look like on this model", () => {
    const p = systemPrompt({ ...base, looks: { shy: "pink cheeks", love: "heart eyes" } });
    expect(p).toContain("On your face: shy = pink cheeks.");
    expect(p).not.toContain("heart eyes");
  });

  it("mentions a focus session in progress", () => {
    const p = systemPrompt({ ...base, focus: { task: "write the report", minutesLeft: 12 } });
    expect(p).toContain('working on "write the report" (12 min left)');
    expect(systemPrompt(base)).not.toContain("focus session");
  });
});

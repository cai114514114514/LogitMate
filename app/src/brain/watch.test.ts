import { describe, expect, it } from "vitest";
import { glanceGap, initialWatch, isPrivateApp, mayRemark, noteRemark, parseWatch, REMARK_COOLDOWN_MS, watchMessages } from "./watch";

describe("watch", () => {
  it("glances every 4-8 minutes", () => {
    expect(glanceGap(() => 0)).toBe(4 * 60_000);
    expect(glanceGap(() => 1)).toBe(8 * 60_000);
    expect(initialWatch(1000, () => 0.5).nextGlance).toBe(1000 + 6 * 60_000);
  });

  it("never looks during meetings or with a password manager in front", () => {
    for (const app of [
      { name: "zoom.us", bundle: "us.zoom.xos" },
      { name: "Microsoft Teams", bundle: "com.microsoft.teams2" },
      { name: "腾讯会议", bundle: "com.tencent.meeting" },
      { name: "1Password 8", bundle: "com.1password.1password" },
      { name: "Passwords", bundle: "com.apple.Passwords" },
    ]) {
      expect(isPrivateApp(app), app.name).toBe(true);
    }
    expect(isPrivateApp({ name: "Code", bundle: "com.microsoft.VSCode" })).toBe(false);
    expect(isPrivateApp({ name: "Obsidian", bundle: "md.obsidian" })).toBe(false);
    expect(isPrivateApp(null)).toBe(false);
  });

  it("builds a glance request with the context and the image", () => {
    const [msg] = watchMessages(
      { name: "大肥鱼", zh: true, now: new Date(2026, 9, 31, 23, 30), app: "Code", focusTask: "fix the build", recent: ["加油！"], emotions: ["happy", "nervous"] },
      "data:image/jpeg;base64,AAA",
    ) as { content: { type: string; text?: string }[] }[];
    const text = msg.content[0].text!;
    expect(text).toContain("Frontmost app: Code.");
    expect(text).toContain('focus session working on "fix the build"');
    expect(text).toContain('your recent remarks: "加油！"');
    expect(text).toContain("in Chinese");
    expect(text).toContain("Never quote or mention private content");
    expect(msg.content[1].type).toBe("image_url");
  });

  it("parses decisions and stays quiet on anything odd", () => {
    expect(parseWatch('{"say": true, "line": "构建挂了，看看第 12 行？", "emotion": "Nervous", "urgent": true}')).toEqual({
      say: true,
      line: "构建挂了，看看第 12 行？",
      emotion: "nervous",
      urgent: true,
    });
    expect(parseWatch('{"say": true, "line": ""}')?.say).toBe(false);
    expect(parseWatch('{"say": false}')?.say).toBe(false);
    expect(parseWatch("nope")).toBeNull();
  });

  it("keeps remarks rare unless something went wrong", () => {
    const s = initialWatch(0, () => 0);
    const say = { say: true, line: "x", emotion: null, urgent: false };
    expect(mayRemark(s, say, REMARK_COOLDOWN_MS)).toBe(true);
    noteRemark(s, "first", REMARK_COOLDOWN_MS);
    expect(mayRemark(s, say, REMARK_COOLDOWN_MS + 60_000)).toBe(false);
    expect(mayRemark(s, { ...say, urgent: true }, REMARK_COOLDOWN_MS + 60_000)).toBe(true);
    for (let i = 0; i < 7; i++) noteRemark(s, `r${i}`, 0);
    expect(s.recent).toEqual(["r2", "r3", "r4", "r5", "r6"]);
  });
});

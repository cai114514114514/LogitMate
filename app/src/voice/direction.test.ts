import { describe, expect, it } from "vitest";
import { direction } from "./direction";

describe("direction", () => {
  it("tells MiMo who speaks, to whom, and how", () => {
    const d = direction({ name: "大肥鱼", voice: "少女音，气息轻", emotion: "shy", replyingTo: "你好可爱", quiet: false, zh: true });
    expect(d).toContain("角色：大肥鱼");
    expect(d).toContain("声音：少女音，气息轻");
    expect(d).toContain("正在回应对方说的「你好可爱」");
    expect(d).toContain("不是念稿");
    expect(d).toContain("情绪：害羞");
  });

  it("whispers self-talk and works without a voice description or emotion", () => {
    const d = direction({ name: "Mia", emotion: null, quiet: true, zh: false });
    expect(d).toContain("murmuring to herself");
    expect(d).toContain("very soft");
    expect(d).not.toContain("Voice:");
    expect(d).not.toContain("emotion:");
  });
});

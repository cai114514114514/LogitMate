import { describe, expect, it } from "vitest";
import { cleanText, TagParser, type TagEvent } from "./tags";

function run(chunks: string[]): { text: string; events: TagEvent[] } {
  const p = new TagParser();
  let text = "";
  const events: TagEvent[] = [];
  for (const c of [...chunks.map((c) => p.feed(c)), p.flush()]) {
    text += c.text;
    events.push(...c.events);
  }
  return { text: cleanText(text), events };
}

describe("TagParser", () => {
  it("strips tags and reports them", () => {
    expect(run(["[emo:happy] 你好呀！[act:point] 记住了 [remember: 用户喜欢猫]"])).toEqual({
      text: "你好呀！ 记住了 ",
      events: [
        { kind: "emo", value: "happy" },
        { kind: "act", value: "point" },
        { kind: "remember", value: "用户喜欢猫" },
      ],
    });
  });

  it("handles tags split across chunks", () => {
    expect(run(["你", "好[e", "mo:s", "hy]啦", "[remem", "ber: likes tea]"])).toEqual({
      text: "你好啦",
      events: [
        { kind: "emo", value: "shy" },
        { kind: "remember", value: "likes tea" },
      ],
    });
  });

  it("never swallows ordinary brackets", () => {
    expect(run(["数组 [1, 2", ", 3] 和 [链接"]).text).toBe("数组 [1, 2, 3] 和 [链接");
    expect(run(["see [emo"]).text).toBe("see [emo");
  });

  it("is case-insensitive and tolerates spaces", () => {
    expect(run(["[EMO : Love]hi"]).events).toEqual([{ kind: "emo", value: "Love" }]);
  });
});

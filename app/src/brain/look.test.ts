import { describe, expect, it } from "vitest";
import { isLookRequest } from "./look";

describe("isLookRequest", () => {
  it("recognizes asking her to look at the screen", () => {
    for (const t of ["看看我的屏幕", "帮我看一下这个报错", "你瞅瞅这里", "屏幕上这是什么", "look at my screen", "Can you check this?", "what's on my screen"]) {
      expect(isLookRequest(t), t).toBe(true);
    }
  });

  it("leaves ordinary chat alone", () => {
    for (const t of ["你好呀", "今天看了部电影", "I like this song", "我想看书", "see you tomorrow"]) {
      expect(isLookRequest(t), t).toBe(false);
    }
  });
});

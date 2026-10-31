import { describe, expect, it } from "vitest";
import type { ProfileMotion } from "../model/types";
import { pairGestures } from "./reactions";

const m = (label: string, index: number): ProfileMotion => ({ group: "Action", index, file: `${label}.motion3.json`, label, holdLastFrame: false });

describe("pairGestures", () => {
  it("pairs open/close hotkeys and ignores the rest", () => {
    const motions = ["抚胸手打开", "抚胸手关闭", "竖手指打开", "竖手指关闭", "狗尾巴草打开", "狗尾巴草关闭", "脱捕"].map(m);
    const pairs = pairGestures(motions).map((g) => [g.open.label, g.close?.label]);
    expect(pairs).toEqual([
      ["抚胸手打开", "抚胸手关闭"],
      ["竖手指打开", "竖手指关闭"],
      ["狗尾巴草打开", "狗尾巴草关闭"],
    ]);
  });

  it("falls back to every action when nothing is paired", () => {
    expect(pairGestures([m("tap_body", 0), m("shake", 1)]).map((g) => g.open.label)).toEqual(["tap_body", "shake"]);
  });
});

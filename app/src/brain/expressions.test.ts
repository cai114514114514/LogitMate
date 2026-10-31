import { describe, expect, it } from "vitest";
import type { ModelProfile } from "../model/types";
import type { ExpressionMeaning, LearnedProfile } from "../model/semantics";
import { buildExpressionMap } from "./expressions";

const profile = (expressions: string[], motions: string[]): ModelProfile => ({
  name: "t",
  expressions: expressions.map((label) => ({ name: label, label, file: `${label}.exp3.json` })),
  motions: motions.map((label, index) => ({ group: "Action", index, label, file: `${label}.motion3.json`, holdLastFrame: false })),
  idleGroup: "Idle",
  capabilities: { eyeBlink: true, lipSyncIds: [], vowels: false, arkit: false, physics: true, breath: true, look: true },
  parameterNames: {},
  sources: [],
});

describe("buildExpressionMap", () => {
  it("maps DeepSeek-chan's labels", () => {
    const m = buildExpressionMap(
      profile(
        ["兔牙", "加载", "单片眼镜", "圈圈眼", "屑", "流泪", "爱心眼", "脱鞋", "脸红", "钢盆", "黑脸", "＞＜", "流冷汗", "体型1"],
        ["抚胸手打开", "抚胸手关闭", "竖手指打开", "竖手指关闭", "狗尾巴草打开", "狗尾巴草关闭"],
      ),
    );
    expect(Object.fromEntries(m.emotions)).toEqual({
      happy: "＞＜",
      love: "爱心眼",
      shy: "脸红",
      sad: "流泪",
      angry: "黑脸",
      confused: "圈圈眼",
      thinking: "加载",
      nervous: "流冷汗",
      smug: "屑",
      surprised: "圈圈眼",
    });
    expect(m.actions.get("point")?.open.label).toBe("竖手指打开");
    expect(m.actions.get("point")?.close?.label).toBe("竖手指关闭");
    expect(m.actions.get("chest")?.open.label).toBe("抚胸手打开");
    expect(m.actions.get("play")?.open.label).toBe("狗尾巴草打开");
  });

  it("works with English labels and borrows missing emotions", () => {
    const m = buildExpressionMap(profile(["Smile", "Blush", "Tears"], []));
    expect(Object.fromEntries(m.emotions)).toEqual({ happy: "Smile", shy: "Blush", sad: "Tears", smug: "Smile", love: "Smile" });
    expect(m.actions.size).toBe(0);
  });

  it("prefers learned meanings over labels", () => {
    const meaning = (name: string, m: Partial<ExpressionMeaning>): ExpressionMeaning => ({
      name, kind: "emotion", emotion: null, intensity: "low", valence: 0, arousal: 0.5, look: "", from: "vision", ...m,
    });
    const learned: LearnedProfile = {
      version: 1,
      labeller: "deepseek-flash",
      learnedAt: "2026-10-31T00:00:00Z",
      expressions: [
        meaning("F01", { emotion: "love", valence: 0.9, look: "heart-shaped pupils" }),
        meaning("F02", { emotion: "happy", intensity: "low", valence: 0.6, look: "soft smile" }),
        meaning("F03", { emotion: "happy", intensity: "high", valence: 0.9, look: "eyes squeezed shut, laughing" }),
        meaning("加载", { emotion: "thinking", valence: 0.1, look: "loading spinner" }),
        // A label that sounds like a feeling, but the labeller saw a prop.
        meaning("Smile Mask", { kind: "accessory" }),
      ],
    };
    const m = buildExpressionMap(profile(["F01", "F02", "F03", "加载", "Smile Mask", "Tears"], []), learned);
    expect(Object.fromEntries(m.emotions)).toEqual({
      happy: "F03",
      love: "F01",
      thinking: "加载",
      // Not labelled: keyword match still works.
      sad: "Tears",
      smug: "F03",
      shy: "F01",
    });
    expect(m.looks.get("love")).toBe("heart-shaped pupils");
    expect(m.looks.get("smug")).toBe("eyes squeezed shut, laughing");
    expect(m.pats).toEqual(["F01", "F02", "F03"]);
  });
});

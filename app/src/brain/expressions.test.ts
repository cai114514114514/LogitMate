import { describe, expect, it } from "vitest";
import type { ModelProfile } from "../model/types";
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
});

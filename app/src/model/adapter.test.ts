import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { ACTION_GROUP, IDLE_GROUP, normalizeModel } from "./adapter";
import type { Model3Json } from "./types";

// The sample model is not in the repo (its license forbids redistribution); point at a local copy.
const DEEPSEEK_DIR =
  process.env.LOGITMATE_MODEL_DIR ??
  join(__dirname, "../../../DeepSeek-chan  DeepSeekちゃん｜Free Live2D Model + Layered PSD  無料モデル・PSD/DeepSeek");

function listFiles(dir: string, root = dir): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return listFiles(full, root);
    return [relative(root, full).split(sep).join("/")];
  });
}
const readJson = (dir: string, file: string) => JSON.parse(readFileSync(join(dir, file), "utf8"));

describe.skipIf(!existsSync(DEEPSEEK_DIR))("DeepSeek-chan", () => {
  const files = listFiles(DEEPSEEK_DIR);
  const { model3, profile } = normalizeModel({
    model3: readJson(DEEPSEEK_DIR, "大肥鱼.model3.json"),
    model3File: "大肥鱼.model3.json",
    files,
    vtube: readJson(DEEPSEEK_DIR, "大肥鱼.vtube.json"),
    cdi: readJson(DEEPSEEK_DIR, "大肥鱼.cdi3.json"),
  });

  it("recovers every expression, labelled from the VTS hotkeys", () => {
    expect(profile.expressions).toHaveLength(23);
    expect(model3.FileReferences.Expressions).toHaveLength(23);
    expect(profile.expressions.find((e) => e.file === "Exp3/爱心眼.exp3.json")?.label).toBe("爱心眼");
    expect(profile.expressions.find((e) => e.file === "Exp3/屑屑眼.exp3.json")?.label).toBe("屑");
  });

  it("puts the VTS idle animation in its own group and the rest in Action", () => {
    expect(profile.idleGroup).toBe(IDLE_GROUP);
    expect(model3.FileReferences.Motions?.[IDLE_GROUP]).toEqual([
      { File: "Animation/IDLE.motion3.json", FadeInTime: 0.5, FadeOutTime: 0.5 },
    ]);
    expect(model3.FileReferences.Motions?.[ACTION_GROUP]).toHaveLength(7);
    expect(profile.motions).toHaveLength(8);
    expect(profile.motions.find((m) => m.file === "Animation/狗尾草切换出来.motion3.json")?.label).toBe("狗尾巴草打开");
  });

  it("detects what the rig can do", () => {
    expect(profile.capabilities).toMatchObject({
      eyeBlink: true,
      lipSyncIds: ["ParamMouthOpenY"],
      vowels: true,
      arkit: true,
      physics: true,
      breath: true,
      look: true,
    });
    expect(model3.Groups?.find((g) => g.Name === "LipSync")?.Ids).toEqual(["ParamMouthOpenY"]);
    expect(profile.parameterNames["ParamEyeLOpen"]).toBe("左眼　开闭");
    expect(profile.name).toBe("大肥鱼");
  });
});

describe("generic models", () => {
  const base: Model3Json = {
    Version: 3,
    FileReferences: {
      Moc: "a.moc3",
      Textures: ["a.png"],
      Expressions: [{ Name: "smile", File: "exp/smile.exp3.json" }],
      Motions: { Idle: [{ File: "m/idle_01.motion3.json" }], TapBody: [{ File: "m/tap.motion3.json" }] },
    },
  };

  it("keeps declared groups and does not duplicate declared files", () => {
    const { model3, profile } = normalizeModel({
      model3: base,
      model3File: "hiyori.model3.json",
      files: ["a.moc3", "a.png", "exp/smile.exp3.json", "exp/angry.exp3.json", "m/idle_01.motion3.json", "m/tap.motion3.json"],
      parameterIds: ["ParamAngleX", "ParamAngleY", "ParamEyeLOpen", "ParamEyeROpen"],
    });
    expect(profile.expressions.map((e) => e.name)).toEqual(["smile", "angry"]);
    expect(Object.keys(model3.FileReferences.Motions!)).toEqual(["Idle", "TapBody"]);
    expect(profile.idleGroup).toBe("Idle");
    expect(profile.capabilities.eyeBlink).toBe(true);
    expect(profile.capabilities.lipSyncIds).toEqual([]);
    expect(profile.name).toBe("hiyori");
  });

  it("does not modify the input", () => {
    const copy = structuredClone(base);
    normalizeModel({ model3: base, model3File: "x.model3.json", files: [] });
    expect(base).toEqual(copy);
  });
});

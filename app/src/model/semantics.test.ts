import { describe, expect, it } from "vitest";
import { describeExpression, labelMessages, parseMeanings, profileKey } from "./semantics";

const exp = (name: string) => ({ name, label: name, file: `Exp3/${name}.exp3.json` });

describe("semantics", () => {
  it("keys a model by path and expressions", () => {
    const a = profileKey("/m/a.model3.json", [exp("爱心眼"), exp("脸红")]);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(profileKey("/m/a.model3.json", [exp("爱心眼"), exp("脸红")])).toBe(a);
    expect(profileKey("/m/b.model3.json", [exp("爱心眼"), exp("脸红")])).not.toBe(a);
    expect(profileKey("/m/a.model3.json", [exp("爱心眼")])).not.toBe(a);
  });

  it("describes what an expression moves, by display name", () => {
    const line = describeExpression(
      exp("屑屑眼"),
      [
        { Id: "key3", Value: 0, Blend: "Add" },
        { Id: "key6", Value: 1, Blend: "Add" },
        { Id: "ParamEyeLOpen", Value: 0.5, Blend: "Multiply" },
      ],
      { key3: "3. 圈圈眼", key6: "6. 屑屑眼" },
    );
    expect(line).toBe('name "屑屑眼", file 屑屑眼.exp3.json, changes: 3. 圈圈眼 (key3) +0, 6. 屑屑眼 (key6) +1, ParamEyeLOpen ×0.5');
  });

  it("puts each image after its caption, and leaves images out in text mode", () => {
    const items = [
      { name: "a", evidence: 'name "a"', image: "data:image/jpeg;base64,AAA", visible: true },
      { name: "b", evidence: 'name "b"', visible: false },
    ];
    const [, user] = labelMessages(items, true) as { content: { type: string; text?: string }[] }[];
    expect(user.content.map((c) => c.type)).toEqual(["text", "text", "image_url"]);
    expect(user.content[0].text).toContain("1. name \"a\" — image 1");
    expect(user.content[0].text).toContain("2. name \"b\" — the rendered still shows no change at rest");
    const [, textOnly] = labelMessages(items, false) as { content: unknown }[];
    expect(typeof textOnly.content).toBe("string");
  });

  it("parses replies defensively", () => {
    const reply = `Sure! {"expressions":[
      {"name":"爱心眼","kind":"emotion","emotion":"Love","intensity":"high","valence":2,"arousal":0.7,"look":"heart-shaped pupils"},
      {"name":"钢盆","kind":"accessory","emotion":"happy","intensity":"low","valence":0,"arousal":0,"look":"steel basin on head"},
      {"name":"made-up","kind":"emotion","emotion":"sad"},
      {"name":"脸红","kind":"weird","emotion":"bored"}
    ]}`;
    const m = parseMeanings(reply, ["爱心眼", "钢盆", "脸红"], "vision");
    expect([...m.keys()]).toEqual(["爱心眼", "钢盆", "脸红"]);
    expect(m.get("爱心眼")).toMatchObject({ kind: "emotion", emotion: "love", intensity: "high", valence: 1, from: "vision" });
    expect(m.get("钢盆")).toMatchObject({ kind: "accessory", emotion: null });
    expect(m.get("脸红")).toMatchObject({ kind: "other", emotion: null, valence: 0, arousal: 0.5, look: "" });
    expect(parseMeanings("not json", ["a"], "text").size).toBe(0);
    expect(parseMeanings('{"other":1}', ["a"], "text").size).toBe(0);
  });
});

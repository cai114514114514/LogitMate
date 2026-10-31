import { describe, expect, it } from "vitest";
import { briefMessages, parseBrief } from "./design";

describe("voice design", () => {
  it("asks for a voice-only description in MiMo's format, with the character image", () => {
    const [msg] = briefMessages("大肥鱼", "  Tsundere.  ", true, "data:image/jpeg;base64,AAA") as {
      content: { type: string; text?: string; image_url?: { url: string } }[];
    }[];
    const text = msg.content[0].text!;
    expect(text).toContain("Her name is 大肥鱼. Persona: Tsundere.");
    expect(text).toContain("no real actors");
    expect(text).toContain("in Chinese, in character");
    expect(msg.content[1].image_url?.url).toBe("data:image/jpeg;base64,AAA");
  });

  it("parses the brief and rejects incomplete ones", () => {
    expect(parseBrief('ok {"description":"少女，声音清亮。","line":"你好呀！"}')).toEqual({ description: "少女，声音清亮。", line: "你好呀！" });
    expect(parseBrief('{"description":"x"}')).toBeNull();
    expect(parseBrief("nope")).toBeNull();
  });
});

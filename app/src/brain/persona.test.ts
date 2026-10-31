import { describe, expect, it } from "vitest";
import { parsePersonaDraft, personaDraftMessages, personaKey } from "./persona";
import { profileKey } from "../model/semantics";

describe("persona", () => {
  it("keys personas by model path, apart from learned profiles", () => {
    const a = personaKey("/m/a.model3.json");
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(personaKey("/m/a.model3.json")).toBe(a);
    expect(personaKey("/m/b.model3.json")).not.toBe(a);
    expect(profileKey("/m/a.model3.json", [])).not.toBe(a);
  });

  it("asks for a persona with tact rules, in the user's language, from the image", () => {
    const [msg] = personaDraftMessages("大肥鱼", true, "data:image/jpeg;base64,AAA") as { content: { type: string; text?: string }[] }[];
    const text = msg.content[0].text!;
    expect(text).toContain('The model is called "大肥鱼"');
    expect(text).toContain("Write, in Chinese");
    expect(text).toContain("never claim to be an official mascot");
    expect(msg.content[1].type).toBe("image_url");
  });

  it("parses drafts and rejects incomplete ones", () => {
    expect(parsePersonaDraft('{"name":"大肥鱼","persona":"你是…"}')).toEqual({ name: "大肥鱼", persona: "你是…" });
    expect(parsePersonaDraft('{"name":"x"}')).toBeNull();
    expect(parsePersonaDraft("nope")).toBeNull();
  });
});

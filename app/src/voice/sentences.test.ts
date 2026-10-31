import { describe, expect, it } from "vitest";
import { splitSentences, styled } from "./sentences";

describe("splitSentences", () => {
  it("cuts complete sentences and keeps the unfinished rest", () => {
    expect(splitSentences("你好呀！今天过得怎么样？我刚")).toEqual({ sentences: ["你好呀！", "今天过得怎么样？"], rest: "我刚" });
    expect(splitSentences("Hi there. How are you? I was")).toEqual({ sentences: ["Hi there.", "How are you?"], rest: " I was" });
  });

  it("joins very short pieces to the next sentence", () => {
    expect(splitSentences("嗯。我觉得可以！").sentences).toEqual(["嗯。我觉得可以！"]);
  });

  it("does not split decimals and flushes the rest at the end", () => {
    expect(splitSentences("版本 2.5 很好用")).toEqual({ sentences: [], rest: "版本 2.5 很好用" });
    expect(splitSentences("最后一句", true)).toEqual({ sentences: ["最后一句"], rest: "" });
  });

  it("cuts a long run at a comma", () => {
    const long = "这是一个很长很长的句子，" + "字".repeat(60);
    const { sentences } = splitSentences(long);
    expect(sentences[0]).toBe("这是一个很长很长的句子，");
  });
});

describe("styled", () => {
  it("adds a style tag in the sentence's language", () => {
    expect(styled("太好了！", "happy", false)).toBe("(开心)太好了！");
    expect(styled("Great!", "happy", false)).toBe("(cheerful)Great!");
    expect(styled("就这样吧。", null, false)).toBe("就这样吧。");
    expect(styled("（我先接着做我这份……）", "happy", true)).toBe("(小声 自言自语)我先接着做我这份……");
  });
});

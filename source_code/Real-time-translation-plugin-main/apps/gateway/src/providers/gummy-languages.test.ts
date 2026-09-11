import { describe, expect, it } from "vitest";
import { fromGummyLanguage, sameGummyLanguage, toGummyLanguage } from "./gummy-languages";

describe("Gummy language mapping", () => {
  it("maps extension language tags to Gummy codes", () => {
    expect(toGummyLanguage("zh-Hans")).toBe("zh");
    expect(toGummyLanguage("en-US")).toBe("en");
    expect(toGummyLanguage("pt-BR")).toBe("pt");
  });

  it("normalizes detected Gummy codes for subtitle events", () => {
    expect(fromGummyLanguage("zh")).toBe("zh-CN");
    expect(fromGummyLanguage("ja")).toBe("ja-JP");
    expect(fromGummyLanguage(undefined)).toBe("und");
  });

  it("compares regional tags by base language and rejects unknown targets", () => {
    expect(sameGummyLanguage("zh-CN", "zh-Hans")).toBe(true);
    expect(sameGummyLanguage("en-US", "zh-Hans")).toBe(false);
    expect(() => toGummyLanguage("pl-PL")).toThrow("不支持语言代码");
  });
});

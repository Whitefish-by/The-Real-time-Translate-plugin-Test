const SUPPORTED_GUMMY_LANGUAGES = new Set([
  "zh", "en", "ja", "ko", "yue", "de", "fr", "ru", "es", "it", "pt", "id", "ar", "th",
  "hi", "da", "ur", "tr", "nl", "ms", "vi",
]);

const GUMMY_TO_BCP47: Record<string, string> = {
  zh: "zh-CN",
  en: "en-US",
  ja: "ja-JP",
  ko: "ko-KR",
  yue: "yue-Hant-HK",
  de: "de-DE",
  fr: "fr-FR",
  ru: "ru-RU",
  es: "es-ES",
  it: "it-IT",
  pt: "pt-BR",
  id: "id-ID",
  ar: "ar-SA",
  th: "th-TH",
  hi: "hi-IN",
  da: "da-DK",
  ur: "ur-PK",
  tr: "tr-TR",
  nl: "nl-NL",
  ms: "ms-MY",
  vi: "vi-VN",
};

function baseLanguage(language: string): string {
  return language.trim().toLowerCase().split(/[-_]/)[0] ?? language.trim().toLowerCase();
}

export function toGummyLanguage(language: string): string {
  const base = baseLanguage(language);
  if (!SUPPORTED_GUMMY_LANGUAGES.has(base)) {
    throw new Error(`Gummy 不支持语言代码：${language}`);
  }
  return base;
}

export function fromGummyLanguage(language: string | undefined): string {
  if (!language) return "und";
  const base = baseLanguage(language);
  return GUMMY_TO_BCP47[base] ?? language;
}

export function sameGummyLanguage(left: string, right: string): boolean {
  return baseLanguage(left) === baseLanguage(right);
}

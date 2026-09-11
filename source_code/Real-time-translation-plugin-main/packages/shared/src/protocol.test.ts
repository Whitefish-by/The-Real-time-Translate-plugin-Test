import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  decodeAudioFrame,
  emptySubtitleState,
  encodeAudioFrame,
  extensionSettingsSchema,
  mergeSubtitle,
  shouldShowTranslation,
  type SubtitleEvent,
} from "./index";

describe("settings", () => {
  it("accepts one to ten unique source languages", () => {
    expect(extensionSettingsSchema.parse(DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS);
    expect(extensionSettingsSchema.safeParse({ ...DEFAULT_SETTINGS, sourceLanguages: ["en-US"] }).success).toBe(true);
    expect(extensionSettingsSchema.safeParse({ ...DEFAULT_SETTINGS, sourceLanguages: [] }).success).toBe(false);
    expect(extensionSettingsSchema.safeParse({ ...DEFAULT_SETTINGS, sourceLanguages: ["en-US", "en-US"] }).success).toBe(false);
    expect(extensionSettingsSchema.safeParse({
      ...DEFAULT_SETTINGS,
      sourceLanguages: Array.from({ length: 11 }, (_, index) => `test-${index}`),
    }).success).toBe(false);
    expect(extensionSettingsSchema.safeParse({ ...DEFAULT_SETTINGS, clientToken: "short" }).success).toBe(false);
  });
});

describe("audio frames", () => {
  it("round trips the little-endian header and PCM payload", () => {
    const decoded = decodeAudioFrame(encodeAudioFrame({ sequence: 42, audioEndMs: 920, pcm: new Uint8Array([1, 2, 3, 4]) }));
    expect(decoded).toEqual({ sequence: 42, audioEndMs: 920, pcm: new Uint8Array([1, 2, 3, 4]) });
  });

  it("rejects invalid uint32 headers and odd PCM16 payloads", () => {
    expect(() => encodeAudioFrame({ sequence: -1, audioEndMs: 40, pcm: new Uint8Array(2) })).toThrow("uint32");
    expect(() => encodeAudioFrame({ sequence: 0, audioEndMs: 40, pcm: new Uint8Array(1) })).toThrow("odd byte");
  });
});

describe("subtitle revisions", () => {
  const event = (revision: number, isFinal = false, generation = 0): SubtitleEvent => ({
    type: "subtitle",
    sessionId: "00000000-0000-4000-8000-000000000000",
    segmentId: "segment-1",
    revision,
    sourceLanguage: "en-US",
    sourceText: `hello ${revision}`,
    translatedText: `你好 ${revision}`,
    isFinal,
    audioStartMs: 0,
    audioEndMs: 500,
    generation,
  });

  it("ignores stale revisions and promotes final text", () => {
    const state1 = mergeSubtitle(emptySubtitleState(), event(2));
    expect(mergeSubtitle(state1, event(1))).toBe(state1);
    const state2 = mergeSubtitle(state1, event(3, true));
    expect(state2.final?.revision).toBe(3);
    expect(state2.interim).toBeNull();
  });

  it("accepts reset segment revisions after a reconnect generation", () => {
    const firstGeneration = mergeSubtitle(emptySubtitleState(), event(4, true, 0));
    const secondGeneration = mergeSubtitle(firstGeneration, event(0, false, 1));
    expect(secondGeneration.interim?.generation).toBe(1);
    expect(secondGeneration.interim?.revision).toBe(0);
  });

  it("bounds revision bookkeeping during long sessions", () => {
    let state = emptySubtitleState();
    for (let index = 0; index < 300; index += 1) {
      state = mergeSubtitle(state, { ...event(0, true), segmentId: `segment-${index}`, audioEndMs: index * 100 });
    }
    expect(Object.keys(state.revisions)).toHaveLength(128);
    expect(state.final?.segmentId).toBe("segment-299");
  });
});

it("hides same-language translation across region/script variants", () => {
  expect(shouldShowTranslation("zh-CN", "zh-Hans")).toBe(false);
  expect(shouldShowTranslation("en-US", "zh-Hans")).toBe(true);
});

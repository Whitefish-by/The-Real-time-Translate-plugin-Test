import { z } from "zod";

export const PROTOCOL_VERSION = 1 as const;
export const PCM_FORMAT = {
  encoding: "pcm_s16le",
  sampleRate: 16_000,
  channels: 1,
  frameDurationMs: 40,
} as const;

export const supportedSourceLanguages = [
  "zh-CN",
  "en-US",
  "ja-JP",
  "ko-KR",
  "fr-FR",
  "de-DE",
  "es-ES",
  "ru-RU",
  "pt-BR",
  "ar-SA",
] as const;

export const targetLanguages = [
  "zh-Hans",
  "zh-Hant",
  "en",
  "ja",
  "ko",
  "fr",
  "de",
  "es",
  "ru",
  "pt",
  "ar",
] as const;

export const displayModeSchema = z.enum(["bilingual", "translation", "source"]);
export type DisplayMode = z.infer<typeof displayModeSchema>;

const sourceLanguagesSchema = z.array(z.string().min(2)).min(1).max(10).refine(
  (languages) => new Set(languages).size === languages.length,
  { message: "sourceLanguages must not contain duplicates" },
);

export const extensionSettingsSchema = z.object({
  sourceLanguages: sourceLanguagesSchema,
  targetLanguage: z.string().min(2),
  displayMode: displayModeSchema,
  fontSizePx: z.number().int().min(14).max(48),
  backgroundOpacity: z.number().min(0).max(1),
  verticalOffset: z.number().int().min(0).max(500),
  gatewayUrl: z.string().url().refine((url) => url.startsWith("ws://") || url.startsWith("wss://"), {
    message: "gatewayUrl must use ws:// or wss://",
  }),
  clientToken: z.string().min(8).max(512),
});

export type ExtensionSettings = z.infer<typeof extensionSettingsSchema>;

export const DEFAULT_SETTINGS: ExtensionSettings = {
  sourceLanguages: [...supportedSourceLanguages],
  targetLanguage: "zh-Hans",
  displayMode: "bilingual",
  fontSizePx: 24,
  backgroundOpacity: 0.72,
  verticalOffset: 42,
  gatewayUrl: "ws://127.0.0.1:8787/v1/realtime",
  clientToken: "change-me",
};

export const helloMessageSchema = z.object({
  type: z.literal("hello"),
  protocolVersion: z.literal(PROTOCOL_VERSION),
  token: z.string(),
  sessionId: z.string().uuid(),
  generation: z.number().int().nonnegative(),
  sourceLanguages: sourceLanguagesSchema,
  targetLanguage: z.string(),
  audio: z.object({
    encoding: z.literal(PCM_FORMAT.encoding),
    sampleRate: z.literal(PCM_FORMAT.sampleRate),
    channels: z.literal(PCM_FORMAT.channels),
    frameDurationMs: z.literal(PCM_FORMAT.frameDurationMs),
  }),
});
export type HelloMessage = z.infer<typeof helloMessageSchema>;

export const endMessageSchema = z.object({
  type: z.literal("end"),
  sessionId: z.string().uuid(),
});

export const clientMessageSchema = z.discriminatedUnion("type", [helloMessageSchema, endMessageSchema]);
export type ClientMessage = z.infer<typeof clientMessageSchema>;

export const subtitleEventSchema = z.object({
  type: z.literal("subtitle"),
  sessionId: z.string().uuid(),
  segmentId: z.string().min(1),
  revision: z.number().int().nonnegative(),
  sourceLanguage: z.string(),
  sourceText: z.string().min(1),
  translatedText: z.string().nullable(),
  isFinal: z.boolean(),
  audioStartMs: z.number().int().nonnegative(),
  audioEndMs: z.number().int().nonnegative(),
  generation: z.number().int().nonnegative(),
}).refine((event) => event.audioEndMs >= event.audioStartMs, { message: "audioEndMs must not precede audioStartMs" });
export type SubtitleEvent = z.infer<typeof subtitleEventSchema>;

export const serverMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ready"), sessionId: z.string().uuid(), provider: z.string() }),
  z.object({
    type: z.literal("status"),
    sessionId: z.string().uuid().optional(),
    code: z.string(),
    message: z.string(),
    detectedLanguage: z.string().optional(),
    latencyMs: z.number().nonnegative().optional(),
  }),
  z.object({
    type: z.literal("error"),
    sessionId: z.string().uuid().optional(),
    code: z.string(),
    message: z.string(),
    retryable: z.boolean(),
  }),
  subtitleEventSchema,
]);
export type ServerMessage = z.infer<typeof serverMessageSchema>;

export type AudioFrame = {
  sequence: number;
  audioEndMs: number;
  pcm: Uint8Array;
};

export function encodeAudioFrame(frame: AudioFrame): ArrayBuffer {
  if (!Number.isInteger(frame.sequence) || frame.sequence < 0 || frame.sequence > 0xffff_ffff) {
    throw new Error("Audio frame sequence must be a uint32");
  }
  if (!Number.isInteger(frame.audioEndMs) || frame.audioEndMs < 0 || frame.audioEndMs > 0xffff_ffff) {
    throw new Error("Audio frame timestamp must be a uint32");
  }
  if (frame.pcm.byteLength % 2 !== 0) throw new Error("PCM16 payload has an odd byte length");
  const result = new ArrayBuffer(8 + frame.pcm.byteLength);
  const view = new DataView(result);
  view.setUint32(0, frame.sequence, true);
  view.setUint32(4, frame.audioEndMs, true);
  new Uint8Array(result, 8).set(frame.pcm);
  return result;
}

export function decodeAudioFrame(input: ArrayBuffer | Uint8Array): AudioFrame {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.byteLength < 8) throw new Error("Audio frame is shorter than its header");
  if ((bytes.byteLength - 8) % 2 !== 0) throw new Error("PCM16 payload has an odd byte length");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    sequence: view.getUint32(0, true),
    audioEndMs: view.getUint32(4, true),
    pcm: bytes.slice(8),
  };
}

export function makeHello(
  settings: ExtensionSettings,
  sessionId: string,
  generation: number,
): HelloMessage {
  return {
    type: "hello",
    protocolVersion: PROTOCOL_VERSION,
    token: settings.clientToken,
    sessionId,
    generation,
    sourceLanguages: settings.sourceLanguages,
    targetLanguage: settings.targetLanguage,
    audio: PCM_FORMAT,
  };
}

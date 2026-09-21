import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  helloMessageSchema,
  makeHello,
  serverMessageSchema,
  subtitleEventSchema,
} from "@live-subtitles/shared";
import { readConfig } from "../../apps/gateway/src/config";

const baseEnv = {
  HOST: "127.0.0.1",
  GATEWAY_CLIENT_TOKEN: "test-token",
  SPEECH_PROVIDER: "fake",
};

describe("模块二：网关配置边界", () => {
  it("M2-001 静音阈值199毫秒被拒绝", () => {
    expect(() => readConfig({ ...baseEnv, GUMMY_MAX_END_SILENCE_MS: "199" })).toThrow();
  });
  it("M2-002 静音阈值200毫秒被接受", () => {
    expect(readConfig({ ...baseEnv, GUMMY_MAX_END_SILENCE_MS: "200" }).gummyMaxEndSilenceMs).toBe(200);
  });
  it("M2-003 静音阈值6000毫秒被接受", () => {
    expect(readConfig({ ...baseEnv, GUMMY_MAX_END_SILENCE_MS: "6000" }).gummyMaxEndSilenceMs).toBe(6_000);
  });
  it("M2-004 静音阈值6001毫秒被拒绝", () => {
    expect(() => readConfig({ ...baseEnv, GUMMY_MAX_END_SILENCE_MS: "6001" })).toThrow();
  });
  it("M2-005 端口-1被拒绝", () => {
    expect(() => readConfig({ ...baseEnv, PORT: "-1" })).toThrow();
  });
  it("M2-006 端口0被接受", () => {
    expect(readConfig({ ...baseEnv, PORT: "0" }).port).toBe(0);
  });
  it("M2-007 端口65535被接受", () => {
    expect(readConfig({ ...baseEnv, PORT: "65535" }).port).toBe(65_535);
  });
  it("M2-008 端口65536被拒绝", () => {
    expect(() => readConfig({ ...baseEnv, PORT: "65536" })).toThrow();
  });
});

const sessionId = "00000000-0000-4000-8000-000000000000";
const subtitle = {
  type: "subtitle" as const,
  sessionId,
  segmentId: "segment-1",
  revision: 0,
  sourceLanguage: "en-US",
  sourceText: "hello",
  translatedText: "你好",
  isFinal: false,
  audioStartMs: 100,
  audioEndMs: 200,
  generation: 0,
};

describe("模块二：共享协议健壮性", () => {
  it("M2-009 负generation被拒绝", () => {
    expect(helloMessageSchema.safeParse({ ...makeHello(DEFAULT_SETTINGS, sessionId, 0), generation: -1 }).success).toBe(false);
  });
  it("M2-010 空字幕文本被拒绝", () => {
    expect(subtitleEventSchema.safeParse({ ...subtitle, sourceText: "" }).success).toBe(false);
  });
  it("M2-011 零时长字幕被接受", () => {
    expect(subtitleEventSchema.safeParse({ ...subtitle, audioStartMs: 100, audioEndMs: 100 }).success).toBe(true);
  });
  it("M2-012 负延迟被拒绝", () => {
    expect(serverMessageSchema.safeParse({ type: "status", code: "listening", message: "ok", latencyMs: -0.1 }).success).toBe(false);
  });
});

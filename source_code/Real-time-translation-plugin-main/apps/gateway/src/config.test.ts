import { describe, expect, it } from "vitest";
import { readConfig } from "./config";

describe("gateway config", () => {
  it("treats blank cloud values as unset for the fake provider", () => {
    expect(readConfig({
      GATEWAY_CLIENT_TOKEN: "test-secret",
      SPEECH_PROVIDER: "fake",
      DASHSCOPE_API_KEY: "",
      AZURE_SPEECH_KEY: "",
      AZURE_SPEECH_ENDPOINT: "",
    })).toMatchObject({ provider: "fake", clientToken: "test-secret" });
  });

  it("requires a DashScope API key for Gummy", () => {
    expect(() => readConfig({
      GATEWAY_CLIENT_TOKEN: "test-secret",
      SPEECH_PROVIDER: "aliyun-gummy",
    })).toThrow("DASHSCOPE_API_KEY");
  });

  it("accepts the Beijing Gummy endpoint and low-latency VAD setting", () => {
    expect(readConfig({
      GATEWAY_CLIENT_TOKEN: "test-secret",
      SPEECH_PROVIDER: "aliyun-gummy",
      DASHSCOPE_API_KEY: "sk-test",
      DASHSCOPE_WEBSOCKET_URL: "wss://dashscope.aliyuncs.com/api-ws/v1/inference/",
      GUMMY_MAX_END_SILENCE_MS: "400",
    })).toMatchObject({
      provider: "aliyun-gummy",
      dashscopeApiKey: "sk-test",
      gummyModel: "gummy-realtime-v1",
      gummyMaxEndSilenceMs: 400,
    });
  });

  it("rejects an unencrypted Gummy endpoint", () => {
    expect(() => readConfig({
      GATEWAY_CLIENT_TOKEN: "test-secret",
      SPEECH_PROVIDER: "aliyun-gummy",
      DASHSCOPE_API_KEY: "sk-test",
      DASHSCOPE_WEBSOCKET_URL: "ws://example.test/api-ws/v1/inference/",
    })).toThrow("wss://");
  });

  it("requires a sovereign-cloud endpoint for Azure China", () => {
    expect(() => readConfig({
      GATEWAY_CLIENT_TOKEN: "test-secret",
      SPEECH_PROVIDER: "azure",
      AZURE_SPEECH_KEY: "key",
      AZURE_SPEECH_REGION: "chinaeast2",
    })).toThrow("AZURE_SPEECH_ENDPOINT");
  });

  it("accepts an Azure China resource endpoint", () => {
    expect(readConfig({
      GATEWAY_CLIENT_TOKEN: "test-secret",
      SPEECH_PROVIDER: "azure",
      AZURE_SPEECH_KEY: "key",
      AZURE_SPEECH_REGION: "chinaeast2",
      AZURE_SPEECH_ENDPOINT: "https://example.cognitiveservices.azure.cn",
    })).toMatchObject({ provider: "azure", azureEndpoint: "https://example.cognitiveservices.azure.cn" });
  });
});

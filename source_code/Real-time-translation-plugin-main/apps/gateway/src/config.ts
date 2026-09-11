import { z } from "zod";

const optionalNonEmptyString = z.preprocess(
  (value) => typeof value === "string" && value.trim() === "" ? undefined : value,
  z.string().optional(),
);

const optionalUrl = z.preprocess(
  (value) => typeof value === "string" && value.trim() === "" ? undefined : value,
  z.string().url().optional(),
);

const envSchema = z.object({
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().min(0).max(65_535).default(8787),
  GATEWAY_CLIENT_TOKEN: z.string().min(8).default("change-me"),
  SPEECH_PROVIDER: z.enum(["fake", "aliyun-gummy", "azure"]).default("fake"),
  DASHSCOPE_API_KEY: optionalNonEmptyString,
  DASHSCOPE_WEBSOCKET_URL: z.string().url().default("wss://dashscope.aliyuncs.com/api-ws/v1/inference/"),
  DASHSCOPE_WORKSPACE_ID: optionalNonEmptyString,
  GUMMY_MODEL: z.string().min(1).default("gummy-realtime-v1"),
  GUMMY_MAX_END_SILENCE_MS: z.coerce.number().int().min(200).max(6_000).default(500),
  AZURE_SPEECH_KEY: optionalNonEmptyString,
  AZURE_SPEECH_REGION: z.string().default("chinaeast2"),
  AZURE_SPEECH_ENDPOINT: optionalUrl,
});

export type GatewayConfig = {
  host: string;
  port: number;
  clientToken: string;
  provider: "fake" | "aliyun-gummy" | "azure";
  dashscopeApiKey?: string;
  dashscopeWebSocketUrl: string;
  dashscopeWorkspaceId?: string;
  gummyModel: string;
  gummyMaxEndSilenceMs: number;
  azureKey?: string;
  azureRegion: string;
  azureEndpoint?: string;
};

export function readConfig(env: NodeJS.ProcessEnv = process.env): GatewayConfig {
  const value = envSchema.parse(env);
  if (value.SPEECH_PROVIDER === "aliyun-gummy" && !value.DASHSCOPE_API_KEY) {
    throw new Error("DASHSCOPE_API_KEY is required when SPEECH_PROVIDER=aliyun-gummy");
  }
  if (value.SPEECH_PROVIDER === "aliyun-gummy" && !value.DASHSCOPE_WEBSOCKET_URL.startsWith("wss://")) {
    throw new Error("DASHSCOPE_WEBSOCKET_URL must use wss:// when SPEECH_PROVIDER=aliyun-gummy");
  }
  if (value.SPEECH_PROVIDER === "azure" && !value.AZURE_SPEECH_KEY) {
    throw new Error("AZURE_SPEECH_KEY is required when SPEECH_PROVIDER=azure");
  }
  if (value.SPEECH_PROVIDER === "azure" && !value.AZURE_SPEECH_ENDPOINT) {
    throw new Error("AZURE_SPEECH_ENDPOINT is required for Azure China; copy the resource endpoint from portal.azure.cn");
  }
  return {
    host: value.HOST,
    port: value.PORT,
    clientToken: value.GATEWAY_CLIENT_TOKEN,
    provider: value.SPEECH_PROVIDER,
    ...(value.DASHSCOPE_API_KEY ? { dashscopeApiKey: value.DASHSCOPE_API_KEY } : {}),
    dashscopeWebSocketUrl: value.DASHSCOPE_WEBSOCKET_URL,
    ...(value.DASHSCOPE_WORKSPACE_ID ? { dashscopeWorkspaceId: value.DASHSCOPE_WORKSPACE_ID } : {}),
    gummyModel: value.GUMMY_MODEL,
    gummyMaxEndSilenceMs: value.GUMMY_MAX_END_SILENCE_MS,
    ...(value.AZURE_SPEECH_KEY ? { azureKey: value.AZURE_SPEECH_KEY } : {}),
    azureRegion: value.AZURE_SPEECH_REGION,
    ...(value.AZURE_SPEECH_ENDPOINT ? { azureEndpoint: value.AZURE_SPEECH_ENDPOINT } : {}),
  };
}

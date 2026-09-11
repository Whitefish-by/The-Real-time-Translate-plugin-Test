import { afterEach, describe, expect, it } from "vitest";
import WebSocket, { type RawData } from "ws";
import { DEFAULT_SETTINGS, encodeAudioFrame, makeHello, serverMessageSchema, type ServerMessage } from "@live-subtitles/shared";
import { createGateway } from "./server";
import type { GatewayConfig } from "./config";

const gateways: Array<Awaited<ReturnType<typeof createGateway>>> = [];
afterEach(async () => {
  await Promise.all(gateways.splice(0).map((gateway) => gateway.close()));
});

const config: GatewayConfig = {
  host: "127.0.0.1",
  port: 0,
  clientToken: "test-secret",
  provider: "fake",
  dashscopeWebSocketUrl: "wss://dashscope.aliyuncs.com/api-ws/v1/inference/",
  gummyModel: "gummy-realtime-v1",
  gummyMaxEndSilenceMs: 500,
  azureRegion: "chinaeast2",
};

async function start(): Promise<{ url: string }> {
  const gateway = await createGateway(config);
  gateways.push(gateway);
  const address = gateway.server.address();
  if (!address || typeof address === "string") throw new Error("No TCP address");
  return { url: `ws://127.0.0.1:${address.port}/v1/realtime` };
}

async function openSocket(url: string): Promise<WebSocket> {
  const socket = new WebSocket(url);
  await new Promise<void>((resolve) => socket.once("open", resolve));
  return socket;
}

function nextMessage(socket: WebSocket): Promise<ServerMessage> {
  return new Promise((resolve, reject) => {
    socket.once("message", (data) => {
      try { resolve(serverMessageSchema.parse(JSON.parse(data.toString()))); } catch (error) { reject(error); }
    });
  });
}

function waitForMessage(socket: WebSocket, predicate: (message: ServerMessage) => boolean): Promise<ServerMessage> {
  return new Promise((resolve, reject) => {
    const listener = (data: RawData): void => {
      try {
        const message = serverMessageSchema.parse(JSON.parse(data.toString()));
        if (!predicate(message)) return;
        socket.off("message", listener);
        resolve(message);
      } catch (error) {
        socket.off("message", listener);
        reject(error);
      }
    };
    socket.on("message", listener);
  });
}

describe("gateway", () => {
  it("exposes only the documented health and capability endpoints", async () => {
    const { url } = await start();
    const baseUrl = url.replace("ws://", "http://").replace("/v1/realtime", "");
    await expect(fetch(`${baseUrl}/healthz`).then((response) => response.json())).resolves.toMatchObject({ ok: true, provider: "fake", protocolVersion: 1 });
    await expect(fetch(`${baseUrl}/v1/capabilities`).then((response) => response.json())).resolves.toMatchObject({
      protocolVersion: 1,
      sourceLanguageLimit: 10,
      audio: { sampleRate: 16_000, channels: 1, frameDurationMs: 40 },
    });
    await expect(fetch(`${baseUrl}/unknown`).then((response) => response.status)).resolves.toBe(404);
  });

  it("rejects an invalid token before starting the provider", async () => {
    const { url } = await start();
    const socket = new WebSocket(url);
    await new Promise<void>((resolve) => socket.once("open", resolve));
    socket.send(JSON.stringify(makeHello({ ...DEFAULT_SETTINGS, clientToken: "wrong-token" }, crypto.randomUUID(), 0)));
    await expect(nextMessage(socket)).resolves.toMatchObject({ type: "error", code: "unauthorized" });
  });

  it("streams deterministic interim and final subtitles", async () => {
    const { url } = await start();
    const socket = new WebSocket(url);
    await new Promise<void>((resolve) => socket.once("open", resolve));
    socket.send(JSON.stringify(makeHello({ ...DEFAULT_SETTINGS, clientToken: config.clientToken }, crypto.randomUUID(), 0)));
    const messages: ServerMessage[] = [];
    socket.on("message", (data) => messages.push(serverMessageSchema.parse(JSON.parse(data.toString()))));
    await new Promise((resolve) => setTimeout(resolve, 25));
    socket.send(encodeAudioFrame({ sequence: 0, audioEndMs: 800, pcm: new Uint8Array(1_280) }));
    await new Promise((resolve) => setTimeout(resolve, 260));
    expect(messages.some((message) => message.type === "ready")).toBe(true);
    expect(messages.some((message) => message.type === "subtitle" && !message.isFinal)).toBe(true);
    expect(messages.some((message) => message.type === "subtitle" && message.isFinal)).toBe(true);
    socket.close();
  });

  it("rejects PCM frames that are not exactly forty milliseconds", async () => {
    const { url } = await start();
    const socket = await openSocket(url);
    socket.send(JSON.stringify(makeHello({ ...DEFAULT_SETTINGS, clientToken: config.clientToken }, crypto.randomUUID(), 0)));
    await waitForMessage(socket, (message) => message.type === "ready");
    socket.send(encodeAudioFrame({ sequence: 0, audioEndMs: 40, pcm: new Uint8Array(2) }));
    await expect(waitForMessage(socket, (message) => message.type === "error")).resolves.toMatchObject({ type: "error", code: "bad_message" });
  });

  it("allows only the newest generation to own a session", async () => {
    const { url } = await start();
    const sessionId = crypto.randomUUID();
    const first = await openSocket(url);
    first.send(JSON.stringify(makeHello({ ...DEFAULT_SETTINGS, clientToken: config.clientToken }, sessionId, 1)));
    await expect(waitForMessage(first, (message) => message.type === "ready")).resolves.toMatchObject({ type: "ready" });

    const stale = await openSocket(url);
    stale.send(JSON.stringify(makeHello({ ...DEFAULT_SETTINGS, clientToken: config.clientToken }, sessionId, 1)));
    await expect(waitForMessage(stale, (message) => message.type === "error")).resolves.toMatchObject({ type: "error", code: "stale_generation" });

    const replacement = await openSocket(url);
    const firstClosed = new Promise<number>((resolve) => first.once("close", (code) => resolve(code)));
    replacement.send(JSON.stringify(makeHello({ ...DEFAULT_SETTINGS, clientToken: config.clientToken }, sessionId, 2)));
    await expect(waitForMessage(replacement, (message) => message.type === "ready")).resolves.toMatchObject({ type: "ready" });
    await expect(firstClosed).resolves.toBe(4_001);
    replacement.close();
  });
});

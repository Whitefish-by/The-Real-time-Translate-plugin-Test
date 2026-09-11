import { createServer, type Server } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { WebSocketServer, WebSocket, type RawData } from "ws";
import {
  clientMessageSchema,
  decodeAudioFrame,
  helloMessageSchema,
  type HelloMessage,
  type ServerMessage,
} from "@live-subtitles/shared";
import type { GatewayConfig } from "./config";
import { AliyunGummyProvider } from "./providers/gummy";
import { AzureSpeechProvider } from "./providers/azure";
import { FakeSpeechProvider } from "./providers/fake";
import { ProviderStartError, type ProviderEvent, type SpeechProvider, type SpeechProviderSession } from "./providers/types";
import { percentile } from "./latency";

type Gateway = { server: Server; close: () => Promise<void> };

function tokensMatch(actual: string, expected: string): boolean {
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.byteLength === right.byteLength && timingSafeEqual(left, right);
}

function send(socket: WebSocket, message: ServerMessage): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function makeProvider(config: GatewayConfig): SpeechProvider {
  if (config.provider === "aliyun-gummy") {
    return new AliyunGummyProvider({
      apiKey: config.dashscopeApiKey!,
      url: config.dashscopeWebSocketUrl,
      model: config.gummyModel,
      maxEndSilenceMs: config.gummyMaxEndSilenceMs,
      ...(config.dashscopeWorkspaceId ? { workspaceId: config.dashscopeWorkspaceId } : {}),
    });
  }
  if (config.provider === "azure") {
    return new AzureSpeechProvider({
      key: config.azureKey!,
      region: config.azureRegion,
      ...(config.azureEndpoint ? { endpoint: config.azureEndpoint } : {}),
    });
  }
  return new FakeSpeechProvider();
}

export async function createGateway(config: GatewayConfig): Promise<Gateway> {
  const provider = makeProvider(config);
  const server = createServer((request, response) => {
    response.setHeader("content-type", "application/json; charset=utf-8");
    response.setHeader("cache-control", "no-store");
    if (request.method === "GET" && request.url === "/healthz") {
      response.writeHead(200).end(JSON.stringify({ ok: true, provider: provider.name, protocolVersion: 1 }));
      return;
    }
    if (request.method === "GET" && request.url === "/v1/capabilities") {
      response.writeHead(200).end(JSON.stringify({
        protocolVersion: 1,
        provider: provider.name,
        audio: { encoding: "pcm_s16le", sampleRate: 16_000, channels: 1, frameDurationMs: 40 },
        sourceLanguageLimit: 10,
      }));
      return;
    }
    response.writeHead(404).end(JSON.stringify({ error: "not_found" }));
  });

  const sockets = new Set<WebSocket>();
  const activeSessions = new Map<string, { generation: number; socket: WebSocket }>();
  const websocketServer = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });
  server.on("upgrade", (request, socket, head) => {
    if (request.url !== "/v1/realtime") {
      socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
      socket.destroy();
      return;
    }
    websocketServer.handleUpgrade(request, socket, head, (websocket) => websocketServer.emit("connection", websocket, request));
  });

  websocketServer.on("connection", (socket) => {
    sockets.add(socket);
    let hello: HelloMessage | null = null;
    let speechSession: SpeechProviderSession | null = null;
    let bytesReceived = 0;
    let lastSequence = -1;
    let latestAudioEndMs = 0;
    const interimLatencies: number[] = [];
    const finalLatencies: number[] = [];

    const helloTimeout = setTimeout(() => {
      send(socket, { type: "error", code: "hello_timeout", message: "未在 5 秒内收到 hello 消息", retryable: false });
      socket.close(1008, "hello_timeout");
    }, 5_000);
    helloTimeout.unref();

    const onProviderEvent = (event: ProviderEvent): void => {
      if (!hello) return;
      if (event.type === "subtitle") {
        const latencyMs = Math.max(0, latestAudioEndMs - event.audioEndMs);
        const bucket = event.isFinal ? finalLatencies : interimLatencies;
        bucket.push(latencyMs);
        if (bucket.length > 10_000) bucket.splice(0, bucket.length - 10_000);
        send(socket, event);
        send(socket, {
          type: "status",
          sessionId: hello.sessionId,
          code: event.isFinal ? "final" : "interim",
          message: event.isFinal ? "已确认字幕" : "实时字幕",
          detectedLanguage: event.sourceLanguage,
          latencyMs,
        });
      } else if (event.type === "provider-status") {
        send(socket, {
          type: "status",
          sessionId: hello.sessionId,
          code: event.code,
          message: event.message,
          ...(event.detectedLanguage ? { detectedLanguage: event.detectedLanguage } : {}),
        });
      } else {
        send(socket, {
          type: "error",
          sessionId: hello.sessionId,
          code: event.code,
          message: event.message,
          retryable: event.retryable,
        });
        socket.close(event.retryable ? 1012 : 1011, "provider_error");
      }
    };

    socket.on("message", async (data: RawData, isBinary: boolean) => {
      try {
        if (!hello) {
          if (isBinary) throw new Error("hello_required");
          const candidate = helloMessageSchema.parse(JSON.parse(data.toString()));
          if (!tokensMatch(candidate.token, config.clientToken)) {
            send(socket, { type: "error", code: "unauthorized", message: "客户端令牌无效", retryable: false });
            socket.close(1008, "unauthorized");
            return;
          }
          clearTimeout(helloTimeout);
          hello = candidate;
          const active = activeSessions.get(candidate.sessionId);
          if (active && active.generation >= candidate.generation) {
            send(socket, { type: "error", sessionId: candidate.sessionId, code: "stale_generation", message: "此会话已有更新的连接", retryable: false });
            socket.close(1008, "stale_generation");
            return;
          }
          if (active) active.socket.close(4001, "superseded_generation");
          activeSessions.set(candidate.sessionId, { generation: candidate.generation, socket });
          speechSession = provider.createSession(candidate, onProviderEvent);
          try {
            await speechSession.start();
          } catch (error) {
            speechSession.abort();
            speechSession = null;
            send(socket, {
              type: "error",
              sessionId: candidate.sessionId,
              code: error instanceof ProviderStartError ? error.code : "provider_start_failed",
              message: error instanceof Error ? error.message : "语音服务启动失败",
              retryable: error instanceof ProviderStartError ? error.retryable : true,
            });
            socket.close(error instanceof ProviderStartError && !error.retryable ? 1011 : 1012, "provider_start_failed");
            return;
          }
          send(socket, { type: "ready", sessionId: candidate.sessionId, provider: provider.name });
          return;
        }

        if (isBinary) {
          const frame = decodeAudioFrame(new Uint8Array(data as Buffer));
          if (frame.pcm.byteLength !== 1_280) throw new Error("Audio frame must contain exactly 40 ms of PCM16 audio");
          if (frame.sequence <= lastSequence) return;
          lastSequence = frame.sequence;
          latestAudioEndMs = Math.max(latestAudioEndMs, frame.audioEndMs);
          bytesReceived += frame.pcm.byteLength;
          speechSession?.write(frame);
          return;
        }

        const message = clientMessageSchema.parse(JSON.parse(data.toString()));
        if (message.type === "end") {
          if (message.sessionId !== hello.sessionId) throw new Error("end message sessionId does not match hello");
          await speechSession?.end();
          speechSession = null;
          socket.close(1000, "complete");
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Malformed client message";
        send(socket, { type: "error", ...(hello ? { sessionId: hello.sessionId } : {}), code: "bad_message", message, retryable: false });
        socket.close(1003, "bad_message");
      }
    });

    socket.on("close", () => {
      clearTimeout(helloTimeout);
      speechSession?.abort();
      sockets.delete(socket);
      if (hello && activeSessions.get(hello.sessionId)?.socket === socket) activeSessions.delete(hello.sessionId);
      if (hello) console.info(JSON.stringify({
        event: "session_closed",
        sessionId: hello.sessionId,
        bytesReceived,
        lastSequence,
        latency: {
          interimP50Ms: percentile(interimLatencies, 0.5),
          interimP95Ms: percentile(interimLatencies, 0.95),
          finalP50Ms: percentile(finalLatencies, 0.5),
          finalP95Ms: percentile(finalLatencies, 0.95),
        },
      }));
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, config.host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  return {
    server,
    close: async () => {
      for (const socket of sockets) socket.close(1001, "server_shutdown");
      await new Promise<void>((resolve, reject) => websocketServer.close((error) => error ? reject(error) : resolve()));
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
}

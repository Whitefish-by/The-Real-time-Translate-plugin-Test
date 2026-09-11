import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer, type RawData, type WebSocket } from "ws";
import { DEFAULT_SETTINGS, makeHello, type SubtitleEvent } from "@live-subtitles/shared";
import { AliyunGummyProvider } from "./gummy";
import type { ProviderEvent } from "./types";

const servers: WebSocketServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(async (server) => {
    for (const client of server.clients) client.terminate();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }));
});

async function createServer(
  onConnection: (socket: WebSocket, authorization: string | undefined) => void,
): Promise<string> {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  servers.push(server);
  server.on("connection", (socket, request) => onConnection(socket, request.headers.authorization));
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No WebSocket test address");
  return `ws://127.0.0.1:${address.port}`;
}

function serviceEvent(taskId: string, event: string, payload: object = {}): string {
  return JSON.stringify({ header: { task_id: taskId, event, attributes: {} }, payload });
}

function rawDataByteLength(data: RawData): number {
  return Array.isArray(data) ? data.reduce((total, chunk) => total + chunk.byteLength, 0) : data.byteLength;
}

describe("Aliyun Gummy provider", () => {
  it("authenticates, aggregates 40 ms frames, and maps interim/final results", async () => {
    const binarySizes: number[] = [];
    let authorization: string | undefined;
    let runTask: Record<string, any> | undefined;
    const url = await createServer((socket, header) => {
      authorization = header;
      socket.on("message", (data, isBinary) => {
        if (isBinary) {
          binarySizes.push(rawDataByteLength(data));
          if (binarySizes.length === 1 && runTask) {
            const taskId = runTask.header.task_id as string;
            socket.send(serviceEvent(taskId, "result-generated", {
              output: {
                transcription: {
                  sentence_id: 7,
                  begin_time: 100,
                  end_time: 800,
                  text: "hello wor",
                  sentence_end: false,
                  lang: "en",
                },
                translations: [{
                  sentence_id: 7,
                  begin_time: 100,
                  end_time: 800,
                  text: "你好世",
                  sentence_end: false,
                  lang: "zh",
                }],
              },
            }));
            socket.send(serviceEvent(taskId, "result-generated", {
              output: {
                transcription: {
                  sentence_id: 7,
                  begin_time: 100,
                  end_time: 1_200,
                  text: "hello world",
                  sentence_end: true,
                  lang: "en",
                },
                translations: [{
                  sentence_id: 7,
                  begin_time: 100,
                  end_time: 1_200,
                  text: "你好，世界",
                  sentence_end: true,
                  lang: "zh",
                }],
              },
            }));
          }
          return;
        }

        const message = JSON.parse(data.toString()) as Record<string, any>;
        if (message.header.action === "run-task") {
          runTask = message;
          socket.send(serviceEvent(message.header.task_id, "task-started"));
        } else if (message.header.action === "finish-task") {
          socket.send(serviceEvent(message.header.task_id, "task-finished", { output: {}, usage: null }));
        }
      });
    });

    const events: ProviderEvent[] = [];
    const hello = makeHello(DEFAULT_SETTINGS, "00000000-0000-4000-8000-000000000000", 3);
    const session = new AliyunGummyProvider({
      apiKey: "sk-test",
      url,
      model: "gummy-realtime-v1",
      maxEndSilenceMs: 400,
    }).createSession(hello, (event) => events.push(event));

    await session.start();
    for (let index = 0; index < 3; index += 1) {
      session.write({
        sequence: index,
        audioEndMs: 10_040 + index * 40,
        pcm: new Uint8Array(1_280).fill(index + 1),
      });
    }
    await new Promise((resolve) => setTimeout(resolve, 30));
    await session.end();

    expect(authorization).toBe("Bearer sk-test");
    expect(runTask?.payload).toMatchObject({
      model: "gummy-realtime-v1",
      parameters: {
        sample_rate: 16_000,
        format: "pcm",
        source_language: null,
        translation_target_languages: ["zh"],
        max_end_silence: 400,
      },
    });
    expect(binarySizes).toEqual([3_200, 640]);

    const subtitles = events.filter((event): event is SubtitleEvent => event.type === "subtitle");
    expect(subtitles.map((event) => [event.revision, event.isFinal])).toEqual([[0, false], [1, true]]);
    expect(subtitles[1]).toMatchObject({
      segmentId: "gummy-7",
      sourceLanguage: "en-US",
      sourceText: "hello world",
      translatedText: "你好，世界",
      audioStartMs: 10_100,
      audioEndMs: 11_200,
      generation: 3,
    });
  });

  it.each([
    {
      name: "keeps translation enabled for English to Chinese",
      sourceLanguage: "en-US",
      expectedSourceLanguage: "en",
      translationEnabled: true,
      expectedTargets: ["zh"],
    },
    {
      name: "skips redundant Chinese to Chinese translation",
      sourceLanguage: "zh-CN",
      expectedSourceLanguage: "zh",
      translationEnabled: false,
      expectedTargets: undefined,
    },
  ])("uses a single source language as fixed: $name", async ({
    sourceLanguage,
    expectedSourceLanguage,
    translationEnabled,
    expectedTargets,
  }) => {
    let runTask: Record<string, any> | undefined;
    const url = await createServer((socket) => {
      socket.on("message", (data, isBinary) => {
        if (isBinary) return;
        const message = JSON.parse(data.toString()) as Record<string, any>;
        if (message.header.action === "run-task") {
          runTask = message;
          socket.send(serviceEvent(message.header.task_id, "task-started"));
        } else if (message.header.action === "finish-task") {
          socket.send(serviceEvent(message.header.task_id, "task-finished", { output: {}, usage: null }));
        }
      });
    });

    const events: ProviderEvent[] = [];
    const hello = makeHello(
      { ...DEFAULT_SETTINGS, sourceLanguages: [sourceLanguage] },
      "00000000-0000-4000-8000-000000000000",
      0,
    );
    const session = new AliyunGummyProvider({
      apiKey: "sk-test",
      url,
      model: "gummy-realtime-v1",
      maxEndSilenceMs: 500,
    }).createSession(hello, (event) => events.push(event));

    await session.start();
    await session.end();

    expect(runTask?.payload.parameters).toMatchObject({
      source_language: expectedSourceLanguage,
      translation_enabled: translationEnabled,
    });
    if (expectedTargets) {
      expect(runTask?.payload.parameters.translation_target_languages).toEqual(expectedTargets);
    } else {
      expect(runTask?.payload.parameters).not.toHaveProperty("translation_target_languages");
    }
    expect(events).toContainEqual(expect.objectContaining({
      type: "provider-status",
      code: "listening",
      detectedLanguage: sourceLanguage,
    }));
  });

  it("rejects start when Gummy reports a task failure", async () => {
    const url = await createServer((socket) => {
      socket.on("message", (data, isBinary) => {
        if (isBinary) return;
        const message = JSON.parse(data.toString()) as Record<string, any>;
        socket.send(JSON.stringify({
          header: {
            task_id: message.header.task_id,
            event: "task-failed",
            error_code: "InvalidApiKey",
            error_message: "Invalid API-key provided.",
            attributes: {},
          },
          payload: {},
        }));
      });
    });
    const session = new AliyunGummyProvider({
      apiKey: "bad-key",
      url,
      model: "gummy-realtime-v1",
      maxEndSilenceMs: 500,
    }).createSession(makeHello(DEFAULT_SETTINGS, "00000000-0000-4000-8000-000000000000", 0), () => {});

    await expect(session.start()).rejects.toMatchObject({
      code: "gummy_InvalidApiKey",
      message: expect.stringContaining("InvalidApiKey"),
      retryable: false,
    });
  });

  it("keeps an interim segment revisable when the stream fails", async () => {
    const url = await createServer((socket) => {
      let taskId = "";
      socket.on("message", (data, isBinary) => {
        if (!isBinary) {
          const message = JSON.parse(data.toString()) as Record<string, any>;
          if (message.header.action === "run-task") {
            taskId = message.header.task_id;
            socket.send(serviceEvent(taskId, "task-started"));
          }
          return;
        }
        socket.send(serviceEvent(taskId, "result-generated", {
          output: {
            transcription: {
              sentence_id: 9,
              begin_time: 0,
              end_time: 300,
              text: "partial",
              sentence_end: false,
              lang: "en",
            },
          },
        }));
        socket.send(JSON.stringify({
          header: {
            task_id: taskId,
            event: "task-failed",
            error_code: "SERVER_ERROR",
            error_message: "temporary failure",
            attributes: {},
          },
          payload: {},
        }));
      });
    });
    const events: ProviderEvent[] = [];
    const session = new AliyunGummyProvider({
      apiKey: "sk-test",
      url,
      model: "gummy-realtime-v1",
      maxEndSilenceMs: 500,
    }).createSession(
      makeHello(DEFAULT_SETTINGS, "00000000-0000-4000-8000-000000000000", 0),
      (event) => events.push(event),
    );
    await session.start();
    for (let index = 0; index < 3; index += 1) {
      session.write({ sequence: index, audioEndMs: 40 + index * 40, pcm: new Uint8Array(1_280) });
    }
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(events.filter((event) => event.type === "subtitle").map((event) => event.isFinal)).toEqual([false]);
    expect(events).toContainEqual(expect.objectContaining({
      type: "provider-error",
      code: "gummy_SERVER_ERROR",
      retryable: true,
    }));
  });
});

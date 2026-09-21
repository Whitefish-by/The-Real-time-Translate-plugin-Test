import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer, type WebSocket } from "ws";
import { DEFAULT_SETTINGS, makeHello, type SubtitleEvent } from "@live-subtitles/shared";
import { AliyunGummyProvider } from "../../apps/gateway/src/providers/gummy";
import type { ProviderEvent } from "../../apps/gateway/src/providers/types";

const servers: WebSocketServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(async (server) => {
    for (const client of server.clients) client.terminate();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }));
});

async function createServer(onRun: (socket: WebSocket, taskId: string) => void): Promise<string> {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  servers.push(server);
  server.on("connection", (socket) => {
    socket.on("message", (data, isBinary) => {
      if (isBinary) return;
      const message = JSON.parse(data.toString()) as { header: { action: string; task_id: string } };
      if (message.header.action === "run-task") onRun(socket, message.header.task_id);
      if (message.header.action === "finish-task") socket.send(serviceEvent(message.header.task_id, "task-finished"));
    });
  });
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("未获得本地WebSocket端口");
  return `ws://127.0.0.1:${address.port}`;
}

function serviceEvent(taskId: string, event: string, payload: object = {}, header: object = {}): string {
  return JSON.stringify({ header: { task_id: taskId, event, attributes: {}, ...header }, payload });
}

function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (predicate()) return resolve();
      if (Date.now() >= deadline) return reject(new Error("等待测试事件超时"));
      setTimeout(tick, 10);
    };
    tick();
  });
}

function resultPayload(translationLang = "zh"): object {
  return {
    output: {
      transcription: {
        sentence_id: 7,
        begin_time: 0,
        end_time: 800,
        text: "hello",
        sentence_end: false,
        lang: "en",
      },
      translations: [{
        sentence_id: 7,
        begin_time: 0,
        end_time: 800,
        text: "你好",
        sentence_end: false,
        lang: translationLang,
      }],
    },
  };
}

async function sessionFor(
  onRun: (socket: WebSocket, taskId: string) => void,
): Promise<{ session: ReturnType<AliyunGummyProvider["createSession"]>; events: ProviderEvent[] }> {
  const url = await createServer(onRun);
  const events: ProviderEvent[] = [];
  const session = new AliyunGummyProvider({
    apiKey: "sk-local-test",
    url,
    model: "gummy-realtime-v1",
    maxEndSilenceMs: 500,
  }).createSession(makeHello(DEFAULT_SETTINGS, "00000000-0000-4000-8000-000000000000", 2), (event) => events.push(event));
  return { session, events };
}

describe("模块二：Gummy Provider异常与结束场景", () => {
  it("M2-013 非JSON上游消息安全失败", async () => {
    const { session, events } = await sessionFor((socket, taskId) => {
      socket.send(serviceEvent(taskId, "task-started"));
      setTimeout(() => socket.send("not-json"), 0);
    });
    await session.start();
    await waitFor(() => events.some((event) => event.type === "provider-error"));
    expect(events).toContainEqual(expect.objectContaining({ type: "provider-error", code: "gummy_invalid_json" }));
  });

  it("M2-014 非法结构上游消息安全失败", async () => {
    const { session, events } = await sessionFor((socket, taskId) => {
      socket.send(serviceEvent(taskId, "task-started"));
      setTimeout(() => socket.send(JSON.stringify({ header: { event: "unexpected-event" } })), 0);
    });
    await session.start();
    await waitFor(() => events.some((event) => event.type === "provider-error"));
    expect(events).toContainEqual(expect.objectContaining({ type: "provider-error", code: "gummy_invalid_event" }));
  });

  it("M2-015 错误taskId消息被忽略", async () => {
    const { session, events } = await sessionFor((socket, taskId) => {
      socket.send(serviceEvent(taskId, "task-started"));
      socket.send(serviceEvent("foreign-task", "result-generated", resultPayload()));
    });
    await session.start();
    await session.end();
    expect(events.filter((event) => event.type === "subtitle")).toEqual([]);
    expect(events).toContainEqual(expect.objectContaining({ type: "provider-status", code: "stopped" }));
  });

  it("M2-016 未知翻译语言码受控失败", async () => {
    const uncaught: unknown[] = [];
    const listener = (error: unknown) => uncaught.push(error);
    process.on("uncaughtException", listener);
    try {
      const { session, events } = await sessionFor((socket, taskId) => {
        socket.send(serviceEvent(taskId, "task-started"));
        setTimeout(() => socket.send(serviceEvent(taskId, "result-generated", resultPayload("xx"))), 0);
      });
      await session.start();
      await waitFor(() => events.some((event) => event.type === "provider-error") || uncaught.length > 0);
      expect(events).toContainEqual(expect.objectContaining({
        type: "provider-error",
        code: "gummy_result_processing_failed",
        retryable: true,
      }));
      expect(uncaught).toEqual([]);
    } finally {
      process.off("uncaughtException", listener);
    }
  });

  it("M2-017 额度错误分类为不可重试", async () => {
    const { session, events } = await sessionFor((socket, taskId) => {
      socket.send(serviceEvent(taskId, "task-started"));
      setTimeout(() => socket.send(serviceEvent(taskId, "task-failed", {}, {
        error_code: "QuotaExhausted",
        error_message: "quota exhausted",
      })), 0);
    });
    await session.start();
    await waitFor(() => events.some((event) => event.type === "provider-error"));
    expect(events).toContainEqual(expect.objectContaining({
      type: "provider-error",
      code: "gummy_QuotaExhausted",
      retryable: false,
    }));
  });

  it("M2-018 正常结束固化临时片段", async () => {
    const { session, events } = await sessionFor((socket, taskId) => {
      socket.send(serviceEvent(taskId, "task-started"));
      setTimeout(() => socket.send(serviceEvent(taskId, "result-generated", resultPayload())), 0);
    });
    await session.start();
    await waitFor(() => events.some((event) => event.type === "subtitle"));
    await session.end();
    const subtitles = events.filter((event): event is SubtitleEvent => event.type === "subtitle");
    expect(subtitles.map((event) => event.isFinal)).toEqual([false, true]);
    expect(subtitles.at(-1)).toMatchObject({ segmentId: "gummy-7", sourceText: "hello", isFinal: true });
  });
});

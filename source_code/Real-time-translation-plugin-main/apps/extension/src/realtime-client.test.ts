import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, decodeAudioFrame } from "@live-subtitles/shared";
import { RealtimeClient } from "./realtime-client";

class MockWebSocket extends EventTarget {
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  readonly url: string;
  readyState = MockWebSocket.OPEN;
  bufferedAmount = 0;
  binaryType = "blob";
  sent: unknown[] = [];

  constructor(url: string | URL) {
    super();
    this.url = String(url);
    sockets.push(this);
  }

  send(data: unknown): void { this.sent.push(data); }
  close(): void {
    if (this.readyState === MockWebSocket.CLOSED) return;
    this.readyState = MockWebSocket.CLOSED;
    this.dispatchEvent(new Event("close"));
  }
}

const sockets: MockWebSocket[] = [];

afterEach(() => {
  sockets.splice(0);
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("RealtimeClient", () => {
  it("keeps at most two seconds of PCM while connecting and flushes it in sequence", () => {
    vi.stubGlobal("WebSocket", MockWebSocket);
    const client = new RealtimeClient(DEFAULT_SETTINGS, "00000000-0000-4000-8000-000000000000", 0, {
      onMessage: () => undefined,
      onState: () => undefined,
    });
    client.connect();
    const socket = sockets[0]!;
    socket.dispatchEvent(new Event("open"));
    for (const [sequence, audioEndMs] of [0, 800, 1_600, 2_400].entries()) {
      client.push({ sequence, audioEndMs, pcm: new Uint8Array([sequence, 0]) });
    }
    socket.dispatchEvent(new MessageEvent("message", {
      data: JSON.stringify({ type: "ready", sessionId: "00000000-0000-4000-8000-000000000000", provider: "fake" }),
    }));
    const frames = socket.sent.filter((item): item is ArrayBuffer => item instanceof ArrayBuffer).map(decodeAudioFrame);
    expect(frames.map((frame) => frame.audioEndMs)).toEqual([800, 1_600, 2_400]);
    expect(frames.map((frame) => frame.sequence)).toEqual([1, 2, 3]);
  });

  it("increments the generation on reconnect and reports a truncated audio buffer", () => {
    vi.useFakeTimers();
    vi.stubGlobal("WebSocket", MockWebSocket);
    const messages: Array<{ type: string; code?: string }> = [];
    const client = new RealtimeClient(DEFAULT_SETTINGS, "00000000-0000-4000-8000-000000000000", 3, {
      onMessage: (message) => messages.push(message),
      onState: () => undefined,
    });
    client.connect();
    const first = sockets[0]!;
    first.dispatchEvent(new Event("open"));
    first.dispatchEvent(new MessageEvent("message", {
      data: JSON.stringify({ type: "ready", sessionId: "00000000-0000-4000-8000-000000000000", provider: "fake" }),
    }));
    first.close();
    for (const [sequence, audioEndMs] of [40, 1_040, 2_080, 3_120].entries()) {
      client.push({ sequence, audioEndMs, pcm: new Uint8Array([0, 0]) });
    }
    vi.advanceTimersByTime(100);
    const second = sockets[1]!;
    second.dispatchEvent(new Event("open"));
    const hello = JSON.parse(String(second.sent[0])) as { generation: number };
    expect(hello.generation).toBe(4);
    second.dispatchEvent(new MessageEvent("message", {
      data: JSON.stringify({ type: "ready", sessionId: "00000000-0000-4000-8000-000000000000", provider: "fake" }),
    }));
    expect(messages).toContainEqual(expect.objectContaining({ type: "status", code: "audio_gap" }));
  });

  it("does not reconnect after a fatal gateway error", () => {
    vi.useFakeTimers();
    vi.stubGlobal("WebSocket", MockWebSocket);
    const client = new RealtimeClient(DEFAULT_SETTINGS, "00000000-0000-4000-8000-000000000000", 0, {
      onMessage: () => undefined,
      onState: () => undefined,
    });
    client.connect();
    const socket = sockets[0]!;
    socket.dispatchEvent(new Event("open"));
    socket.dispatchEvent(new MessageEvent("message", {
      data: JSON.stringify({ type: "error", sessionId: "00000000-0000-4000-8000-000000000000", code: "unauthorized", message: "Invalid token", retryable: false }),
    }));
    vi.advanceTimersByTime(10_000);
    expect(sockets).toHaveLength(1);
  });

  it("rejects messages routed from another session", () => {
    vi.stubGlobal("WebSocket", MockWebSocket);
    const messages: Array<{ type: string; code?: string }> = [];
    const client = new RealtimeClient(DEFAULT_SETTINGS, "00000000-0000-4000-8000-000000000000", 0, {
      onMessage: (message) => messages.push(message),
      onState: () => undefined,
    });
    client.connect();
    const socket = sockets[0]!;
    socket.dispatchEvent(new MessageEvent("message", {
      data: JSON.stringify({ type: "ready", sessionId: "10000000-0000-4000-8000-000000000000", provider: "fake" }),
    }));
    expect(messages).toContainEqual(expect.objectContaining({ type: "error", code: "session_mismatch" }));
  });
});

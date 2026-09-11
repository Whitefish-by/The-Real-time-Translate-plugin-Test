import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, makeHello, type ServerMessage } from "@live-subtitles/shared";
import { FakeSpeechProvider } from "./fake";
import type { ProviderEvent } from "./types";

describe("speech provider contract", () => {
  it("emits status, revisable interim text, and one final result without retaining audio", async () => {
    const events: ProviderEvent[] = [];
    const hello = makeHello(DEFAULT_SETTINGS, "00000000-0000-4000-8000-000000000000", 2);
    const session = new FakeSpeechProvider().createSession(hello, (event) => events.push(event));
    await session.start();
    session.write({ sequence: 0, audioEndMs: 800, pcm: new Uint8Array(1_280) });
    await new Promise((resolve) => setTimeout(resolve, 220));

    const subtitles = events.filter((event): event is Extract<ServerMessage, { type: "subtitle" }> => event.type === "subtitle");
    expect(events[0]).toMatchObject({ type: "provider-status", code: "listening" });
    expect(subtitles).toHaveLength(2);
    expect(subtitles.map((event) => [event.revision, event.isFinal])).toEqual([[0, false], [1, true]]);
    expect(subtitles.every((event) => event.generation === 2)).toBe(true);
    await session.end();
  });

  it("does not emit a delayed final result after abort", async () => {
    const events: ProviderEvent[] = [];
    const session = new FakeSpeechProvider().createSession(
      makeHello(DEFAULT_SETTINGS, "00000000-0000-4000-8000-000000000000", 0),
      (event) => events.push(event),
    );
    await session.start();
    session.write({ sequence: 0, audioEndMs: 800, pcm: new Uint8Array(1_280) });
    session.abort();
    await new Promise((resolve) => setTimeout(resolve, 220));
    expect(events.filter((event) => event.type === "subtitle" && event.isFinal)).toHaveLength(0);
  });
});

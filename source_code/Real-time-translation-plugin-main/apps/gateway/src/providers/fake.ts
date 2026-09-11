import type { AudioFrame, HelloMessage, SubtitleEvent } from "@live-subtitles/shared";
import type { ProviderEventHandler, SpeechProvider, SpeechProviderSession } from "./types";

const SCRIPT = [
  ["这是实时字幕测试。", null],
  ["Low latency subtitles are working.", "低延迟字幕正常工作。"],
  ["The language was detected automatically.", "已自动检测语言。"],
] as const;

function baseLanguage(language: string): string {
  return language.toLowerCase().split("-")[0] ?? language.toLowerCase();
}

class FakeSession implements SpeechProviderSession {
  private lastEmissionAt = 0;
  private segmentIndex = 0;
  private stopped = false;

  constructor(private readonly hello: HelloMessage, private readonly emit: ProviderEventHandler) {}

  async start(): Promise<void> {
    this.emit({ type: "provider-status", code: "listening", message: "模拟识别器正在监听" });
  }

  write(frame: AudioFrame): void {
    if (this.stopped || frame.audioEndMs - this.lastEmissionAt < 800) return;
    this.lastEmissionAt = frame.audioEndMs;
    const script = SCRIPT[this.segmentIndex % SCRIPT.length] ?? SCRIPT[0];
    const sourceLanguage = this.segmentIndex % SCRIPT.length === 0 ? "zh-CN" : "en-US";
    const segmentId = `fake-${this.segmentIndex}`;
    const translatedText = baseLanguage(sourceLanguage) === baseLanguage(this.hello.targetLanguage)
      ? null
      : this.hello.targetLanguage.startsWith("zh") && script[1]
        ? script[1]
        : `【${this.hello.targetLanguage}】${script[0]}`;
    this.emit(this.subtitle(segmentId, 0, sourceLanguage, `${script[0].slice(0, Math.max(1, Math.floor(script[0].length / 2)))}…`, translatedText, false, frame.audioEndMs));
    setTimeout(() => {
      if (this.stopped) return;
      this.emit(this.subtitle(segmentId, 1, sourceLanguage, script[0], translatedText, true, frame.audioEndMs));
    }, 180).unref();
    this.segmentIndex += 1;
  }

  async end(): Promise<void> {
    this.stopped = true;
  }

  abort(): void {
    this.stopped = true;
  }

  private subtitle(
    segmentId: string,
    revision: number,
    sourceLanguage: string,
    sourceText: string,
    translatedText: string | null,
    isFinal: boolean,
    audioEndMs: number,
  ): SubtitleEvent {
    return {
      type: "subtitle",
      sessionId: this.hello.sessionId,
      segmentId,
      revision,
      sourceLanguage,
      sourceText,
      translatedText,
      isFinal,
      audioStartMs: Math.max(0, audioEndMs - 800),
      audioEndMs,
      generation: this.hello.generation,
    };
  }
}

export class FakeSpeechProvider implements SpeechProvider {
  readonly name = "fake";

  createSession(hello: HelloMessage, emit: ProviderEventHandler): SpeechProviderSession {
    return new FakeSession(hello, emit);
  }
}

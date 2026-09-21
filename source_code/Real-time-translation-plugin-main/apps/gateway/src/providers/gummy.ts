import { randomUUID } from "node:crypto";
import WebSocket, { type RawData } from "ws";
import { z } from "zod";
import type { AudioFrame, HelloMessage, SubtitleEvent } from "@live-subtitles/shared";
import { mapProviderAudioRange } from "./audio-timeline";
import { fromGummyLanguage, sameGummyLanguage, toGummyLanguage } from "./gummy-languages";
import { ProviderStartError, type ProviderEventHandler, type SpeechProvider, type SpeechProviderSession } from "./types";

const GUMMY_CHUNK_BYTES = 3_200; // 100 ms of 16 kHz, 16-bit mono PCM.
const MAX_BUFFERED_BYTES = 64_000; // Two seconds of PCM before reconnect is safer than growing memory.
const TASK_START_TIMEOUT_MS = 10_000;
const TASK_FINISH_TIMEOUT_MS = 10_000;

const sentenceSchema = z.object({
  sentence_id: z.union([z.number().int(), z.string()]),
  begin_time: z.number().int().nonnegative(),
  end_time: z.number().int().nonnegative(),
  text: z.string(),
  sentence_end: z.boolean(),
  lang: z.string().optional(),
  language: z.string().optional(),
  source_language: z.string().optional(),
}).passthrough();

const gummyEventSchema = z.object({
  header: z.object({
    task_id: z.string().optional(),
    event: z.enum(["task-started", "result-generated", "task-finished", "task-failed"]),
    error_code: z.string().optional(),
    error_message: z.string().optional(),
    attributes: z.record(z.string(), z.unknown()).optional(),
  }).passthrough(),
  payload: z.object({
    output: z.object({
      transcription: sentenceSchema.optional(),
      translations: z.array(sentenceSchema).optional(),
      source_language: z.string().optional(),
      language: z.string().optional(),
    }).passthrough().optional(),
  }).passthrough().optional(),
}).passthrough();

type GummySentence = z.infer<typeof sentenceSchema>;
type GummyEvent = z.infer<typeof gummyEventSchema>;

export type GummyOptions = {
  apiKey: string;
  url: string;
  model: string;
  maxEndSilenceMs: number;
  workspaceId?: string;
};

type SegmentState = {
  sourceText: string;
  translatedText: string | null;
  sourceLanguage: string;
  beginTimeMs: number;
  endTimeMs: number;
  sourceFinal: boolean;
  translationFinal: boolean;
  lastSignature: string;
  revision: number;
  emittedFinal: boolean;
};

type SessionState = "idle" | "starting" | "streaming" | "finishing" | "closed" | "aborted";

function failureIsRetryable(code: string, message: string): boolean {
  return !/(invalid.?api.?key|unauthori[sz]ed|forbidden|permission|quota|balance|arrears|parameter|bad.?request)/i.test(`${code} ${message}`);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

class GummySession implements SpeechProviderSession {
  private readonly taskId = randomUUID().replaceAll("-", "");
  private readonly targetLanguage: string;
  private readonly fixedSourceLanguage: string | null;
  private readonly translationEnabled: boolean;
  private readonly segments = new Map<string, SegmentState>();
  private socket: WebSocket | null = null;
  private state: SessionState = "idle";
  private pendingAudio = Buffer.alloc(0);
  private audioTimelineOriginMs: number | null = null;
  private startResolve: (() => void) | null = null;
  private startReject: ((error: Error) => void) | null = null;
  private finishResolve: (() => void) | null = null;
  private startTimer: NodeJS.Timeout | null = null;
  private finishTimer: NodeJS.Timeout | null = null;
  private failureEmitted = false;
  private lastDetectedLanguage: string;

  constructor(
    private readonly hello: HelloMessage,
    private readonly emit: ProviderEventHandler,
    private readonly options: GummyOptions,
  ) {
    this.targetLanguage = toGummyLanguage(hello.targetLanguage);
    this.fixedSourceLanguage = hello.sourceLanguages.length === 1
      ? toGummyLanguage(hello.sourceLanguages[0]!)
      : null;
    this.translationEnabled = this.fixedSourceLanguage === null
      || !sameGummyLanguage(this.fixedSourceLanguage, this.targetLanguage);
    this.lastDetectedLanguage = fromGummyLanguage(this.fixedSourceLanguage ?? undefined);
  }

  start(): Promise<void> {
    if (this.state !== "idle") return Promise.reject(new Error("Gummy 会话不能重复启动"));
    this.state = "starting";

    return new Promise((resolve, reject) => {
      this.startResolve = resolve;
      this.startReject = reject;
      const headers: Record<string, string> = {
        Authorization: `Bearer ${this.options.apiKey}`,
        "User-Agent": "live-bilingual-subtitles/0.1",
      };
      if (this.options.workspaceId) headers["X-DashScope-WorkSpace"] = this.options.workspaceId;

      const socket = new WebSocket(this.options.url, {
        headers,
        handshakeTimeout: TASK_START_TIMEOUT_MS,
        maxPayload: 256 * 1024,
      });
      this.socket = socket;
      socket.on("open", () => this.sendJson(this.runTaskMessage()));
      socket.on("message", (data) => this.handleMessage(data));
      socket.once("error", (error) => this.handleSocketError(error));
      socket.once("close", (code, reason) => this.handleClose(code, reason.toString()));

      this.startTimer = setTimeout(() => {
        this.failStart(new Error("连接 Gummy 后 10 秒内未收到 task-started"));
        socket.terminate();
      }, TASK_START_TIMEOUT_MS);
      this.startTimer.unref();
    });
  }

  write(frame: AudioFrame): void {
    if (this.state !== "streaming") return;
    this.audioTimelineOriginMs ??= Math.max(0, frame.audioEndMs - this.hello.audio.frameDurationMs);
    const pcm = Buffer.from(frame.pcm.buffer, frame.pcm.byteOffset, frame.pcm.byteLength);
    this.pendingAudio = Buffer.concat([this.pendingAudio, pcm]);
    while (this.pendingAudio.byteLength >= GUMMY_CHUNK_BYTES) {
      this.sendAudio(this.pendingAudio.subarray(0, GUMMY_CHUNK_BYTES));
      this.pendingAudio = this.pendingAudio.subarray(GUMMY_CHUNK_BYTES);
    }
  }

  end(): Promise<void> {
    if (this.state === "closed" || this.state === "aborted") return Promise.resolve();
    if (this.state !== "streaming") {
      this.abort();
      return Promise.resolve();
    }

    if (this.pendingAudio.byteLength > 0) {
      this.sendAudio(this.pendingAudio);
      this.pendingAudio = Buffer.alloc(0);
    }
    if (this.state !== "streaming") return Promise.resolve();
    this.state = "finishing";
    this.sendJson({
      header: { action: "finish-task", task_id: this.taskId, streaming: "duplex" },
      payload: { input: {} },
    });

    return new Promise((resolve) => {
      this.finishResolve = resolve;
      this.finishTimer = setTimeout(() => {
        this.emitFailure("gummy_finish_timeout", "Gummy 未在 10 秒内结束任务", true);
        this.finalizeOutstandingSegments();
        this.state = "closed";
        this.socket?.terminate();
        this.resolveFinish();
      }, TASK_FINISH_TIMEOUT_MS);
      this.finishTimer.unref();
    });
  }

  abort(): void {
    if (this.state === "closed" || this.state === "aborted") return;
    this.state = "aborted";
    this.clearTimers();
    this.pendingAudio = Buffer.alloc(0);
    this.segments.clear();
    this.socket?.terminate();
    this.socket = null;
    this.startReject?.(new Error("Gummy 会话已中止"));
    this.startResolve = null;
    this.startReject = null;
    this.resolveFinish();
  }

  private runTaskMessage(): object {
    return {
      header: { action: "run-task", task_id: this.taskId, streaming: "duplex" },
      payload: {
        task_group: "audio",
        task: "asr",
        function: "recognition",
        model: this.options.model,
        parameters: {
          sample_rate: 16_000,
          format: "pcm",
          // A single extension language is fixed; multiple choices use Gummy automatic detection.
          source_language: this.fixedSourceLanguage,
          transcription_enabled: true,
          translation_enabled: this.translationEnabled,
          ...(this.translationEnabled ? { translation_target_languages: [this.targetLanguage] } : {}),
          max_end_silence: this.options.maxEndSilenceMs,
        },
        input: {},
      },
    };
  }

  private handleMessage(raw: RawData): void {
    let candidate: unknown;
    try {
      candidate = JSON.parse(raw.toString());
    } catch {
      this.failActive("gummy_invalid_json", "Gummy 返回了无法解析的消息", true);
      return;
    }
    const parsed = gummyEventSchema.safeParse(candidate);
    if (!parsed.success) {
      this.failActive("gummy_invalid_event", "Gummy 返回了不符合协议的消息", true);
      return;
    }

    const event = parsed.data;
    if (event.header.task_id && event.header.task_id !== this.taskId) return;
    switch (event.header.event) {
      case "task-started":
        this.handleTaskStarted();
        break;
      case "result-generated":
        try {
          this.handleResult(event);
        } catch {
          this.failActive(
            "gummy_result_processing_failed",
            "Gummy 返回了无法处理的识别结果",
            true,
          );
        }
        break;
      case "task-finished":
        this.handleTaskFinished();
        break;
      case "task-failed": {
        const code = event.header.error_code ?? "task_failed";
        const message = event.header.error_message ?? "Gummy 任务失败";
        if (this.state === "starting") {
          this.failStart(new ProviderStartError(`gummy_${code}`, `${code}: ${message}`, failureIsRetryable(code, message)));
          this.socket?.close(1011, "task_failed");
        } else {
          this.failActive(`gummy_${code}`, message, failureIsRetryable(code, message));
        }
        break;
      }
    }
  }

  private handleTaskStarted(): void {
    if (this.state !== "starting") return;
    this.clearStartTimer();
    this.state = "streaming";
    this.startResolve?.();
    this.startResolve = null;
    this.startReject = null;
    this.emit({
      type: "provider-status",
      code: "listening",
      message: this.fixedSourceLanguage ? "阿里云 Gummy 正在使用固定源语言" : "阿里云 Gummy 正在自动检测语言",
      ...(this.fixedSourceLanguage ? { detectedLanguage: fromGummyLanguage(this.fixedSourceLanguage) } : {}),
    });
  }

  private handleResult(event: GummyEvent): void {
    if (this.state !== "streaming" && this.state !== "finishing") return;
    const output = event.payload?.output;
    if (!output) return;
    const transcription = output.transcription;
    const matchingTranslation = output.translations?.find((item) => toGummyLanguage(item.lang ?? this.targetLanguage) === this.targetLanguage)
      ?? output.translations?.[0];
    const sentenceId = transcription?.sentence_id ?? matchingTranslation?.sentence_id;
    if (sentenceId === undefined) return;

    const key = String(sentenceId);
    const existing = this.segments.get(key) ?? this.emptySegment();
    const detected = this.detectedLanguage(event, transcription);
    const next: SegmentState = {
      ...existing,
      ...(transcription ? {
        sourceText: transcription.text,
        beginTimeMs: transcription.begin_time,
        endTimeMs: transcription.end_time,
        sourceFinal: transcription.sentence_end,
      } : {}),
      ...(matchingTranslation ? {
        translatedText: matchingTranslation.text || null,
        translationFinal: matchingTranslation.sentence_end,
      } : {}),
      ...(detected !== "und" ? { sourceLanguage: detected } : {}),
    };
    this.segments.set(key, next);
    this.trimSegments();
    this.emitSegment(key, next, false);
  }

  private detectedLanguage(event: GummyEvent, transcription: GummySentence | undefined): string {
    const raw = transcription?.source_language
      ?? transcription?.language
      ?? transcription?.lang
      ?? event.payload?.output?.source_language
      ?? event.payload?.output?.language
      ?? optionalString(event.header.attributes?.source_language)
      ?? optionalString(event.header.attributes?.language)
      ?? this.fixedSourceLanguage
      ?? undefined;
    const detected = fromGummyLanguage(raw);
    if (detected !== "und" && detected !== this.lastDetectedLanguage) {
      this.lastDetectedLanguage = detected;
      this.emit({
        type: "provider-status",
        code: "language-detected",
        message: `检测到语言：${detected}`,
        detectedLanguage: detected,
      });
    }
    return detected;
  }

  private emptySegment(): SegmentState {
    return {
      sourceText: "",
      translatedText: null,
      sourceLanguage: "und",
      beginTimeMs: 0,
      endTimeMs: 0,
      sourceFinal: false,
      translationFinal: false,
      lastSignature: "",
      revision: -1,
      emittedFinal: false,
    };
  }

  private emitSegment(sentenceId: string, segment: SegmentState, forceFinal: boolean): void {
    if (!segment.sourceText) return;
    const translationExpected = segment.sourceLanguage === "und"
      || !sameGummyLanguage(segment.sourceLanguage, this.targetLanguage);
    const isFinal = forceFinal || (segment.sourceFinal && (!translationExpected || segment.translationFinal));
    const signature = JSON.stringify([
      segment.sourceText,
      segment.translatedText,
      segment.sourceLanguage,
      segment.beginTimeMs,
      segment.endTimeMs,
      isFinal,
    ]);
    if (signature === segment.lastSignature || (segment.emittedFinal && !isFinal)) return;

    segment.revision += 1;
    segment.lastSignature = signature;
    segment.emittedFinal ||= isFinal;
    const timelineOriginMs = this.audioTimelineOriginMs ?? 0;
    const range = mapProviderAudioRange(
      timelineOriginMs,
      segment.beginTimeMs,
      Math.max(0, segment.endTimeMs - segment.beginTimeMs),
    );
    const subtitle: SubtitleEvent = {
      type: "subtitle",
      sessionId: this.hello.sessionId,
      segmentId: `gummy-${sentenceId}`,
      revision: segment.revision,
      sourceLanguage: segment.sourceLanguage,
      sourceText: segment.sourceText,
      translatedText: segment.translatedText,
      isFinal,
      audioStartMs: range.audioStartMs,
      audioEndMs: range.audioEndMs,
      generation: this.hello.generation,
    };
    this.emit(subtitle);
  }

  private finalizeOutstandingSegments(): void {
    for (const [sentenceId, segment] of this.segments) {
      if (!segment.emittedFinal) this.emitSegment(sentenceId, segment, true);
    }
  }

  private handleTaskFinished(): void {
    if (this.state !== "finishing" && this.state !== "streaming") return;
    this.finalizeOutstandingSegments();
    this.state = "closed";
    this.clearTimers();
    this.socket?.close(1000, "task_finished");
    this.resolveFinish();
    this.emit({ type: "provider-status", code: "stopped", message: "阿里云 Gummy 会话已停止" });
  }

  private sendAudio(audio: Buffer): void {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      this.failActive("gummy_socket_not_open", "Gummy WebSocket 未连接", true);
      return;
    }
    if (socket.bufferedAmount > MAX_BUFFERED_BYTES) {
      this.failActive("gummy_backpressure", "Gummy 连接积压超过 2 秒音频", true);
      return;
    }
    socket.send(audio, { binary: true });
  }

  private sendJson(message: object): void {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify(message));
  }

  private failStart(error: Error): void {
    if (this.state !== "starting") return;
    this.clearStartTimer();
    this.state = "closed";
    this.startReject?.(error);
    this.startResolve = null;
    this.startReject = null;
  }

  private failActive(code: string, message: string, retryable: boolean): void {
    if (this.state === "closed" || this.state === "aborted") return;
    this.emitFailure(code, message, retryable);
    this.state = "closed";
    this.clearTimers();
    this.socket?.terminate();
    this.resolveFinish();
  }

  private emitFailure(code: string, message: string, retryable: boolean): void {
    if (this.failureEmitted) return;
    this.failureEmitted = true;
    this.emit({ type: "provider-error", code, message, retryable });
  }

  private handleSocketError(error: Error): void {
    if (this.state === "starting") {
      this.failStart(new Error(`连接 Gummy 失败：${error.message}`));
      return;
    }
    if (this.state !== "closed" && this.state !== "aborted") {
      this.failActive("gummy_socket_error", `Gummy 连接错误：${error.message}`, true);
    }
  }

  private handleClose(code: number, reason: string): void {
    this.socket = null;
    if (this.state === "closed" || this.state === "aborted") return;
    if (this.state === "starting") {
      this.failStart(new Error(`Gummy 在任务启动前断开（${code}${reason ? `: ${reason}` : ""}）`));
      return;
    }
    if (this.state === "finishing") {
      this.finalizeOutstandingSegments();
      this.state = "closed";
      this.clearTimers();
      this.resolveFinish();
      return;
    }
    this.failActive("gummy_socket_closed", `Gummy 连接意外断开（${code}${reason ? `: ${reason}` : ""}）`, true);
  }

  private trimSegments(): void {
    while (this.segments.size > 128) {
      const oldest = this.segments.keys().next().value as string | undefined;
      if (oldest === undefined) return;
      this.segments.delete(oldest);
    }
  }

  private clearStartTimer(): void {
    if (this.startTimer) clearTimeout(this.startTimer);
    this.startTimer = null;
  }

  private clearTimers(): void {
    this.clearStartTimer();
    if (this.finishTimer) clearTimeout(this.finishTimer);
    this.finishTimer = null;
  }

  private resolveFinish(): void {
    this.finishResolve?.();
    this.finishResolve = null;
  }
}

export class AliyunGummyProvider implements SpeechProvider {
  readonly name = "aliyun-gummy";

  constructor(private readonly options: GummyOptions) {}

  createSession(hello: HelloMessage, emit: ProviderEventHandler): SpeechProviderSession {
    return new GummySession(hello, emit, this.options);
  }
}

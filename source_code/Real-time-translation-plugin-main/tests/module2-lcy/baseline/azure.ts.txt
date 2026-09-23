import {
  AudioConfig,
  AudioInputStream,
  AudioStreamFormat,
  AutoDetectSourceLanguageConfig,
  AutoDetectSourceLanguageResult,
  PropertyId,
  ResultReason,
  SpeechTranslationConfig,
  TranslationRecognizer,
  type PushAudioInputStream,
  type TranslationRecognitionEventArgs,
} from "microsoft-cognitiveservices-speech-sdk";
import type { AudioFrame, HelloMessage, SubtitleEvent } from "@live-subtitles/shared";
import type { ProviderEventHandler, SpeechProvider, SpeechProviderSession } from "./types";
import { mapProviderAudioRange } from "./audio-timeline";

type AzureOptions = { key: string; region: string; endpoint?: string };

class AzureSession implements SpeechProviderSession {
  private readonly input: PushAudioInputStream;
  private readonly recognizer: TranslationRecognizer;
  private readonly revisions = new Map<string, number>();
  private stopped = false;
  private audioTimelineOriginMs: number | null = null;

  constructor(private readonly hello: HelloMessage, private readonly emit: ProviderEventHandler, options: AzureOptions) {
    const speechConfig = options.endpoint
      ? SpeechTranslationConfig.fromEndpoint(new URL(options.endpoint), options.key)
      : SpeechTranslationConfig.fromSubscription(options.key, options.region);
    speechConfig.setProperty(PropertyId.SpeechServiceConnection_LanguageIdMode, "Continuous");
    speechConfig.addTargetLanguage(hello.targetLanguage);
    speechConfig.enableDictation();

    this.input = AudioInputStream.createPushStream(AudioStreamFormat.getWaveFormatPCM(16_000, 16, 1));
    const audioConfig = AudioConfig.fromStreamInput(this.input);
    const autoDetect = AutoDetectSourceLanguageConfig.fromLanguages(hello.sourceLanguages);
    this.recognizer = TranslationRecognizer.FromConfig(speechConfig, autoDetect, audioConfig);

    this.recognizer.recognizing = (_sender, event) => this.handleResult(event, false);
    this.recognizer.recognized = (_sender, event) => this.handleResult(event, true);
    this.recognizer.canceled = (_sender, event) => {
      this.emit({
        type: "provider-error",
        code: `azure_${event.reason}`,
        message: event.errorDetails || "Azure 语音识别已取消",
        retryable: true,
      });
    };
    this.recognizer.sessionStopped = () => {
      this.emit({ type: "provider-status", code: "stopped", message: "Azure 识别会话已停止" });
    };
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.recognizer.startContinuousRecognitionAsync(resolve, (error) => reject(new Error(error)));
    });
  }

  write(frame: AudioFrame): void {
    if (this.stopped) return;
    this.audioTimelineOriginMs ??= Math.max(0, frame.audioEndMs - this.hello.audio.frameDurationMs);
    this.input.write(Uint8Array.from(frame.pcm).buffer);
  }

  end(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    this.stopped = true;
    this.input.close();
    return new Promise((resolve) => {
      this.recognizer.stopContinuousRecognitionAsync(
        () => {
          this.recognizer.close();
          resolve();
        },
        () => {
          this.recognizer.close();
          resolve();
        },
      );
    });
  }

  abort(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.input.close();
    this.recognizer.close();
  }

  private handleResult(event: TranslationRecognitionEventArgs, isFinal: boolean): void {
    const result = event.result;
    if (result.reason !== ResultReason.TranslatingSpeech && result.reason !== ResultReason.TranslatedSpeech) return;
    if (!result.text) return;

    const sourceLanguage = AutoDetectSourceLanguageResult.fromResult(result).language || this.hello.sourceLanguages[0] || "und";
    const offsetMs = Math.max(0, Math.round(Number(result.offset) / 10_000));
    const durationMs = Math.max(0, Math.round(Number(result.duration) / 10_000));
    const timelineOriginMs = this.audioTimelineOriginMs ?? 0;
    const { audioStartMs, audioEndMs } = mapProviderAudioRange(timelineOriginMs, offsetMs, durationMs);
    const segmentId = `azure-${audioStartMs}`;
    const revision = (this.revisions.get(segmentId) ?? -1) + 1;
    this.revisions.set(segmentId, revision);
    if (this.revisions.size > 128) {
      const oldest = this.revisions.keys().next().value as string | undefined;
      if (oldest !== undefined) this.revisions.delete(oldest);
    }
    const translatedText = result.translations.get(this.hello.targetLanguage) || null;

    const subtitle: SubtitleEvent = {
      type: "subtitle",
      sessionId: this.hello.sessionId,
      segmentId,
      revision,
      sourceLanguage,
      sourceText: result.text,
      translatedText,
      isFinal,
      audioStartMs,
      audioEndMs,
      generation: this.hello.generation,
    };
    this.emit(subtitle);
  }
}

export class AzureSpeechProvider implements SpeechProvider {
  readonly name = "azure";
  constructor(private readonly options: AzureOptions) {}

  createSession(hello: HelloMessage, emit: ProviderEventHandler): SpeechProviderSession {
    return new AzureSession(hello, emit, this.options);
  }
}

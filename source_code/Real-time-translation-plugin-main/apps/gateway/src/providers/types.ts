import type { AudioFrame, HelloMessage, SubtitleEvent } from "@live-subtitles/shared";

export type ProviderEvent =
  | SubtitleEvent
  | { type: "provider-status"; code: string; message: string; detectedLanguage?: string }
  | { type: "provider-error"; code: string; message: string; retryable: boolean };

export type ProviderEventHandler = (event: ProviderEvent) => void;

export class ProviderStartError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "ProviderStartError";
  }
}

export interface SpeechProviderSession {
  start(): Promise<void>;
  write(frame: AudioFrame): void;
  end(): Promise<void>;
  abort(): void;
}

export interface SpeechProvider {
  readonly name: string;
  createSession(hello: HelloMessage, emit: ProviderEventHandler): SpeechProviderSession;
}

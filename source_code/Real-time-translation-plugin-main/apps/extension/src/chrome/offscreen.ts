import { PCM_FORMAT, serverMessageSchema, type AudioFrame, type ExtensionSettings, type ServerMessage } from "@live-subtitles/shared";
import { RealtimeClient } from "../realtime-client";
import type { ExtensionMessage, SessionSnapshot } from "../messages";

let stream: MediaStream | null = null;
let audioContext: AudioContext | null = null;
let realtime: RealtimeClient | null = null;
let sequence = 0;
let audioEndMs = 0;
let activeSessionId: string | null = null;
let silentFrameCount = 0;
let silenceNoticeSent = false;

function notify(message: ExtensionMessage): void {
  void chrome.runtime.sendMessage(message).catch(() => undefined);
}

function state(stateValue: SessionSnapshot["state"], statusMessage: string): void {
  if (activeSessionId) notify({ type: "offscreen:state", sessionId: activeSessionId, state: { state: stateValue, statusMessage } });
}

async function stopCapture(publishIdle = true): Promise<void> {
  const stoppedSessionId = activeSessionId;
  activeSessionId = null;
  realtime?.close();
  realtime = null;
  for (const track of stream?.getTracks() ?? []) track.stop();
  stream = null;
  if (audioContext) await audioContext.close().catch(() => undefined);
  audioContext = null;
  silentFrameCount = 0;
  silenceNoticeSent = false;
  if (publishIdle && stoppedSessionId) {
    notify({ type: "offscreen:state", sessionId: stoppedSessionId, state: { state: "idle", statusMessage: "字幕会话已停止" } });
  }
}

async function startCapture(streamId: string, sessionId: string, settings: ExtensionSettings, generation: number): Promise<void> {
  await stopCapture(false);
  activeSessionId = sessionId;
  sequence = 0;
  audioEndMs = 0;
  state("starting", "正在读取标签页音频…");
  stream = await navigator.mediaDevices.getUserMedia({
    audio: { mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: streamId } } as MediaTrackConstraints,
    video: false,
  });
  const audioTrack = stream.getAudioTracks()[0];
  if (!audioTrack) throw new Error("当前标签页没有可捕获的音频");
  audioTrack.addEventListener("ended", () => {
    if (activeSessionId !== sessionId) return;
    notify({ type: "offscreen:event", event: { type: "error", sessionId, code: "capture_ended", message: "标签页音频捕获已结束", retryable: false } });
    void stopCapture(false);
  });

  audioContext = new AudioContext({ latencyHint: "interactive" });
  await audioContext.audioWorklet.addModule(chrome.runtime.getURL("pcm-worklet.js"));
  const source = audioContext.createMediaStreamSource(stream);
  source.connect(audioContext.destination);
  const captureNode = new AudioWorkletNode(audioContext, "pcm-capture", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
  const silentGain = audioContext.createGain();
  silentGain.gain.value = 0;
  source.connect(captureNode).connect(silentGain).connect(audioContext.destination);

  realtime = new RealtimeClient(settings, sessionId, generation, {
    onMessage: (event: ServerMessage) => {
      const parsed = serverMessageSchema.parse(event);
      notify({ type: "offscreen:event", event: parsed });
      if (parsed.type === "error" && !parsed.retryable) void stopCapture(false);
    },
    onState: (clientState, statusMessage) => state(clientState === "ready" ? "capturing" : clientState === "reconnecting" ? "reconnecting" : clientState === "closed" ? "idle" : "starting", statusMessage),
  });
  captureNode.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
    const pcm = new Int16Array(event.data);
    let peak = 0;
    for (const sample of pcm) peak = Math.max(peak, Math.abs(sample));
    if (peak < 24) silentFrameCount += 1;
    else {
      silentFrameCount = 0;
      if (silenceNoticeSent) {
        notify({ type: "offscreen:event", event: { type: "status", sessionId, code: "audio_resumed", message: "已恢复检测网页声音" } });
      }
      silenceNoticeSent = false;
    }
    if (!silenceNoticeSent && silentFrameCount >= 125) {
      silenceNoticeSent = true;
      notify({ type: "offscreen:event", event: { type: "status", sessionId, code: "no_audio", message: "未检测到声音，请检查视频是否播放或标签页是否静音", detectedLanguage: undefined } });
    }
    audioEndMs += PCM_FORMAT.frameDurationMs;
    const frame: AudioFrame = { sequence, audioEndMs, pcm: new Uint8Array(event.data) };
    sequence += 1;
    realtime?.push(frame);
  };
  realtime.connect();
  await audioContext.resume();
}

chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
  if (message.type === "offscreen:start") {
    void startCapture(message.streamId, message.sessionId, message.settings, message.generation)
      .then(() => sendResponse({ ok: true }))
      .catch((error: unknown) => {
        const text = error instanceof Error ? error.message : "无法启动音频捕获";
        notify({ type: "offscreen:event", event: { type: "error", sessionId: message.sessionId, code: "capture_failed", message: text, retryable: false } });
        state("error", text);
        sendResponse({ ok: false, error: text });
      });
    return true;
  } else if (message.type === "offscreen:stop") {
    void stopCapture().then(() => sendResponse({ ok: true }));
    return true;
  }
  return false;
});

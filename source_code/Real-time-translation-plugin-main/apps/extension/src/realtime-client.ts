import { PCM_FORMAT, encodeAudioFrame, makeHello, serverMessageSchema, type AudioFrame, type ExtensionSettings, type ServerMessage } from "@live-subtitles/shared";

type State = "idle" | "connecting" | "ready" | "reconnecting" | "closed";
type Callbacks = {
  onMessage: (event: ServerMessage) => void;
  onState: (state: State, message: string) => void;
};

const RETRY_DELAYS = [100, 250, 500, 1_000, 2_000] as const;
const MAX_BUFFER_MS = 2_000;
const MAX_SOCKET_BUFFER_BYTES = 256 * 1_024;

export class RealtimeClient {
  private socket: WebSocket | null = null;
  private pending: AudioFrame[] = [];
  private reconnectAttempt = 0;
  private manuallyClosed = false;
  private ready = false;
  private droppedAudio = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly settings: ExtensionSettings,
    private readonly sessionId: string,
    private generation: number,
    private readonly callbacks: Callbacks,
  ) {}

  connect(): void {
    this.manuallyClosed = false;
    this.openSocket();
  }

  push(frame: AudioFrame): void {
    let resetConnection = false;
    if (this.socket?.readyState === WebSocket.OPEN && this.ready && this.socket.bufferedAmount <= MAX_SOCKET_BUFFER_BYTES) {
      try {
        this.socket.send(encodeAudioFrame(frame));
        return;
      } catch {
        this.ready = false;
        resetConnection = true;
      }
    } else if (this.socket?.readyState === WebSocket.OPEN && this.ready) {
      resetConnection = true;
    }
    this.buffer(frame);
    if (resetConnection && this.socket?.readyState === WebSocket.OPEN) {
      this.ready = false;
      this.socket.close(1013, "send_backpressure");
    }
  }

  private buffer(frame: AudioFrame): void {
    this.pending.push({ ...frame, pcm: frame.pcm.slice() });
    const newest = frame.audioEndMs;
    while (this.pending.length && newest - (this.pending[0]?.audioEndMs ?? newest) + PCM_FORMAT.frameDurationMs > MAX_BUFFER_MS) {
      this.pending.shift();
      this.droppedAudio = true;
    }
  }

  close(): void {
    this.manuallyClosed = true;
    this.ready = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ type: "end", sessionId: this.sessionId }));
      this.socket.close(1000, "client_stop");
    } else {
      this.socket?.close();
    }
    this.socket = null;
    this.pending = [];
    this.callbacks.onState("closed", "会话已停止");
  }

  private openSocket(): void {
    this.callbacks.onState(this.reconnectAttempt ? "reconnecting" : "connecting", this.reconnectAttempt ? "正在重连…" : "正在连接字幕网关…");
    const socket = new WebSocket(this.settings.gatewayUrl);
    socket.binaryType = "arraybuffer";
    this.socket = socket;
    socket.addEventListener("open", () => {
      if (socket === this.socket && !this.manuallyClosed) socket.send(JSON.stringify(makeHello(this.settings, this.sessionId, this.generation)));
    });
    socket.addEventListener("message", (message) => {
      if (socket !== this.socket) return;
      try {
        const parsed = serverMessageSchema.parse(JSON.parse(String(message.data)));
        if (parsed.sessionId && parsed.sessionId !== this.sessionId) {
          this.callbacks.onMessage({ type: "error", sessionId: this.sessionId, code: "session_mismatch", message: "网关返回了其他会话的消息", retryable: false });
          return;
        }
        let recoveredWithGap = false;
        if (parsed.type === "ready") {
          this.ready = true;
          this.reconnectAttempt = 0;
          this.callbacks.onState("ready", "正在生成字幕");
          for (const frame of this.pending.splice(0)) this.push(frame);
          if (this.droppedAudio) {
            this.droppedAudio = false;
            recoveredWithGap = true;
          }
        }
        this.callbacks.onMessage(parsed);
        if (recoveredWithGap) {
          this.callbacks.onMessage({
            type: "status",
            sessionId: this.sessionId,
            code: "audio_gap",
            message: "重连缓存已达 2 秒，部分字幕可能缺失",
          });
        }
        if (parsed.type === "error" && !parsed.retryable) {
          this.manuallyClosed = true;
          this.ready = false;
          this.pending = [];
          socket.close(1008, "fatal_server_error");
        }
      } catch {
        this.callbacks.onMessage({ type: "error", sessionId: this.sessionId, code: "invalid_server_message", message: "网关返回了无效消息", retryable: false });
      }
    });
    socket.addEventListener("close", () => {
      if (socket !== this.socket) return;
      this.ready = false;
      if (!this.manuallyClosed) this.scheduleReconnect();
    });
    socket.addEventListener("error", () => { if (socket === this.socket) socket.close(); });
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    const delay = RETRY_DELAYS[Math.min(this.reconnectAttempt, RETRY_DELAYS.length - 1)] ?? 2_000;
    this.reconnectAttempt += 1;
    this.generation += 1;
    this.callbacks.onState("reconnecting", "网络中断，正在快速重连…");
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.manuallyClosed) this.openSocket();
    }, delay);
  }
}

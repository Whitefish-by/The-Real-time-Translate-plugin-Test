import { extensionSettingsSchema, serverMessageSchema, type ExtensionSettings, type ServerMessage } from "@live-subtitles/shared";
import { ensureSettings, getSettings, setSettings } from "../storage";
import { IDLE_SNAPSHOT, type ExtensionMessage, type SessionSnapshot } from "../messages";

const NATIVE_APP_ID = "com.example.LiveBilingualSubtitles";
let snapshot: SessionSnapshot = IDLE_SNAPSHOT;
let settings: ExtensionSettings | undefined;
let activeTargetLanguage: string | undefined;
const SESSION_KEY = "activeSafariSession";

type PersistedSession = { snapshot: SessionSnapshot; targetLanguage?: string };

function isPersistedSession(value: unknown): value is PersistedSession {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<PersistedSession>;
  return Boolean(candidate.snapshot && typeof candidate.snapshot.state === "string" && typeof candidate.snapshot.statusMessage === "string");
}

const restored = Promise.all([getSettings(), chrome.storage.local.get(SESSION_KEY)]).then(([savedSettings, savedSession]) => {
  settings = savedSettings;
  if (isPersistedSession(savedSession[SESSION_KEY])) {
    snapshot = savedSession[SESSION_KEY].snapshot;
    activeTargetLanguage = savedSession[SESSION_KEY].targetLanguage;
  }
});

function isAllowedPage(url?: string): boolean {
  return Boolean(url && (url.startsWith("http://") || url.startsWith("https://")));
}

async function publishState(next: SessionSnapshot): Promise<void> {
  snapshot = next;
  if (next.state === "idle") {
    activeTargetLanguage = undefined;
    await chrome.storage.local.remove(SESSION_KEY);
  }
  else await chrome.storage.local.set({ [SESSION_KEY]: {
    snapshot: next,
    ...(activeTargetLanguage ? { targetLanguage: activeTargetLanguage } : {}),
  } satisfies PersistedSession });
  if (next.tabId !== undefined) {
    await chrome.tabs.sendMessage(next.tabId, { type: "content:state", state: next } satisfies ExtensionMessage).catch(() => undefined);
  }
  await chrome.runtime.sendMessage({ type: "popup:state", state: next } satisfies ExtensionMessage).catch(() => undefined);
}

async function nativeCommand(command: Record<string, unknown>): Promise<Record<string, unknown>> {
  return await chrome.runtime.sendNativeMessage(NATIVE_APP_ID, command) as Record<string, unknown>;
}

async function start(): Promise<SessionSnapshot> {
  await restored;
  settings ??= await getSettings();
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || tab.id === undefined || !isAllowedPage(tab.url)) throw new Error("请在普通 HTTP/HTTPS 网页上启动字幕");
  await stop();
  const sessionId = crypto.randomUUID();
  activeTargetLanguage = settings.targetLanguage;
  await publishState({ state: "starting", sessionId, tabId: tab.id, statusMessage: "正在请求 Safari 窗口音频…" });
  const response = await nativeCommand({ type: "start", commandId: crypto.randomUUID(), sessionId, tabId: tab.id, settings });
  if (!response.hostRunning) {
    await publishState({ ...snapshot, state: "error", errorCode: "host_not_running", statusMessage: "请先打开“实时双语字幕”菜单栏 App" });
  } else if (!response.accepted) {
    await publishState({ ...snapshot, state: "error", errorCode: "native_rejected", statusMessage: String(response.message ?? "伴随 App 拒绝了启动请求") });
  }
  return snapshot;
}

async function stop(): Promise<SessionSnapshot> {
  await restored;
  if (snapshot.sessionId) await nativeCommand({ type: "stop", commandId: crypto.randomUUID(), sessionId: snapshot.sessionId }).catch(() => undefined);
  const tabId = snapshot.tabId;
  await publishState({ ...IDLE_SNAPSHOT, ...(tabId !== undefined ? { tabId } : {}) });
  return snapshot;
}

async function deliver(event: ServerMessage, tabId = snapshot.tabId): Promise<void> {
  await restored;
  const parsed = serverMessageSchema.parse(event);
  if (parsed.sessionId && parsed.sessionId !== snapshot.sessionId) return;
  if (tabId !== undefined && snapshot.tabId !== undefined && tabId !== snapshot.tabId) return;
  if (parsed.type === "status") {
    await publishState({
      ...snapshot,
      state: parsed.code === "reconnecting" ? "reconnecting" : "capturing",
      statusMessage: parsed.message,
      ...(parsed.detectedLanguage ? { detectedLanguage: parsed.detectedLanguage } : {}),
      ...(parsed.latencyMs !== undefined ? { latencyMs: parsed.latencyMs } : {}),
    });
  } else if (parsed.type === "error") {
    await publishState({ ...snapshot, state: "error", statusMessage: parsed.message, errorCode: parsed.code });
  } else if (parsed.type === "ready") {
    await publishState({ ...snapshot, state: "capturing", statusMessage: "正在生成字幕" });
  }
  settings ??= await getSettings();
  const contentSettings = { ...settings, targetLanguage: activeTargetLanguage ?? settings.targetLanguage };
  if (tabId !== undefined) await chrome.tabs.sendMessage(tabId, { type: "content:subtitle", event: parsed, settings: contentSettings } satisfies ExtensionMessage).catch(() => undefined);
}

function parseNativeMessage(message: unknown): { event?: ServerMessage; tabId?: number } {
  if (!message || typeof message !== "object") return {};
  const object = message as Record<string, unknown>;
  const info = object.userInfo && typeof object.userInfo === "object"
    ? object.userInfo as Record<string, unknown>
    : object.message && typeof object.message === "object"
      ? object.message as Record<string, unknown>
      : object;
  const isNativeEnvelope = object.name === "native-event" || "userInfo" in object || "payload" in object;
  if (!isNativeEnvelope) return {};
  const payload = info.payload ?? (object.name === "native-event" && info.type ? info : undefined);
  if (!payload || typeof payload !== "object") return {};
  const tabId = typeof info.tabId === "number" ? info.tabId : undefined;
  return { event: payload as ServerMessage, ...(tabId !== undefined ? { tabId } : {}) };
}

async function testConnection(candidate: ExtensionSettings): Promise<{ ok: boolean; message: string }> {
  const validated = extensionSettingsSchema.parse(candidate);
  return new Promise((resolve) => {
    const socket = new WebSocket(validated.gatewayUrl);
    let settled = false;
    const finish = (result: { ok: boolean; message: string }): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.close();
      resolve(result);
    };
    const timer = setTimeout(() => finish({ ok: false, message: "连接超时" }), 3_000);
    socket.onopen = () => socket.send(JSON.stringify({ type: "hello", protocolVersion: 1, token: validated.clientToken, sessionId: crypto.randomUUID(), generation: 0, sourceLanguages: validated.sourceLanguages, targetLanguage: validated.targetLanguage, audio: { encoding: "pcm_s16le", sampleRate: 16_000, channels: 1, frameDurationMs: 40 } }));
    socket.onmessage = (message) => {
      try {
        const value = serverMessageSchema.parse(JSON.parse(String(message.data)));
        if (value.type === "ready") finish({ ok: true, message: "连接成功" });
        else if (value.type === "error") finish({ ok: false, message: value.message });
      } catch { finish({ ok: false, message: "网关返回了无效响应" }); }
    };
    socket.onerror = () => finish({ ok: false, message: "无法连接网关" });
  });
}

async function reconcileState(): Promise<void> {
  await restored;
  if (!snapshot.sessionId || snapshot.state === "idle") return;
  try {
    const response = await nativeCommand({ type: "status" });
    if (!response.hostRunning || response.activeSessionId !== snapshot.sessionId) {
      await publishState({ ...IDLE_SNAPSHOT, ...(snapshot.tabId !== undefined ? { tabId: snapshot.tabId } : {}) });
    }
  } catch {
    await publishState({ ...snapshot, state: "error", errorCode: "host_not_running", statusMessage: "请先打开“实时双语字幕”菜单栏 App" });
  }
}

chrome.runtime.onInstalled.addListener(() => void ensureSettings());
chrome.tabs.onRemoved.addListener((tabId) => { if (snapshot.tabId === tabId) void stop(); });

function connectNativeEvents(): void {
  try {
    const port = chrome.runtime.connectNative(NATIVE_APP_ID);
    port.onMessage.addListener((message: unknown) => {
      const native = parseNativeMessage(message);
      if (native.event) void deliver(native.event, native.tabId);
    });
    port.onDisconnect.addListener(() => {
      setTimeout(connectNativeEvents, 1_000);
    });
  } catch {
    // A later background wake or popup action will retry the native connection.
  }
}

connectNativeEvents();

chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
  const run = async (): Promise<unknown> => {
    await restored;
    const native = parseNativeMessage(message);
    if (native.event) { await deliver(native.event, native.tabId); return true; }
    switch (message.type) {
      case "popup:get-state": await reconcileState(); return snapshot;
      case "popup:start": return start();
      case "popup:stop": return stop();
      case "popup:open-options": await chrome.runtime.openOptionsPage(); return true;
      case "settings:get": settings ??= await getSettings(); return settings;
      case "settings:set": {
        settings = extensionSettingsSchema.parse(message.settings);
        await setSettings(settings);
        if (snapshot.tabId !== undefined) {
          const contentSettings = { ...settings, targetLanguage: activeTargetLanguage ?? settings.targetLanguage };
          await chrome.tabs.sendMessage(snapshot.tabId, { type: "content:settings", settings: contentSettings } satisfies ExtensionMessage).catch(() => undefined);
        }
        return settings;
      }
      case "settings:test": return testConnection(message.settings);
      case "safari:native-event": await deliver(message.event); return true;
      default: return undefined;
    }
  };
  void run().then(sendResponse).catch((error: unknown) => sendResponse({ error: error instanceof Error ? error.message : "未知错误" }));
  return true;
});

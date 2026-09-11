import { extensionSettingsSchema, serverMessageSchema, type ExtensionSettings, type ServerMessage } from "@live-subtitles/shared";
import { ensureSettings, getSettings, setSettings } from "../storage";
import { IDLE_SNAPSHOT, type ExtensionMessage, type SessionSnapshot } from "../messages";

let snapshot: SessionSnapshot = IDLE_SNAPSHOT;
let settings: ExtensionSettings | undefined;
let generation = 0;
let activeTargetLanguage: string | undefined;
const SESSION_KEY = "activeChromeSession";

type PersistedSession = { snapshot: SessionSnapshot; generation: number; targetLanguage?: string };

function isPersistedSession(value: unknown): value is PersistedSession {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<PersistedSession>;
  return Boolean(
    candidate.snapshot
    && typeof candidate.snapshot === "object"
    && typeof candidate.snapshot.state === "string"
    && typeof candidate.snapshot.statusMessage === "string"
    && typeof candidate.generation === "number",
  );
}

const restored = Promise.all([
  getSettings(),
  chrome.storage.session.get(SESSION_KEY),
]).then(([savedSettings, session]) => {
  settings = savedSettings;
  if (isPersistedSession(session[SESSION_KEY])) {
    snapshot = session[SESSION_KEY].snapshot;
    generation = session[SESSION_KEY].generation;
    activeTargetLanguage = session[SESSION_KEY].targetLanguage;
  }
});

function isAllowedPage(url?: string): boolean {
  return Boolean(url && (url.startsWith("http://") || url.startsWith("https://")));
}

async function publishState(next: SessionSnapshot): Promise<void> {
  snapshot = next;
  if (next.state === "idle") {
    activeTargetLanguage = undefined;
    await chrome.storage.session.remove(SESSION_KEY);
  }
  else await chrome.storage.session.set({ [SESSION_KEY]: {
    snapshot: next,
    generation,
    ...(activeTargetLanguage ? { targetLanguage: activeTargetLanguage } : {}),
  } satisfies PersistedSession });
  if (next.tabId !== undefined) {
    await chrome.tabs.sendMessage(next.tabId, { type: "content:state", state: next } satisfies ExtensionMessage).catch(() => undefined);
  }
  await chrome.runtime.sendMessage({ type: "popup:state", state: next } satisfies ExtensionMessage).catch(() => undefined);
}

async function ensureOffscreen(): Promise<void> {
  const url = chrome.runtime.getURL("offscreen.html");
  const contexts = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"], documentUrls: [url] });
  if (!contexts.length) {
    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: [chrome.offscreen.Reason.USER_MEDIA, chrome.offscreen.Reason.WEB_RTC],
      justification: "Capture and process the active tab audio for live subtitles",
    });
  }
}

async function stop(): Promise<void> {
  await restored;
  const oldTabId = snapshot.tabId;
  await chrome.runtime.sendMessage({ type: "offscreen:stop" } satisfies ExtensionMessage).catch(() => undefined);
  await chrome.offscreen.closeDocument().catch(() => undefined);
  await publishState({ ...IDLE_SNAPSHOT, ...(oldTabId !== undefined ? { tabId: oldTabId } : {}) });
}

async function start(targetTabId?: number): Promise<SessionSnapshot> {
  await restored;
  const tab = targetTabId === undefined
    ? (await chrome.tabs.query({ active: true, currentWindow: true }))[0]
    : await chrome.tabs.get(targetTabId).catch(() => undefined);
  if (!tab || tab.id === undefined || !isAllowedPage(tab.url)) throw new Error("请在普通 HTTP/HTTPS 网页上启动字幕");
  await stop();
  settings ??= await getSettings();
  const sessionId = crypto.randomUUID();
  generation += 1;
  activeTargetLanguage = settings.targetLanguage;
  await publishState({ state: "starting", sessionId, tabId: tab.id, statusMessage: "正在请求标签页音频…" });
  try {
    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
    await ensureOffscreen();
    const result = await chrome.runtime.sendMessage({ type: "offscreen:start", streamId, sessionId, settings, generation } satisfies ExtensionMessage) as { ok?: boolean; error?: string };
    if (!result?.ok) throw new Error(result?.error ?? "无法启动音频捕获");
    if (tab.mutedInfo?.muted) {
      await deliver({ type: "status", sessionId, code: "tab_muted", message: "当前标签页已静音；如果没有字幕，请先取消静音" });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "无法启动音频捕获";
    await chrome.runtime.sendMessage({ type: "offscreen:stop" } satisfies ExtensionMessage).catch(() => undefined);
    await chrome.offscreen.closeDocument().catch(() => undefined);
    await publishState({ ...snapshot, state: "error", statusMessage: message, errorCode: "capture_failed" });
    throw error;
  }
  return snapshot;
}

async function deliver(event: ServerMessage): Promise<void> {
  await restored;
  const parsed = serverMessageSchema.parse(event);
  if (parsed.sessionId && parsed.sessionId !== snapshot.sessionId) return;
  const tabId = snapshot.tabId;
  if (parsed.type === "status") {
    await publishState({
      ...snapshot,
      state: snapshot.state === "starting" ? "capturing" : snapshot.state,
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

async function testConnection(candidate: ExtensionSettings): Promise<{ ok: boolean; message: string }> {
  const validated = extensionSettingsSchema.parse(candidate);
  return new Promise((resolve) => {
    const socket = new WebSocket(validated.gatewayUrl);
    const sessionId = crypto.randomUUID();
    let settled = false;
    const finish = (result: { ok: boolean; message: string }): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.close();
      resolve(result);
    };
    const timer = setTimeout(() => finish({ ok: false, message: "连接超时" }), 3_000);
    socket.onopen = () => socket.send(JSON.stringify({
      type: "hello", protocolVersion: 1, token: validated.clientToken, sessionId, generation: 0,
      sourceLanguages: validated.sourceLanguages, targetLanguage: validated.targetLanguage,
      audio: { encoding: "pcm_s16le", sampleRate: 16_000, channels: 1, frameDurationMs: 40 },
    }));
    socket.onmessage = (message) => {
      try {
        const data = serverMessageSchema.parse(JSON.parse(String(message.data)));
        if (data.type === "ready") finish({ ok: true, message: "连接成功" });
        else if (data.type === "error") finish({ ok: false, message: data.message });
      } catch { finish({ ok: false, message: "网关返回了无效响应" }); }
    };
    socket.onerror = () => finish({ ok: false, message: "无法连接网关" });
  });
}

chrome.runtime.onInstalled.addListener(() => void ensureSettings());
chrome.tabs.onRemoved.addListener((tabId) => { if (snapshot.tabId === tabId) void stop(); });
chrome.commands.onCommand.addListener((command) => {
  if (command !== "toggle-subtitles") return;
  void restored.then(async () => {
    if (snapshot.state === "idle" || snapshot.state === "error") await start();
    else await stop();
  }).catch(() => undefined);
});
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (tabId === snapshot.tabId && snapshot.sessionId && changeInfo.mutedInfo) {
    void deliver({
      type: "status",
      sessionId: snapshot.sessionId,
      code: changeInfo.mutedInfo.muted ? "tab_muted" : "audio_resumed",
      message: changeInfo.mutedInfo.muted ? "当前标签页已静音；如果没有字幕，请先取消静音" : "标签页已取消静音",
    });
  }
  if (changeInfo.status !== "complete" || tabId !== snapshot.tabId || snapshot.state === "idle") return;
  void restored.then(async () => {
    settings ??= await getSettings();
    const contentSettings = { ...settings, targetLanguage: activeTargetLanguage ?? settings.targetLanguage };
    await chrome.tabs.sendMessage(tabId, { type: "content:settings", settings: contentSettings } satisfies ExtensionMessage).catch(() => undefined);
    await chrome.tabs.sendMessage(tabId, { type: "content:state", state: snapshot } satisfies ExtensionMessage).catch(() => undefined);
  });
});

chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
  const run = async (): Promise<unknown> => {
    await restored;
    switch (message.type) {
      case "popup:get-state": return snapshot;
      case "popup:start": return start(message.tabId);
      case "popup:stop": await stop(); return snapshot;
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
      case "offscreen:event": await deliver(message.event); return true;
      case "offscreen:state":
        if (message.sessionId === snapshot.sessionId) await publishState({ ...snapshot, ...message.state });
        return true;
      default: return undefined;
    }
  };
  void run().then(sendResponse).catch((error: unknown) => sendResponse({ error: error instanceof Error ? error.message : "未知错误" }));
  return true;
});

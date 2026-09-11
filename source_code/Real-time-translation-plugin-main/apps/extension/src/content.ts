import {
  type ExtensionSettings,
  type ServerMessage,
  type SubtitleEvent,
} from "@live-subtitles/shared";
import type { ExtensionMessage, SessionSnapshot } from "./messages";

const host = document.createElement("div");
host.id = "live-bilingual-subtitles-root";
host.style.cssText = "all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none";
const shadow = host.attachShadow({ mode: "closed" });

const style = document.createElement("style");
style.textContent = `
  :host { all: initial; }
  #panel { position: fixed; left: 50%; bottom: var(--offset, 42px); transform: translateX(-50%); width: min(92vw, 1050px); color: white; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; text-align: center; pointer-events: auto; user-select: none; cursor: grab; }
  #panel.dragging { cursor: grabbing; }
  .segment { display: none; margin-top: 8px; padding: 8px 18px; border-radius: 10px; background: rgb(0 0 0 / var(--opacity, .72)); box-shadow: 0 2px 16px rgb(0 0 0 / .35); text-shadow: 0 1px 3px #000; line-height: 1.3; backdrop-filter: blur(5px); }
  .segment.visible { display: block; }
  .source { font-size: var(--font-size, 24px); }
  .translation { margin-top: 5px; color: #b9e5ff; font-size: calc(var(--font-size, 24px) * .9); }
  .translation:empty { display: none; }
  #status { display: none; width: max-content; max-width: 80vw; margin: 0 auto 8px; padding: 5px 10px; border-radius: 999px; background: rgb(20 20 20 / .78); color: #eee; font-size: 13px; }
  #status.visible { display: block; }
  #status.error { background: rgb(145 25 25 / .9); }
`;
const panel = document.createElement("div");
panel.id = "panel";
const status = document.createElement("div");
status.id = "status";
const finalSegment = createSegment();
const interimSegment = createSegment();
panel.append(status, finalSegment.root, interimSegment.root);
shadow.append(style, panel);

let settings: ExtensionSettings | null = null;
type SubtitleState = { final: SubtitleEvent | null; interim: SubtitleEvent | null; revisions: Record<string, number> };
const emptySubtitleState = (): SubtitleState => ({ final: null, interim: null, revisions: {} });
const MAX_TRACKED_REVISIONS = 128;
function mergeSubtitle(state: SubtitleState, event: SubtitleEvent): SubtitleState {
  const eventKey = `${event.generation}:${event.segmentId}`;
  const previous = state.revisions[eventKey] ?? -1;
  if (event.revision <= previous) return state;
  const revisions = { ...state.revisions, [eventKey]: event.revision };
  const keys = Object.keys(revisions);
  for (let index = 0; index < keys.length - MAX_TRACKED_REVISIONS; index += 1) {
    const staleKey = keys[index];
    if (staleKey !== undefined) delete revisions[staleKey];
  }
  const replacesInterim = state.interim?.segmentId === event.segmentId && state.interim.generation === event.generation;
  return event.isFinal
    ? { final: event, interim: replacesInterim ? null : state.interim, revisions }
    : { ...state, interim: event, revisions };
}
function shouldShowTranslation(sourceLanguage: string, targetLanguage: string): boolean {
  const base = (tag: string) => tag.toLowerCase().split("-")[0] ?? tag.toLowerCase();
  return base(sourceLanguage) !== base(targetLanguage);
}

let subtitles = emptySubtitleState();
let statusTimer: number | undefined;

function createSegment(): { root: HTMLDivElement; source: HTMLDivElement; translation: HTMLDivElement } {
  const root = document.createElement("div");
  root.className = "segment";
  const source = document.createElement("div");
  source.className = "source";
  const translation = document.createElement("div");
  translation.className = "translation";
  root.append(source, translation);
  return { root, source, translation };
}

function attach(): void {
  const target = document.fullscreenElement ?? document.documentElement;
  if (host.parentElement !== target) target.append(host);
}

function renderSegment(view: ReturnType<typeof createSegment>, event: SubtitleEvent | null): void {
  if (!event || !settings) {
    view.root.classList.remove("visible");
    view.source.textContent = "";
    view.translation.textContent = "";
    return;
  }
  const showTranslation = shouldShowTranslation(event.sourceLanguage, settings.targetLanguage);
  view.root.classList.add("visible");
  if (settings.displayMode === "translation") {
    view.source.textContent = showTranslation ? event.translatedText ?? event.sourceText : event.sourceText;
    view.translation.textContent = "";
  } else if (settings.displayMode === "source") {
    view.source.textContent = event.sourceText;
    view.translation.textContent = "";
  } else {
    view.source.textContent = event.sourceText;
    view.translation.textContent = showTranslation ? event.translatedText ?? "" : "";
  }
}

function render(): void {
  if (!settings) return;
  panel.style.setProperty("--font-size", `${settings.fontSizePx}px`);
  panel.style.setProperty("--opacity", String(settings.backgroundOpacity));
  panel.style.setProperty("--offset", `${settings.verticalOffset}px`);
  renderSegment(finalSegment, subtitles.final);
  renderSegment(interimSegment, subtitles.interim);
}

function showStatus(message: string, error = false, persistent = false): void {
  window.clearTimeout(statusTimer);
  status.textContent = message;
  status.className = `visible${error ? " error" : ""}`;
  if (!persistent) statusTimer = window.setTimeout(() => { status.className = ""; }, 2_400);
}

function handleServerEvent(event: ServerMessage): void {
  if (event.type === "subtitle") {
    subtitles = mergeSubtitle(subtitles, event);
    render();
  } else if (event.type === "error") {
    showStatus(event.message, true, true);
  } else if (event.type === "status" && ["reconnecting", "audio_gap", "no_audio", "tab_muted"].includes(event.code)) {
    showStatus(event.message, false, true);
  } else if (event.type === "status" && event.code === "audio_resumed") {
    status.className = "";
  } else if (event.type === "ready") {
    showStatus("实时字幕已启动");
  }
}

function handleState(state: SessionSnapshot): void {
  if (state.state === "idle") {
    subtitles = emptySubtitleState();
    render();
    status.className = "";
  } else if (state.state === "error") {
    showStatus(state.statusMessage, true, true);
  } else if (state.state === "starting" || state.state === "reconnecting") {
    showStatus(state.statusMessage, false, true);
  }
}

chrome.runtime.onMessage.addListener((message: ExtensionMessage) => {
  if (message.type === "content:subtitle") {
    settings = message.settings;
    handleServerEvent(message.event);
  } else if (message.type === "content:state") {
    handleState(message.state);
  } else if (message.type === "content:settings") {
    settings = message.settings;
    render();
  }
});

document.addEventListener("fullscreenchange", attach);
let dragStartY = 0;
let dragStartOffset = 0;
panel.addEventListener("pointerdown", (event) => {
  if (!settings) return;
  dragStartY = event.clientY;
  dragStartOffset = settings.verticalOffset;
  panel.classList.add("dragging");
  panel.setPointerCapture(event.pointerId);
});
panel.addEventListener("pointermove", (event) => {
  if (!settings || !panel.hasPointerCapture(event.pointerId)) return;
  settings = { ...settings, verticalOffset: Math.max(0, Math.min(500, dragStartOffset + dragStartY - event.clientY)) };
  render();
});
panel.addEventListener("pointerup", (event) => {
  if (!settings) return;
  panel.classList.remove("dragging");
  panel.releasePointerCapture(event.pointerId);
  void chrome.runtime.sendMessage({ type: "settings:set", settings } satisfies ExtensionMessage);
});

if (document.documentElement) attach();
else document.addEventListener("DOMContentLoaded", attach, { once: true });
void chrome.runtime.sendMessage({ type: "settings:get" } satisfies ExtensionMessage).then((value: ExtensionSettings) => {
  settings = value;
  render();
});

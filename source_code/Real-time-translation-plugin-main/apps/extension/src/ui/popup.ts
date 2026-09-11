import type { ExtensionMessage, SessionSnapshot } from "../messages";

document.head.insertAdjacentHTML("beforeend", `<style>
  * { box-sizing: border-box; } body { margin:0; width:320px; color:#e9f2ff; background:#0b1220; font:14px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
  main { padding:18px; } h1 { margin:0 0 6px; font-size:18px; } .hint { color:#8fa6c6; font-size:12px; }
  .card { margin:16px 0; padding:13px; border:1px solid #24344f; border-radius:12px; background:#111d30; }
  .status { display:flex; align-items:center; gap:8px; } .dot { width:9px; height:9px; border-radius:50%; background:#6f7c90; }
  .dot.live { background:#39d98a; box-shadow:0 0 8px #39d98a; } .dot.error { background:#ff6464; }
  dl { display:grid; grid-template-columns:90px 1fr; margin:12px 0 0; gap:6px; font-size:12px; } dt { color:#8fa6c6; } dd { margin:0; text-align:right; }
  button { width:100%; border:0; border-radius:10px; padding:10px 12px; color:white; background:#1479ff; font-weight:650; cursor:pointer; }
  button.stop { background:#d64747; } button.secondary { margin-top:8px; color:#b8c8dc; background:#1b2a42; }
  button:disabled { opacity:.55; cursor:wait; } #error { min-height:18px; margin-top:8px; color:#ff9292; font-size:12px; }
</style>`);

document.querySelector("#app")!.innerHTML = `<main>
  <h1>实时双语字幕</h1><div class="hint">当前网页的原文与译文</div>
  <section class="card"><div class="status"><span id="dot" class="dot"></span><strong id="status">正在读取状态…</strong></div>
  <dl><dt>检测语言</dt><dd id="language">—</dd><dt>最近延迟</dt><dd id="latency">—</dd></dl></section>
  <button id="toggle" disabled>请稍候</button><button id="options" class="secondary">打开设置</button><div id="error"></div>
</main>`;

const toggle = document.querySelector<HTMLButtonElement>("#toggle")!;
const dot = document.querySelector("#dot")!;
const status = document.querySelector("#status")!;
const language = document.querySelector("#language")!;
const latency = document.querySelector("#latency")!;
const error = document.querySelector("#error")!;
let snapshot: SessionSnapshot;

function render(next: SessionSnapshot): void {
  snapshot = next;
  status.textContent = next.statusMessage;
  language.textContent = next.detectedLanguage ?? "自动检测中";
  latency.textContent = next.latencyMs === undefined ? "—" : `${next.latencyMs} ms`;
  const active = ["starting", "capturing", "reconnecting"].includes(next.state);
  dot.className = `dot ${next.state === "error" ? "error" : active ? "live" : ""}`;
  toggle.disabled = false;
  toggle.textContent = active ? "停止字幕" : "开始生成字幕";
  toggle.className = active ? "stop" : "";
  error.textContent = next.state === "error" ? next.statusMessage : "";
}

async function request<T>(message: ExtensionMessage): Promise<T> {
  const response = await chrome.runtime.sendMessage(message) as T & { error?: string };
  if (response && typeof response === "object" && response.error) throw new Error(response.error);
  return response;
}

toggle.addEventListener("click", async () => {
  toggle.disabled = true; error.textContent = "";
  try {
    if (["starting", "capturing", "reconnecting"].includes(snapshot.state)) {
      render(await request<SessionSnapshot>({ type: "popup:stop" }));
    } else {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      render(await request<SessionSnapshot>({ type: "popup:start", ...(tab?.id !== undefined ? { tabId: tab.id } : {}) }));
    }
  } catch (cause) {
    error.textContent = cause instanceof Error ? cause.message : "操作失败";
    toggle.disabled = false;
  }
});
document.querySelector("#options")!.addEventListener("click", () => void request({ type: "popup:open-options" }));
chrome.runtime.onMessage.addListener((message: ExtensionMessage) => {
  if (message.type === "popup:state") render(message.state);
});
void request<SessionSnapshot>({ type: "popup:get-state" }).then(render).catch((cause) => { error.textContent = cause instanceof Error ? cause.message : "无法读取状态"; });

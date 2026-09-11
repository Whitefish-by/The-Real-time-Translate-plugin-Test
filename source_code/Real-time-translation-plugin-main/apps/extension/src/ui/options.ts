import {
  displayModeSchema,
  extensionSettingsSchema,
  supportedSourceLanguages,
  targetLanguages,
  type ExtensionSettings,
} from "@live-subtitles/shared";
import type { ExtensionMessage } from "../messages";

const labels: Record<string, string> = {
  "zh-CN": "中文（普通话）", "en-US": "英语", "ja-JP": "日语", "ko-KR": "韩语", "fr-FR": "法语",
  "de-DE": "德语", "es-ES": "西班牙语", "ru-RU": "俄语", "pt-BR": "葡萄牙语", "ar-SA": "阿拉伯语",
  "zh-Hans": "简体中文", "zh-Hant": "繁体中文", en: "英语", ja: "日语", ko: "韩语", fr: "法语", de: "德语", es: "西班牙语", ru: "俄语", pt: "葡萄牙语", ar: "阿拉伯语",
};

document.head.insertAdjacentHTML("beforeend", `<style>
  *{box-sizing:border-box}body{margin:0;background:#f4f7fb;color:#152238;font:14px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{max-width:760px;margin:36px auto;padding:0 20px 60px}h1{font-size:26px}h2{font-size:16px;margin:0 0 14px}.card{margin:16px 0;padding:22px;border:1px solid #dae2ef;border-radius:14px;background:white;box-shadow:0 5px 24px #17345b0d}.languages{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.row{display:grid;grid-template-columns:180px 1fr;align-items:center;gap:14px;margin:13px 0}.row label{font-weight:600}input[type=text],input[type=password],select,input[type=number]{width:100%;padding:9px 10px;border:1px solid #bdcadc;border-radius:8px;background:white}input[type=range]{width:100%}.actions{display:flex;gap:10px;margin-top:20px}button{border:0;border-radius:9px;padding:10px 18px;background:#126cf3;color:white;font-weight:650;cursor:pointer}button.secondary{background:#e8eff9;color:#284363}#message{margin:14px 0;min-height:20px;color:#167342}.error{color:#c73434!important}.hint{color:#6f8098;font-size:12px}@media(max-width:600px){.row{grid-template-columns:1fr}.languages{grid-template-columns:1fr}}
</style>`);

document.querySelector("#app")!.innerHTML = `<h1>实时双语字幕设置</h1>
<form id="form">
  <section class="card"><h2>语言</h2><div class="hint">可选择 1–10 种源语言。仅选 1 种时固定该语言，可降低检测延迟；选择多种时由服务自动检测。</div><div id="languages" class="languages"></div>
    <div class="row"><label for="target">目标语言</label><select id="target"></select></div><div class="row"><label for="mode">显示模式</label><select id="mode"><option value="bilingual">原文 + 译文</option><option value="translation">仅译文</option><option value="source">仅原文</option></select></div>
  </section>
  <section class="card"><h2>外观</h2><div class="row"><label for="font">字号</label><input id="font" type="number" min="14" max="48"></div><div class="row"><label for="opacity">背景透明度</label><input id="opacity" type="range" min="0" max="1" step="0.05"></div><div class="row"><label for="offset">距底部高度 (px)</label><input id="offset" type="number" min="0" max="500"></div></section>
  <section class="card"><h2>实时网关</h2><div class="row"><label for="url">WebSocket 地址</label><input id="url" type="text" spellcheck="false"></div><div class="row"><label for="token">客户端令牌</label><input id="token" type="password" autocomplete="off"></div><div class="actions"><button type="submit">保存设置</button><button type="button" id="test" class="secondary">测试连接</button></div><div id="message"></div></section>
</form>`;

const languageBox = document.querySelector("#languages")!;
for (const code of supportedSourceLanguages) {
  const label = document.createElement("label");
  const input = document.createElement("input");
  input.type = "checkbox"; input.name = "sourceLanguage"; input.value = code;
  label.append(input, document.createTextNode(` ${labels[code] ?? code}`)); languageBox.append(label);
}
const target = document.querySelector<HTMLSelectElement>("#target")!;
for (const code of targetLanguages) target.add(new Option(labels[code] ?? code, code));

function collect(): ExtensionSettings {
  const sourceLanguages = [...document.querySelectorAll<HTMLInputElement>('input[name="sourceLanguage"]:checked')].map((item) => item.value);
  return extensionSettingsSchema.parse({
    sourceLanguages, targetLanguage: target.value, displayMode: displayModeSchema.parse((document.querySelector<HTMLSelectElement>("#mode")!).value),
    fontSizePx: Number((document.querySelector<HTMLInputElement>("#font")!).value), backgroundOpacity: Number((document.querySelector<HTMLInputElement>("#opacity")!).value),
    verticalOffset: Number((document.querySelector<HTMLInputElement>("#offset")!).value), gatewayUrl: (document.querySelector<HTMLInputElement>("#url")!).value.trim(), clientToken: (document.querySelector<HTMLInputElement>("#token")!).value,
  });
}
function show(text: string, isError = false): void { const box = document.querySelector("#message")!; box.textContent = text; box.className = isError ? "error" : ""; }
async function request<T>(message: ExtensionMessage): Promise<T> {
  const response = await chrome.runtime.sendMessage(message) as T & { error?: string };
  if (response && typeof response === "object" && response.error) throw new Error(response.error);
  return response;
}
function populate(settings: ExtensionSettings): void {
  for (const item of document.querySelectorAll<HTMLInputElement>('input[name="sourceLanguage"]')) item.checked = settings.sourceLanguages.includes(item.value);
  target.value = settings.targetLanguage; (document.querySelector<HTMLSelectElement>("#mode")!).value = settings.displayMode;
  (document.querySelector<HTMLInputElement>("#font")!).value = String(settings.fontSizePx); (document.querySelector<HTMLInputElement>("#opacity")!).value = String(settings.backgroundOpacity);
  (document.querySelector<HTMLInputElement>("#offset")!).value = String(settings.verticalOffset); (document.querySelector<HTMLInputElement>("#url")!).value = settings.gatewayUrl; (document.querySelector<HTMLInputElement>("#token")!).value = settings.clientToken;
}
document.querySelector("#form")!.addEventListener("submit", async (event) => { event.preventDefault(); try { await request({ type: "settings:set", settings: collect() }); show("设置已保存"); } catch (cause) { show(cause instanceof Error ? cause.message : "设置无效", true); } });
document.querySelector("#test")!.addEventListener("click", async () => { try { show("正在连接…"); const result = await request<{ ok: boolean; message: string }>({ type: "settings:test", settings: collect() }); show(result.message, !result.ok); } catch (cause) { show(cause instanceof Error ? cause.message : "连接失败", true); } });
void request<ExtensionSettings>({ type: "settings:get" }).then(populate).catch((cause) => show(cause instanceof Error ? cause.message : "无法读取设置", true));

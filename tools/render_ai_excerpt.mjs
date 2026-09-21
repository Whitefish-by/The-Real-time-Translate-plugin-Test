import fs from "node:fs";
import path from "node:path";
import { chromium } from "../source_code/Real-time-translation-plugin-main/node_modules/playwright/index.mjs";

const workspace = "/Users/whitefish/study/软件测试与实践";
const markdownPath = path.join(workspace, "deliverables/module2/AI实践记录.md");
const outputPath = path.join(workspace, "deliverables/module2/evidence/AI关键对话摘录.png");
const markdown = fs.readFileSync(markdownPath, "utf8");
for (const phrase of ["候选生成提示", "人工审查规则", "从 28 条到 24 条的关键修正"]) {
  if (!markdown.includes(phrase)) throw new Error(`AI实践记录缺少关键段落：${phrase}`);
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });
await page.setContent(`<!doctype html><meta charset="utf-8"><style>
  *{box-sizing:border-box}body{margin:0;background:#eef5f7;color:#153044;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif}
  main{width:1400px;height:900px;padding:60px 72px;position:relative;overflow:hidden}
  header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:34px}
  h1{font-size:38px;margin:0 0 10px;color:#0b3551;letter-spacing:.5px} .sub{font-size:17px;color:#527080}
  .badge{background:#0aa6a6;color:white;border-radius:20px;padding:9px 18px;font-weight:700;font-size:16px}
  .grid{display:grid;grid-template-columns:1.15fr .85fr;gap:24px}.card{background:white;border-radius:18px;padding:26px 30px;box-shadow:0 8px 24px rgba(11,53,81,.08);border-top:6px solid #12a8a8}
  .card.wide{grid-row:span 2}.card h2{font-size:20px;margin:0 0 16px;color:#0b5b78}.tag{font-size:13px;color:#fff;background:#164a6b;padding:5px 10px;border-radius:12px;margin-right:8px}
  p{font-size:18px;line-height:1.65;margin:12px 0}ol{margin:8px 0 0 24px;padding:0}li{font-size:17px;line-height:1.55;margin:8px 0}.strike{color:#8a3b3b}.good{color:#08766e;font-weight:700}
  footer{position:absolute;left:72px;right:72px;bottom:34px;border-top:1px solid #b9ccd3;padding-top:14px;color:#607985;font-size:15px;display:flex;justify-content:space-between}
</style><main>
  <header><div><h1>模块二 · 关键对话摘录</h1><div class="sub">从版本库 AI实践记录.md 的真实内容重新排版</div></div><div class="badge">方案2 · AI测</div></header>
  <section class="grid">
    <article class="card wide"><h2><span class="tag">提示</span>候选生成与缺陷定位</h2>
      <p>“阅读 README、共享协议、网关配置、Gummy provider 与 Chrome content script；在模块一 62 条之外，提出可在本地稳定复现的候选。”</p>
      <p>“优先检查跨层约束不一致，以及上游不可信消息触发异常时的会话生命周期。只读探针先确认现象，再决定是否计为独立缺陷。”</p>
      <h2 style="margin-top:24px"><span class="tag">AI初稿</span>28 条候选</h2>
      <p>覆盖配置边界、共享协议、Gummy 异常和 Chrome 交互；同时混入了需求依据不足、依赖真实云服务及协作范围不清的建议。</p>
      <h2 style="margin-top:24px"><span class="tag">结果</span>人工筛选后 24 条</h2>
      <p class="good">18 条 Vitest + 6 条 Playwright；边界值 15、等价类 4、场景法 5。</p>
    </article>
    <article class="card"><h2>人工剔除的 4 条</h2><ol>
      <li class="strike">部分损坏设置逐字段恢复：需求依据不足</li>
      <li class="strike">拒绝 zh-Hant：属于产品决策</li>
      <li class="strike">ready 前发送音频：外部契约未定义</li>
      <li class="strike">并入模块一 62 条：超出协作边界</li>
    </ol></article>
    <article class="card"><h2>人工补强</h2><ol>
      <li>真实云服务改为本地 WebSocket 模拟</li>
      <li>拖拽同时断言整数保存与指针状态</li>
      <li>未知语言码改测结果处理异常边界</li>
      <li>先隔离复现，再按独立根因计缺陷</li>
    </ol></article>
  </section>
  <footer><span>内容来源：deliverables/module2/AI实践记录.md</span><strong>非 Codex 界面截图</strong></footer>
</main>`);
await page.screenshot({ path: outputPath, fullPage: false });
await browser.close();

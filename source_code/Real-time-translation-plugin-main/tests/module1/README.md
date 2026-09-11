# 模块一测试基础实践

本目录包含本轮新增的 38 条用例，覆盖设置校验、音频处理、字幕状态、客户端缓存、网关会话和 Chrome 交互。用例编号 M1-001 至 M1-038 与交付 Excel 一一对应，使用等价类、边界值、场景法。项目原有的 36 条单元测试单独统计。

## 环境准备

需要 Node.js 24+、npm 11+。以下命令在源码工程根目录（包含 package.json）执行：

```bash
npm ci
npx playwright install chromium
```

Linux 如缺少浏览器系统库，按 Playwright 提示安装系统依赖后重试。首次安装需要网络，测试本身不连接云端识别服务，不需要 API Key。

## 一键运行

```bash
npm run test:module1
```

该命令依次执行 33 条 Vitest 测试、Chrome 扩展构建和 5 条 Playwright 测试。成功退出码为 0，任意测试失败、未执行或构建失败均返回非零。正常结果为 `Module 1: 38/38 passed; 0 not passed`。脚本在全部测试阶段结束后汇总，避免某个单测失败时遗漏浏览器结果。

结果保存在 `tests/module1/results/`：

- `summary.json`：38 个用例逐项状态、耗时、环境、执行时间及 Git 基线。
- `unit.json`、`browser.json`：测试框架原始记录。
- `unit.log`、`build.log`、`browser.log`：命令输出。
- `browser-artifacts/`：成功设置页和字幕截图，以及失败时的截图和 trace。

运行会更新本地 results 目录。首次实际执行的修复前后证据已归档至作业工作区 `deliverables/module1/evidence/`，日常重跑不覆盖归档。

## 整体回归

```bash
npm run test:regression
```

包含原有及新增代码的类型检查、原有单元测试、本轮全部测试、工作区构建、Safari 资源构建和原有浏览器测试。原有浏览器测试中真实标签页音频捕获用例由项目显式跳过，故预期为 3 passed、1 skipped。Safari 资源构建不代表 Swift 原生宿主构建或签名验收。

## 缺陷复现与回归

```bash
npm run test:module1:reproduce -- BUG-M1-001
npm run test:module1:reproduce -- BUG-M1-002
npm run test:module1:reproduce
```

复现脚本建立临时源码副本，只在副本中还原 `original-sources.json` 保存的三个原始文件，并执行对应失败用例。该命令**预期非零退出**，表示断言揭示原版缺陷；完整错误信息应与归档证据比对。脚本执行完即删除临时目录，不修改当前源码。它使用当前 node_modules 的依赖，不重新安装。

修复后的指定用例验证：

```bash
npx vitest run --config tests/module1/vitest.config.ts -t 'M1-025|M1-027'
npx playwright test --config tests/module1/playwright.config.ts -g M1-037
```

BUG-M1-001 对应最终字幕被临时结果重新显示（M1-025、M1-037）；BUG-M1-002 对应两秒缓存多保留一帧（M1-027）。修复补丁、原始 Git 版本和原始/修复后文件 SHA-256 位于归档证据目录。

## 结构与隔离方式

```text
cases.json                 编号、设计方法、输入、预期及文档元数据
core.test.ts               28 条纯函数与客户端测试
 gateway.test.ts           5 条本地 HTTP/WebSocket 集成测试
browser.spec.ts            5 条 Chrome 设置及字幕显示测试
vitest.config.ts           本轮 Vitest 范围，不混入原有测试
playwright.config.ts       隔离 Chromium、报告与截图设置
run.mjs                    一键编排与逐用例汇总
reproduce.mjs              原版缺陷隔离复现
original-sources.json      修复前的最小源码快照
```

网关测试绑定 `127.0.0.1` 随机端口，结束时关闭连接与服务。浏览器设置用例运行真实 MV3 扩展，每条用例先通过 settings:set 重置后台与持久化状态，避免后台内存缓存影响下一条用例。字幕浮层用例在浏览器中执行构建后的 content.js，只替代 Chrome 消息传输并保留 closed ShadowRoot 引用以便断言，生产代码的 ShadowRoot 模式未改变。

模拟字幕只证明协议、状态及渲染行为，不能证明语音识别准确率或真实云端延迟。真实音频捕获需要用户点击扩展按钮，具体演示步骤见交付的自动化测试执行说明。此轮没有执行该手动验收。

## 常见问题

- 找不到浏览器：重新执行 `npx playwright install chromium`。
- 找不到依赖或工作区包：确认在源码工程根目录执行 `npm ci`。
- 启动扩展失败：检查 Chrome 构建日志，使用 Playwright 安装的 Chromium。
- 模块一运行成功但整体回归有跳过：查看原有音频捕获用例的 skip 说明，不将跳过计为通过。
- 文档数字与重跑不同：以新生成的 summary.json 为准，归档文档对应归档执行时间。

本轮代码和文档由 AI 辅助制作。成员署名、实际分工及课程提交合规性由小组合并时据实确认；没有生成或代写个人提交历史。

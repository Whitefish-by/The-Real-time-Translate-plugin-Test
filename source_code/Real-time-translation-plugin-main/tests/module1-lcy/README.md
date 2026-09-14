# 模块一自动化测试执行说明

模块一共62条课程用例，覆盖设置、音频、字幕、客户端连接、网关和Chrome交互。本目录包含 M1-039 至 M1-062，M1-001 至 M1-038 位于 `tests/module1`。总交付件位于仓库 `deliverables/module1_all/`。

## 安装与运行

需要 Node.js 24+、npm 11+，首次安装需要网络。在源码工程根目录运行：

```sh
npm ci
npx playwright install chromium
npm run test:module1:lcy
```

一键运行小组全部62条课程用例：

```sh
npm run test:module1:all
```

该命令依次执行38条和24条两个配置中的测试；前一阶段失败时停止，退出码非零，不会声明全部通过。两批结果分别在各自目录，编号不重叠。

完整回归（产品类型检查、原工程单元与浏览器测试、两批课程用例及构建）：

```sh
npm run test:regression:lcy
```

Mac/Linux/Windows 均可通过上述 npm 命令执行。Linux 如缺少 Chromium 系统库，需按 Playwright 提示安装。网关与原生 WebSocket 测试需要允许本机端口监听，受限沙箱拒绝监听或浏览器启动属于环境阻塞。

## 用例组织与去重

| 文件 | 数量 | 范围 |
|---|---:|---|
| core.test.ts | 10 | 令牌与偏移边界、字幕时间约束、解码输入、状态幂等与跨片段保留 |
| client.test.ts | 3 | 本地致命错误停止发送、会话隔离、可重试错误恢复 |
| gateway.test.ts | 4 | 握手超时、非法JSON、不匹配end、不支持的协议版本 |
| browser.spec.ts | 7 | 显示模式、空译文回退、HTML纯文本、全屏、原生WebSocket关闭 |

`cases.json` 是用例元数据，编号对应 Excel、测试名称和 `summary.json`。设计方法与具体输入均在其中。原表 M1-001 至 M1-038 没有被复制。原工程能力接口和代次替换已存在测试，所以未重复新增。令牌7/8/512/513是精确边界；原工程仅有短令牌5字符的代表值。M1-061扩展原有会话不匹配测试：原测试只检查错误回调，本条检查后续音频、关闭及重连，验证不同的生命周期要求。

## 执行结果与证据

`run.mjs` 依次执行17条Vitest、Chrome构建、客户端浏览器打包、7条Playwright。每条必须有唯一编号和真实结果，失败、重复编号、跳过、未执行或构建失败均导致非零退出码。

默认 `results/` 保存 `summary.json`、框架JSON、阶段日志和浏览器截图/trace。`summary.json` 包含环境、执行时间、Git基线、工作区差异及关键源码SHA-256。覆盖率工具未启用，不报告代码覆盖率。

可以指定结果目录，路径相对于源码根目录：

```sh
npm run test:module1:lcy -- --output tests/module1-lcy/results
```

测试结果和截图在运行时生成，未纳入版本控制。交付文档记录已归档的执行结果；重新运行后应以当前生成的 summary.json 为准。

## 连接协议缺陷复现

```sh
npm run test:module1:lcy:reproduce
```

复现脚本在系统临时目录复制最小工程，使用当前已安装依赖，仅还原本轮修复前 `realtime-client.ts`，执行 M1-049/059/060/061。预期为4条失败并返回非零；不应把这个退出码解释为回归失败。其他20条不属于本次定向复现，部分在框架原始报告标为跳过。原项目源码不被还原或覆盖，复现结果保存在 `reproduce-results/`。也可在命令末尾传入结果目录。

- BUG-M1-003：浏览器主动调用 `close(1013/1008)` 抛出 InvalidAccessError。改为应用关闭码4013/4008，使用原生浏览器API回归。
- BUG-M1-004：本地生成的不可重试协议错误只通知调用者，未停止音频与连接。统一关闭与清理，停止后拒绝后续push。仅修关闭码时两条生命周期测试仍失败，证明根因独立。

浏览器关闭码依据：[WHATWG WebSockets close 算法](https://websockets.spec.whatwg.org/#dom-websocket-close)。关闭码修复只作用于浏览器客户端，网关服务器的1003/1008等协议码保持原义。

## 测试边界与可重复性

显示测试执行真实构建后的content.js，仅替代Chrome消息传输并保留closed ShadowRoot供断言。客户端测试使用真实浏览器WebSocket，背压用只读属性替身制造262145字节队列，未改变原生close校验。测试页与WebSocket同在本机，避免about:blank触发Chromium本地网络访问限制。

全屏测试等待fullscreenchange后的宿主迁移完成，避免把DOM事件调度差异记为产品缺陷。Node的轻量Mock不执行浏览器关闭码限制，不能用其通过代替浏览器行为验证。

本地fake和固定字幕不能证明云端识别准确率、真实音频捕获或端到端延迟。没有制作演示视频；执行说明提供后续展示命令与范围。Safari只验证资源构建，未验证原生宿主和签名。

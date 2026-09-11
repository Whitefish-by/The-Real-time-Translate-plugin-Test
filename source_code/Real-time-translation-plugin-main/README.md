# 实时双语字幕（阿里云 Gummy）

一个面向 Chrome 116+ 和 macOS Safari 17+ 的低延迟实时字幕项目。扩展捕获网页或 Safari 窗口的音频，将其转换为 16 kHz、16-bit、单声道 PCM 后发送到本地 Node.js 网关；网关负责鉴权，并通过阿里云百炼 Gummy 完成自动语种识别、流式转写和翻译。

默认显示“原文 + 简体中文译文”。当源语言已经是中文时，字幕层自动隐藏重复译文。音频和字幕历史不会写入本地存储，阿里云 API Key 只保存在本地网关中，不会发送给浏览器扩展。

阿里云 Gummy 是默认生产方案；`fake` provider 保留用于无需云端密钥的本地链路测试。仓库仍保留原 Azure 适配器以兼容已有配置，但本文不再把它作为推荐部署方式。

## 主要能力

- Chrome 使用 Manifest V3、`tabCapture`、offscreen document 和 AudioWorklet 捕获当前标签页的混合音频，同时将音频接回扬声器，视频原声不会因捕获而消失。
- Safari 使用 Safari Web Extension、SwiftUI 菜单栏 App 和 ScreenCaptureKit 捕获用户选择的 Safari 窗口或应用音频。
- 音频统一为 PCM16 LE、16 kHz、单声道；扩展以 40 ms 帧发送，Gummy provider 聚合成 100 ms 数据包后上传。
- Gummy 使用 `gummy-realtime-v1`，适合视频、直播和会议等长时间连续音频。
- 字幕支持临时结果原位修订和最终结果固定，页面上最多保留“最近一个最终片段 + 当前临时片段”。
- 设置页支持源语言、目标语言、显示模式、字号、透明度、垂直位置、网关地址和客户端令牌。
- 弱网重连最多缓存最近 2 秒 PCM；超过缓存范围时明确提示可能缺失字幕。
- 网关只记录会话 ID、字节数、延迟分位数和错误码，不记录音频、原文或译文。

## 系统要求

- Node.js 24+
- npm 11+
- Chrome 116+，或 macOS 14+ / Safari 17+
- 使用 Safari 时还需要完整 Xcode 16+ 和 XcodeGen
- 使用真实字幕时需要阿里云中国站账号、已开通的百炼服务，以及华北 2（北京）地域 API Key

## 快速开始（Chrome + Gummy）

如果已经取得北京地域百炼 API Key，可以直接按下面的顺序启动：

```bash
npm install
cp apps/gateway/.env.example apps/gateway/.env
openssl rand -hex 32
```

编辑 `apps/gateway/.env`，至少替换以下两项：

```dotenv
GATEWAY_CLIENT_TOKEN=上一步生成的随机令牌
DASHSCOPE_API_KEY=sk-你的北京地域百炼API-Key
```

构建扩展并启动网关：

```bash
npm run build:chrome
npm run dev:gateway
```

网关正常启动后，在另一个终端验证：

```bash
curl http://127.0.0.1:8787/healthz
```

响应中的 `provider` 应为 `aliyun-gummy`。然后在 `chrome://extensions` 开启开发者模式，加载 `apps/extension/dist`，并在扩展设置中填写：

```text
网关地址：ws://127.0.0.1:8787/v1/realtime
客户端令牌：与 GATEWAY_CLIENT_TOKEN 完全相同
```

`DASHSCOPE_API_KEY` 只能存在于本地网关配置中，不要填写到扩展设置。

## 架构

```text
网页或 Safari 窗口
        │
        │ 混合音频
        ▼
Chrome tabCapture / Safari ScreenCaptureKit
        │
        │ PCM16 LE · 16 kHz · 单声道 · 40 ms
        ▼
本地网关 ws://127.0.0.1:8787/v1/realtime
        │
        │ WebSocket 流式音频
        ▼
阿里云百炼 Gummy（华北 2 / 北京）
        │
        │ 临时与最终原文/译文
        ▼
Shadow DOM 字幕浮层
```

浏览器扩展只认识本项目的统一协议，不直接连接阿里云。这样可以防止长期 API Key 暴露，也便于以后替换语音供应商。

## 一、注册并开通阿里云百炼

1. 注册并登录[阿里云中国站](https://www.aliyun.com/)，建议完成个人或企业实名认证。
2. 打开[阿里云百炼控制台](https://bailian.console.aliyun.com/)，按页面提示开通服务。
3. 在控制台右上角选择 **华北 2（北京）**。
4. 进入“API Key”或“密钥管理”，创建一个新的 API Key：
   - 归属账号：自己的阿里云主账号；
   - 归属业务空间：默认业务空间；
   - 权限：开发阶段可选择全部，生产环境建议只授权需要的模型并设置 IP 白名单。
5. 复制生成的通用百炼 API Key，通常以 `sk-` 开头。不要使用 Coding Plan 的 `sk-sp-` Key。
6. 在费用设置中开启月度限额、余额告警；如果页面提供“免费额度用完即停”，建议同时开启。

Gummy 当前只支持北京地域，API Key 和接入地域必须一致。具体操作以阿里云的[获取与配置 API Key](https://help.aliyun.com/zh/model-studio/get-api-key)和[Gummy 实时语音翻译](https://help.aliyun.com/zh/model-studio/real-time-speech-translation)文档为准。

### 费用说明

阿里云文档当前列出的 `gummy-realtime-v1` 单价为 `0.00015 元/秒`，语音识别与翻译分别计费。若同时开启原文识别和译文，按该价格估算约为：

```text
0.00015 × 2 = 0.00030 元/秒
约 0.018 元/分钟
约 1.08 元/小时
```

价格可能调整，正式使用前请重新查看[官方模型与价格](https://help.aliyun.com/zh/model-studio/real-time-java-sdk)。

## 二、安装项目

在仓库根目录执行：

```bash
npm install
```

建议先运行类型检查和单元测试：

```bash
npm run typecheck
npm test
```

## 三、先用 fake provider 验证本地链路

`fake` provider 不需要云端密钥，也不会执行真实识别。它会在收到音频后输出确定性的测试字幕，适合验证捕获、WebSocket、重连和字幕浮层。

```bash
npm run build:chrome
GATEWAY_CLIENT_TOKEN=change-me SPEECH_PROVIDER=fake npm run dev:gateway
```

然后：

1. 在 Chrome 打开 `chrome://extensions`。
2. 开启“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择 `apps/extension/dist`。
5. 打开扩展设置，填写：

```text
网关地址：ws://127.0.0.1:8787/v1/realtime
客户端令牌：change-me
```

6. 打开一个正在播放声音的普通 HTTP/HTTPS 页面，点击扩展并选择“开始生成字幕”。

每次修改扩展源码后，重新执行 `npm run build:chrome`，并在 `chrome://extensions` 中重新加载扩展。

## 四、配置并启动 Gummy

将 `apps/gateway/.env.example` 复制为 `apps/gateway/.env`：

```bash
cp apps/gateway/.env.example apps/gateway/.env
```

建议用下面的方式生成独立客户端令牌：

```bash
openssl rand -hex 32
```

填写以下配置：

```dotenv
HOST=127.0.0.1
PORT=8787

# 浏览器扩展连接本地网关时使用；不要与阿里云 API Key 相同。
GATEWAY_CLIENT_TOKEN=替换为openssl生成的随机令牌

SPEECH_PROVIDER=aliyun-gummy
DASHSCOPE_API_KEY=sk-替换为北京地域百炼API-Key
DASHSCOPE_WEBSOCKET_URL=wss://dashscope.aliyuncs.com/api-ws/v1/inference/
# 默认业务空间可以留空；使用子业务空间时填写其 Workspace ID。
DASHSCOPE_WORKSPACE_ID=
GUMMY_MODEL=gummy-realtime-v1
# 200–6000 ms；越低越快断句，也越容易切碎长句。
GUMMY_MAX_END_SILENCE_MS=500
```

启动网关：

```bash
npm run dev:gateway
```

再把 `GATEWAY_CLIENT_TOKEN` 的值填入扩展设置。扩展中只填写本地客户端令牌，**绝不能填写 `DASHSCOPE_API_KEY`**。

网关创建的 Gummy WebSocket 会话使用以下参数：

```text
model: gummy-realtime-v1
sample_rate: 16000
format: pcm
source_language: null（使用服务端默认的自动检测）
transcription_enabled: true
translation_enabled: true
translation_target_languages: [由扩展目标语言映射得到]
```

协议时序、临时/最终结果和音频发送要求见[官方 Gummy WebSocket API](https://help.aliyun.com/zh/model-studio/real-time-websocket-api)。

## 五、Chrome 使用方法

1. 启动本地网关。
2. 打开一个有声音的普通 HTTP/HTTPS 页面。
3. 点击扩展图标，再点击“开始生成字幕”。开始操作必须由用户手势触发。
4. 首次使用时，根据浏览器提示授予当前网站权限。
5. 点击“停止”结束捕获；停止后扩展不再发送音频。

Chrome 捕获当前标签页的完整混合音频，而不是某一个 `<video>` 元素。若页面中有多个声音来源，它们会一起进入识别链路。浏览器内部页、Chrome 网上应用店和没有页面权限的地址无法启动。

## 六、Safari 使用方法

1. 安装完整 Xcode 16+，然后执行：

   ```bash
   sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
   brew install xcodegen
   ```

2. 生成并打开 Xcode 工程：

   ```bash
   sh apps/safari-host/generate-project.sh
   open apps/safari-host/LiveBilingualSubtitles.xcodeproj
   ```

3. 在 Xcode 中为 App 和 Extension 选择签名团队。正式签名前，将 `com.example.*` 和 App Group 替换为自己的唯一标识。
4. 启动菜单栏 App。
5. 在 Safari 设置中启用扩展，并授予网页权限。
6. 从 Safari 扩展启动字幕；首次使用时，在系统选择器中选择 Safari 窗口或 Safari 应用，并授予“屏幕与系统音频录制”权限。

Safari 伴随 App 必须保持运行。ScreenCaptureKit 捕获的是用户选择的窗口或应用，不能稳定地隔离单个标签页；同一 Safari 窗口中的多个声音会被一起识别。

## 七、语言与显示设置

默认候选源语言：

```text
zh-CN  en-US  ja-JP  ko-KR  fr-FR
de-DE  es-ES  ru-RU  pt-BR  ar-SA
```

设置页允许选择 **1–10 种**源语言：

- 仅选 1 种时，网关会把它作为 Gummy 的固定 `source_language`，跳过自动语种检测，可降低首字延迟并避免语种误判。
- 选择 2–10 种时，网关会将 `source_language` 设为 `null`，由 Gummy 自动检测。Gummy 不接收精确的候选语言数组，因此这些勾选项不会严格限制它的检测范围。

默认目标语言为 `zh-Hans`，Gummy provider 会将其映射为 `zh`。当固定源语言与目标语言相同时，网关不会启动重复翻译。provider 会读取服务响应中可能存在的 `lang`、`language` 或 `source_language` 字段；自动检测模式下，如果响应没有返回检测代码，字幕仍正常生成，但检测语言显示为 `und`。

需要特别注意当前 Gummy 翻译语向限制：

- 英语、日语、韩语、法语、德语、西班牙语和俄语可以直接翻译为中文。
- 葡萄牙语和阿拉伯语目前只能翻译为英语，不能直接翻译为中文。
- `zh-Hant` 不是 Gummy 文档中的独立中文目标语言。
- 如果源语言与目标语言相同，插件隐藏重复译文。

因此，在未实现二段翻译回退前，若自动检测到葡萄牙语或阿拉伯语且目标为中文，字幕可能只显示原文并将译文保留为空；provider 不会伪造译文。

设置页还支持：

- 原文 + 译文、仅译文、仅原文；
- 字号 14–48 px；
- 字幕背景透明度；
- 字幕垂直位置，页面中也可直接拖动；
- 网关地址和客户端令牌；
- 网关连接测试。

修改语言、目标语言、网关地址或令牌后，需要停止并重新开始会话。

## 八、健康检查与验证

网关启动后执行：

```bash
curl http://127.0.0.1:8787/healthz
curl http://127.0.0.1:8787/v1/capabilities
```

完整验证命令：

```bash
npm run verify
```

也可以分别运行：

```bash
npm run typecheck
npm test
npm run build
npm run build:safari-resources
npm run test:e2e -w @live-subtitles/extension
```

当前自动化测试使用本地模拟 Gummy WebSocket 服务，不会访问阿里云或产生费用。真实云端识别与延迟验收尚未运行，需要显式提供北京地域 API Key；验收日志只能输出聚合延迟和错误码，不应输出音频、原文或译文。

## 九、延迟目标

在中国大陆稳定网络、网关与北京地域 Gummy 接入点连接正常的条件下，项目目标为：

| 结果类型 | P50 | P95 |
| --- | ---: | ---: |
| 临时字幕 | ≤ 1.2 秒 | ≤ 2.5 秒 |
| 最终字幕 | ≤ 2.0 秒 | ≤ 3.5 秒 |

这些是验收目标，不是阿里云 SLA。真实表现受网页音频质量、网络、语言检测、VAD 断句和翻译语向影响，必须使用固定音频做端到端测量。

## 十、安全与隐私

- `DASHSCOPE_API_KEY` 只存放在本地网关环境变量或 `.env` 中。
- 不要把长期 API Key 写进扩展、前端代码、Git 仓库、截图或聊天消息。
- `GATEWAY_CLIENT_TOKEN` 只用于扩展到本地网关的认证，应使用随机值，并与阿里云 Key 分开。
- 网关默认只监听 `127.0.0.1:8787`，不要无认证地改为 `0.0.0.0`。
- 若密钥疑似泄露，立即在百炼控制台禁用、重置或删除，并更新网关配置。
- 项目不保存音频或字幕历史；停止会话后应释放音频流、WebSocket 和 provider 资源。

## 常见问题

### 启动时报 `DASHSCOPE_API_KEY is required`

确认 `apps/gateway/.env` 中已经填写北京地域通用百炼 API Key，并且启动命令的工作目录能够加载该文件。也可以在当前终端临时设置 `DASHSCOPE_API_KEY` 后再启动。

### Gummy 返回 `InvalidApiKey`

确认使用的是华北 2（北京）地域创建的通用百炼 API Key，而不是新加坡 Key、Coding Plan Key 或已禁用的 Key。

### 启动时报 `DASHSCOPE_WEBSOCKET_URL must use wss://`

真实 Gummy 连接必须使用加密 WebSocket。保持默认值 `wss://dashscope.aliyuncs.com/api-ws/v1/inference/`，不要改成 `ws://`。

### 为什么没有译文

可能原因包括：源语言与目标语言相同、显示模式设为“仅原文”，或者当前翻译语向不受 Gummy 支持。当前网关在 Gummy 会话中会同时开启转写与翻译。

### 为什么 Chrome 捕获后听不到视频声音

正常实现会把 `tabCapture` 流重新连接到 `AudioContext.destination`。如果没有声音，请检查 offscreen document 是否创建成功、Chrome 是否静音，以及网页播放器自身音量。

### 为什么 Safari 识别到了其他标签页的声音

Safari 使用 ScreenCaptureKit 捕获所选窗口或应用，无法保证隔离单独标签页。请关闭同一窗口内其他正在播放的内容，或将目标页面移动到独立窗口。

## 仓库结构

- `packages/shared`：设置 Schema、WebSocket 协议、PCM 帧、语言工具和字幕修订合并。
- `apps/gateway`：本地 Node.js 网关、Gummy/fake provider、鉴权、健康检查和延迟统计。
- `apps/extension`：共享 UI、字幕层、Chrome MV3 适配器和 Safari Web Extension 资源。
- `apps/safari-host`：macOS 菜单栏 App、ScreenCaptureKit 音频捕获和 Safari native messaging 桥接。

## 已知边界

- “任意网页”仅指用户已授权的普通 HTTP/HTTPS 页面。
- 不支持浏览器内部页、扩展商店、系统播放器或受平台保护的内容。
- Chrome 捕获当前标签页的全部声音；Safari 捕获所选窗口或应用的全部声音。
- MVP 不包含 iPhone/iPad Safari、Firefox、本地离线模型、账号、支付、字幕导出、云端部署和商店发布。
- Safari 完整构建和签名需要 Xcode 16+；真实 Gummy 验收需要有效的北京地域百炼 API Key。

## 官方参考

- [Gummy 实时语音翻译](https://help.aliyun.com/zh/model-studio/real-time-speech-translation)
- [Gummy WebSocket API](https://help.aliyun.com/zh/model-studio/real-time-websocket-api)
- [获取与配置百炼 API Key](https://help.aliyun.com/zh/model-studio/get-api-key)
- [百炼地域与接入域名](https://help.aliyun.com/zh/model-studio/regions/)
- [百炼账单与成本管理](https://help.aliyun.com/zh/model-studio/bill-query-and-cost-management)
- [Chrome `tabCapture`](https://developer.chrome.com/docs/extensions/reference/api/tabCapture)
- [Apple ScreenCaptureKit](https://developer.apple.com/documentation/screencapturekit/capturing-screen-content-in-macos)
- [Safari Web Extension 原生消息](https://developer.apple.com/documentation/safariservices/messaging-between-the-app-and-javascript-in-a-safari-web-extension)

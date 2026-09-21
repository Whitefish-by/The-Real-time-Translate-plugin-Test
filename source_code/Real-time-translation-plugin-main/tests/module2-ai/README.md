# 模块二 AI 测自动化工程

本目录包含模块二独立的 24 条自动化测试（M2-001～M2-024）。测试使用 Vitest、Playwright 和进程内本地 WebSocket 模拟服务，不读取 `.env`，不访问真实阿里云，不产生云端费用。

## 环境

- Node.js 24 或更高版本（项目 `package.json` 已声明）
- npm 11
- 首次执行需在仓库根目录运行 `npm install`；若 Playwright 未安装 Chromium，再运行 `npx playwright install chromium`

## 一键执行

在 `source_code/Real-time-translation-plugin-main` 目录运行：

```bash
npm run test:module2
```

命令依次执行 18 条 Vitest、Chrome 扩展构建、6 条 Playwright，并生成 `tests/module2-ai/results/summary.json`。runner 会校验 M2-001～M2-024 是否缺失、重复或未执行；任一用例、构建或完整性检查失败都会返回非零。

结果文件：

- `results/summary.json`：唯一汇总数据源，含 24 条逐条结果、环境、方法分布和源码 SHA-256
- `results/unit.json`、`unit.log`：Vitest 机器可读结果与日志
- `results/browser.json`、`browser.log`：Playwright 结果与日志
- `results/chrome-build.log`：Chrome 构建日志
- `results/browser-artifacts/`：截图、trace 等浏览器证据

## 缺陷复现

```bash
npm run test:module2:reproduce
npm run test:module2:reproduce -- BUG-M2-001
npm run test:module2:reproduce -- BUG-M2-002
```

脚本在系统临时目录复制源码，依据 `original-sources.json` 恢复修复前片段，执行 M2-016、M2-019、M2-022，然后删除临时目录。**复现成功时命令预期返回非零**，因为断言准确捕获了修复前行为；当前工作区不会被改写。

## 完整回归

```bash
npm run test:regression:module2
```

依次执行产品类型检查、模块二类型检查、产品单元测试、模块二 24 条、全量构建、Safari 资源构建和既有扩展 E2E。既有 E2E 中需要真实浏览器音频捕获的用例按原项目设计显式跳过，单独披露，不计作通过。

## 测试范围

| 范围 | 数量 | 工具 |
|---|---:|---|
| 网关配置边界 | 8 | Vitest |
| 共享协议健壮性 | 4 | Vitest |
| Gummy Provider | 6 | Vitest + 本地 WebSocket |
| Chrome 字幕交互 | 6 | Playwright + 构建后的 `content.js` |

详细输入、预期结果、方法和缺陷关联见 `cases.json`。该套件独立于模块一 62 条用例，不修改也不合并模块一编号。

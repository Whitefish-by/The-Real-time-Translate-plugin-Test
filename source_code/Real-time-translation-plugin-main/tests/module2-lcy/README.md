# 模块二 Azure 适配器自动化测试

新增 24 条 M2-LCY-001～024 用例，全部采用 Vitest。被测代码为 `apps/gateway/src/providers/azure.ts`。SDK 工厂、音频流与识别器采用模拟对象；枚举直接使用已安装 SDK 的真实定义。测试不读取 .env，不请求云服务，不需要密钥或浏览器。

## 安装与一键运行

在 `source_code/Real-time-translation-plugin-main` 目录执行。需要 Node.js 24+ 与 npm；首次安装依赖需联网。

```sh
npm ci
npm run test:module2:lcy
```

已安装依赖时，也可以直接运行 `node tests/module2-lcy/run.mjs`。执行器检查全部编号唯一、没有缺失或跳过、全部通过，失败返回非零。结果在本目录 `results/summary.json`、`unit.json` 和 `unit.log`。

```sh
npm run typecheck:module2:lcy
npm run test:module2:lcy:reproduce
npm run test:regression:module2:lcy
```

复现命令将代码复制到系统临时目录，以 `baseline/azure.ts.txt` 替换临时副本中的被测文件；24条应为20通过、4失败，**预期退出码为1**。关联：020→BUG-M2-LCY-001；021、022、024→BUG-M2-LCY-002。当前源码不被覆盖。修复前快照来自基线提交 6ee6d51，未人工注入缺陷。

回归命令先运行新增24条，再做3个产品工作区和新增脚本类型检查，以及产品36条、模块一33+17条、既有模块二18条Vitest测试。既有测试需要允许本机127.0.0.1监听。此命令不包含Playwright，不代表浏览器或云端端到端验收。

## 文件职责

- `azure.test.ts`：SDK模拟、固定夹具、24条断言及每次清理。
- `cases.json`：用例编号、输入、步骤、预期、方法和缺陷映射。
- `run.mjs`：统一执行、完整性检查、机器可读汇总和源码指纹。
- `reproduce.mjs`、`baseline/azure.ts.txt`：修复前复现。
- `regression.mjs`：类型检查及既有Vitest回归。
- `vitest.config.ts`、`tsconfig.json`：测试范围与类型配置。

## 设计与限制

以等价类12条、边界值4条、场景法8条组织测试。重点检查参数传递、PCM子数组复制、SDK时间换算、字幕字段、资源释放和取消分类。每条测试结束后abort清理会话，下一条开始前清空mock记录。

Azure为兼容保留的可选适配器，当前README推荐生产方案是Gummy。本套件不证明Azure真实账号、网络、识别准确率、翻译质量或服务延迟正常。没有启用覆盖率采集，不宣称代码覆盖率100%。

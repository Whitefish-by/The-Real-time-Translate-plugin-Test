# 软件测试与实践

被测对象：`source_code/Real-time-translation-plugin-main` 中的实时双语字幕浏览器插件。

## 模块一交付

- `deliverables/module1/`：测试用例 Excel、缺陷报告、模块一测试报告、成果汇报 PPT、自动化测试执行说明。
- `deliverables/module1/evidence/`：修复前后执行记录、补丁、源码版本及截图。
- `source_code/Real-time-translation-plugin-main/tests/module1/`：新增测试与复现工具。
- `docs/`：作业要求和未改动的原始模板。

## 运行

```bash
cd source_code/Real-time-translation-plugin-main
npm ci
npx playwright install chromium
npm run test:module1
```

完整回归执行 `npm run test:regression`。环境、缺陷复现、测试隔离和结果说明见 [模块一 README](source_code/Real-time-translation-plugin-main/tests/module1/README.md)。

本轮采用本地确定性测试，不调用云端识别服务。成员身份及最终贡献比例待小组合并填写，AI 辅助情况见模块一 README。

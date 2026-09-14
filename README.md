# 软件测试与实践

被测对象为 `source_code/Real-time-translation-plugin-main` 中的实时双语字幕浏览器插件。小组成员：白宇、李承远，贡献比例各 50%。李承远为软工2602班。

## 模块一交付

总交付件保存在 `deliverables/module1_all/`，包括测试用例清单、缺陷清单、模块一测试报告、自动化测试执行说明和成果汇报 PPT。共 62 条课程用例、4 项有效缺陷，测试方法覆盖边界值、等价类与场景法。

自动化代码位于源码工程的 `tests/module1/` 和 `tests/module1-lcy/`，用例编号分别为 M1-001 至 M1-038、M1-039 至 M1-062。`docs/` 保存作业要求和教师模板。

## 安装与运行

```sh
cd source_code/Real-time-translation-plugin-main
npm ci
npx playwright install chromium
npm run test:module1:all
```

全部课程测试包含 50 条 Vitest 和 12 条 Playwright 测试。完整产品回归、类型检查及构建执行 `npm run test:regression:lcy`。

运行结果分别写入两个测试目录的 `results/`。结果、截图和打包产物由脚本生成，不纳入版本控制。测试采用固定输入和本地服务；真实音频、云端效果与 Safari 原生宿主需另行验收。

运行配置及缺陷复现方式见 [测试执行说明](source_code/Real-time-translation-plugin-main/tests/module1-lcy/README.md)。

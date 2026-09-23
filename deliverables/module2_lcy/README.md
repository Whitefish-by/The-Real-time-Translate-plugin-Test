# 模块二新增交付件

本目录保存李承远负责的Azure适配器测试成果，24条用例、2项缺陷。测试报告和Excel仅统计新增部分；成果汇报在原PPT基础上加入Azure内容，展示全组模块二48条用例和4项缺陷。

自动化工程位于 `../../source_code/Real-time-translation-plugin-main/tests/module2-lcy/`，运行方式见其中README或本目录《自动化测试执行说明》。`evidence/`为本次实际执行的归档结果。对应源码修复位于 `apps/gateway/src/providers/azure.ts`。

关键AI对话截图由成员统一整理；人工审阅和具体修改情况需据实补充。缺陷处理人员及签字字段保留空白。

`自动化测试工程.zip` 是可独立解压的完整源码工程，包含本次修复、测试和既有回归用例，不含依赖、构建产物、真实环境配置或 Git 历史。解压后进入 `Real-time-translation-plugin-main`，先执行 `npm ci`，再执行 `npm run test:module2:lcy`。本次新增脚本说明位于 `tests/module2-lcy/README.md`。

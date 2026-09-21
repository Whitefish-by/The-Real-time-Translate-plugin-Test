import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
process.chdir(root);
const resultDir = path.join(root, "tests/module2-ai/results");
fs.mkdirSync(resultDir, { recursive: true });
for (const name of ["unit.json", "browser.json", "summary.json", "unit.log", "chrome-build.log", "browser.log"]) {
  fs.rmSync(path.join(resultDir, name), { force: true });
}

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const casesPath = path.join(root, "tests/module2-ai/cases.json");
const definitions = JSON.parse(fs.readFileSync(casesPath, "utf8"));
const expectedIds = Array.from({ length: 24 }, (_, index) => `M2-${String(index + 1).padStart(3, "0")}`);
const definitionIds = definitions.map((entry) => entry.id);
const duplicateDefinitions = definitionIds.filter((id, index) => definitionIds.indexOf(id) !== index);
if (definitions.length !== 24 || duplicateDefinitions.length > 0 || JSON.stringify(definitionIds) !== JSON.stringify(expectedIds)) {
  console.error("用例元数据必须且只能按顺序包含 M2-001 至 M2-024。", { duplicateDefinitions, definitionIds });
  process.exit(1);
}

const steps = [
  ["unit", process.execPath, ["node_modules/vitest/vitest.mjs", "run", "--config", "tests/module2-ai/vitest.config.ts", "--reporter=default", "--reporter=json", `--outputFile=${resultDir}/unit.json`]],
  ["chrome-build", npm, ["run", "build:chrome"]],
  ["browser", process.execPath, ["node_modules/@playwright/test/cli.js", "test", "--config", "tests/module2-ai/playwright.config.ts"]],
];

const execution = [];
let failed = false;
for (const [name, command, args] of steps) {
  if (name === "browser" && execution.find((step) => step.name === "chrome-build")?.exitCode !== 0) {
    execution.push({ name, startedAt: new Date().toISOString(), exitCode: null, reason: "Chrome 构建失败，浏览器测试未执行" });
    fs.writeFileSync(path.join(resultDir, "browser.log"), "Chrome 构建失败，浏览器测试未执行。\n");
    failed = true;
    continue;
  }
  const startedAt = new Date().toISOString();
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8", env: { ...process.env, FORCE_COLOR: "0" } });
  const log = `${result.stdout ?? ""}${result.stderr ?? ""}${result.error?.message ?? ""}`;
  process.stdout.write(log);
  fs.writeFileSync(path.join(resultDir, `${name}.log`), log);
  execution.push({ name, startedAt, finishedAt: new Date().toISOString(), exitCode: result.status });
  if (result.status !== 0) failed = true;
}

const observations = new Map();
const duplicateResults = [];
const unknownResults = [];
function record(id, observation) {
  if (!expectedIds.includes(id)) {
    unknownResults.push(id);
    return;
  }
  if (observations.has(id)) duplicateResults.push(id);
  observations.set(id, observation);
}

if (fs.existsSync(path.join(resultDir, "unit.json"))) {
  const report = JSON.parse(fs.readFileSync(path.join(resultDir, "unit.json"), "utf8"));
  for (const file of report.testResults ?? []) {
    for (const assertion of file.assertionResults ?? []) {
      const id = assertion.fullName?.match(/M2-\d{3}/)?.[0];
      if (id) record(id, { status: assertion.status, durationMs: assertion.duration ?? null, errors: assertion.failureMessages ?? [] });
    }
  }
}

function visitSuites(suites) {
  for (const suite of suites ?? []) {
    for (const spec of suite.specs ?? []) {
      const id = spec.title?.match(/M2-\d{3}/)?.[0];
      for (const test of spec.tests ?? []) {
        const result = test.results?.at(-1);
        if (id) record(id, {
          status: result?.status ?? "not-run",
          durationMs: result?.duration ?? null,
          errors: (result?.errors ?? []).map((error) => error.message ?? String(error)),
        });
      }
    }
    visitSuites(suite.suites);
  }
}
if (fs.existsSync(path.join(resultDir, "browser.json"))) {
  visitSuites(JSON.parse(fs.readFileSync(path.join(resultDir, "browser.json"), "utf8")).suites);
}

const cases = definitions.map((definition) => ({
  ...definition,
  automation: definition.id <= "M2-018" ? "Vitest" : "Playwright",
  ...(observations.get(definition.id) ?? { status: "not-run", durationMs: null, errors: ["结果文件中未找到该编号"] }),
}));
if (duplicateResults.length > 0 || unknownResults.length > 0 || cases.some((entry) => entry.status !== "passed")) failed = true;

function sha256(relativePath) {
  return createHash("sha256").update(fs.readFileSync(path.join(root, relativePath))).digest("hex");
}
let commit = "unavailable";
let gitStatus = "unavailable";
try {
  commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  gitStatus = execFileSync("git", ["status", "--short", "--", "apps/extension/src/content.ts", "apps/gateway/src/providers/gummy.ts", "tests/module2-ai", "package.json"], { cwd: root, encoding: "utf8" }).trim();
} catch {}

const summary = {
  suite: "模块二 AI 融合实践（方案2 AI测）",
  executedAt: new Date().toISOString(),
  commit,
  workingTree: gitStatus,
  environment: {
    node: process.version,
    platform: os.platform(),
    release: os.release(),
    arch: os.arch(),
    cpu: os.cpus()[0]?.model ?? "unknown",
    memoryGiB: Math.round(os.totalmem() / 2 ** 30),
  },
  sourceHashes: {
    "apps/extension/src/content.ts": sha256("apps/extension/src/content.ts"),
    "apps/gateway/src/providers/gummy.ts": sha256("apps/gateway/src/providers/gummy.ts"),
    "tests/module2-ai/cases.json": sha256("tests/module2-ai/cases.json"),
  },
  execution,
  integrity: {
    expectedIds,
    duplicateDefinitions,
    duplicateResults,
    unknownResults,
    observedCount: observations.size,
  },
  methodCounts: Object.fromEntries(["边界值", "等价类", "场景法"].map((method) => [method, cases.filter((entry) => entry.method === method).length])),
  areaCounts: Object.fromEntries([...new Set(cases.map((entry) => entry.area))].map((area) => [area, cases.filter((entry) => entry.area === area).length])),
  total: cases.length,
  passed: cases.filter((entry) => entry.status === "passed").length,
  failed: cases.filter((entry) => ["failed", "timedOut", "interrupted"].includes(entry.status)).length,
  skipped: cases.filter((entry) => ["skipped", "pending", "disabled"].includes(entry.status)).length,
  notRun: cases.filter((entry) => entry.status === "not-run").length,
  notPassed: cases.filter((entry) => entry.status !== "passed").length,
  cases,
};
fs.writeFileSync(path.join(resultDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
console.log(`模块二：${summary.passed}/${summary.total} 通过；失败 ${summary.failed}；跳过 ${summary.skipped}；未执行 ${summary.notRun}。`);
console.log("结果：tests/module2-ai/results/summary.json");
process.exitCode = failed ? 1 : 0;

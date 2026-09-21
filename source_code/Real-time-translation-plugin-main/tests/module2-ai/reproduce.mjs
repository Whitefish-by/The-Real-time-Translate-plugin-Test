import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const selected = process.argv[2] ?? "all";
const selections = {
  all: { unit: "M2-016", browser: "M2-019|M2-022" },
  "BUG-M2-001": { unit: null, browser: "M2-019|M2-022" },
  "BUG-M2-002": { unit: "M2-016", browser: null },
};
const selection = selections[selected];
if (!selection) throw new Error("参数应为 all、BUG-M2-001 或 BUG-M2-002");

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "module2-ai-original-"));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
let observedFailure = false;
let reproductionLog = "";
const resultDir = path.join(root, "tests/module2-ai/results");
fs.mkdirSync(resultDir, { recursive: true });
fs.rmSync(path.join(resultDir, "reproduction-artifacts"), { recursive: true, force: true });
function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: temporaryRoot,
    encoding: "utf8",
    env: { ...process.env, FORCE_COLOR: "0" },
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}${result.error?.message ?? ""}`;
  reproductionLog += output;
  process.stdout.write(output);
  return result;
}
try {
  for (const name of ["packages", "apps", "tests", "package.json", "tsconfig.base.json"]) {
    fs.cpSync(path.join(root, name), path.join(temporaryRoot, name), {
      recursive: true,
      filter: (source) => !["node_modules", "results", "dist", "dist-safari", ".env"].includes(path.basename(source)),
    });
  }
  fs.symlinkSync(path.join(root, "node_modules"), path.join(temporaryRoot, "node_modules"), process.platform === "win32" ? "junction" : "dir");

  const snapshot = JSON.parse(fs.readFileSync(path.join(root, "tests/module2-ai/original-sources.json"), "utf8"));
  for (const replacement of snapshot.replacements) {
    const target = path.join(temporaryRoot, replacement.path);
    const current = fs.readFileSync(target, "utf8");
    if (!current.includes(replacement.fixed)) throw new Error(`当前源码与修复快照不一致：${replacement.path}`);
    fs.writeFileSync(target, current.replace(replacement.fixed, replacement.original));
  }

  if (selection.unit) {
    const result = run(process.execPath, [path.join(root, "node_modules/vitest/vitest.mjs"), "run", "--config", "tests/module2-ai/vitest.config.ts", "-t", selection.unit]);
    observedFailure ||= result.status !== 0;
  }
  if (selection.browser) {
    const build = run(npm, ["run", "build:chrome"]);
    if (build.status !== 0) throw new Error("临时源码的 Chrome 构建失败，无法执行缺陷复现");
    const result = run(process.execPath, [path.join(root, "node_modules/@playwright/test/cli.js"), "test", "--config", "tests/module2-ai/playwright.config.ts", "-g", selection.browser]);
    observedFailure ||= result.status !== 0;
    const artifacts = path.join(temporaryRoot, "tests/module2-ai/results/browser-artifacts");
    if (fs.existsSync(artifacts)) fs.cpSync(artifacts, path.join(resultDir, "reproduction-artifacts"), { recursive: true });
  }

  const conclusion = `缺陷复现目标：${selected}。测试失败表示修复前缺陷已被观察到；当前工作区源码未被修改。\n`;
  reproductionLog += conclusion;
  process.stdout.write(conclusion);
  fs.writeFileSync(path.join(resultDir, "reproduction.log"), reproductionLog);
  process.exitCode = observedFailure ? 1 : 2;
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}

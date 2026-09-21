import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const workspace = "/Users/whitefish/study/软件测试与实践";
const sourceRoot = path.join(workspace, "source_code/Real-time-translation-plugin-main");
const results = path.join(sourceRoot, "tests/module2-ai/results");
const output = path.join(workspace, "deliverables/module2/evidence");
fs.mkdirSync(output, { recursive: true });

for (const name of ["summary.json", "unit.json", "unit.log", "browser.json", "browser.log", "chrome-build.log", "reproduction.log", "regression.log"]) {
  fs.copyFileSync(path.join(results, name), path.join(output, name));
}
for (const folder of ["browser-artifacts", "reproduction-artifacts"]) {
  fs.rmSync(path.join(output, folder), { recursive: true, force: true });
  fs.cpSync(path.join(results, folder), path.join(output, folder), { recursive: true });
}

const snapshot = JSON.parse(fs.readFileSync(path.join(sourceRoot, "tests/module2-ai/original-sources.json"), "utf8"));
const sourceEvidence = {};
for (const replacement of snapshot.replacements) {
  const fixedText = fs.readFileSync(path.join(sourceRoot, replacement.path), "utf8");
  const beforeText = fixedText.replace(replacement.fixed, replacement.original);
  sourceEvidence[replacement.path] = {
    beforeSha256: createHash("sha256").update(beforeText).digest("hex"),
    afterSha256: createHash("sha256").update(fixedText).digest("hex"),
    beforeExcerpt: replacement.original,
    afterExcerpt: replacement.fixed,
  };
}
fs.writeFileSync(path.join(output, "source-before-after.json"), `${JSON.stringify(sourceEvidence, null, 2)}\n`);
const patch = execFileSync("git", ["diff", "--", "apps/extension/src/content.ts", "apps/gateway/src/providers/gummy.ts", "package.json"], {
  cwd: sourceRoot,
  encoding: "utf8",
});
fs.writeFileSync(path.join(output, "repair.patch"), patch);

const summary = JSON.parse(fs.readFileSync(path.join(results, "summary.json"), "utf8"));
fs.writeFileSync(path.join(output, "evidence-index.json"), `${JSON.stringify({
  generatedAt: new Date().toISOString(),
  resultSource: "tests/module2-ai/results/summary.json",
  totals: { total: summary.total, passed: summary.passed, failed: summary.failed, skipped: summary.skipped, notRun: summary.notRun },
  defects: {
    "BUG-M2-001": ["M2-019", "M2-022"],
    "BUG-M2-002": ["M2-016"],
  },
  files: fs.readdirSync(output).sort(),
}, null, 2)}\n`);

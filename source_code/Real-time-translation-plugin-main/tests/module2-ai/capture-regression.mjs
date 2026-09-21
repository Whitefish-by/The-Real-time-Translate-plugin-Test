import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const outputPath = path.join(root, "tests/module2-ai/results/regression.log");
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
const output = fs.createWriteStream(outputPath, { flags: "w" });
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const child = spawn(npm, ["run", "test:regression:module2"], {
  cwd: root,
  env: { ...process.env, FORCE_COLOR: "0" },
  stdio: ["ignore", "pipe", "pipe"],
});
for (const stream of [child.stdout, child.stderr]) {
  stream.on("data", (chunk) => {
    process.stdout.write(chunk);
    output.write(chunk);
  });
}
child.on("error", (error) => {
  const message = `${error.stack ?? error.message}\n`;
  process.stderr.write(message);
  output.write(message);
});
child.on("close", (code) => {
  output.end(() => {
    process.exitCode = code ?? 1;
  });
});

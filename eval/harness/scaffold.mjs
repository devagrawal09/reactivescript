// Makes a working directory for one arm of one task: the brief, the API, the visible tests and the commands the
// agent may run. With --reference, also copies in the reference solution (eval/reference/<task>/<arm>).
// Usage: node harness/scaffold.mjs <task> <rx|react> <dir> [--reference]
import { cpSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const evalDir = path.resolve(here, "..");

export function scaffold(task, arm, dir, { reference = false } = {}) {
  const t = path.join(evalDir, "tasks", task);
  dir = path.resolve(dir);
  mkdirSync(path.join(dir, "src"), { recursive: true }); mkdirSync(path.join(dir, "tests"), { recursive: true });
  writeFileSync(path.join(dir, "arm"), `${arm}\n`);
  cpSync(path.join(t, "brief.md"), path.join(dir, "BRIEF.md"));
  cpSync(path.join(t, "api.js"), path.join(dir, "src/api.js"));
  cpSync(path.join(here, "flights.js"), path.join(dir, "src/flights.js"));
  cpSync(path.join(t, arm === "rx" ? "api.d.rx" : "api.d.ts"), path.join(dir, `src/${arm === "rx" ? "api.d.rx" : "api.d.ts"}`));
  cpSync(path.join(t, "visible.mjs"), path.join(dir, "tests/visible.mjs"));
  cpSync(path.join(t, "fixtures.mjs"), path.join(dir, "tests/fixtures.mjs"));
  if (arm === "react") {
    writeFileSync(path.join(dir, "tsconfig.json"), JSON.stringify({
      compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "bundler", jsx: "react-jsx", strict: true, noEmit: true, allowJs: true, checkJs: false, skipLibCheck: true, lib: ["ES2022", "DOM", "DOM.Iterable"] },
      include: ["src"],
    }, null, 2) + "\n");
  }
  const cli = path.join(here, "agent-cli.mjs");
  for (const c of ["check", "test"]) writeFileSync(path.join(dir, c), `#!/bin/sh\nexec node ${JSON.stringify(cli)} ${c} "$(dirname "$0")"\n`, { mode: 0o755 });
  // the .rx arm's documentation: the spec, as the earlier agent tests had it (there is nothing about .rx online)
  if (arm === "rx") cpSync(path.join(evalDir, "../spec"), path.join(dir, "docs/spec"), { recursive: true });
  if (reference) cpSync(path.join(evalDir, "reference", task, arm), path.join(dir, "src"), { recursive: true });
  return dir;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [task, arm, dir] = process.argv.slice(2);
  console.log(scaffold(task, arm, dir, { reference: process.argv.includes("--reference") }));
}

// Makes a working directory for one arm of one task: the brief, the API, the visible tests and the commands the
// agent may run. With --reference, also copies in the reference solution (eval/reference/<task>/<arm>).
// --brief <name> uses tasks/<task>/brief-<name>.md (e.g. `plain`) instead of brief.md. Writes the agent's prompt to
// <dir>/.prompt.
// --base <dir> makes a change task (round 4): it copies an existing app's source files from <dir> into src/, and the
// task's BASE.md (the brief that app was built to) next to BRIEF.md, and the prompt asks for a change, not a new app.
// Usage: node harness/scaffold.mjs <task> <rx|react> <dir> [--reference] [--brief <name>] [--base <dir>]
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const evalDir = path.resolve(here, "..");

export function scaffold(task, arm, dir, { reference = false, brief = null, base = null } = {}) {
  const t = path.join(evalDir, "tasks", task);
  dir = path.resolve(dir);
  mkdirSync(path.join(dir, "src"), { recursive: true }); mkdirSync(path.join(dir, "tests"), { recursive: true });
  writeFileSync(path.join(dir, "arm"), `${arm}\n`);
  cpSync(path.join(t, brief ? `brief-${brief}.md` : "brief.md"), path.join(dir, "BRIEF.md"));
  cpSync(path.join(t, "api.js"), path.join(dir, "src/api.js"));
  // a plain brief names no races, so the agent's copy of the plumbing loses the header that says tests order answers
  const flights = readFileSync(path.join(here, "flights.js"), "utf8");
  writeFileSync(path.join(dir, "src/flights.js"), brief === "plain" ? flights.replace(/^(\/\/.*\n)+\n/, "") : flights);
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
  if (arm === "rx") {
    cpSync(path.join(evalDir, "../spec"), path.join(dir, "docs/spec"), { recursive: true });
    cpSync(path.join(evalDir, "../guide"), path.join(dir, "docs/guide"), { recursive: true });
  }
  if (reference) cpSync(path.join(evalDir, "reference", task, arm), path.join(dir, "src"), { recursive: true });
  if (base) {
    cpSync(path.join(t, "BASE.md"), path.join(dir, "BASE.md"));
    for (const f of readdirSync(base)) if (/\.(rx|tsx?)$/.test(f)) cpSync(path.join(base, f), path.join(dir, "src", f));
    mkdirSync(path.join(dir, ".scratch"));
  }
  writeFileSync(path.join(dir, ".prompt"), prompt(arm, dir, { plain: brief === "plain", change: !!base }));
  return dir;
}

export function prompt(arm, dir, { plain = false, change = false } = {}) {
  const fill = { ...JSON.parse(readFileSync(path.join(here, "prompt-arms.json"), "utf8"))[arm] };
  fill.BACKEND_NOTE = plain ? "" : " whose answers the tests control";
  let text = readFileSync(path.join(here, change ? "prompt-change.md" : "prompt.md"), "utf8");
  for (let i = 0; i < 2; i++) for (const k of [...Object.keys(fill), "DIR"]) text = text.replaceAll(`{{${k}}}`, k === "DIR" ? dir : fill[k]);
  return text;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [task, arm, dir] = process.argv.slice(2);
  const b = process.argv.indexOf("--brief");
  const base = process.argv.indexOf("--base");
  console.log(scaffold(task, arm, dir, { reference: process.argv.includes("--reference"), brief: b > 0 ? process.argv[b + 1] : null, base: base > 0 ? path.resolve(process.argv[base + 1]) : null }));
}

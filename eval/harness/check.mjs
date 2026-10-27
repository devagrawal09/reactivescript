// The arm's compiler feedback, as the agent runs it.
//   rx:    rxc check src/main.rx
//   react: tsc --noEmit -p . and eslint (react-hooks rules)
// Usage: node harness/check.mjs <dir>
import { execFileSync } from "node:child_process";
import { existsSync, symlinkSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { RXC, armOf } from "./build.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const evalDir = path.resolve(here, "..");

const run = (cmd, args, cwd) => {
  try { return { ok: true, out: execFileSync(cmd, args, { cwd, stdio: "pipe" }).toString() }; }
  catch (e) { return { ok: false, out: `${e.stdout ?? ""}${e.stderr ?? ""}` }; }
};

export function check(dir) {
  dir = path.resolve(dir);
  if (!existsSync(path.join(dir, "node_modules"))) symlinkSync(path.join(evalDir, "node_modules"), path.join(dir, "node_modules"));
  if (armOf(dir) === "rx") return run(RXC, ["check", "src/main.rx"], dir);
  const bin = n => path.join(evalDir, "node_modules/.bin", n);
  const tsc = run(bin("tsc"), ["--noEmit", "-p", "."], dir);
  const lint = run(bin("eslint"), ["--no-warn-ignored", "-c", path.join(here, "eslint.config.mjs"), "src"], dir);
  return { ok: tsc.ok && lint.ok, out: `${tsc.out}${lint.out}`.trim() || "ok" };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const r = check(process.argv[2]);
  console.log(r.out.trim());
  process.exit(r.ok ? 0 : 1);
}

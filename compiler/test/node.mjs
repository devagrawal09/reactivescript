// The Node-API build loads on this platform and compiles a program for every target: what CI checks on each binary
// before it is published. Usage: node test/node.mjs (after `npm run build`)
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const { app } = createRequire(import.meta.url)("../index.js");
const examples = fileURLToPath(new URL("../../examples/", import.meta.url));
let fail = 0;
for (const [entry, target] of [["todo.rx", "dom"], ["todo.rx", "ssr"], ["shop/main.rx", "universal"]]) {
  const out = JSON.parse(app(path.join(examples, entry), target));
  const modules = Object.keys(out.modules ?? {});
  const ok = modules.length > 0 && !out.error && !out.diagnostics;
  if (!ok) fail++;
  console.log(`${ok ? "✓" : "✗"} ${entry} (${target}): ${ok ? `${modules.length} modules` : JSON.stringify(out).slice(0, 300)}`);
}
const bad = JSON.parse(app(path.join(examples, "missing.rx")));
if (!bad.error) { fail++; console.log("✗ a missing entry is not an error"); } else console.log("✓ a missing entry is an error");
process.exit(fail ? 1 : 0);

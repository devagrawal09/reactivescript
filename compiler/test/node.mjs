// The Node-API build loads on this platform and compiles a program for every target: what CI checks on each binary
// before it is published. Usage: node test/node.mjs (after `npm run build`)
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

const { app, model } = createRequire(import.meta.url)("../index.js");
const examples = fileURLToPath(new URL("../../examples/", import.meta.url));
let fail = 0;
// the last: a client-only build (08 CN-3d), as the Vite front end asks for one
for (const [entry, target, spa] of [["todo.rx", "dom"], ["todo.rx", "ssr"], ["shop/main.rx", "universal"], ["shop/main.rx", "dom", true]]) {
  const out = JSON.parse(app(path.join(examples, entry), target, null, spa));
  const modules = Object.keys(out.modules ?? {});
  const ok = modules.length > 0 && !out.error && !out.diagnostics;
  if (!ok) fail++;
  console.log(`${ok ? "✓" : "✗"} ${entry} (${target}${spa ? ", client-only" : ""}): ${ok ? `${modules.length} modules` : JSON.stringify(out).slice(0, 300)}`);
}
const bad = JSON.parse(app(path.join(examples, "missing.rx")));
if (!bad.error) { fail++; console.log("✗ a missing entry is not an error"); } else console.log("✓ a missing entry is an error");
// a relative JS import is the app's own file (MO-8): it stays an ES import, no package.json `#imports` needed; `./api`
// stays the injected API (CP-4)
const dir = mkdtempSync(path.join(tmpdir(), "rx-import-"));
writeFileSync(path.join(dir, "util.js"), "export const greet = n => `hi ${n}`;\n");
writeFileSync(path.join(dir, "main.rx"), [
  'import pure { greet } from "./util.js"',
  'import { save } from "./api"',
  'export default component App() {',
  '  source n := 1',
  '  <p onClick={() => { save(n) }}>{greet(n)}</p>',
  '}',
].join("\n"));
const rel = JSON.parse(app(path.join(dir, "main.rx"), "dom", null, true));
const code = Object.values(rel.modules ?? {}).map(m => m.code).join("\n");
const relOk = !rel.error && !rel.diagnostics && /from "\.\/util\.js"/.test(code) && !/from "\.\/api"/.test(code);
if (!relOk) fail++;
console.log(`${relOk ? "✓" : "✗"} a relative JS import stays an ES import${relOk ? "" : `: ${JSON.stringify(rel).slice(0, 300)}`}`);
// a dev build runs each source's and equation's creating calls under its key (spec/11 CP-4b `key`), named from `root`;
// a build that is not dev has none, and the model gives the same keys
const repo = path.resolve(examples, "..");
const users = path.join(examples, "users.rx");
const devCode = Object.values(JSON.parse(app(users, "dom", null, false, true, repo)).modules ?? {}).map(m => m.code).join("\n");
const prodCode = Object.values(JSON.parse(app(users, "dom")).modules ?? {}).map(m => m.code).join("\n");
const keys = JSON.parse(model([users], repo)).flatMap(m => m.symbols.flatMap(s => s.key ? [s.key] : []));
const devOk = devCode.includes('__rt.key("examples/users.rx|Row|isEditing", () =>') && !prodCode.includes("__rt.key(") && keys.includes("examples/users.rx|Row|isEditing") && keys.every(k => devCode.includes(JSON.stringify(k)));
if (!devOk) fail++;
console.log(`${devOk ? "✓" : "✗"} a dev build keys each source and equation, as the model does (${keys.length} keys)`);
process.exit(fail ? 1 : 0);

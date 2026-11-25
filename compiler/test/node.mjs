// The Node-API build loads on this platform and compiles a program for every target: what CI checks on each binary
// before it is published. Usage: node test/node.mjs (after `npm run build`)
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const { app, model } = require("../index.js");
// 09 MO-11d: a TS module's declaration is generated, here in process as the Vite front end does it. TypeScript is the
// project's; this repository's is ref/'s.
const { createDeclarations } = await import("../dts.mjs");
let ts; try { ts = require("typescript"); } catch { ts = require("../../ref/node_modules/typescript"); }
const generator = createDeclarations({ ts });
const declare = stem => JSON.stringify(generator.record(stem));
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
const outDir = new URL("./.out/", import.meta.url);
mkdirSync(outDir, { recursive: true });
const dir = mkdtempSync(fileURLToPath(new URL("rx-import-", outDir)));
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
const relOk = !rel.error && !rel.diagnostics && /from "\.\/util\.js"/.test(code) && code.includes('__rt.api("save")');
if (!relOk) fail++;
console.log(`${relOk ? "✓" : "✗"} a relative JS import stays an ES import${relOk ? "" : `: ${JSON.stringify(rel).slice(0, 300)}`}`);
try {
  const entry = path.join(dir, "main.rx");
  writeFileSync(entry, [
    'import pure { load } from "./api"',
    'import { save, Book as Volume } from "./server"',
    'import { Title } from "./types"',
    'export default component App() {',
    '  source book: Volume := { title: "A" }',
    '  title: Title = load()',
    '  <p onClick={() => { save(book) }}>{title}</p>',
    '}',
  ].join("\n"));
  writeFileSync(path.join(dir, "server.js"), "export function save(book) {}\n");
  writeFileSync(path.join(dir, "server.d.rx"), "export fn save(book: Book)\nexport type Book = { title: string }\n");
  writeFileSync(path.join(dir, "types.ts"), 'export type Title = string;\n');
  writeFileSync(path.join(dir, "types.d.rx"), "export type Title = string\n");
  for (const ext of ["js", "ts"]) {
    const api = path.join(dir, `api.${ext}`);
    writeFileSync(api, 'export function load() { return "loaded"; }\n');
    const compiled = JSON.parse(app(entry, "dom", null, true, undefined, undefined, undefined, declare));
    const code = compiled.modules?.[entry]?.code ?? "";
    const ok = /import \{ load as w\$load \} from "\.\/api"/.test(code)
      && /import \{ save as w\$save \} from "\.\/server"/.test(code)
      && !/__rt\.api|w\$Volume|v\$Volume|\.\/types/.test(code);
    if (!ok) fail++;
    console.log(`${ok ? "✓" : "✗"} ./api.${ext} stays real, and .d.rx types bind no values${ok ? "" : `: ${code || JSON.stringify(compiled)}`}`);
    rmSync(api);
  }
} finally { rmSync(dir, { recursive: true }); }
// a dev build runs each source's and equation's creating calls under its key (spec/11 CP-4b `key`), named from `root`;
// a build that is not dev has none, and the model gives the same keys
const repo = path.resolve(examples, "..");
const users = path.join(examples, "users.rx");
const devCode = Object.values(JSON.parse(app(users, "dom", null, false, true, repo)).modules ?? {}).map(m => m.code).join("\n");
const prodCode = Object.values(JSON.parse(app(users, "dom")).modules ?? {}).map(m => m.code).join("\n");
const keys = JSON.parse(model([users], repo)).flatMap(m => m.symbols.flatMap(s => s.key ? [s.key] : []));
const devOk = devCode.includes('__rt.key("examples/users.rx|Row|isEditing", () =>')
  && devCode.includes("__rt.DevLoading") && devCode.includes("__rt.DevErrored")
  && !/__rt\.(key\(|DevLoading|DevErrored)|examples\/users\.rx\|\|rename/.test(prodCode)
  && keys.includes("examples/users.rx|Row|isEditing") && keys.includes("examples/users.rx||rename")
  && keys.every(k => devCode.includes(JSON.stringify(k)));
if (!devOk) fail++;
console.log(`${devOk ? "✓" : "✗"} a dev build keys sources, equations and actions (${keys.length} keys) and instruments boundaries`);
process.exit(fail ? 1 : 0);

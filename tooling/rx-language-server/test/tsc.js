// `rx-tsc` (bin/tsc.js) on a copy of examples/shop: a clean program passes; a TypeScript type error, a parse error and a
// checker error each fail it, placed on the .rx. The README's entry (`app.mount(main(app))`) type-checks against the
// runtime's types, and a `.d.rx` in `include` is no file of the program's. Same prerequisites as test/run.js, and the
// runtime built (`npm run build` in runtime/).
//   node test/tsc.js            VERBOSE=1 prints each run's output
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const repo = path.resolve(__dirname, "../../..");
const ws = path.join(__dirname, "../.test/tsc");
fs.rmSync(ws, { recursive: true, force: true });
fs.mkdirSync(ws, { recursive: true });
for (const f of fs.readdirSync(path.join(repo, "examples/shop"))) {
  const src = fs.readFileSync(path.join(repo, "examples/shop", f), "utf8");
  fs.writeFileSync(path.join(ws, f), src.replace(/^import pure (.* from "\.\/api")$/gm, "import $1"));
}
// the injected API's types, its `pure` stated as a .d.ts can state it (the brand type; a .ts states it with `pure(…)`), so
// this fixture provides an actual TS module where the examples use the injected JS API (09 MO-11e)
fs.writeFileSync(path.join(ws, "api.d.ts"), [
  'import type { Pure } from "@reactivescript/js";',
  "export declare function checkout(items: { id: number; qty: number }[], coupon: string): Pure<Promise<{ id: number }>>;",
  "export declare function fetchProducts(): Pure<Promise<{ id: number; name: string; price: number }[]>>;",
  "export declare function validateCoupon(code: string): Pure<Promise<number>>;",
  "",
].join("\n"));
const nm = path.join(ws, "node_modules");
fs.mkdirSync(path.join(nm, "@reactivescript"), { recursive: true });
for (const f of fs.readdirSync(path.join(repo, "ref/node_modules")).filter(f => !f.startsWith("."))) fs.symlinkSync(path.join(repo, "ref/node_modules", f), path.join(nm, f), "dir");
fs.symlinkSync(path.join(repo, "runtime"), path.join(nm, "@reactivescript/runtime"), "dir");
// MO-11: the helpers (`@reactivescript/js`), and the declaration generator (`@reactivescript/compiler/dts`), as a project
// installs them
fs.symlinkSync(path.join(repo, "js"), path.join(nm, "@reactivescript/js"), "dir");
fs.symlinkSync(path.join(repo, "compiler"), path.join(nm, "@reactivescript/compiler"), "dir");
const tsconfig = include => fs.writeFileSync(path.join(ws, "tsconfig.json"), JSON.stringify({
  compilerOptions: { jsx: "preserve", jsxImportSource: "@solidjs/web", strict: true, noImplicitAny: false, target: "ES2022", module: "ESNext", moduleResolution: "Bundler", allowImportingTsExtensions: true, noEmit: true, skipLibCheck: true, lib: ["ES2022", "DOM"], types: [] },
  include,
}, null, 2));

const original = Object.fromEntries(fs.readdirSync(ws).filter(f => f.endsWith(".rx")).map(f => [f, fs.readFileSync(path.join(ws, f), "utf8")]));
const added = new Set();
function run(...edits) {
  for (const f of added) fs.rmSync(path.join(ws, f));
  added.clear();
  tsconfig(["*.rx", "*.ts"]);
  for (const [f, t] of Object.entries(original)) fs.writeFileSync(path.join(ws, f), t);
  for (const edit of edits) {
    if (edit.include) { tsconfig(edit.include); continue; }
    if (!(edit.file in original)) added.add(edit.file);
    fs.writeFileSync(path.join(ws, edit.file), edit.text(original[edit.file]));
  }
  const r = spawnSync(process.execPath, [path.join(__dirname, "../bin/tsc.js")], { cwd: ws, encoding: "utf8" });
  return { status: r.status, out: r.stdout + r.stderr };
}

let pass = 0, fail = 0;
function check(name, ok, got) {
  if (ok) pass++; else fail++;
  console.log(`${ok ? "  ✓" : "  ✗"} ${name}${!ok || process.env.VERBOSE ? `\n      ${JSON.stringify(got).slice(0, 2000)}` : ""}`);
}

const clean = run();
check("the shop passes", clean.status === 0 && clean.out.trim() === "", clean);

const type = run({ file: "cart.rx", text: t => t.replace("qtyOf(p.id)", 'qtyOf("x")') });
const typeLine = original["cart.rx"].slice(0, original["cart.rx"].indexOf("qtyOf(p.id)")).split("\n").length;
check("a type error fails, on the .rx line", type.status !== 0 && new RegExp(`cart\\.rx\\(${typeLine},\\d+\\): error TS2345`).test(type.out), type);

const parse = run({ file: "catalog.rx", text: t => t + "\nexport fn broken( {\n" });
check("a parse error fails (no projection, so TypeScript alone would pass it)", parse.status !== 0 && /catalog\.rx:\d+:\d+ - error PARSE/.test(parse.out), parse);

const write = run({ file: "main.rx", text: t => t + "\naction wipe() { products := [] }\n" });
check("a checker error fails, with its rule", write.status !== 0 && /main\.rx:\d+:\d+ - error WRITE_TO_NON_SOURCE: .*\(MO-2\)/.test(write.out), write);

// the README's entry, as written: a compiled entry's default export is `main(__rt)` (spec/11 CP-4a)
const readme = fs.readFileSync(path.join(repo, "README.md"), "utf8").match(/```js\n\/\/ src\/main\.js\n([^]*?)```/)[1].replace("./app.rx", "./main.rx");
const entry = run({ file: "entry.ts", text: () => readme });
check("the README's entry type-checks (the projection's default is the app's main)", entry.status === 0 && entry.out.trim() === "", entry);

const server = run({ file: "entry.ts", text: () => 'import { createApp } from "@reactivescript/runtime/server";\nimport main from "./main.rx";\nconst app = createApp();\napp.stream(main(app), { write() {}, end() {} });\n' });
check("so does the server's (`app.stream(main(app), sink)`)", server.status === 0 && server.out.trim() === "", server);

const uncalled = run({ file: "entry.ts", text: () => readme.replace("main(app)", "main") });
check("the default is typed: mounting `main` uncalled fails", uncalled.status !== 0 && /entry\.ts\(\d+,\d+\): error TS2345/.test(uncalled.out), uncalled);

// MO-8a: a `.d.rx` in `include` (the README's `"include": ["src"]`), with the JS module it declares
const decl = run(
  { include: ["."] },
  { file: "names.d.rx", text: () => "export pure fn shout(s: string): string\n" },
  { file: "names.ts", text: () => "export const shout = (s: string): string => s.toUpperCase();\n" },
  { file: "main.rx", text: t => t.replace('import { Row, Panel } from "./ui.rx"', 'import { Row, Panel } from "./ui.rx"\nimport { shout } from "./names"').replace('title="The shop"', 'title={shout("The shop")}') },
);
check("a .d.rx in include passes", decl.status === 0 && decl.out.trim() === "", decl);

// TY-4b: the sibling .ts is what the bundler runs; the .d.rx is what .rx is checked against.
// createHash's implementation returns Accessor<string>; .d.rx says `ref string`, which .rx reads as string.
const refWin = run(
  { include: ["."] },
  { file: "hash.d.rx", text: () => "export pure fn createHash(): ref string\nexport pure fn createDebounced(ref source: string, ms: number): ref string\n" },
  { file: "hash.ts", text: () => "import { type Accessor, createSignal } from 'solid-js';\nexport function createHash(): Accessor<string> { return createSignal('')[0]; }\nexport function createDebounced(source: Accessor<string>, _ms: number): Accessor<string> { return source; }\n" },
  { file: "main.rx", text: () => 'import { createHash, createDebounced } from "./hash"\nexport default component App() {\n  source q := ""\n  hash = createHash()\n  h = hash.trim()\n  d = createDebounced(q, 10)\n  <p>{h}{d}</p>\n}\n' },
);
check("a .d.rx wins over the sibling .ts (ref is string, not Accessor)", refWin.status === 0 && refWin.out.trim() === "", refWin);

// MO-8e/TY-4b: an imported type comes from the other .d.rx, not its implementation.
const sharedTypes = [
  { file: "shared.d.rx", text: () => "export type Label = { text: string }\n" },
  { file: "shared.ts", text: () => "export type Label = number;\n" },
  { file: "labels.d.rx", text: () => 'import { Label as TextLabel } from "./shared"\nexport pure fn labelText(x?: TextLabel): string\n' },
  { file: "labels.js", text: () => "export const labelText = x => x?.text ?? '';\n" },
];
const labels = value => ({ file: "main.rx", text: () =>
  `import { labelText } from "./labels"\nexport default component App() { <p>{labelText(${value})}</p> }\n` });
const declaredType = run(...sharedTypes, labels('{ text: "ok" }'));
check("a .d.rx can import an aliased type from another .d.rx", declaredType.status === 0 && declaredType.out.trim() === "", declaredType);
const omitted = run(...sharedTypes, labels(""));
check("an optional .d.rx parameter can be omitted", omitted.status === 0 && omitted.out.trim() === "", omitted);
const wrongType = run(...sharedTypes, labels("123"));
check("the imported .d.rx type rejects the sibling TS type", wrongType.status !== 0 && /main\.rx\(2,\d+\): error TS2345/.test(wrongType.out), wrongType);

// 09 MO-11, 13 TY-4b/TY-4d: a .ts with no .d.rx declares itself. Its rows are generated from it (helpers where written),
// its types are TypeScript's own.
const usersTs = [
  'import { pure, ref, rejects } from "@reactivescript/js";',
  "export type User = { name: string; age: number };",
  "export class NotFound extends Error { missingId = 1; }",
  "export const initials = pure((name: string) => name.slice(0, 1));",
  "export const loadUser = pure(rejects([NotFound], async (id: number): Promise<User> => { if (id < 0) throw new NotFound(); return { name: 'Ada', age: 36 }; }));",
  "export const createUpper = ref({ args: [0], result: true }, (source: () => string) => () => source().toUpperCase());",
  "export const save = rejects([NotFound], async (user: User): Promise<void> => { void user; });",
  "export function greet(name: string) { return `hi ${name}`; }",
  "",
].join("\n");
const usersRx = [
  'import { initials, loadUser, createUpper, save, NotFound, User } from "./users"',
  "export default component App() {",
  '  source name := "ada"',
  '  source status := ""',
  "  first = initials(name)",
  "  user: User | null = await loadUser(1) catch (e) { NotFound => { e.missingId > 0 ? null : null } }",
  "  loud = createUpper(name)",
  "  shout = loud.trim()",
  '  label = user == null ? "" : `${user.name} ${user.age}`',
  "  action store() {",
  '    try { await save({ name: name, age: 1 }); status := "saved" }',
  '    catch (e) { NotFound => { status := `missing ${e.missingId}` } }',
  "  }",
  "  errored fallback(e) { <p>{e.message}</p> } { <p>{first}{shout}{label}{status}</p> }",
  "}",
  "",
].join("\n");
const tsModule = (...edits) => run(
  { include: ["."] },
  { file: "users.ts", text: () => usersTs },
  { file: "main.rx", text: () => usersRx },
  ...edits,
);
const generated = tsModule();
check("a .ts with no .d.rx: a helper-stated pure fn in an equation, a type import, an error class caught, a Ref read as T — passes", generated.status === 0 && generated.out.trim() === "", generated);

const badArg = tsModule({ file: "main.rx", text: () => usersRx.replace("loadUser(1)", 'loadUser("1")') });
const badLine = usersRx.split("\n").findIndex(l => l.includes("loadUser(1)")) + 1;
check("a type error against the .ts's own types fails, on the .rx line", badArg.status !== 0 && new RegExp(`main\\.rx\\(${badLine},\\d+\\): error TS2345`).test(badArg.out), badArg);

const badArm = tsModule({ file: "main.rx", text: () => usersRx.replace("e.missingId > 0", "e.retryAfter > 0") });
const armColumn = usersRx.split("\n")[badLine - 1].indexOf("missingId") + 1;
check("an error arm rejects a foreign field at its .rx span", badArm.status !== 0 && badArm.out.includes(`main.rx(${badLine},${armColumn}): error TS2339`) && !badArm.out.includes("instanceof"), badArm);

const refAsT = tsModule({ file: "main.rx", text: () => usersRx.replace("shout = loud.trim()", "shout: number = loud") });
check("a Ref result reads as its T (TY-4d): `string` is not `number`", refAsT.status !== 0 && /main\.rx\(\d+,\d+\): error TS2322/.test(refAsT.out), refAsT);

const misplaced = tsModule({ file: "users.ts", text: () => usersTs + "export const score = [pure((n: number) => n)][0];\n" });
const helperLine = (usersTs + "export const score").split("\n").length;
check("a misplaced helper is DECLARATION_HELPER, at the call in the .ts", misplaced.status !== 0 && new RegExp(`^users\\.ts:${helperLine}:\\d+ - error DECLARATION_HELPER: .*\\(MO-11c\\)`, "m").test(misplaced.out), misplaced);

// 09 MO-11e: `import pure` on a defaulted fact of the .ts still narrows it; rx-tsc prints the warning and passes
const narrowed = tsModule({ file: "main.rx", text: () => usersRx.replace('import { initials,', 'import pure { greet } from "./users"\nimport { initials,').replace("first = initials(name)", "first = initials(greet(name))") });
check("`import pure` on TS: IMPORT_ROW_ON_TS naming `pure(…)`, exit 1", narrowed.status === 1 && /^main\.rx:1:\d+ - error IMPORT_ROW_ON_TS: .*`export const greet = pure\(…\)`.*\(MO-11e\)$/m.test(narrowed.out) && /Found 1 ReactiveScript error\./.test(narrowed.out), narrowed);

const missing = tsModule({ file: "main.rx", text: () => usersRx.replace("save, NotFound", "save, remove, NotFound") });
check("an import of a name the .ts lacks is NOT_EXPORTED, on the .rx", missing.status !== 0 && /^main\.rx:1:\d+ - error NOT_EXPORTED/m.test(missing.out), missing);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

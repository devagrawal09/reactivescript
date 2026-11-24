// node --experimental-strip-types compile/features-check.ts
// One program per manifest entry (emit.ts `features`): a program that uses the feature keeps it, and the plain program
// beside it drops it. Prints one line per case; exits 1 on a mismatch.
import { parseProgram } from "../src/parse.ts";
import { singleModule } from "../src/modules.ts";
import { compileModules, type Features } from "./emit.ts";

type Want = Partial<Record<Exclude<keyof Features, "why">, boolean>>;
const OFF: Want = { stores: true, accessors: false, guards: false, shallow: false, families: false, optimistic: false, delete: false };
const cases: [string, string, Want][] = [
  ["no store feature: a counter", `export default component App() {\n  source n := 0\n  <button onClick={() => { n := n + 1 }}>{n}</button>\n}`, { ...OFF, stores: false }],
  ["no store feature: a store with path and root writes", `export default component App() {\n  source user := { name: "Ann", prefs: { size: 12 } }\n  <p onClick={() => { user.prefs.size := 14; user := { name: "Bo", prefs: { size: 1 } } }}>{user.name} {user.prefs.size}</p>\n}`, OFF],
  ["no store feature: rows, a numeric index", `export default component App() {\n  source rows := [{ id: 1, t: "A" }]\n  <ul onClick={() => { rows[0].t := "B"; rows[len(rows) - 1].t := "C" }}>{for r in rows { <li>{r.t}</li> }}</ul>\n}`, OFF],
  ["optimistic: a guess", `import pure { fetch } from "./prelude"\nexport default component App() {\n  source rows := [{ id: 1, t: "A" }]\n  action rename(t) { try { guess rows[0].t := t; let r = await fetch("save"); rows[0].t := r } catch {} }\n  <ul>{for r in rows { <li>{r.t}</li> }}</ul>\n}`, { optimistic: true, families: true, delete: true, accessors: false }],
  ["families: a keyed equation", `import pure { fetch } from "./prelude"\nexport default component App() {\n  rows key id = await fetch("rows") -> []\n  <ul>{for r in rows { <li>{r.t}</li> }}</ul>\n}`, { families: true, delete: true, optimistic: false }],
  ["families: a question written by path", `import pure { fetch } from "./prelude"\nexport default component App() {\n  source user = await fetch("user") -> { name: "" }\n  <p onClick={() => { user.name := "x" }}>{user.name}</p>\n}`, { families: true, delete: true, optimistic: false }],
  ["families: a draft", `export default component App() {\n  source n := 0\n  acc = draft(pre acc -> { total: 0 }) { d.total := d.total + n }\n  <p>{acc.total}</p>\n}`, { families: true, delete: true, optimistic: false }],
  ["guards: a member named constructor", `export default component App() {\n  source o := { a: 1 }\n  <p>{o.constructor}</p>\n}`, { guards: true, families: false }],
  ["guards: an index that may be a string", `export default component App() {\n  source o := { a: 1 }\n  source k := "a"\n  <p>{o[k]}</p>\n}`, { guards: true, families: false }],
  ["accessors: a value from JS that is not pure", `import { widget } from "some-package"\nexport default component App() {\n  source o := { a: 1 }\n  <p>{o.a}</p>\n}`, { accessors: true, families: false }],
];
let bad = 0;
for (const [name, src, want] of cases) {
  let f: Features;
  try { f = compileModules(singleModule(parseProgram(src))).features; }
  catch (e) { console.log(`✗ ${name}: ${(e as Error).message}`); bad++; continue; }
  const wrong = Object.entries(want).filter(([k, v]) => f[k as keyof Want] !== v).map(([k, v]) => `${k} is ${f[k as keyof Want]}, expected ${v}`);
  console.log(`${wrong.length ? "✗" : "✓"} ${name}: ${Object.entries(f).filter(([k, v]) => k !== "why" && v).map(([k]) => `${k} (${f.why[k]})`).join("; ") || "nothing kept"}${wrong.length ? "  — " + wrong.join(", ") : ""}`);
  if (wrong.length) bad++;
}
console.log(`\n${cases.length - bad} of ${cases.length} manifest cases`);
process.exit(bad ? 1 : 0);

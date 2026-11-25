// TY: every scenario's program, projected to TSX (types/project.ts) and checked by TypeScript with Solid's JSX types.
// A program the checker accepts must type-check; a rejected variant `-- reject: TS2322` must fail with that code, on its
// `.rx` line. One TypeScript program holds every projection, so the libraries are read once.
// node --experimental-strip-types types/run.ts [filter]      DEBUG=1 prints each projection with its errors
// RX_CRATE=1: the projection is the crate's (`rxc project`, compiler/), not types/project.ts's (CP-5)
import ts from "typescript";
import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, relative, join } from "node:path";
import { parseScenario, moduleSet, type Scenario } from "../src/scenario.ts";
import { checkModules } from "../src/check.ts";
import { projectModules, PRELUDE, type Projected } from "./project.ts";
import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { loadModules } from "../src/modules.ts";
import { withDeclarations } from "../src/dts-host.ts";

const rxc = fileURLToPath(new URL("../../compiler/target/release/rxc", import.meta.url));
/** RX_CRATE=1: the crate's projection of the program, read from the same files ref/ reads. */
function crateProjection(sc: Scenario, src: string): Projected[] {
  const files: Record<string, string> = {};
  const read0 = withDeclarations(p => p === sc.entry ? src : sc.modules.get(p) ?? (existsSync(p) && statSync(p).isFile() ? readFileSync(p, "utf8") : undefined), sc.modules);
  const read = (p: string) => { const s = read0(p); if (s !== undefined) files[p] = s; return s; };
  loadModules(sc.entry, read);
  const out = JSON.parse(execFileSync(rxc, ["project"], { input: JSON.stringify([{ id: 0, entry: sc.entry, files }]), maxBuffer: 1 << 28 }).toString());
  return out.programs[0].files;
}

const out = fileURLToPath(new URL("../.types/", import.meta.url)); rmSync(out, { recursive: true, force: true }); mkdirSync(out, { recursive: true });
const opts: ts.CompilerOptions = {
  jsx: ts.JsxEmit.Preserve, jsxImportSource: "@solidjs/web", strict: true, noImplicitAny: false, useUnknownInCatchVariables: false,
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, allowImportingTsExtensions: true,
  noEmit: true, skipLibCheck: true, lib: ["lib.es2022.d.ts", "lib.dom.d.ts", "lib.esnext.d.ts"], types: [], moduleDetection: ts.ModuleDetectionKind.Force,
};
type Unit = { sc: string; title: string; expect: string | null; dir: string; files: Map<string, Projected> };
const units: Unit[] = [];
const filter = process.argv[2];
const sdir = new URL("../../scenarios/", import.meta.url);
let seq = 0;
function add(sc: Scenario, title: string, src: string, expect: string | null, requireChecked = false) {
  let set; try { set = moduleSet(sc, src); } catch (e) { if (requireChecked) throw e; return; }
  const checked = checkModules(set);
  if (checked.diags.length) {
    if (requireChecked) throw new Error(`${sc.name} (${title}) did not pass RX checks: ${JSON.stringify(checked.diags)}`);
    return;                                                                     // the checker refused it: no types are asked
  }
  const dir = join(out, `${sc.name}.${seq++}`); const root = dirname(set.entry.startsWith("/") ? set.entry : "/" + set.entry);
  const files = new Map<string, Projected>();
  for (const [k, text] of sc.modules) if (!/\.rx$/.test(k)) {             // MO-11: a TS module (and what it imports) is TypeScript's to read, beside the projection
    const f = join(dir, relative(root, k.startsWith("/") ? k : "/" + k)); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, text);
  }
  for (const p of process.env.RX_CRATE ? crateProjection(sc, src) : projectModules(set, checked)) {
    const rel = relative(root, p.path.startsWith("/") ? p.path : "/" + p.path); const f = join(dir, rel);
    mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, p.code); files.set(f, p);
  }
  writeFileSync(join(dir, "__prelude.ts"), PRELUDE);
  units.push({ sc: sc.name, title, expect, dir, files });
}
for (const f of readdirSync(sdir).filter(f => f.endsWith(".md") && f !== "TEMPLATE.md" && !f.startsWith("OPEN-") && (!filter || f.includes(filter))).sort()) {
  const sc = parseScenario(f.replace(/\.md$/, ""), readFileSync(new URL(f, sdir), "utf8"), fileURLToPath(sdir));
  add(sc, "Program", sc.program, null);
  for (const t of sc.tables) if (t.program) add(sc, t.title, t.program, null);
  for (const rj of sc.rejected) if (rj.types) add(sc, `types ${rj.rule}`, rj.program, rj.rule);
}
if (!filter || "ordered-error-arms".includes(filter)) {
  const sc = parseScenario("ordered-error-arms", "", fileURLToPath(sdir));
  const source = `
error Conflict(version: number)
error Offline(retryAfter: number)
import { load } from "./api"
export default component App() {
  source count := 0
  result: string | number | null = await load() catch (e) {
    Conflict => { e.version }
    _ => { e.retryAfter || null }
  }
  action save() {
    let status: string | number = await load() catch (e) {
      Offline => { e.retryAfter }
      _ => { e.version }
    }
    try { await load() } catch (e) {
      Conflict => { count := e.version }
      _ => { count := e.retryAfter }
    }
    log(status)
  }
  errored fallback(e) {
    Offline => { <p>{e.retryAfter}</p> }
    _ => { <p>{e.version}</p> }
  } { <p>{await load()}{result}{count}</p> }
}
`;
  sc.modules.set(join(dirname(sc.entry), "api.d.rx"), "export pure fn load(): Promise<string> rejects(Conflict | Offline)\n");
  add(sc, "each arm sees its own instance, and `_` sees only the residual", source, null, true);
  add(sc, "statement arm rejects a foreign field", source.replace("count := e.version", "count := e.retryAfter"), "TS2339", true);
  add(sc, "await arm rejects a foreign field", source.replace("Conflict => { e.version }", "Conflict => { e.retryAfter }"), "TS2339", true);
  add(sc, "fallback arm rejects a foreign field", source.replace("<p>{e.retryAfter}</p>", "<p>{e.version}</p>"), "TS2339", true);
  add(sc, "await result includes the types of all arms", source.replace("string | number | null", "string"), "TS2322", true);
}
const roots = units.flatMap(u => [...u.files.keys()].filter(f => f.endsWith(".tsx")));
const t0 = Date.now();
const prog = ts.createProgram(roots, opts);
const diags = ts.getPreEmitDiagnostics(prog);
const byFile = new Map<string, ts.Diagnostic[]>(); for (const d of diags) { const k = d.file?.fileName ?? "(global)"; let l = byFile.get(k); if (!l) byFile.set(k, (l = [])); l.push(d); }
let pass = 0, fail = 0;
const scenarios = new Map<string, string[]>();
for (const u of units) {
  const got: string[] = [];
  for (const [f, p] of u.files) for (const d of byFile.get(f) ?? []) {
    const line = d.file && d.start !== undefined ? d.file.getLineAndCharacterOfPosition(d.start).line : 0;
    const msg0 = ts.flattenDiagnosticMessageText(d.messageText, " "); const own = /"(WIRE_VALUE|MISSING_AWAIT): ([^"]*)"/.exec(msg0);   // a rule the projection states as a type
    if (own) { got.push(`${own[1]} ${p.rx.split("/").pop()}:${p.lines[line] ?? "?"}: ${own[2]}`); continue; }
    got.push(`TS${d.code} ${p.rx.split("/").pop()}:${p.lines[line] ?? "?"}: ${ts.flattenDiagnosticMessageText(d.messageText, " ").slice(0, Number(process.env.MSG ?? 220))}`);
    if (process.env.DEBUG) console.log(`--- ${f}\n${p.code.split("\n").map((l, i) => `${String(i + 1).padStart(3)}${i === line ? ">" : " "} ${l}`).join("\n")}`);
  }
  const lines = scenarios.get(u.sc) ?? []; scenarios.set(u.sc, lines);
  if (u.expect === null) { if (got.length) { fail++; lines.push(`  ✗ ${u.title}: ${got.join("\n      ")}`); } else { pass++; lines.push(`  ✓ ${u.title}: types check`); } }
  else { const hit = got.find(g => g.startsWith(u.expect! + " ")); if (hit && (u.sc !== "ordered-error-arms" || got.length === 1)) { pass++; lines.push(`  ✓ ${u.title}: ${hit}`); } else { fail++; lines.push(`  ✗ ${u.title}: expected ${u.expect}, got ${got.join(" | ") || "no error"}`); } }
}
for (const d of byFile.get("(global)") ?? []) { fail++; console.log(`✗ global: TS${d.code} ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`); }
for (const [sc, lines] of scenarios) { console.log(`${lines.some(l => l.includes("✗")) ? "FAIL" : "PASS"} ${sc}`); for (const l of lines) console.log(l); }
console.log(`\n${pass} pass, ${fail} fail (TypeScript ${ts.version}, ${roots.length} projected modules${process.env.RX_CRATE ? " from the crate" : ""}, ${Date.now() - t0} ms)`);
process.exit(fail ? 1 : 0);

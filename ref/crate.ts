// CP-5: the Rust crate (compiler/) against ref/ on every program the scenarios and examples hold. For each program both
// sides load the modules, parse, check, print signatures and build the resolved model (CP-6); the two must agree exactly.
// Usage: node --experimental-strip-types ref/crate.ts [filter]     (builds compiler/ with cargo first; VERBOSE=1 lists each)
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { parseScenario } from "./src/scenario.ts";
import { loadModules } from "./src/modules.ts";
import { checkModules } from "./src/check.ts";
import { printSignature } from "./src/signature.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const filter = process.argv[2];
type Req = { id: string; entry: string; files: Record<string, string> };
const reqs: Req[] = [];

/** A program: its entry and every file the loader reads for it (MO-8 `.d.rx`, MO-9 signatures, imported modules). */
function add(id: string, entry: string, read: (p: string) => string | undefined) {
  if (filter && !id.includes(filter)) return;
  const files: Record<string, string> = {};
  const rec = (p: string) => { const s = read(p); if (s !== undefined) files[p] = s; return s; };
  try { loadModules(entry, rec); } catch { /* the files read up to the error are what both sides see */ }
  reqs.push({ id, entry, files });
}
const disk = (p: string) => existsSync(p) && statSync(p).isFile() ? readFileSync(p, "utf8") : undefined;

const sdir = join(root, "scenarios");
for (const f of readdirSync(sdir).filter(f => f.endsWith(".md") && f !== "TEMPLATE.md").sort()) {
  const sc = parseScenario(f.replace(/\.md$/, ""), readFileSync(join(sdir, f), "utf8"), sdir);
  const read = (src: string) => (p: string) => p === sc.entry ? src : sc.modules.get(p) ?? disk(p);
  if (sc.program) add(`${sc.name} Program`, sc.entry, read(sc.program));
  for (const t of sc.tables) if (t.program) add(`${sc.name} ${t.title}`, sc.entry, read(t.program));
  sc.rejected.forEach((r, i) => add(`${sc.name} ${r.types ? "types" : r.warn ? "warn" : "reject"}(${r.rule}) #${i}`, sc.entry, read(r.program)));
}
const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(join(d, e.name)) : e.name.endsWith(".rx") && !e.name.endsWith(".d.rx") ? [join(d, e.name)] : []);
for (const f of walk(join(root, "examples")).sort()) add(`examples/${f.slice(join(root, "examples").length + 1)}`, f, disk);

const plain = (x: unknown) => JSON.parse(JSON.stringify(x, (_k, v) => v instanceof Map ? Object.fromEntries(v) : v instanceof Set ? [...v] : v));
function refOf(r: Req) {
  const read = (p: string) => r.files[p];
  let set; try { set = loadModules(r.entry, read); } catch (e) { return { error: (e as Error).message }; }
  let checked; try { checked = checkModules(set); } catch (e) { return { throws: (e as Error).message }; }
  return plain({
    order: set.order,
    asts: Object.fromEntries(set.order.map(p => [p, set.programs.get(p)])),
    diags: checked.diags,
    sigs: Object.fromEntries(set.order.map(p => [p, printSignature(checked.sigs.get(p)!)])),
    models: Object.fromEntries(checked.models),
  });
}
/** The first place two JSON values differ, as a path. */
function diff(a: any, b: any, at = ""): string | null {
  if (a === b) return null;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object" || Array.isArray(a) !== Array.isArray(b))
    return `${at || "/"}: ref ${JSON.stringify(a)?.slice(0, 200)} ≠ crate ${JSON.stringify(b)?.slice(0, 200)}`;
  const keys = Array.isArray(a) ? [...Array(Math.max(a.length, b.length)).keys()] : [...new Set([...Object.keys(a), ...Object.keys(b)])];
  for (const k of keys) { const d = diff(a[k as any], b[k as any], `${at}/${k}`); if (d) return d; }
  return null;
}

execFileSync("cargo", ["build", "--release", "--quiet"], { cwd: join(root, "compiler"), stdio: "inherit" });
if (process.env.DUMP) { const { writeFileSync } = await import("node:fs"); writeFileSync(process.env.DUMP, JSON.stringify(reqs)); }
const out = execFileSync(join(root, "compiler/target/release/rxc"), ["conform"], { input: JSON.stringify(reqs), maxBuffer: 1 << 30 }).toString();
const got = new Map((JSON.parse(out) as any[]).map(x => [x.id, x]));
let bad = 0;
const verbose = !!process.env.VERBOSE;
for (const r of reqs) {
  const want = refOf(r); const { id: _, ...have } = got.get(r.id) ?? {};
  const d = diff(want, have);
  if (d) { bad++; console.log(`FAIL ${r.id}\n  ${d}`); } else if (verbose) console.log(`ok   ${r.id}`);
}
console.log(`${reqs.length - bad}/${reqs.length} programs: the crate agrees with ref/ (AST, diagnostics, signatures, resolved model)`);
process.exit(bad ? 1 : 0);

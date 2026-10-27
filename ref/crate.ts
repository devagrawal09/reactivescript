// CP-5: the Rust crate (compiler/) against ref/ on every program the scenarios and examples hold. For each program both
// sides load the modules, parse, check, print signatures and build the resolved model (CP-6); the two must agree exactly.
// With --lower (CP-1): every program the checker accepts is also compiled by both — ref/compile/emit.ts then Solid's
// transform(), the crate's emit.rs then compile_program() — for the universal, dom and ssr targets, with a scenario table's
// handler rows as compile/run.ts passes them; the modules must agree (comments dropped, both printed by esbuild), and the
// crate's source maps onto .rx must hold (checkMap, CP-1c).
// Usage: node --experimental-strip-types ref/crate.ts [--lower] [filter]     (builds compiler/ with cargo first; VERBOSE=1 lists each;
//        DUMP=dir writes the first differing module of a failure, both sides, to dir/{ref,crate}.<target>.js)
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { parseScenario } from "./src/scenario.ts";
import { loadModules } from "./src/modules.ts";
import { checkModules } from "./src/check.ts";
import { printSignature } from "./src/signature.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const lowerMode = process.argv.includes("--lower");
const filter = process.argv.slice(2).find(a => !a.startsWith("--"));
const verbose = !!process.env.VERBOSE;
type Req = { id: string; entry: string; files: Record<string, string>; extra?: string[] };
const reqs: Req[] = [];

/** A program: its entry and every file the loader reads for it (MO-8 `.d.rx`, MO-9 signatures, imported modules). */
function add(id: string, entry: string, read: (p: string) => string | undefined, extra?: string[]) {
  if (filter && !id.includes(filter)) return;
  const files: Record<string, string> = {};
  const rec = (p: string) => { const s = read(p); if (s !== undefined) files[p] = s; return s; };
  try { loadModules(entry, rec); } catch { /* the files read up to the error are what both sides see */ }
  reqs.push({ id, entry, files, ...(extra ? { extra } : {}) });
}
const disk = (p: string) => existsSync(p) && statSync(p).isFile() ? readFileSync(p, "utf8") : undefined;

const sdir = join(root, "scenarios");
for (const f of readdirSync(sdir).filter(f => f.endsWith(".md") && f !== "TEMPLATE.md").sort()) {
  const sc = parseScenario(f.replace(/\.md$/, ""), readFileSync(join(sdir, f), "utf8"), sdir);
  const read = (src: string) => (p: string) => p === sc.entry ? src : sc.modules.get(p) ?? disk(p);
  if (lowerMode) {                                                     // what compile/run.ts compiles: each table, with its handler rows
    const base = sc.tables.find(t => t.title === "Frames");
    for (const t of sc.tables) {
      let rows = t.rows;
      if (t !== base && base && rows.length && rows[0].instant > 0) rows = [...base.rows.filter(r => r.instant < rows[0].instant), ...rows];
      add(`${sc.name} ${t.title}`, sc.entry, read(t.program ?? sc.program), rows.filter(r => r.action.startsWith("handler")).map(r => r.action.slice(7)));
    }
    if (!sc.tables.length && sc.program) add(`${sc.name} Program`, sc.entry, read(sc.program), []);
    continue;
  }
  if (sc.program) add(`${sc.name} Program`, sc.entry, read(sc.program));
  for (const t of sc.tables) if (t.program) add(`${sc.name} ${t.title}`, sc.entry, read(t.program));
  sc.rejected.forEach((r, i) => add(`${sc.name} ${r.types ? "types" : r.warn ? "warn" : "reject"}(${r.rule}) #${i}`, sc.entry, read(r.program)));
}
const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(join(d, e.name)) : e.name.endsWith(".rx") && !e.name.endsWith(".d.rx") ? [join(d, e.name)] : []);
for (const f of walk(join(root, "examples")).sort()) add(`examples/${f.slice(join(root, "examples").length + 1)}`, f, disk, lowerMode ? [] : undefined);

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
if (lowerMode) process.exit(await lower());
const out = execFileSync(join(root, "compiler/target/release/rxc"), ["conform"], { input: JSON.stringify(reqs), maxBuffer: 1 << 30 }).toString();
const got = new Map((JSON.parse(out) as any[]).map(x => [x.id, x]));
let bad = 0;
for (const r of reqs) {
  const want = refOf(r); const { id: _, ...have } = got.get(r.id) ?? {};
  const d = diff(want, have);
  if (d) { bad++; console.log(`FAIL ${r.id}\n  ${d}`); } else if (verbose) console.log(`ok   ${r.id}`);
}
console.log(`${reqs.length - bad}/${reqs.length} programs: the crate agrees with ref/ (AST, diagnostics, signatures, resolved model)`);
process.exit(bad ? 1 : 0);

/** --lower: ref/compile's modules against the crate's, through Solid's compiler for each target. */
async function lower(): Promise<number> {
  const { compileModules, CompileError } = await import("./compile/emit.ts");
  const { lowerViews, STRING_RENDERER } = await import("./compile/jsx.ts");
  const { transformSync } = await import("esbuild");
  const { parseStmts } = await import("./src/parse.ts");
  const norm = (code: string) => { try { return transformSync(code, { loader: "js", format: "esm", legalComments: "none" }).code; } catch (e) { return `esbuild: ${(e as Error).message}\n${code}`; } };
  const out = execFileSync(join(root, "compiler/target/release/rxc"), ["lower"], { input: JSON.stringify(reqs.map(r => ({ ...r, renderer: STRING_RENDERER, maps: true }))), maxBuffer: 1 << 30 }).toString();
  const got = new Map((JSON.parse(out) as any[]).map(x => [x.id, x]));
  let bad = 0, compiled = 0, modules = 0, mapped = 0;
  for (const r of reqs) {
    const have = got.get(r.id);
    let set: ReturnType<typeof loadModules> | undefined;
    let want: any;
    try {
      set = loadModules(r.entry, p => r.files[p]);
      if (checkModules(set).diags.length) want = { refused: true };
      else {
        const extra = (r.extra ?? []).map(s => { try { return parseStmts(s); } catch { return []; } });
        let c; try { c = compileModules(set, { extraStmts: extra }); } catch (e) { if (!(e instanceof CompileError)) throw e; c = null; want = { compileError: (e as Error).message }; }
        if (c) {
          const files: Record<string, Record<string, string>> = {};
          for (const [k, target] of [["universal", "universal"], ["dom", "dom"], ["ssr", "ssr"]] as const) {
            for (const [name, code] of lowerViews(c.files, target)) (files[name] ??= {})[k] = code;
          }
          want = { entry: c.entry, css: c.css, files };
        }
      }
    } catch (e) { want = { error: (e as Error).message }; }
    let d: string | null = null;
    if (want.files && have?.files) {
      compiled++;
      if (want.entry !== have.entry) d = `entry: ref ${want.entry} ≠ crate ${have.entry}`;
      else if (want.css !== have.css) d = `css: ref ${JSON.stringify(want.css).slice(0, 300)} ≠ crate ${JSON.stringify(have.css).slice(0, 300)}`;
      else for (const name of new Set([...Object.keys(want.files), ...Object.keys(have.files)])) {
        modules++;
        for (const k of ["universal", "dom", "ssr"]) {
          const a = want.files[name]?.[k], b = have.files[name]?.[k];
          if (typeof b !== "string") { d = `${name} ${k}: crate ${JSON.stringify(b)}`; break; }
          const [x, y] = [norm(a), norm(b)];
          if (x !== y && process.env.DUMP) { const { writeFileSync } = await import("node:fs"); writeFileSync(`${process.env.DUMP}/ref.${k}.js`, x); writeFileSync(`${process.env.DUMP}/crate.${k}.js`, y); }
          if (x !== y) { const xl = x.split("\n"), yl = y.split("\n"); const i = xl.findIndex((l, j) => l !== yl[j]); d = `${name} ${k} line ${i + 1}:\n    ref:   ${xl[i]}\n    crate: ${yl[i]}`; break; }
        }
        if (d) break;
      }
      if (!d) for (const name of Object.keys(have.files)) {
        const path = name === "main.mjs" ? set!.entry : set!.order[+name.slice(1, -4)];
        for (const k of ["universal", "dom", "ssr"]) { d = checkMap(have.files[name][k], have.maps?.[name]?.[k], set!.programs.get(path)!, r.files[path] ?? "", k); if (d) { d = `${name} ${k} map: ${d}`; break; } mapped++; }
        if (d) break;
      }
    } else d = diff(want, (({ id: _, ...x }) => x)(have ?? {}));
    if (d) { bad++; console.log(`FAIL ${r.id}\n  ${d}`); } else if (verbose) console.log(`ok   ${r.id}`);
  }
  console.log(`${reqs.length - bad}/${reqs.length} programs lowered alike (${compiled} compiled, ${modules} modules × universal, dom, ssr; ${mapped} source maps onto .rx checked)`);
  return bad ? 1 : 0;
}

/** Base64 VLQ `mappings` → [generated line, generated column, source line] (0-based). */
function decodeMappings(mappings: string): [number, number, number][] {
  const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const out: [number, number, number][] = []; let srcLine = 0;
  mappings.split(";").forEach((line, gl) => {
    let gc = 0;
    for (const seg of line.split(",").filter(Boolean)) {
      const v: number[] = []; let shift = 0, n = 0;
      for (const ch of seg) { const d = B64.indexOf(ch); n += (d & 31) << shift; if (d & 32) shift += 5; else { v.push(n & 1 ? -(n >>> 1) : n >>> 1); n = 0; shift = 0; } }
      gc += v[0]; if (v.length >= 4) { srcLine += v[2]; out.push([gl, gc, srcLine]); }
    }
  });
  return out;
}
/** CP-1c: a module's source map onto its `.rx`. Every mapped line is the module's; each source or equation declared once
 *  is declared (`const v$x`, `const [v$x, w$x]`) at a position mapped to its line; on dom, every element's line is mapped. */
function checkMap(code: string, map: string | undefined, prog: any, text: string, target: string): string | null {
  if (!map) return "none";
  const m = JSON.parse(map); const nlines = text.split("\n").length;
  if (m.sourcesContent?.[0] !== text) return "sourcesContent is not the module's text";
  const toks = decodeMappings(m.mappings);
  const outside = toks.find(t => t[2] < 0 || t[2] >= nlines); if (outside) return `line ${outside[2] + 1} is past the module's ${nlines}`;
  const decls: { name: string; line: number }[] = []; const els = new Set<number>();
  const markup = (ms: any[]) => { for (const x of ms ?? []) { if (x.k === "el" && x.tag && x.line) els.add(x.line); for (const v of Object.values(x)) if (Array.isArray(v) && v.length && typeof v[0] === "object" && v[0]?.k) markup(v as any[]); if (Array.isArray(x.decls)) walk(x.decls); } };
  const walk = (ds: any[]) => { for (const x of ds) { if (x.k === "source" || x.k === "eq") decls.push(x); if (x.decls) walk(x.decls); if (x.view) markup(x.view); } };
  walk(prog.decls);
  const lines = code.split("\n"); let checked = 0;
  for (const dcl of decls) {
    if (decls.filter(x => x.name === dcl.name).length > 1) continue;
    const re = new RegExp(`(?:const|let|var)\\s+\\[?\\s*v\\$${dcl.name.replace(/\$/g, "\\$")}\\b`, "g");
    const hits = [...code.matchAll(re)]; if (hits.length !== 1) continue;
    const before = code.slice(0, hits[0].index!); const gl = before.split("\n").length - 1; const gc = gl ? before.length - before.lastIndexOf("\n") - 1 : before.length;
    const at = toks.filter(t => t[0] === gl && t[1] <= gc).pop();
    if (!at) return `${dcl.name} (line ${dcl.line}): no mapping at ${gl + 1}:${gc + 1} — ${lines[gl]?.trim().slice(0, 80)}`;
    if (at[2] + 1 !== dcl.line) return `${dcl.name} maps to line ${at[2] + 1}, declared on ${dcl.line} — ${lines[gl]?.trim().slice(0, 80)}`;
    checked++;
  }
  if (target === "dom") { const seen = new Set(toks.map(t => t[2] + 1)); const miss = [...els].find(l => !seen.has(l)); if (miss) return `element on line ${miss} is not mapped`; }
  return null;
}

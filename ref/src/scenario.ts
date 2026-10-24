// Parses scenarios/*.md (the Markdown is the source) and runs them against the runtime.
import { parseProgram, parseStmts, ParseError } from "./parse.ts";
import { Runtime, RuleError, CheckError } from "./runtime.ts";

type Row = { instant: number; action: string; frame: string; effects: string[] };
type Table = { title: string; program: string | null; rows: Row[] };
type Rejected = { rule: string; program: string; handlers: string[]; warn: boolean };
export type Divergence = { table: string; instant: number; frame: string; runner: "oracle" | "server" | "hydrated" };   // what Solid 2.0 shows where the spec rules otherwise (the client's, or the server render's)
export type Scenario = { name: string; program: string; tables: Table[]; rejected: Rejected[]; divergences: Divergence[];
  entry: string; modules: Map<string, string>;
  server: Row[];     // 10: `## Server frames` — what a browser shows from the server's stream (ref/ssr/run.ts only)
  before: Row[] };   // 10 SV-3e: `## Before hydration` — user events on the served page, then `hydrate` (ref/ssr/run.ts only)   // 09: the entry's module key, and the `## Modules` fences (`-- module: ./lib.rx`) by key

const strip = (s: string) => s.replace(/`/g, "").trim();

import { readFileSync, existsSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { loadModules, joinPath, type ModuleSet } from "./modules.ts";
/** The module set for one of a scenario's programs: the entry is `src`; its `.rx` imports are the `## Modules` fences, else files
 *  beside the entry (a `file:` program). */
export function moduleSet(sc: Scenario, src: string): ModuleSet {
  return loadModules(sc.entry, p => p === sc.entry ? src : sc.modules.get(p) ?? (existsSync(p) ? readFileSync(p, "utf8") : undefined));
}
export function parseScenario(name: string, md: string, baseDir = "."): Scenario {
  const sections = md.split(/^## /m).slice(1).map(s => { const nl = s.indexOf("\n"); return { title: s.slice(0, nl).trim(), body: s.slice(nl + 1) }; });
  const fence = (b: string) => { const m = /```[^\n]*\n([\s\S]*?)```/.exec(b); return m ? m[1] : null; };
  const table = (b: string): Row[] => {
    const lines = b.split("\n").filter(l => l.trim().startsWith("|"));
    if (lines.length < 2) return [];
    const head = lines[0].split("|").map(strip).map(s => s.toLowerCase());
    const col = (n: string) => head.indexOf(n);
    return lines.slice(2).map(l => {
      const cells = l.split("|").map(strip);
      const eff = col("effect") >= 0 ? cells[col("effect")] : "—";
      return { instant: Number(cells[col("instant")]), action: cells[col("action")], frame: cells[col("frame")],
        effects: eff === "—" || eff === "" ? [] : eff.split(";").map(s => s.trim()) };
    });
  };
  let program = ""; let entry = "main.rx"; const modules = new Map<string, string>();
  const tables: Table[] = []; const rejected: Rejected[] = []; const divergences: Divergence[] = []; let server: Row[] = []; let before: Row[] = [];
  for (const s of sections) {
    if (s.title === "Program") { const f = /^file:\s*(\S+)/m.exec(s.body); if (f) entry = resolvePath(baseDir, f[1]); program = f ? readFileSync(entry, "utf8") : (fence(s.body) ?? ""); }   // `file: ../examples/x.rx`: a real program
    else if (s.title === "Modules") {
      for (const m of s.body.matchAll(/```[^\n]*\n([\s\S]*?)```/g)) { const [first, ...rest] = m[1].split("\n"); const k = /--\s*module:\s*(\S+)/.exec(first); if (k) modules.set(joinPath("main.rx", k[1]), rest.join("\n")); }
    }
    else if (s.title === "Server frames") server = table(s.body);
    else if (s.title === "Before hydration") before = table(s.body);
    else if (s.title === "Frames") tables.push({ title: "Frames", program: null, rows: table(s.body) });
    else if (s.title.startsWith("Variant")) tables.push({ title: s.title, program: fence(s.body), rows: table(s.body) });
    else if (s.title.startsWith("Divergences")) {
      for (const m of s.body.matchAll(/^- (oracle|server|hydrated) "([^"]*)" instant (\d+): `([^`]*)`/gm)) divergences.push({ runner: m[1] as Divergence["runner"], table: m[2], instant: Number(m[3]), frame: m[4] });
    }
    else if (s.title.startsWith("Rejected")) {
      for (const m of s.body.matchAll(/```[^\n]*\n([\s\S]*?)```/g)) {
        const [first, ...rest] = m[1].split("\n");
        const r = /--\s*(reject|warn):\s*([\w-]+)/.exec(first);
        if (r) rejected.push({ rule: r[2], warn: r[1] === "warn", program: rest.filter(l => !l.trim().startsWith("--")).join("\n"),
          handlers: rest.map(l => /--\s*handler:\s*(.*)/.exec(l)?.[1]).filter((x): x is string => !!x) });
      }
    }
  }
  return { name, program, tables, rejected, divergences, entry, modules, server, before };
}

export type Result = { ok: boolean; lines: string[] };

export function runScenario(sc: Scenario): Result {
  const lines: string[] = []; let ok = true;
  const base = sc.tables.find(t => t.title === "Frames");
  for (const t of sc.tables) {
    const src = t.program ?? sc.program;
    let rows = t.rows; let own = 0;
    if (t !== base && base && rows.length && rows[0].instant > 0) { const pre = base.rows.filter(r => r.instant < rows[0].instant); own = pre.length; rows = [...pre, ...rows]; }
    let rt: Runtime;
    try { rt = new Runtime(moduleSet(sc, src)); } catch (e) { ok = false; lines.push(`  ✗ ${t.title}: ${(e as Error).message}`); continue; }
    let pending: { frame: string; effects: string[] }[] = [];
    for (const r of rows) {
      let got: { frame: string; effects: string[] } | undefined;
      try {
        if (r.action === "mount") { pending = rt.step([]); got = pending.shift(); }
        else if (r.action === "(effect)") got = pending.shift();
        else if (r.action.startsWith("handler")) { pending = rt.handler(parseStmts(r.action.slice(7))); got = pending.shift(); }
        else if (/^(resolve|reject)\s/.test(r.action)) {
          const m = /^(resolve|reject)\s+(\S+)\s+([\s\S]*)$/.exec(r.action)!;
          const valueExpr = parseStmts(m[3])[0]; const value = valueExpr.k === "expr" ? rt.runStmts([valueExpr], (rt as any).virtualScope(), new Map()) : undefined;
          pending = rt.land(m[2], value, m[1] === "reject"); got = pending.shift();
        }
        else throw new Error(`unknown action '${r.action}'`);
      } catch (e) { ok = false; lines.push(`  ✗ ${t.title} instant ${r.instant}: ${(e as Error).message}`); break; }
      if (!got) { ok = false; lines.push(`  ✗ ${t.title} instant ${r.instant}: no instant produced`); break; }
      const norm = (s: string) => s.replace(/\s+/g, " ").trim();
      const frameOk = norm(got.frame) === norm(r.frame);
      const prefixed = rows.indexOf(r) < own;
      const effOk = prefixed || got.effects.join("; ") === r.effects.join("; ");
      if (prefixed && t.program) { continue; }                          // a variant with its own program: prefix rows only drive state
      if (frameOk && effOk) lines.push(`  ✓ ${t.title} instant ${r.instant}: ${norm(got.frame)}${got.effects.length ? "  [" + got.effects.join("; ") + "]" : ""}`);
      else { ok = false; lines.push(`  ✗ ${t.title} instant ${r.instant}: expected frame '${norm(r.frame)}' effects [${r.effects.join("; ")}], got '${norm(got.frame)}' effects [${got.effects.join("; ")}]`); }
    }
    if (pending.length) { ok = false; lines.push(`  ✗ ${t.title}: ${pending.length} unlisted chained instant(s): ${pending.map(p => p.frame).join(" | ")}`); }
  }
  for (const rj of sc.rejected) {
    if (rj.warn) {
      try {
        const rt = new Runtime(moduleSet(sc, rj.program)); rt.step([]);
        const hit = rt.diagnostics.find(d => d.startsWith(rj.rule));
        if (hit) lines.push(`  ✓ warn(${rj.rule}): ${hit}`); else { ok = false; lines.push(`  ✗ warn(${rj.rule}): no diagnostic (got: ${rt.diagnostics.join(" | ") || "none"})`); }
      } catch (e) { ok = false; lines.push(`  ✗ warn(${rj.rule}): ${(e as Error).message}`); }
      continue;
    }
    try {
      const rt = new Runtime(moduleSet(sc, rj.program));
      rt.step([]);
      // handlers in rejected programs: run any `handler:` comment lines
      for (const m of rj.handlers) rt.handler(parseStmts(m));
      ok = false; lines.push(`  ✗ rejected(${rj.rule}): accepted`);
    } catch (e) {
      if (e instanceof CheckError) {                                     // the checker: any diagnostic may carry the expected rule id or code
        const hit = e.diagnostics.find(d => d.rule === rj.rule || d.code === rj.rule);
        if (hit) lines.push(`  ✓ rejected(${rj.rule}): ${hit.code} (${hit.rule}) line ${hit.line}: ${hit.msg}`);
        else { ok = false; lines.push(`  ✗ rejected(${rj.rule}): got ${e.diagnostics.map(d => `${d.code} (${d.rule})`).join(", ")}: ${e.message}`); }
        continue;
      }
      const rule = e instanceof RuleError ? e.rule : e instanceof ParseError ? (/([A-Z]+-\d+)/.exec(e.message)?.[1] ?? "parse") : "crash";
      if (rule === rj.rule) lines.push(`  ✓ rejected(${rj.rule}): ${(e as Error).message}`);
      else { ok = false; lines.push(`  ✗ rejected(${rj.rule}): got ${rule}: ${(e as Error).message}`); }
    }
  }
  return { ok, lines };
}

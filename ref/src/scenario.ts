// Parses scenarios/*.md (the Markdown is the source) and runs them against the runtime.
import { parseProgram, parseStmts, ParseError } from "./parse.ts";
import { Runtime, RuleError } from "./runtime.ts";

type Row = { instant: number; action: string; frame: string; effects: string[] };
type Table = { title: string; program: string | null; rows: Row[] };
type Rejected = { rule: string; program: string };
export type Scenario = { name: string; program: string; tables: Table[]; rejected: Rejected[] };

const strip = (s: string) => s.replace(/`/g, "").trim();

export function parseScenario(name: string, md: string): Scenario {
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
  let program = "";
  const tables: Table[] = []; const rejected: Rejected[] = [];
  for (const s of sections) {
    if (s.title === "Program") program = fence(s.body) ?? "";
    else if (s.title === "Frames") tables.push({ title: "Frames", program: null, rows: table(s.body) });
    else if (s.title.startsWith("Variant")) tables.push({ title: s.title, program: fence(s.body), rows: table(s.body) });
    else if (s.title.startsWith("Rejected")) {
      for (const m of s.body.matchAll(/```[^\n]*\n([\s\S]*?)```/g)) {
        const [first, ...rest] = m[1].split("\n");
        const r = /--\s*reject:\s*([\w-]+)/.exec(first);
        if (r) rejected.push({ rule: r[1], program: rest.join("\n") });
      }
    }
  }
  return { name, program, tables, rejected };
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
    try { rt = new Runtime(parseProgram(src)); } catch (e) { ok = false; lines.push(`  ✗ ${t.title}: ${(e as Error).message}`); continue; }
    let pending: { frame: string; effects: string[] }[] = [];
    for (const r of rows) {
      let got: { frame: string; effects: string[] } | undefined;
      try {
        if (r.action === "mount") { pending = rt.step([]); got = pending.shift(); }
        else if (r.action === "(effect)") got = pending.shift();
        else if (r.action.startsWith("handler")) { pending = rt.handler(parseStmts(r.action.slice(7))); got = pending.shift(); }
        else throw new Error(`unknown action '${r.action}'`);
      } catch (e) { ok = false; lines.push(`  ✗ ${t.title} instant ${r.instant}: ${(e as Error).message}`); break; }
      if (!got) { ok = false; lines.push(`  ✗ ${t.title} instant ${r.instant}: no instant produced`); break; }
      const norm = (s: string) => s.replace(/\s+/g, " ").trim();
      const frameOk = norm(got.frame) === norm(r.frame);
      const effOk = rows.indexOf(r) < own || got.effects.join("; ") === r.effects.join("; ");
      if (frameOk && effOk) lines.push(`  ✓ ${t.title} instant ${r.instant}: ${norm(got.frame)}${got.effects.length ? "  [" + got.effects.join("; ") + "]" : ""}`);
      else { ok = false; lines.push(`  ✗ ${t.title} instant ${r.instant}: expected frame '${norm(r.frame)}' effects [${r.effects.join("; ")}], got '${norm(got.frame)}' effects [${got.effects.join("; ")}]`); }
    }
    if (pending.length) { ok = false; lines.push(`  ✗ ${t.title}: ${pending.length} unlisted chained instant(s): ${pending.map(p => p.frame).join(" | ")}`); }
  }
  for (const rj of sc.rejected) {
    try {
      const rt = new Runtime(parseProgram(rj.program));
      rt.step([]);
      // handlers in rejected programs: run any `handler:` comment lines
      for (const m of rj.program.matchAll(/--\s*handler:\s*(.*)/g)) rt.handler(parseStmts(m[1]));
      ok = false; lines.push(`  ✗ rejected(${rj.rule}): accepted`);
    } catch (e) {
      const rule = e instanceof RuleError ? e.rule : e instanceof ParseError ? (/([A-Z]+-\d+)/.exec(e.message)?.[1] ?? "parse") : "crash";
      if (rule === rj.rule) lines.push(`  ✓ rejected(${rj.rule}): ${(e as Error).message}`);
      else { ok = false; lines.push(`  ✗ rejected(${rj.rule}): got ${rule}: ${(e as Error).message}`); }
    }
  }
  return { ok, lines };
}

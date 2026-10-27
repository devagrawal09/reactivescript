// A scenario program compiled for the runners: ref/compile/emit.ts then Solid's transform() — or, with RX_CRATE=1, the
// Rust crate (compiler/, `rxc lower`, spec/11 CP-7), so that compile/run.ts and ssr/run.ts run the crate's output.
// `handlers` are a table's handler rows (their statements, unparsed), compiled into the program as both runners need.
import { readFileSync, existsSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { moduleSet, type Scenario } from "../src/scenario.ts";
import { parseStmts } from "../src/parse.ts";
import { loadModules } from "../src/modules.ts";
import { compileModules, CompileError } from "./emit.ts";
import { lowerViews, STRING_RENDERER, type Target } from "./jsx.ts";

export type Built = { entry: string; css: string; views: (target: Target) => Map<string, string> };
export const crate = !!process.env.RX_CRATE;
const rxc = fileURLToPath(new URL("../../compiler/target/release/rxc", import.meta.url));
if (crate) execFileSync("cargo", ["build", "--release", "--quiet"], { cwd: fileURLToPath(new URL("../../compiler/", import.meta.url)), stdio: "inherit" });

/** Throws CompileError when the program is not compiled; the caller has run the checker. */
export function build(sc: Scenario, src: string, handlers: string[]): Built {
  if (!crate) {
    const out = compileModules(moduleSet(sc, src), { extraStmts: handlers.map(h => { try { return parseStmts(h); } catch { return []; } }) });
    return { entry: out.entry, css: out.css, views: t => lowerViews(out.files, t) };
  }
  const files: Record<string, string> = {};
  const read = (p: string) => { const s = p === sc.entry ? src : sc.modules.get(p) ?? (existsSync(p) && statSync(p).isFile() ? readFileSync(p, "utf8") : undefined); if (s !== undefined) files[p] = s; return s; };
  loadModules(sc.entry, read);
  const [r] = JSON.parse(execFileSync(rxc, ["lower"], { input: JSON.stringify([{ id: sc.name, entry: sc.entry, files, extra: handlers, renderer: STRING_RENDERER }]), maxBuffer: 1 << 30 }).toString());
  if (r.compileError) throw new CompileError(r.compileError);
  if (r.refused || r.error || r.panic) throw new Error(`crate: ${JSON.stringify(r)}`);
  const views = (t: Target) => {
    const m = new Map<string, string>();
    for (const [name, ts] of Object.entries(r.files as Record<string, Record<Target, string | { error: string }>>)) {
      const code = ts[t];
      if (typeof code !== "string") throw new Error(`crate: ${name} ${t}: ${code.error}`);
      m.set(name, code);
    }
    return m;
  };
  return { entry: r.entry, css: r.css, views };
}

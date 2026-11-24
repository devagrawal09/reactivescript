// node --experimental-strip-types tiers-scan.ts <rx-worktree> [dir-or-file…]
// A first cut of the tier analysis (later: ref/compile/emit.ts `tiers`): the async ladder step each program needs, from
// its text. Scans scenario .md programs and .rx files; prints one line per program and the spread.
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve, basename, join } from "node:path";
const [wt, ...targets] = process.argv.slice(2);
const ref = (p: string) => import(pathToFileURL(`${wt}/ref/${p}`).href);
const { parseScenario, moduleSet } = await ref("src/scenario.ts"); const { loadModules } = await ref("src/modules.ts");
const { parseStmts } = await ref("src/parse.ts"); const { checkModules } = await ref("src/check.ts");
type F = Record<string, string>;
const SYNC_BUILTINS = new Set(["len", "str", "map", "filter", "sum", "fail", "every", "indexOf", "log"]);
export function scan(programs: unknown[], extra: unknown[] = []): F {
  const f: F = {}; const keep = (k: string, why: string) => { f[k] ??= why; };
  const seen = new WeakSet<object>();
  const hasAwait = (x: unknown): boolean => JSON.stringify(x).includes('"k":"await"');
  const walk = (x: unknown, inAction = false): void => {
    if (!x || typeof x !== "object" || seen.has(x as object)) return; seen.add(x as object);
    if (Array.isArray(x)) { x.forEach(y => walk(y, inAction)); return; }
    const o = x as Record<string, any>;
    if (o.k === "await") keep(inAction ? "A2-await-in-action" : "A5-question", `await (line ${o.line ?? "?"})`);
    if (o.k === "source" && o.question) keep("A5-question", `source ${o.name} = …`);
    if (o.k === "refresh") keep("A5-question", `refresh ${o.name}`);
    if (o.k === "affects") keep("A5-question", `affects ${o.name}`);
    if (o.k === "eq" && o.deferred) keep("A5-question", `deferred ${o.name}`);
    if (o.k === "optimistic") keep("A4-guess", `guess ${o.target.name}`);
    if (o.k === "pending" || o.k === "latest") keep("A3-probe", o.k);
    if (o.k === "action" && (o.body || o.name)) keep("A1-action", `action ${o.name ?? ""}`);
    if (o.k === "import" && !o.resolved) for (const n of o.names) if (!SYNC_BUILTINS.has(n.name)) keep(n.name === "fetch" ? "A5-question" : "js-import", `import ${n.name} from ${o.from}`);
    if (o.k === "errored" || o.k === "catch" || o.k === "throw" || o.k === "error" || o.k === "try") keep("errors", o.k);
    if (o.k === "loading") keep("A5-question", "loading boundary");
    if (o.k === "portal") keep("portal", "portal");
    if (o.k === "context" || o.k === "provide" || o.k === "use") keep("context", o.k);
    if (o.k === "effect") keep("effects", "effect");
    if (o.k === "mfor") keep("for", "for"); if (o.k === "mif") keep("if", "if");
    if (o.k === "component") keep("components", o.name);
    if (o.k === "call" && o.f?.k === "id" && ["until", "onSettled", "onFlush"].includes(o.f.name)) keep(o.f.name === "until" ? "A5-question" : "settled-flush", o.f.name);
    if (o.k === "source" && !o.question && !(o.init?.k === "lit" && (o.init.v === null || typeof o.init.v !== "object"))) keep("stores", `source ${o.name}`);
    if (o.k === "eq" && (o.key || o.e?.k === "draft")) keep("store-families", o.name);
    if (o.k === "source" && o.key) keep("store-families", o.name);
    const act = inAction || o.k === "action" || (o.k === "fn" && o.stmts && hasAwait(o.stmts));
    if (o.k === "fn" && o.stmts && hasAwait(o.stmts)) keep("A1-action", "an inferred action");
    for (const v of Object.values(o)) walk(v, act);
  };
  for (const p of programs) walk(p); walk(extra, true);
  return f;
}
export const ladder = (f: F): string => f["A5-question"] ? "A5" : f["A4-guess"] ? "A4" : f["A3-probe"] ? "A3" : f["A2-await-in-action"] ? "A2" : f["A1-action"] ? "A1" : "A0";
if (targets.length) {
  const rows: { name: string; step: string; f: F }[] = [];
  const add = (name: string, set: any, extra: unknown[] = []) => { const f = scan([...set.programs.values()], extra); if (set.signatures?.size) f["A5-question"] ??= "a module from its signature"; rows.push({ name, step: ladder(f), f }); };
  for (const t of targets) {
    const files = statSync(t).isDirectory() ? readdirSync(t).map(x => join(t, x)) : [t];
    for (const file of files.sort()) {
      try {
        if (file.endsWith(".md") && !/TEMPLATE|OPEN-/.test(file)) {
          const sc = parseScenario(basename(file, ".md"), readFileSync(file, "utf8"), resolve(file, ".."));
          sc.tables.forEach((tb: any, i: number) => { const src = tb.program ?? sc.program; const set = moduleSet(sc, src); if (checkModules(set).diags.length) return;
            const handlers = tb.rows.filter((r: any) => r.action.startsWith("handler")).map((r: any) => { try { return parseStmts(r.action.slice(7)); } catch { return []; } });
            if (i === 0 || tb.program) add(`${sc.name}${tb.program ? "#" + i : ""}`, set, handlers); });
        } else if (file.endsWith(".rx") || (statSync(file).isDirectory() && existsSync(join(file, "main.rx")))) {
          const entry = file.endsWith(".rx") ? file : join(file, "main.rx");
          const set = loadModules(resolve(entry), (p: string) => existsSync(p) && statSync(p).isFile() ? readFileSync(p, "utf8") : undefined);
          if (!checkModules(set).diags.length) add(basename(file), set);
        }
      } catch (e) { console.error(`! ${file}: ${(e as Error).message.slice(0, 100)}`); }
    }
  }
  const order = ["A0", "A1", "A2", "A3", "A4", "A5"]; const feats = ["stores", "store-families", "errors", "context", "effects", "for", "if", "components", "portal", "settled-flush", "js-import"];
  for (const r of rows) console.log(`${r.step} ${r.name.padEnd(28)} ${feats.filter(k => r.f[k]).join(",")}`);
  console.log(`\n${rows.length} programs`);
  for (const s of order) { const g = rows.filter(r => r.step === s); console.log(`${s}: ${String(g.length).padStart(3)}  (${(100 * g.length / rows.length).toFixed(0)}%)  ` + feats.map(k => `${k} ${g.filter(r => r.f[k]).length}`).join(", ")); }
  const a0 = rows.filter(r => r.step === "A0");
  console.log(`A0 with no errors/js-import/portal/settled-flush: ${a0.filter(r => !r.f.errors && !r.f["js-import"] && !r.f.portal && !r.f["settled-flush"]).length}; of those with no stores: ${a0.filter(r => !r.f.errors && !r.f["js-import"] && !r.f.portal && !r.f["settled-flush"] && !r.f.stores).length}`);
}

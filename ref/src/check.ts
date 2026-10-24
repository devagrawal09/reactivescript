// The checker: spec/08-constraints.md made executable. Runs over the AST before the interpreter.
// Every diagnostic is an error (CN-1a). Codes keep Solid's names where one exists (CN-1b); `rule`
// is the spec rule enforced. Names resolve lexically (a component body sees its declaration
// site, never its caller — RG-7a); provisions resolve through the static application tree (RG-7b).
import type { Decl, Expr, Markup, Program, Stmt } from "./ast.ts";
import type { Diagnostic } from "./errors.ts";
import type { ModuleSet } from "./modules.ts";
import type { JsDecl } from "./parse.ts";

const BUILTINS = new Set(["len", "str", "map", "filter", "sum", "fail", "fetch", "every"]);   // the scenario prelude; all pure
const isHandler = (attr: string) => /^on[A-Z:]/.test(attr);                                   // SC-4

// ---------------------------------------------------------------- regions and symbols
type Region = {
  id: number; depth: number;
  parent: Region | null;               // lexical
  component: Region | null;            // nearest enclosing component root (possibly self)
  isComponentRoot: boolean;
  provParent: Region | null;           // where provisions come from when not a component root (children: the component's root)
  appSites: Region[];                  // component roots: the regions it is applied in
  provides: Set<string>;
  catches?: Catch;                     // an `errored` body: what its boundary discharges (R-f-4)
  kids?: { comp: Region; site: Region };   // children passed to a component: read where it reads props.children (R-f-5)
  sig?: CompSig;                       // an imported component's root: its signature stands in for its body (MO-3)
};
// ---------------------------------------------------------------- failures (R-f)
/** What a catch or a boundary discharges: named classes, or every failure. `Error` is the top: only "all" discharges it. */
type Catch = Set<string> | "all";
/** A read of a component's prop: its failures are the argument's, known only at each application (R-f-5). `pre`: catches already applied. */
type PropRef = { comp: Region; field: string; pre: Catch[] };
type Fails = { cls: Set<string>; props: PropRef[] };
/** One step on the way up from a read: what it discharges — failures (`f`: a boundary or a catch) and provisions (`p`). */
type Step = { f?: Catch; p?: Catch };
/** Where a prop goes once read: up to the component's root (`term` null) or out of an action (an error). */
type PFEntry = { chain: Step[]; term: null | { line: number; name: string } };
const caught = (c: Catch, cls: string) => c === "all" || (cls !== "Error" && c.has(cls));
const escF = (chain: Step[], cls: string) => !chain.some(s => s.f && caught(s.f, cls));
const escP = (chain: Step[], name: string) => !chain.some(s => s.p && (s.p === "all" || s.p.has(name)));
/** MO-3: an exported component as an importer sees it — what escapes its root, the provisions it needs from above, and per prop
 *  what it discharges on every path from its reads (`f`, `p`), and what an action reading it catches. */
export type CompSig = { own: { cls: string; what: string; at?: string }[]; requires: string[]; props: Record<string, { f: Catch; p: Catch; rendered: boolean; action?: { f: Catch; name: string } }> };
const noFails = (): Fails => ({ cls: new Set(), props: [] });
/** A context key (`file#name`, `@n` for one declared in a block) → its name. */
export const keyName = (k: string) => k.split("#").pop()!.replace(/@\d+$/, "");
const addF = (a: Fails, b: Fails) => { for (const x of b.cls) a.cls.add(x); a.props.push(...b.props); return a; };
const catchOf = (classes?: string[]): Catch => classes ? new Set(classes) : "all";
/** A short rendering of an expression, for messages. */
function show(e: Expr): string {
  switch (e.k) {
    case "lit": return JSON.stringify(e.v); case "id": return e.name; case "member": return `${show(e.o)}.${e.p}`;
    case "call": return `${show(e.f)}(…)`; case "await": return `await ${show(e.e)}`; case "latest": return `latest ${show(e.e)}`;
    case "peek": return `peek ${show(e.e)}`; case "throw": return `throw ${show(e.e)}`; case "index": return `${show(e.o)}[…]`;
    case "use": return `use ${e.name}`; case "catch": return `${show(e.e)} catch …`; case "tpl": return "`…`"; case "bin": return `${show(e.l)} ${e.op} ${show(e.r)}`; case "if": return `${show(e.c)} ? … : …`;
    default: return "…";
  }
}
type SymKind = "source" | "eq" | "props" | "value" | "fn" | "action" | "comp" | "import" | "errclass" | "context";
type Sym = {
  kind: SymKind; name: string; region: Region; line: number;
  question?: boolean;                  // source x = e
  io?: boolean;                        // calling it is io (R-io)
  instantiating?: boolean;             // fn with ref params or declarations (E-9)
  params?: { name: string; ref: boolean }[];
  captures?: Sym[];                    // a value holding a closure: the reactive names it captured (O-3)
  mapsRecords?: boolean;               // an unkeyed equation that maps into fresh records (ST-4b)
  rows?: () => Set<string>;            // inferred rows of its value (R-13)
  comp?: Extract<Decl, { k: "component" }>;
  expr?: Expr; env?: Env;              // an equation's (or a question source's) expression and the scope it reads in — C-3
  compRegion?: Region;
  failsT?: () => Fails;                // R-f-2: the failures of its value (an equation, a question source) or of a call (a fn)
  fnTail?: Expr; fnEnv?: Env;          // a fn: its result, for what an `await` of a call to it rejects with
  rejects?: Set<string>;               // an import: what its promises reject with (R-f-8)
  imported?: string;                   // a source imported from an .rx module: read-only here (MO-2)
  ctx?: { key: string; source: boolean; dflt: boolean; contract: { rows: Set<string>; fails: Set<string> } | null };   // a context (RG-7): its identity, whether it carries a source, and its declared rows (null: inferred from its provisions)
};
const reactiveKinds = new Set<SymKind>(["source", "eq", "props"]);

class Env {
  vars = new Map<string, Sym>(); parent: Env | null; region: Region;
  constructor(parent: Env | null, region: Region) { this.parent = parent; this.region = region; }
  lookup(n: string): Sym | undefined { return this.vars.get(n) ?? this.parent?.lookup(n); }
}
type Ctx = { scope: "reactive" | "imperative"; inFn?: boolean; inAction?: boolean };

// ---------------------------------------------------------------- free names
/** Free identifiers of an expression (`pre:x` for `pre x`), minus names bound inside it. */
function freeNames(e: Expr, bound: Set<string>, out: Set<string>): void {
  const go = (x: Expr) => freeNames(x, bound, out);
  switch (e.k) {
    case "lit": case "use": return;
    case "id": if (!bound.has(e.name)) out.add(e.name); return;
    case "pre": if (!bound.has(e.name)) out.add(`pre:${e.name}`); return;
    case "peek": go(e.e); return;
    case "await": go(e.e); if (e.init) go(e.init); return;
    case "latest": case "pending": case "un": case "spread": go(e.e); return;
    case "bin": go(e.l); go(e.r); return;
    case "if": go(e.c); go(e.t); go(e.f); return;
    case "tpl": for (const p of e.parts) if (typeof p !== "string") go(p); return;
    case "member": go(e.o); return;
    case "index": go(e.o); go(e.i); return;
    case "call": go(e.f); e.args.forEach(go); return;
    case "arr": e.items.forEach(go); return;
    case "rec": for (const f of e.fields) go("spread" in f ? f.spread : f.v); return;
    case "fn": { const b = new Set([...bound, ...e.params]); freeNames(e.body, b, out); if (e.stmts) freeNamesStmts(e.stmts, b, out); return; }
    case "draft": { go(e.seed); freeNamesStmts(e.body, new Set([...bound, "d"]), out); return; }
    case "throw": go(e.e); return;
    case "catch": go(e.e); freeNames(e.alt, e.name ? new Set([...bound, e.name]) : bound, out); return;
  }
}
function freeNamesStmts(ss: Stmt[], bound0: Set<string>, out: Set<string>): void {
  const bound = new Set(bound0);
  for (const s of ss) {
    const go = (x: Expr) => freeNames(x, bound, out);
    switch (s.k) {
      case "let": go(s.e); bound.add(s.name); break;
      case "write": case "optimistic": if (!s.target.ctx && !bound.has(s.target.name)) out.add(s.target.name); s.target.path.forEach(p => typeof p !== "string" && go(p)); go(s.e); break;
      case "expr": case "throw": go(s.e); break;
      case "return": if (s.e) go(s.e); break;
      case "refresh": case "affects": if (!bound.has(s.name)) out.add(s.name); break;
      case "action": freeNamesStmts(s.body, bound, out); break;
      case "sif": go(s.c); freeNamesStmts(s.t, bound, out); freeNamesStmts(s.f, bound, out); break;
      case "try": freeNamesStmts(s.body, bound, out); if (s.handler) freeNamesStmts(s.handler, new Set([...bound, ...(s.catchName ? [s.catchName] : [])]), out); if (s.fin) freeNamesStmts(s.fin, bound, out); break;
    }
  }
}
/** Free names outside `peek` — the reads that make an initializer a snapshot (E-4). */
function readsOutsidePeek(e: Expr, out: Set<string>): void {
  if (e.k === "peek") return;
  if (e.k === "fn") return;                                             // a closure literal reads nothing now
  const tmp = new Set<string>();
  switch (e.k) {
    case "id": out.add(e.name); return;
    case "pre": out.add(e.name); return;
    default: {
      for (const v of Object.values(e as object)) {
        if (Array.isArray(v)) v.forEach(x => { if (x && typeof x === "object") { if ("k" in x) readsOutsidePeek(x as Expr, out); else if ("v" in x) readsOutsidePeek((x as { v: Expr }).v, out); else if ("spread" in x) readsOutsidePeek((x as { spread: Expr }).spread, out); } });
        else if (v && typeof v === "object" && "k" in (v as object)) readsOutsidePeek(v as Expr, out);
      }
      void tmp;
    }
  }
}
const mapsIntoRecords = (e: Expr): boolean => {                         // `map(xs, x => ({…}))` / `xs.map(x => ({…}))`
  if (e.k !== "call") return false;
  const fnArg = e.f.k === "id" && e.f.name === "map" ? e.args[1] : e.f.k === "member" && e.f.p === "map" ? e.args[0] : undefined;
  return !!fnArg && fnArg.k === "fn" && !fnArg.stmts && fnArg.body.k === "rec";
};
const ROW_WORDS = /^((?:io|pending|lane|fails\([^)]*\))\s+)+/;

// ---------------------------------------------------------------- the checker
/** MO-3: what an importer sees of each export — rows, parameters, and for a component its summary. Never its body. */
export type ExportSig =
  | { kind: "source"; question: boolean; rows: string[]; fails: string[] }
  | { kind: "eq"; rows: string[]; fails: string[]; io: boolean }
  | { kind: "fn"; params: { name: string; ref: boolean }[]; instantiating: boolean; rows: string[]; fails: string[]; rejects: string[] }
  | { kind: "action" }
  | { kind: "errclass"; params: string[] }
  | { kind: "comp"; sig: CompSig }
  | { kind: "context"; key: string; source: boolean; dflt: boolean; rows: string[]; fails: string[]; type?: string }
  | { kind: "type" };                                                                   // `export type T`: importable, binds no value (MO-6c)   // an exported context: its written type is the contract (RG-7e)
export type ModSig = { file: string; exports: Map<string, ExportSig> };
type Opts = { sigs?: Map<string, ModSig>; file?: string; declarations?: Map<string, JsDecl[]> };

export function check(p: Program, opts: Opts = {}): Diagnostic[] { const c = new Checker(opts); c.run(p); return c.diags; }
export function checkWithSignature(p: Program, opts: Opts = {}): { diags: Diagnostic[]; sig: ModSig } { const c = new Checker(opts); c.run(p); return { diags: c.diags, sig: c.signature(p) }; }
/** CN-4b / MO-3: check every module of a program, dependencies first, each against its imports' signatures only. */
export function checkModules(set: ModuleSet): { diags: Diagnostic[]; sigs: Map<string, ModSig> } {
  const sigs = new Map<string, ModSig>(); const diags: Diagnostic[] = [...set.diags];
  for (const path of set.order) { const r = checkWithSignature(set.programs.get(path)!, { sigs, file: path, declarations: set.declarations }); diags.push(...r.diags); sigs.set(path, r.sig); }
  return { diags, sigs };
}

class Checker {
  diags: Diagnostic[] = [];
  private opts: Opts;
  private rootEnv: Env | null = null;
  constructor(opts: Opts = {}) { this.opts = opts; }
  private line = 1;
  private seq = 0;
  private uses: { region: Region; name: string; line: number; display: string }[] = [];   // name: the context's key
  // R-f: recorded during the walk, resolved after it (every symbol's thunks exist by then)
  private readers: { region: Region; e: Expr; env: Env; line: number }[] = [];
  private apps: { comp: Region; site: Region; line: number; tag: string; args: { field: string; e: Expr; env: Env }[] }[] = [];
  private actions: { name: string; body: Stmt[]; env: Env; line: number }[] = [];
  private provisions: { key: string; e: Expr; env: Env }[] = [];
  private later: (() => void)[] = [];
  private rowsBusy = new Set<string>();
  private err(code: string, rule: string, msg: string) { if (!this.diags.some(d => d.code === code && d.line === this.line && d.msg === msg)) this.diags.push({ code, rule, line: this.line, msg, ...(this.opts.file ? { file: this.opts.file } : {}) }); }
  private region(parent: Region | null, opts: { component?: boolean; provParent?: Region | null } = {}): Region {
    const r: Region = { id: this.seq++, depth: parent ? parent.depth + 1 : 0, parent, component: null, isComponentRoot: !!opts.component, provParent: opts.provParent === undefined ? parent : opts.provParent, appSites: [], provides: new Set() };
    r.component = opts.component ? r : parent?.component ?? null;
    return r;
  }

  run(p: Program) {
    const root = new Env(null, this.region(null)); this.rootEnv = root;
    this.block(p.decls, p.view, root, { scope: "reactive" });
    for (const f of this.later) f();
    this.resolveTree();
  }

  // ---- blocks: declarations, then a view (02 §1, 03) ----
  private block(decls: Decl[], view: Markup[], env: Env, ctx: Ctx) {
    // 1. names (E-7: one declaration per name in a block)
    for (const d of decls) {
      this.line = d.line;
      if (d.k === "import" && d.resolved) { this.importRx(d, env); continue; }                                  // MO-1/MO-3: an .rx module's signature
      if (d.k === "import" && d.declared) { this.importDeclared(d, env); continue; }                            // MO-8: a JS module's declaration file
      if (d.k === "import") { for (const { alias } of d.names) env.vars.set(alias, { kind: "import", name: alias, region: env.region, line: d.line, io: !d.pure, rejects: new Set(d.fails ?? ["Error"]) }); continue; }   // R-io-4, R-f-8
      if (d.k === "effect" || d.k === "provide" || d.k === "typedecl") continue;
      if (d.k === "context") {                                                             // RG-7: a declared context — its identity is the declaration, not its spelling
        if (env.vars.has(d.name)) this.err("DUPLICATE_DECLARATION", "E-7", `${d.name} is declared twice in one block`);
        const contract = (d.type && ROW_WORDS.test(d.type)) || d.exported ? this.contractOf(d.type) : null;   // RG-7e: written rows, or exported (its type is then the contract: no row words, no rows)
        if (d.source && d.dflt) this.err("INVALID_CONTEXT_DEFAULT", "RG-7c", `context ${d.name}: source … has no default — a provided source is its provider's; a default would be one source every user writes (declare that source instead)`);
        env.vars.set(d.name, { kind: "context", name: d.name, region: env.region, line: d.line, ctx: { key: `${this.opts.file ?? "main.rx"}#${d.name}${env.region.parent ? `@${this.seq++}` : ""}`, source: d.source, dflt: !!d.dflt, contract } });
        if (d.dflt) this.provisions.push({ key: env.vars.get(d.name)!.ctx!.key, e: d.dflt, env });
        continue;
      }
      if (env.vars.has(d.name) && env.vars.get(d.name)!.kind !== "import") this.err("DUPLICATE_DECLARATION", "E-7", `${d.name} is declared twice in one block`);
      const sym: Sym = { kind: d.k === "fn" ? "fn" : d.k === "component" ? "comp" : d.k === "action" ? "action" : d.k === "source" ? "source" : d.k === "error" ? "errclass" : "eq", name: d.name, region: env.region, line: d.line };
      if (d.k === "source") sym.question = !!d.question;
      if (d.k === "action") sym.io = true;                                                 // R-io-2: an action is io
      if (d.k === "fn") { sym.params = d.params; sym.instantiating = d.params.some(p => p.ref) || d.decls.length > 0; }
      if (d.k === "component") { sym.comp = d; sym.compRegion = this.region(env.region, { component: true }); }
      if (d.k === "eq") { sym.mapsRecords = !d.key && mapsIntoRecords(d.e); if (d.e.k === "id") { const t = env.lookup(d.e.name); if (t?.io) sym.io = true; } }
      env.vars.set(d.name, sym);
    }
    for (const d of decls) if (d.k === "source" && !d.question) env.vars.get(d.name)!.failsT = this.failsThunk(d.init, env);   // R-f-2: a source holds what its initializer gave it — an error, if that failed (found by S-ai2-settings)
    for (const d of decls) if ((d.k === "eq" || (d.k === "source" && d.question))) { const e = d.k === "eq" ? d.e : d.init; const sym = env.vars.get(d.name)!; sym.rows = this.rowsThunk(e, env); sym.expr = e; sym.env = env; sym.failsT = this.failsThunk(e, env); }
    // 2. C-1 over this block's equations (the static graph, CN-3a): only an equation's own `pre` breaks a cycle
    this.cycles(decls, env);
    // 3. each declaration
    for (const d of decls) { this.line = d.line; this.decl(d, env, ctx); }
    // 4. the view
    this.markup(view, env);
  }

  /** MO-3/MO-4: bind an `.rx` import's names from its module's signature. Its rows are the signature's: `pure` must agree and
   *  `fails` is refused. An imported source is read-only here (MO-2). */
  private importRx(d: Extract<Decl, { k: "import" }>, env: Env) {
    const sig = this.opts.sigs?.get(d.resolved!);
    if (d.fails) this.err("IMPORT_ROW_MISMATCH", "MO-4", `\`fails\` asserts rows at the JS boundary; ${d.from} is .rx and its rows are its signature's`);
    for (const { name, alias } of d.names) {
      const base: Sym = { kind: "import", name: alias, region: env.region, line: d.line };
      const x = sig?.exports.get(name);
      if (!sig) { env.vars.set(alias, base); continue; }                                      // the module was not found or not checked (reported there)
      if (!x) { this.err("NOT_EXPORTED", "MO-6", `${d.from} does not export ${name === "default" ? "a default" : name}`); env.vars.set(alias, base); continue; }
      if (x.kind === "type") continue;                                                      // a type name: text to the checker (07 §2), nothing to bind
      const rowsOf = (r: string[]) => () => new Set(r);
      const failsOf = (f: string[]) => () => ({ cls: new Set(f), props: [] as PropRef[] });
      let sym: Sym;
      switch (x.kind) {
        case "source": sym = { kind: "source", name: alias, region: env.region, line: d.line, question: x.question, imported: d.from, rows: rowsOf(x.rows), failsT: failsOf(x.fails) }; break;
        case "eq": sym = { kind: "eq", name: alias, region: env.region, line: d.line, io: x.io, rows: rowsOf(x.rows), failsT: failsOf(x.fails) }; break;
        case "fn": sym = { kind: "fn", name: alias, region: env.region, line: d.line, params: x.params, instantiating: x.instantiating, rows: rowsOf(x.rows), failsT: failsOf(x.fails), rejects: new Set(x.rejects) }; break;
        case "action": sym = { kind: "action", name: alias, region: env.region, line: d.line, io: true }; break;
        case "errclass": sym = { kind: "errclass", name: alias, region: env.region, line: d.line }; break;
        case "comp": { const r = this.region(null, { component: true }); r.sig = x.sig; sym = { kind: "comp", name: alias, region: env.region, line: d.line, compRegion: r }; break; }
        case "context": sym = { kind: "context", name: alias, region: env.region, line: d.line, ctx: { key: x.key, source: x.source, dflt: x.dflt, contract: { rows: new Set(x.rows), fails: new Set(x.fails) } } }; break;
      }
      if (d.pure && sym.io) this.err("IMPORT_ROW_MISMATCH", "MO-4", `${name} is io in ${d.from}'s signature; \`pure\` cannot lower an .rx row`);
      env.vars.set(alias, sym);
    }
  }
  /** RG-7: the context a `provide`/`use` names — lexically, like any name. */
  private ctxOf(name: string, env: Env): Sym | undefined {
    const s = env.lookup(name);
    if (!s) { this.err("UNBOUND", "RG-7", `${name} is not declared here: declare the context (\`context ${name}: T\`) or import it`); return undefined; }
    if (s.kind !== "context") { this.err("NOT_A_CONTEXT", "RG-7", `${name} is ${s.kind === "source" ? "a source" : s.kind === "eq" ? "an equation" : `a ${s.kind}`}, not a context: \`provide\` and \`use\` name a \`context\` declaration`); return undefined; }
    return s;
  }
  /** RG-7e: a context's written rows — the row words before its type (`context user: pending fails(Error) User`). */
  private contractOf(type?: string): { rows: Set<string>; fails: Set<string> } {
    const m = type ? ROW_WORDS.exec(type) : null; const rows = new Set<string>(); const fails = new Set<string>();
    if (m) for (const w of m[0].trim().split(/\s+(?![^(]*\))/)) { if (w.startsWith("fails(")) w.slice(6, -1).split("|").map(x => x.trim()).filter(Boolean).forEach(x => fails.add(x)); else rows.add(w); }
    return { rows, fails };
  }
  /** MO-8: bind a JS import's names from its declaration file. The file is the row: `pure` on the import must agree with it,
   *  `fails` is refused, and a name it does not declare is not exported. */
  private importDeclared(d: Extract<Decl, { k: "import" }>, env: Env) {
    const decls = this.opts.declarations?.get(d.declared!) ?? []; const file = d.declared!.split("/").pop();
    if (d.fails) this.err("IMPORT_ROW_MISMATCH", "MO-8", `${d.from}'s rows are declared in ${file}: \`fails\` on the import cannot restate them`);
    for (const { name, alias } of d.names) {
      const x = decls.find(y => y.name === name);
      if (!x) { this.err("NOT_EXPORTED", "MO-8", `${file} declares no export ${name} (declare it, or it is not ${d.from}'s)`); env.vars.set(alias, { kind: "import", name: alias, region: env.region, line: d.line, io: true }); continue; }
      if (x.kind === "type") continue;
      if (x.kind === "error") { env.vars.set(alias, { kind: "errclass", name: alias, region: env.region, line: d.line }); continue; }
      if (d.pure && !x.pure) this.err("IMPORT_ROW_MISMATCH", "MO-8", `${name} is declared io in ${file} (\`export fn\`, not \`export pure fn\`); \`pure\` on the import cannot lower it`);
      env.vars.set(alias, { kind: "import", name: alias, region: env.region, line: d.line, io: !x.pure, rejects: new Set(x.rejects ?? ["Error"]) });
    }
  }
  /** MO-3: this module's signature — every export as an importer sees it. */
  signature(p: Program): ModSig {
    const exports = new Map<string, ExportSig>(); const env = this.rootEnv!;
    const arr = (x?: Set<string>) => [...(x ?? [])];
    for (const d of p.decls) {
      if (!(d as { exported?: boolean }).exported || !("name" in d)) continue;
      if (d.k === "typedecl") { exports.set(d.name, { kind: "type" }); continue; }
      const s = env.vars.get(d.name); if (!s) continue;
      switch (s.kind) {
        case "source": exports.set(d.name, { kind: "source", question: !!s.question, rows: arr(s.rows?.()), fails: arr(s.failsT?.().cls) }); break;
        case "eq": exports.set(d.name, { kind: "eq", rows: arr(s.rows?.()), fails: arr(s.failsT?.().cls), io: !!s.io }); break;
        case "fn": exports.set(d.name, { kind: "fn", params: s.params ?? [], instantiating: !!s.instantiating, rows: arr(s.rows?.()), fails: arr(s.failsT?.().cls), rejects: arr(s.fnTail && s.fnEnv ? this.rejects(s.fnTail, s.fnEnv, new Set()) : s.rejects) }); break;
        case "action": exports.set(d.name, { kind: "action" }); break;
        case "errclass": exports.set(d.name, { kind: "errclass", params: d.k === "error" ? d.params : [] }); break;
        case "comp": exports.set(d.name, { kind: "comp", sig: this.compSig!(s.compRegion!) }); break;
        case "context": { const c = s.ctx!; exports.set(d.name, { kind: "context", key: c.key, source: c.source, dflt: c.dflt, rows: arr(c.contract?.rows), fails: arr(c.contract?.fails), type: d.k === "context" ? d.type?.replace(ROW_WORDS, "") : undefined }); break; }
      }
    }
    return { file: this.opts.file ?? "", exports };
  }

  private cycles(decls: Decl[], env: Env) {
    const eqs = new Map<string, { e: Expr; line: number }>();
    for (const d of decls) { if (d.k === "eq") eqs.set(d.name, { e: d.e, line: d.line }); if (d.k === "source" && d.question) eqs.set(d.name, { e: d.init, line: d.line }); }
    const color = new Map<string, 1 | 2>(); const reported = new Set<string>();
    const visit = (n: string, stack: string[]) => {
      if (color.get(n) === 2) return;
      if (color.get(n) === 1) { const cyc = [...stack.slice(stack.indexOf(n)), n]; const key = [...cyc].sort().join(); if (!reported.has(key)) { reported.add(key); this.line = eqs.get(n)!.line; this.err("CYCLE", "C-1", `instantaneous cycle: ${cyc.join(" → ")} (break it with \`pre\`, C-2)`); } return; }
      color.set(n, 1);
      const names = new Set<string>(); freeNames(eqs.get(n)!.e, new Set(), names);
      for (const m0 of names) { const own = m0 === `pre:${n}`; const m = m0.startsWith("pre:") ? m0.slice(4) : m0; if (own) continue; if (eqs.has(m) && env.vars.get(m) && env.vars.get(m)!.region === env.region) visit(m, [...stack, n]); }
      color.set(n, 2);
    };
    for (const n of eqs.keys()) visit(n, []);
  }

  private rowsThunk(e: Expr, env: Env): () => Set<string> {
    const busyKeys = this.rowsBusy;
    let cache: Set<string> | null = null; let busy = false;
    return () => {
      if (cache) return cache; if (busy) return new Set(); busy = true;
      const rows = new Set<string>();
      const walk = (x: Expr): void => {
        switch (x.k) {
          case "await": rows.add("pending"); break;
          case "latest": case "pending": rows.add("lane"); break;
          case "fn": return;                                                                // a closure's body is not this value's
          case "use": {                                                                     // RG-7e
            const c = env.lookup(x.name)?.ctx; if (!c) return;
            if (c.contract) { for (const r of c.contract.rows) rows.add(r); return; }
            for (const p of this.provisions) if (p.key === c.key && !busyKeys.has(c.key)) { busyKeys.add(c.key); for (const r of this.rowsThunk(p.e, p.env)()) rows.add(r); busyKeys.delete(c.key); }
            return;
          }
          case "id": { const s = env.lookup(x.name); if (s?.rows) for (const r of s.rows()) rows.add(r); return; }
        }
        for (const v of Object.values(x as object)) {
          if (Array.isArray(v)) v.forEach(y => { if (y && typeof y === "object") { if ("k" in y) walk(y as Expr); else if ("v" in y) walk((y as { v: Expr }).v); else if ("spread" in y) walk((y as { spread: Expr }).spread); } });
          else if (v && typeof v === "object" && "k" in (v as object)) walk(v as Expr);
        }
      };
      walk(e); busy = false; cache = rows; return rows;
    };
  }

  private decl(d: Decl, env: Env, ctx: Ctx) {
    const reactive: Ctx = { scope: "reactive", inFn: ctx.inFn };
    switch (d.k) {
      case "import": if (d.fails) for (const n of d.fails) this.errClass(n, env); return;
      case "typedecl": return;
      case "error": if (d.msg) { const inner = new Env(env, env.region); for (const p of d.params) inner.vars.set(p, { kind: "value", name: p, region: env.region, line: d.line }); this.expr(d.msg, inner, { scope: "reactive", inFn: true }); } return;
      case "source": {
        if (d.question) { this.expr(d.init, env, reactive); this.rowCheck(d.name, d.type, env); return; }
        const reads = new Set<string>(); readsOutsidePeek(d.init, reads);
        const hit = [...reads].find(n => { const s = env.lookup(n); return s && reactiveKinds.has(s.kind); });
        if (hit) this.err("SNAPSHOT_INITIALIZER", "E-4", `source ${d.name} := … reads ${hit} outside peek(…): write the snapshot as one (DV-6)`);
        this.expr(d.init, env, { scope: "reactive", inFn: ctx.inFn });
        return;
      }
      case "eq": {
        if (d.e.k === "call" && d.e.f.k === "id") { const f = env.lookup(d.e.f.name); if (f?.kind === "fn" && f.instantiating) { this.snapshotArgs(d.e, f, env); d.e.args.forEach(a => this.expr(a, env, reactive)); this.rowCheck(d.name, d.type, env); return; } }
        this.expr(d.e, env, reactive); this.rowCheck(d.name, d.type, env); return;
      }
      case "provide": {
        this.expr(d.e, env, reactive);
        const c = this.ctxOf(d.name, env); if (!c) return;
        env.region.provides.add(c.ctx!.key); this.provisions.push({ key: c.ctx!.key, e: d.e, env });
        if (c.ctx!.source) { const t = d.e.k === "id" ? env.lookup(d.e.name) : undefined; if (!t || t.kind !== "source" || t.imported) this.err("PROVIDE_NOT_A_SOURCE", "RG-7c", `context ${d.name} carries a source: provide one of this module's sources by name (\`provide ${d.name} = x\`)`); }
        const contract = c.ctx!.contract; const line = this.line;
        if (contract) this.later.push(() => {                                              // RG-7e: a provision is checked against the declared rows
          const rows = this.rowsThunk(d.e, env)(); const f = this.failsOf(d.e, env, false, new Map());
          this.line = line;
          for (const r of rows) if (!contract.rows.has(r)) this.err("ROW_NARROWER_THAN_INFERRED", "RG-7e", `context ${d.name} is declared without \`${r}\`, but this provision is ${r}`);
          for (const x of f.cls) if (!contract.fails.has("Error") && !contract.fails.has(x)) this.err("ROW_NARROWER_THAN_INFERRED", "RG-7e", `context ${d.name} is declared without fails(${x}), but this provision can fail with ${x}`);
        });
        return;
      }
      case "context": if (d.dflt) this.expr(d.dflt, env, reactive); return;
      case "effect": {
        for (const i of d.inputs) this.expr(i, env, reactive);                               // EF-1: the compute half is reactive scope
        this.stmts(d.body, new Env(env, env.region), { scope: "imperative" });
        this.ownSourceWrites(d, env);
        return;
      }
      case "action": {
        const inner = new Env(env, env.region);
        for (const p of d.params) inner.vars.set(p, { kind: "value", name: p, region: env.region, line: d.line });
        this.stmts(d.body, inner, { scope: "imperative", inAction: true });
        this.actions.push({ name: d.name, body: d.body, env: inner, line: d.line });
        return;
      }
      case "fn": {
        const r = d.decls.length ? this.region(env.region) : env.region;                     // RG-6: an instantiating fn is a region
        const inner = new Env(env, r);
        for (const p of d.params) inner.vars.set(p.name, { kind: p.ref ? "eq" : "value", name: p.name, region: r, line: d.line });
        this.block(d.decls, [], inner, { scope: "reactive", inFn: true });
        this.expr(d.tail, inner, { scope: "reactive", inFn: true });
        { const sym = env.lookup(d.name)!; sym.fnTail = d.tail; sym.fnEnv = inner; sym.failsT = this.failsThunk(d.tail, inner); sym.rows = this.rowsThunk(d.tail, inner); }
        return;
      }
      case "component": {
        const sym = env.lookup(d.name)!; const r = sym.compRegion!;
        const inner = new Env(env, r);
        inner.vars.set(d.props, { kind: "props", name: d.props, region: r, line: d.line });
        this.block(d.decls, d.view, inner, { scope: "reactive" });
        return;
      }
    }
  }

  /** C-3 (ruled 2026-10-23): an apply block's own statements may not write a source its compute half reads, directly or
   *  through the equations it reads — a loop across instants. Writes inside closures the apply creates (timers,
   *  listeners, its cleanup) are later events and stay legal; writes through a provision are not visible here. */
  private ownSourceWrites(d: Extract<Decl, { k: "effect" }>, env: Env) {
    const read = new Map<Sym, string>();                                                   // source → the path that reaches it
    const seen = new Set<Sym>();
    const visit = (e: Expr, scope: Env, via: string) => {
      const names = new Set<string>(); freeNames(e, new Set(), names);
      for (const n0 of names) {
        const s = scope.lookup(n0.startsWith("pre:") ? n0.slice(4) : n0); if (!s || seen.has(s)) continue; seen.add(s);
        if (s.kind === "source" && !read.has(s)) read.set(s, via ? `${via} → ${s.name}` : s.name);
        if (s.expr && s.env) visit(s.expr, s.env, via ? `${via} → ${s.name}` : s.name);
      }
    };
    for (const i of d.inputs) visit(i, env, "");
    const direct = (ss: Stmt[]): void => {
      for (const st of ss) {
        if ((st.k === "write" || st.k === "optimistic") && !st.target.ctx) {
          const t = env.lookup(st.target.name);
          if (t && read.has(t)) this.err("EFFECT_WRITES_OWN_SOURCE", "C-3", `the apply block writes ${t.name}, which its compute half reads (${read.get(t)}): a loop across instants — derive it as an equation, or as \`source ${t.name} = …\` (ST-5), or write it from the event that changes the inputs`);
        }
        if (st.k === "sif") { direct(st.t); direct(st.f); }
        if (st.k === "try") { direct(st.body); if (st.handler) direct(st.handler); if (st.fin) direct(st.fin); }
        if (st.k === "action") direct(st.body);
      }
    };
    direct(d.body);
  }

  /** E-10: a reactive argument for a value parameter of an instantiating fn is snapshotted. */
  private snapshotArgs(call: Extract<Expr, { k: "call" }>, f: Sym, env: Env) {
    f.params!.forEach((p, i) => {
      const a = call.args[i]; if (!a || p.ref) return;
      const reads = new Set<string>(); readsOutsidePeek(a, reads);
      const hit = [...reads].find(n => { const s = env.lookup(n); return s && reactiveKinds.has(s.kind); });
      if (hit) this.err("SNAPSHOT_ARGUMENT", "E-10", `${f.name}(…): the argument for value parameter ${p.name} reads ${hit} and would be snapshotted — declare the parameter \`ref\`, or pass peek(…)`);
    });
  }

  /** CN-4a: a written row narrower than the inferred one. Rows are checked only when written (`x: pending T`). */
  private rowCheck(name: string, type: string | undefined, env: Env) {
    if (!type) return; const m = ROW_WORDS.exec(type); if (!m) return;
    const words = m[0].trim().split(/\s+(?![^(]*\))/);
    const written = new Set(words.map(w => w.replace(/\(.*$/, "")));
    const inferred = env.vars.get(name)?.rows?.() ?? new Set();
    for (const r of inferred) if (!written.has(r)) this.err("ROW_NARROWER_THAN_INFERRED", "CN-4a", `${name} is declared \`${m[0].trim()}\` but its value is also \`${r}\``);
    const fw = words.find(w => w.startsWith("fails("));                                    // R-f-9: a written failure row bounds the inferred one
    const line = this.line;
    this.later.push(() => {
      const f = env.vars.get(name)?.failsT?.(); if (!f) return;
      const allowed = fw ? fw.slice(6, -1).split("|").map(x => x.trim()).filter(Boolean) : null;
      const all = !allowed || allowed.includes("Error");
      if (fw === undefined) { if (!f.cls.size) return; }
      for (const c of f.cls) if (fw === undefined || (!all && !allowed!.includes(c))) { this.line = line; this.err("ROW_NARROWER_THAN_INFERRED", "CN-4a", `${name} is declared \`${m[0].trim()}\` but its value also fails with ${c}`); }
    });
  }
  /** R-f-1: a name in a catch, a boundary or an import's `fails` must be an error class (declared, or a JS class imported). */
  private errClass(n: string, env: Env) {
    if (n === "Error" || n === "Panic") return;                                           // the top class; R-f-10's panics-only
    const s = env.lookup(n);
    if (!s || (s.kind !== "errclass" && s.kind !== "import")) this.err("NOT_AN_ERROR_CLASS", "R-f-1", `${n} is not an error class (declare it: \`error ${n}(…)\`)`);
  }

  // ---- expressions ----
  private resolve(name: string, env: Env, ctx: Ctx): Sym | undefined {
    const s = env.lookup(name); if (s) return s;
    if (BUILTINS.has(name)) return undefined;
    if (ctx.scope === "imperative" && (name === "log" || /^\$\d+$/.test(name))) return undefined;   // the apply block's parameters; `log` is io and only in imperative scope
    this.err("UNBOUND", "SCOPE", `${name} is not declared here (a component sees its declaration site, not its caller — RG-7a)`);
    return undefined;
  }
  private expr(e: Expr, env: Env, ctx: Ctx): void {
    const go = (x: Expr) => this.expr(x, env, ctx);
    switch (e.k) {
      case "lit": return;
      case "id": { const s = this.resolve(e.name, env, ctx); if (s?.kind === "comp") this.err("COMPONENT_AS_VALUE", "RG-4a", `component ${e.name} used as a value: apply it in a view`); if (s?.kind === "context") this.err("CONTEXT_AS_VALUE", "RG-7", `context ${e.name} used as a value: read the nearest provision with \`use ${e.name}\``); return; }
      case "pre": { const s = this.resolve(e.name, env, ctx); if (s && !reactiveKinds.has(s.kind)) this.err("PRE_OF_NON_REACTIVE", "C-2", `pre of ${e.name}, which is not reactive`); if (e.init) go(e.init); return; }
      case "use": { const c = this.ctxOf(e.name, env); if (c && !c.ctx!.dflt) this.uses.push({ region: env.region, name: c.ctx!.key, line: this.line, display: e.name }); return; }
      case "peek": case "latest": case "pending": case "un": case "spread": go(e.e); return;
      case "await": go(e.e); if (e.init) go(e.init); return;
      case "throw": go(e.e); return;
      case "catch": {
        go(e.e); if (e.classes) for (const n of e.classes) this.errClass(n, env);
        const inner = new Env(env, env.region); if (e.name) inner.vars.set(e.name, { kind: "value", name: e.name, region: env.region, line: this.line });
        this.expr(e.alt, inner, ctx); return;
      }
      case "bin": go(e.l); go(e.r); return;
      case "if": go(e.c); go(e.t); go(e.f); return;
      case "tpl": for (const p of e.parts) if (typeof p !== "string") go(p); return;
      case "member": go(e.o); return;
      case "index": go(e.o); go(e.i); return;
      case "arr": e.items.forEach(go); return;
      case "rec": for (const f of e.fields) go("spread" in f ? f.spread : f.v); return;
      case "call": {
        if (e.f.k === "id") {
          const s = env.lookup(e.f.name);
          if (ctx.scope === "reactive" && (s?.io || (!s && e.f.name === "log"))) {
            if (ctx.inFn) this.err("IO_IN_FN", "R-io-2", `${e.f.name}(…) is io; a fn is pure by definition`);
            else this.err(s?.kind === "action" ? "ACTION_CALLED_IN_OWNED_SCOPE" : "IO_IN_REACTIVE", "IO-2", `${e.f.name}(…) is io and is called in reactive scope (R-io-3)`);
          }
          if (s?.kind === "fn" && s.instantiating) this.err("INSTANTIATION_NOT_BOUND", "E-9", `${e.f.name}(…) declares state: bind it, \`x = ${e.f.name}(…)\` (RG-6)`);
          if (s?.kind === "comp") this.err("COMPONENT_AS_VALUE", "RG-4a", `component ${e.f.name} called as a function: apply it in a view`);
        }
        go(e.f); e.args.forEach(go); return;
      }
      case "fn": {
        const inner = new Env(env, env.region);
        for (const p of e.params) inner.vars.set(p, { kind: "value", name: p, region: env.region, line: this.line });
        if (e.stmts) {
          if (ctx.scope === "reactive") { this.err("REACTIVE_WRITE_IN_OWNED_SCOPE", "W-2", "a statement-bodied closure in reactive scope (SC-3: a closure created here is a pure function)"); return; }
          this.stmts(e.stmts, inner, { scope: "imperative" }); return;
        }
        this.expr(e.body, inner, { scope: ctx.scope, inFn: ctx.inFn }); return;
      }
      case "draft": {
        go(e.seed);
        const inner = new Env(env, env.region); inner.vars.set("d", { kind: "value", name: "d", region: env.region, line: this.line });
        for (const s of e.body) {
          if (s.k === "let") { this.expr(s.e, inner, ctx); inner.vars.set(s.name, { kind: "value", name: s.name, region: env.region, line: this.line }); }
          else if (s.k === "expr") this.expr(s.e, inner, ctx);
          else if (s.k === "write") { if (s.target.name !== "d" || s.target.ctx) this.err("DRAFT_WRITE_OUTSIDE_DRAFT", "ST-3a", `a draft block writes only its draft, not ${s.target.ctx ? "use " : ""}${s.target.name}`); s.target.path.forEach(p => typeof p !== "string" && this.expr(p, inner, ctx)); this.expr(s.e, inner, ctx); }
          else this.err("ASYNC_STORE_SETTER", "ST-3b", `${s.k} in a draft block: it is reactive scope (only let, expressions and writes to d)`);
        }
        return;
      }
    }
  }

  // ---- imperative scope (SC-2) ----
  private stmts(ss: Stmt[], env0: Env, ctx: Ctx) {
    const env = new Env(env0, env0.region);
    for (const s of ss) {
      switch (s.k) {
        case "let": {
          this.expr(s.e, env, ctx);
          env.vars.set(s.name, { kind: "value", name: s.name, region: env.region, line: this.line, captures: this.stored(s.e, env) });
          break;
        }
        case "expr": case "throw": this.expr(s.e, env, ctx); break;
        case "return": if (s.e) this.expr(s.e, env, ctx); break;
        case "write": case "optimistic": {
          let target: Sym | undefined;
          if (s.target.ctx) {
            const c = this.ctxOf(s.target.name, env);
            if (c) { this.uses.push({ region: env.region, name: c.ctx!.key, line: this.line, display: s.target.name }); if (!c.ctx!.source) this.err("WRITE_TO_NON_SOURCE", "RG-7c", `context ${s.target.name} is not declared \`source\`: what is provided is read-only (\`context ${s.target.name}: source T\` to write through it)`); }
          }
          else {
            target = this.resolve(s.target.name, env, ctx);
            if (target && target.kind !== "source") this.err("WRITE_TO_NON_SOURCE", "W-1", `${s.target.name} is ${target.kind === "eq" ? "an equation" : target.kind === "props" ? "props" : `a ${target.kind}`}: only sources are written (W-1)`);
            else if (target?.imported) this.err("WRITE_TO_NON_SOURCE", "MO-2", `${s.target.name} is a source of ${target.imported}: a module boundary is a value boundary — write it through an action ${target.imported} exports`);
          }
          if (s.k === "optimistic") {
            if (!ctx.inAction) this.err("OPTIMISTIC_OUTSIDE_HOLD", "AC-3", "optimistic outside an action body: a guess needs a hold to live in");
            if (target && target.kind === "source" && !target.question) this.err("OPTIMISTIC_NO_QUESTION", "AC-3", `${s.target.name} is declared with := — a guess needs a question to confirm it (source ${s.target.name} = …, ST-5c)`);
          }
          s.target.path.forEach(p => typeof p !== "string" && this.expr(p, env, ctx));
          this.expr(s.e, env, ctx);
          this.escape(s, target, env);
          break;
        }
        case "refresh": { const t = this.resolve(s.name, env, ctx); if (t && !(t.kind === "eq" || (t.kind === "source" && t.question))) this.err("INVALID_REFRESH_TARGET", "AC-4", `${s.name} has no question to re-ask`); break; }
        case "affects": { const t = this.resolve(s.name, env, ctx); if (t && !reactiveKinds.has(t.kind)) this.err("INVALID_AFFECTS_TARGET", "AC-5", `${s.name} is not reactive`); break; }
        case "action": this.stmts(s.body, env, { scope: "imperative", inAction: true }); this.actions.push({ name: "(inline)", body: s.body, env, line: this.line }); break;
        case "sif": this.expr(s.c, env, ctx); this.stmts(s.t, env, ctx); this.stmts(s.f, env, ctx); break;
        case "try": {
          this.stmts(s.body, env, ctx);
          if (s.catchClasses) for (const n of s.catchClasses) this.errClass(n, env);
          if (s.handler) { const h = new Env(env, env.region); if (s.catchName) h.vars.set(s.catchName, { kind: "value", name: s.catchName, region: env.region, line: this.line }); this.stmts(s.handler, h, ctx); }
          if (s.fin) this.stmts(s.fin, env, ctx);
          break;
        }
      }
    }
  }

  /** The reactive names captured by closures that a value stores (O-3). A functional write's own function is applied, not stored. */
  private stored(e: Expr, env: Env): Sym[] {
    const out: Sym[] = [];
    const walk = (x: Expr): void => {
      if (x.k === "fn") {
        const names = new Set<string>(); freeNames(x, new Set(), names);
        for (const n of names) { const s = env.lookup(n.startsWith("pre:") ? n.slice(4) : n); if (s && reactiveKinds.has(s.kind)) out.push(s); if (s?.captures) out.push(...s.captures); }
        return;
      }
      if (x.k === "id") { const s = env.lookup(x.name); if (s?.captures) out.push(...s.captures); return; }
      for (const v of Object.values(x as object)) {
        if (Array.isArray(v)) v.forEach(y => { if (y && typeof y === "object") { if ("k" in y) walk(y as Expr); else if ("v" in y) walk((y as { v: Expr }).v); else if ("spread" in y) walk((y as { spread: Expr }).spread); } });
        else if (v && typeof v === "object" && "k" in (v as object)) walk(v as Expr);
      }
    };
    walk(e); return out;
  }
  private escape(s: Extract<Stmt, { k: "write" | "optimistic" }>, target: Sym | undefined, env: Env) {
    const value = s.e.k === "fn" && !s.e.stmts ? s.e.body : s.e;                          // W-6: `x := f` applies f; f's result is what is stored
    const captured = this.stored(value, env); if (!captured.length) return;
    let tDepth: number;
    if (target) tDepth = target.region.depth;
    else {                                                                                   // `use p := …`: the provision is in this component, or above it
      let r: Region | null = env.region; let found: Region | null = null;
      const key = env.lookup(s.target.name)?.ctx?.key ?? s.target.name;
      while (r) { if (r.provides.has(key)) { found = r; break; } if (r.isComponentRoot) break; r = r.parent; }
      tDepth = found ? found.depth : env.region.component ? env.region.component.depth - 1 : 0;
    }
    const leak = captured.find(c => c.region.depth > tDepth);
    if (leak) this.err("REGION_ESCAPE", "O-3", `a closure capturing ${leak.name} (declared in a region that ends sooner) is stored into ${s.target.ctx ? "use " : ""}${s.target.name}, which outlives it`);
  }

  // ---- views ----
  private markup(ms: Markup[], env: Env) {
    for (const m of ms) {
      if (m.line) this.line = m.line;
      switch (m.k) {
        case "text": break;
        case "read": this.expr(m.e, env, { scope: "reactive" }); this.readers.push({ region: env.region, e: m.e, env, line: this.line }); break;
        case "el": {
          if (/^[A-Z]/.test(m.tag)) {
            const s = env.lookup(m.tag);
            if (!s || s.kind !== "comp") { this.err("UNKNOWN_COMPONENT", "RG-4a", `<${m.tag}> is not a component declared here`); }
            for (const a of m.attrs) this.expr(a.e, env, { scope: isHandler(a.name) ? "imperative" : "reactive" });
            if (s?.kind === "comp") {
              s.compRegion!.appSites.push(env.region);
              this.apps.push({ comp: s.compRegion!, site: env.region, line: this.line, tag: m.tag, args: m.attrs.filter(a => !isHandler(a.name)).map(a => ({ field: a.name, e: a.e, env })) });   // R-2: passing is not reading — checked where the component reads it
              const kids = this.region(env.region, { provParent: s.compRegion! });              // RG-4c: children are named by the caller, owned where the component reads them
              kids.kids = { comp: s.compRegion!, site: env.region };
              this.markup(m.children, new Env(env, kids));
            } else this.markup(m.children, env);
            break;
          }
          for (const a of m.attrs) { this.expr(a.e, env, { scope: isHandler(a.name) ? "imperative" : "reactive" }); if (!isHandler(a.name)) this.readers.push({ region: env.region, e: a.e, env, line: this.line }); }
          this.markup(m.children, env);
          break;
        }
        case "mif": {
          this.expr(m.c, env, { scope: "reactive" }); this.readers.push({ region: env.region, e: m.c, env, line: this.line });
          this.block(m.tDecls, m.t, new Env(env, this.region(env.region)), { scope: "reactive" });
          this.block(m.fDecls, m.f, new Env(env, this.region(env.region)), { scope: "reactive" });
          break;
        }
        case "mfor": {
          this.expr(m.xs, env, { scope: "reactive" }); this.readers.push({ region: env.region, e: m.xs, env, line: this.line });
          const src = m.xs.k === "id" ? env.lookup(m.xs.name) : undefined;
          if ((src?.mapsRecords) || mapsIntoRecords(m.xs)) this.err("UNSTABLE_LIST_IDENTITY", "ST-4b", `for ${m.name} in …: the rows are rebuilt as fresh records on every change — declare a key (\`x key id = …\`)`);
          const r = this.region(env.region); const inner = new Env(env, r);
          inner.vars.set(m.name, { kind: "value", name: m.name, region: r, line: this.line });   // RG-2b: the row binding is a constant
          this.block(m.decls, m.body, inner, { scope: "reactive" });
          break;
        }
        case "loading": {
          if (m.on) { this.expr(m.on, env, { scope: "reactive" }); this.readers.push({ region: env.region, e: m.on, env, line: this.line }); }
          this.markup(m.fallback, env);
          this.block(m.decls, m.body, new Env(env, this.region(env.region)), { scope: "reactive" });
          break;
        }
        case "errored": {
          const f = new Env(env, env.region); if (m.errName) f.vars.set(m.errName, { kind: "value", name: m.errName, region: env.region, line: this.line });
          this.markup(m.fallback, f);
          if (m.classes) for (const n of m.classes) this.errClass(n, env);
          const body = this.region(env.region); body.catches = catchOf(m.classes);                 // R-f-4: the boundary discharges its classes for its content
          this.block(m.decls, m.body, new Env(env, body), { scope: "reactive" });
          break;
        }
      }
    }
  }

  // ---- R-f: failures ----
  private failsThunk(e: Expr, env: Env): () => Fails {
    let cache: Fails | null = null; let busy = false;
    return () => { if (cache) return cache; if (busy) return noFails(); busy = true; const f = this.failsOf(e, env, false, new Map()); busy = false; cache = f; return f; };
  }
  /** R-f-2/3/4: the failures an expression's evaluation can produce. `imp`: imperative scope, where closures are not run now.
   *  `bound`: catch bindings in scope and what they caught (for a rethrow). */
  private failsOf(e: Expr, env: Env, imp: boolean, bound: Map<string, Set<string>>): Fails {
    const out = noFails(); const go = (x: Expr) => addF(out, this.failsOf(x, env, imp, bound));
    switch (e.k) {
      case "lit": case "pending": case "pre": return out;                                 // `pending? e` is a verdict, never e's error (R-f-4); `pre` is a value seen
      case "id": {
        if (bound.has(e.name)) return out;
        const s = env.lookup(e.name); if (!s) return out;
        if (s.kind === "props") { out.props.push({ comp: s.region, field: "*", pre: [] }); return out; }
        if (s.failsT && (s.kind === "eq" || s.kind === "source")) return addF(out, s.failsT());
        return out;
      }
      case "member": {
        if (e.o.k === "id" && !bound.has(e.o.name)) { const s = env.lookup(e.o.name); if (s?.kind === "props") { out.props.push({ comp: s.region, field: e.p, pre: [] }); return out; } }
        go(e.o); return out;
      }
      case "use": {                                                                        // RG-7e: the declared rows, else what this module's provisions of it can fail with
        const c = env.lookup(e.name)?.ctx; if (!c) return out;
        if (c.contract) { for (const x of c.contract.fails) out.cls.add(x); return out; }
        for (const p of this.provisions) if (p.key === c.key) addF(out, this.failsOf(p.e, p.env, false, new Map())); return out;
      }
      case "await": go(e.e); if (e.init) go(e.init); for (const c of this.rejects(e.e, env, new Set())) out.cls.add(c); return out;
      case "throw": go(e.e); out.cls.add(this.classOf(e.e, env, bound)); return out;
      case "catch": {
        const inner = this.failsOf(e.e, env, imp, bound); const c = catchOf(e.classes);
        const got = new Set([...inner.cls].filter(x => caught(c, x)));
        for (const x of inner.cls) if (!caught(c, x)) out.cls.add(x);
        for (const pr of inner.props) out.props.push({ ...pr, pre: [...pr.pre, c] });
        const b2 = new Map(bound); if (e.name) b2.set(e.name, c === "all" ? new Set([...inner.cls]) : got);
        return addF(out, this.failsOf(e.alt, env, imp, b2));
      }
      case "fn": {
        if (imp || e.stmts) return out;                                                    // an imperative closure runs later, not now
        const b2 = new Map(bound); for (const p of e.params) b2.set(p, new Set());         // a parameter shadows: not a catch binding, not a symbol
        const inner = new Env(env, env.region); for (const p of e.params) inner.vars.set(p, { kind: "value", name: p, region: env.region, line: 0 });
        return addF(out, this.failsOf(e.body, inner, imp, b2));                             // a pure closure may be called during this evaluation (map, filter)
      }
      case "call": {
        if (e.f.k === "id" && !bound.has(e.f.name)) {
          const s = env.lookup(e.f.name);
          if (s?.kind === "fn" && s.failsT) addF(out, s.failsT());
          else if (s && s.kind !== "errclass" && s.kind !== "import" && s.kind !== "action") go(e.f);
        } else go(e.f);
        e.args.forEach(go); return out;
      }
      case "draft": { go(e.seed); for (const st of e.body) { if (st.k === "let" || st.k === "expr" || st.k === "write") go(st.e); } return out; }
      default: {
        for (const v of Object.values(e as object)) {
          if (Array.isArray(v)) v.forEach(y => { if (typeof y === "string") return; if (y && typeof y === "object") { if ("k" in y) go(y as Expr); else if ("v" in y) go((y as { v: Expr }).v); else if ("spread" in y) go((y as { spread: Expr }).spread); } });
          else if (v && typeof v === "object" && "k" in (v as object)) go(v as Expr);
        }
        return out;
      }
    }
  }
  /** R-f-8: what an awaited value's promise may reject with. A call into a JS import: its declared failure (Error unless narrowed). */
  private rejects(e: Expr, env: Env, seen: Set<Sym>): Set<string> {
    const root = (x: Expr): Expr => x.k === "member" || x.k === "index" ? root(x.o) : x;
    switch (e.k) {
      case "lit": case "tpl": case "arr": case "rec": case "bin": case "un": return new Set();   // values: `await` is the value (R-1)
      case "if": return new Set([...this.rejects(e.t, env, seen), ...this.rejects(e.f, env, seen)]);
      case "call": {
        const r = root(e.f);
        if (r.k === "id") {
          const s = env.lookup(r.name);
          if (s?.kind === "import") return new Set(s.rejects ?? ["Error"]);
          if (s?.kind === "fn" && s.fnTail && s.fnEnv && e.f.k === "id" && !seen.has(s)) { seen.add(s); return this.rejects(s.fnTail, s.fnEnv, seen); }
          if (s?.kind === "fn" && s.rejects) return new Set(s.rejects);                     // an imported fn: its signature (MO-3)
          if (s?.kind === "action") return new Set();                                        // an action never fails (R-f-6)
        }
        return new Set(["Error"]);
      }
      case "id": {
        const s = env.lookup(e.name);
        if (s?.expr && s.env && !seen.has(s)) { seen.add(s); return this.rejects(s.expr, s.env, seen); }
        if (s && (s.kind === "source" || s.kind === "value")) return new Set(["Error"]);
        return new Set(["Error"]);
      }
      default: return new Set(["Error"]);
    }
  }
  /** R-f-3: the class a `throw` fails with — a declared class's construction, a rethrown catch binding, else Error. */
  private classOf(e: Expr, env: Env, bound: Map<string, Set<string>>): string {
    if (e.k === "call" && e.f.k === "id") { const s = env.lookup(e.f.name); if (s?.kind === "errclass" || s?.kind === "import") return e.f.name; }
    if (e.k === "id" && bound.has(e.name)) { const b = bound.get(e.name)!; return b.size === 1 ? [...b][0] : b.size ? `${[...b].join("|")}` : "Error"; }
    return "Error";
  }
  /** R-f-6: the failures an action body lets out. */
  private stmtsFails(ss: Stmt[], env0: Env, bound: Map<string, Set<string>>): Fails {
    const out = noFails(); const env = new Env(env0, env0.region);
    const ex = (x: Expr) => addF(out, this.failsOf(x, env, true, bound));
    for (const s of ss) {
      switch (s.k) {
        case "let": ex(s.e); env.vars.set(s.name, { kind: "value", name: s.name, region: env.region, line: 0 }); break;
        case "expr": ex(s.e); break;
        case "return": if (s.e) ex(s.e); break;
        case "write": case "optimistic": s.target.path.forEach(p => typeof p !== "string" && ex(p)); ex(s.e); break;
        case "throw": ex(s.e); for (const c of this.classOf(s.e, env, bound).split("|")) out.cls.add(c); break;
        case "sif": ex(s.c); addF(out, this.stmtsFails(s.t, env, bound)); addF(out, this.stmtsFails(s.f, env, bound)); break;
        case "try": {
          const b = this.stmtsFails(s.body, env, bound);
          if (s.handler) {
            const c = catchOf(s.catchClasses);
            for (const x of b.cls) if (!caught(c, x)) out.cls.add(x);
            for (const pr of b.props) out.props.push({ ...pr, pre: [...pr.pre, c] });
            const b2 = new Map(bound); if (s.catchName) b2.set(s.catchName, new Set([...b.cls].filter(x => caught(c, x))));
            const h = new Env(env, env.region); if (s.catchName) h.vars.set(s.catchName, { kind: "value", name: s.catchName, region: env.region, line: 0 });
            addF(out, this.stmtsFails(s.handler, h, b2));
          } else addF(out, b);
          if (s.fin) addF(out, this.stmtsFails(s.fin, env, bound));
          break;
        }
        case "action": case "refresh": case "affects": break;                               // a nested action is its own (R-f-6)
      }
    }
    return out;
  }

  /** R-f-5/6 and RG-7b over the static application tree. Every reader's failures are discharged by a catch or a boundary
   *  above it, and every `use` finds a provision above it, through each place its component is applied (and, for an imported
   *  component, through its signature, MO-3); every action catches what its body can fail with. */
  private resolveTree() {
    type Item = { cls: string; line: number; what: string };
    type Req = { name: string; line: number; what: string };
    const readerF = this.readers.map(r => ({ ...r, f: this.failsOf(r.e, r.env, false, new Map()) }));
    const argF = this.apps.flatMap(a => a.args.map(x => ({ app: a, field: x.field, f: this.failsOf(x.e, x.env, false, new Map()) })));
    const actF = this.actions.map(a => ({ ...a, f: this.stmtsFails(a.body, a.env, new Map()) }));
    const ck = (c?: Catch) => c === undefined ? "-" : c === "all" ? "*" : [...c].sort().join("|");
    const key = (c: Step[]) => c.map(x => `${ck(x.f)}~${ck(x.p)}`).join("/");
    const dedupe = <T extends PFEntry | Step[]>(xs: T[]): T[] => { const seen = new Set<string>(); return xs.filter(x => { const k = Array.isArray(x) ? key(x) : key(x.chain) + JSON.stringify(x.term); if (seen.has(k)) return false; seen.add(k); return true; }); };
    const pre = (cs: Catch[]): Step[] => cs.map(f => ({ f }));
    // routes: the steps from a region up to its component's root (or the program's), through children's reads
    const rMemo = new Map<Region, Step[][]>(); const rBusy = new Set<Region>();
    const routes = (R: Region): Step[][] => {
      if (rMemo.has(R)) return rMemo.get(R)!; if (rBusy.has(R)) return []; rBusy.add(R);
      const local: Step[] = []; let out: Step[][] = [];
      for (let r: Region | null = R; r; r = r.parent) {
        if (r.catches || r.provides.size) local.push({ f: r.catches, p: r.provides.size ? r.provides : undefined });
        if (r.kids) { for (const p of PF(r.kids.comp, "children")) if (p.term === null) for (const q of routes(r.kids.site)) out.push([...local, ...p.chain, ...q]); break; }
        if (r.isComponentRoot || !r.parent) { out = [local]; break; }
      }
      out = dedupe(out); rBusy.delete(R); rMemo.set(R, out); return out;
    };
    // PF: where a component's prop field goes once read — up to its root, or out of an action
    const occ: { comp: Region; field: string; pre: Step[]; via: () => PFEntry[] }[] = [];
    for (const r of readerF) for (const pr of r.f.props) occ.push({ comp: pr.comp, field: pr.field, pre: pre(pr.pre), via: () => routes(r.region).map(q => ({ chain: q, term: null })) });
    for (const a of argF) for (const pr of a.f.props) occ.push({ comp: pr.comp, field: pr.field, pre: pre(pr.pre), via: () => PF(a.app.comp, a.field).flatMap(p => p.term ? [p] : routes(a.app.site).map(q => ({ chain: [...p.chain, ...q], term: null }))) });
    for (const a of actF) for (const pr of a.f.props) occ.push({ comp: pr.comp, field: pr.field, pre: pre(pr.pre), via: () => [{ chain: [], term: { line: a.line, name: a.name } }] });
    const pfMemo = new Map<string, PFEntry[]>(); const pfBusy = new Set<string>();
    const PF = (G: Region, field: string): PFEntry[] => {
      if (G.sig) {                                                                           // MO-3: an imported component's summary
        const s = G.sig.props[field] ?? G.sig.props["*"]; if (!s) return [];
        const out: PFEntry[] = [{ chain: [{ f: s.f, p: s.p }], term: null }];
        if (s.action) out.push({ chain: [{ f: s.action.f }], term: { line: -1, name: s.action.name } });
        return out;
      }
      const k = `${G.id}:${field}`; if (pfMemo.has(k)) return pfMemo.get(k)!; if (pfBusy.has(k)) return []; pfBusy.add(k);
      const out: PFEntry[] = [];
      for (const o of occ) if (o.comp === G && (o.field === field || o.field === "*")) for (const v of o.via()) out.push({ chain: [...o.pre, ...v.chain], term: v.term });
      const res = dedupe(out); pfBusy.delete(k); pfMemo.set(k, res); return res;
    };
    // what escapes each component's root (and the program's): failures and provisions
    const escMemo = new Map<Region | null, { fails: Item[]; reqs: Req[] }>(); const escBusy = new Set<Region | null>();
    const compOf = (r: Region) => r.component;
    const esc = (C: Region | null): { fails: Item[]; reqs: Req[] } => {
      if (C?.sig) return { fails: C.sig.own.map(o => ({ cls: o.cls, line: -1, what: o.at ? `${o.what} at ${o.at}` : o.what })), reqs: C.sig.requires.map(n => ({ name: n, line: -1, what: `use ${keyName(n)}` })) };
      if (escMemo.has(C)) return escMemo.get(C)!; if (escBusy.has(C)) return { fails: [], reqs: [] }; escBusy.add(C);
      const fails: Item[] = []; const reqs: Req[] = []; const seen = new Set<string>();
      const pushF = (it: Item) => { const k = `F${it.cls}@${it.line}:${it.what}`; if (!seen.has(k)) { seen.add(k); fails.push(it); } };
      const pushR = (it: Req) => { const k = `R${it.name}@${it.line}:${it.what}`; if (!seen.has(k)) { seen.add(k); reqs.push(it); } };
      for (const r of readerF) if (compOf(r.region) === C) for (const cls of r.f.cls) if (routes(r.region).some(q => escF(q, cls))) pushF({ cls, line: r.line, what: show(r.e) });
      for (const u of this.uses) if (compOf(u.region) === C) if (routes(u.region).some(q => escP(q, u.name))) pushR({ name: u.name, line: u.line, what: `use ${u.display}` });
      for (const a of this.apps) if (compOf(a.site) === C) {
        const e = esc(a.comp);
        for (const it of e.fails) if (routes(a.site).some(q => escF(q, it.cls))) pushF({ ...it, line: it.line < 0 ? a.line : it.line, what: `${it.what} (in <${a.tag}>)` });
        for (const it of e.reqs) if (routes(a.site).some(q => escP(q, it.name))) pushR({ ...it, line: it.line < 0 ? a.line : it.line, what: `${it.what} (in <${a.tag}>)` });
      }
      for (const a of argF) if (compOf(a.app.site) === C) for (const cls of a.f.cls) for (const p of PF(a.app.comp, a.field)) {
        if (p.term) { if (escF(p.chain, cls)) { this.line = a.app.line; this.err("UNCAUGHT_ACTION_FAILURE", "R-f-6", `action ${p.term.name} in <${a.app.tag}> reads props.${a.field}, which can fail with ${cls} here (line ${a.app.line}), and does not catch it`); } continue; }
        if (routes(a.app.site).some(q => escF([...p.chain, ...q], cls))) { pushF({ cls, line: a.app.line, what: `<${a.app.tag} ${a.field}={…}>` }); break; }
      }
      const res = { fails, reqs }; escBusy.delete(C); escMemo.set(C, res); return res;
    };
    const top = esc(null);
    for (const it of top.fails) { this.line = it.line; this.err("UNHANDLED_FAILURE", "R-f-5", `a reader of ${it.what} can fail with ${it.cls} and no catch or errored boundary above it discharges ${it.cls} — wrap it in \`errored fallback(e${it.cls === "Error" ? "" : `: ${it.cls}`}) { … } { … }\`, or catch it: \`… catch (e${it.cls === "Error" ? "" : `: ${it.cls}`}) => …\``); }
    for (const it of top.reqs) { this.line = it.line; this.err("CONTEXT_NOT_FOUND", "RG-7b", `${it.what}: no provision of ${keyName(it.name)} (declared in ${it.name.split("#")[0].split("/").pop()}) above this region on any path that renders it`); }
    for (const a of actF) if (a.f.cls.size) { this.line = a.line; this.err("UNCAUGHT_ACTION_FAILURE", "R-f-6", `action ${a.name} can fail with ${[...a.f.cls].join(", ")} and does not catch it: a handler cannot (it does not await the action) — \`try { … } catch (e) { … }\` in the body`); }
    // MO-3: the summaries an importing module checks against
    const meet = (a: Catch, b: Catch): Catch => a === "all" ? b : b === "all" ? a : new Set([...a].filter(x => b.has(x)));
    const along = (chain: Step[], which: "f" | "p"): Catch => { const out = new Set<string>(); for (const st of chain) { const c = st[which]; if (c === "all") return "all"; if (c) for (const x of c) out.add(x); } return out; };
    this.compSig = (G: Region): CompSig => {
      const fields = new Set(occ.filter(o => o.comp === G).map(o => o.field));
      const props: CompSig["props"] = {};
      for (const f of fields) {
        const es = PF(G, f); let df: Catch = "all", dp: Catch = "all", da: Catch | null = null; let an = ""; let rendered = false;
        for (const e of es) { if (e.term) { da = da === null ? along(e.chain, "f") : meet(da, along(e.chain, "f")); an = e.term.name; } else { rendered = true; df = meet(df, along(e.chain, "f")); dp = meet(dp, along(e.chain, "p")); } }
        props[f] = { f: df, p: dp, rendered, ...(da !== null ? { action: { f: da, name: an } } : {}) };
      }
      const e = esc(G);
      const file = (this.opts.file ?? "main.rx").split("/").pop();
      return { own: e.fails.map(i => ({ cls: i.cls, what: i.what, at: `${file}:${i.line}` })), requires: [...new Set(e.reqs.map(r => r.name))], props };
    };
  }
  compSig: ((G: Region) => CompSig) | null = null;
}

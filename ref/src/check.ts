// The checker: spec/08-constraints.md made executable. Runs over the AST before the interpreter.
// Every diagnostic is an error (CN-1a). Codes keep Solid's names where one exists (CN-1b); `rule`
// is the spec rule enforced. Names resolve lexically (a component body sees its declaration
// site, never its caller — RG-7a); provisions resolve through the static application tree (RG-7b).
import type { Decl, Expr, Markup, Program, Stmt } from "./ast.ts";
import type { Diagnostic } from "./errors.ts";

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
};
type SymKind = "source" | "eq" | "props" | "value" | "fn" | "action" | "comp" | "import";
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
const ROW_WORDS = /^((?:io|pending|lane)\s+)+/;

// ---------------------------------------------------------------- the checker
export function check(p: Program): Diagnostic[] { const c = new Checker(); c.run(p); return c.diags; }

class Checker {
  diags: Diagnostic[] = [];
  private line = 1;
  private seq = 0;
  private uses: { region: Region; name: string; line: number }[] = [];
  private err(code: string, rule: string, msg: string) { if (!this.diags.some(d => d.code === code && d.line === this.line && d.msg === msg)) this.diags.push({ code, rule, line: this.line, msg }); }
  private region(parent: Region | null, opts: { component?: boolean; provParent?: Region | null } = {}): Region {
    const r: Region = { id: this.seq++, depth: parent ? parent.depth + 1 : 0, parent, component: null, isComponentRoot: !!opts.component, provParent: opts.provParent === undefined ? parent : opts.provParent, appSites: [], provides: new Set() };
    r.component = opts.component ? r : parent?.component ?? null;
    return r;
  }

  run(p: Program) {
    const root = new Env(null, this.region(null));
    this.block(p.decls, p.view, root, { scope: "reactive" });
    this.checkUses();
  }

  // ---- blocks: declarations, then a view (02 §1, 03) ----
  private block(decls: Decl[], view: Markup[], env: Env, ctx: Ctx) {
    // 1. names (E-7: one declaration per name in a block)
    for (const d of decls) {
      this.line = d.line;
      if (d.k === "import") { for (const { alias } of d.names) env.vars.set(alias, { kind: "import", name: alias, region: env.region, line: d.line, io: !d.pure }); continue; }   // R-io-4
      if (d.k === "effect" || d.k === "provide" || d.k === "typedecl") continue;
      if (env.vars.has(d.name) && env.vars.get(d.name)!.kind !== "import") this.err("DUPLICATE_DECLARATION", "E-7", `${d.name} is declared twice in one block`);
      const sym: Sym = { kind: d.k === "fn" ? "fn" : d.k === "component" ? "comp" : d.k === "action" ? "action" : d.k === "source" ? "source" : "eq", name: d.name, region: env.region, line: d.line };
      if (d.k === "source") sym.question = !!d.question;
      if (d.k === "action") sym.io = true;                                                 // R-io-2: an action is io
      if (d.k === "fn") { sym.params = d.params; sym.instantiating = d.params.some(p => p.ref) || d.decls.length > 0; }
      if (d.k === "component") { sym.comp = d; sym.compRegion = this.region(env.region, { component: true }); }
      if (d.k === "eq") { sym.mapsRecords = !d.key && mapsIntoRecords(d.e); if (d.e.k === "id") { const t = env.lookup(d.e.name); if (t?.io) sym.io = true; } }
      env.vars.set(d.name, sym);
    }
    for (const d of decls) if ((d.k === "eq" || (d.k === "source" && d.question))) { const e = d.k === "eq" ? d.e : d.init; const sym = env.vars.get(d.name)!; sym.rows = this.rowsThunk(e, env); sym.expr = e; sym.env = env; }
    // 2. C-1 over this block's equations (the static graph, CN-3a): only an equation's own `pre` breaks a cycle
    this.cycles(decls, env);
    // 3. each declaration
    for (const d of decls) { this.line = d.line; this.decl(d, env, ctx); }
    // 4. the view
    this.markup(view, env);
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
    let cache: Set<string> | null = null; let busy = false;
    return () => {
      if (cache) return cache; if (busy) return new Set(); busy = true;
      const rows = new Set<string>();
      const walk = (x: Expr): void => {
        switch (x.k) {
          case "await": rows.add("pending"); break;
          case "latest": case "pending": rows.add("lane"); break;
          case "fn": return;                                                                // a closure's body is not this value's
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
      case "import": case "typedecl": return;
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
      case "provide": env.region.provides.add(d.name); this.expr(d.e, env, reactive); return;
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
        return;
      }
      case "fn": {
        const r = d.decls.length ? this.region(env.region) : env.region;                     // RG-6: an instantiating fn is a region
        const inner = new Env(env, r);
        for (const p of d.params) inner.vars.set(p.name, { kind: p.ref ? "eq" : "value", name: p.name, region: r, line: d.line });
        this.block(d.decls, [], inner, { scope: "reactive", inFn: true });
        this.expr(d.tail, inner, { scope: "reactive", inFn: true });
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
    const written = new Set(m[0].trim().split(/\s+/));
    const inferred = env.vars.get(name)?.rows?.() ?? new Set();
    for (const r of inferred) if (!written.has(r)) this.err("ROW_NARROWER_THAN_INFERRED", "CN-4a", `${name} is declared \`${m[0].trim()}\` but its value is also \`${r}\``);
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
      case "id": { const s = this.resolve(e.name, env, ctx); if (s?.kind === "comp") this.err("COMPONENT_AS_VALUE", "RG-4a", `component ${e.name} used as a value: apply it in a view`); return; }
      case "pre": { const s = this.resolve(e.name, env, ctx); if (s && !reactiveKinds.has(s.kind)) this.err("PRE_OF_NON_REACTIVE", "C-2", `pre of ${e.name}, which is not reactive`); if (e.init) go(e.init); return; }
      case "use": this.uses.push({ region: env.region, name: e.name, line: this.line }); return;
      case "peek": case "latest": case "pending": case "un": case "spread": go(e.e); return;
      case "await": go(e.e); if (e.init) go(e.init); return;
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
          if (s.target.ctx) this.uses.push({ region: env.region, name: s.target.name, line: this.line });
          else {
            target = this.resolve(s.target.name, env, ctx);
            if (target && target.kind !== "source") this.err("WRITE_TO_NON_SOURCE", "W-1", `${s.target.name} is ${target.kind === "eq" ? "an equation" : target.kind === "props" ? "props" : `a ${target.kind}`}: only sources are written (W-1)`);
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
        case "action": this.stmts(s.body, env, { scope: "imperative", inAction: true }); break;
        case "sif": this.expr(s.c, env, ctx); this.stmts(s.t, env, ctx); this.stmts(s.f, env, ctx); break;
        case "try": {
          this.stmts(s.body, env, ctx);
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
      while (r) { if (r.provides.has(s.target.name)) { found = r; break; } if (r.isComponentRoot) break; r = r.parent; }
      tDepth = found ? found.depth : env.region.component ? env.region.component.depth - 1 : 0;
    }
    const leak = captured.find(c => c.region.depth > tDepth);
    if (leak) this.err("REGION_ESCAPE", "O-3", `a closure capturing ${leak.name} (declared in a region that ends sooner) is stored into ${s.target.ctx ? "use " : ""}${s.target.name}, which outlives it`);
  }

  // ---- views ----
  private markup(ms: Markup[], env: Env) {
    for (const m of ms) {
      switch (m.k) {
        case "text": break;
        case "read": this.expr(m.e, env, { scope: "reactive" }); break;
        case "el": {
          if (/^[A-Z]/.test(m.tag)) {
            const s = env.lookup(m.tag);
            if (!s || s.kind !== "comp") { this.err("UNKNOWN_COMPONENT", "RG-4a", `<${m.tag}> is not a component declared here`); }
            for (const a of m.attrs) this.expr(a.e, env, { scope: isHandler(a.name) ? "imperative" : "reactive" });
            if (s?.kind === "comp") {
              s.compRegion!.appSites.push(env.region);
              const kids = this.region(env.region, { provParent: s.compRegion! });              // RG-4c: children are named by the caller, owned where the component reads them
              this.markup(m.children, new Env(env, kids));
            } else this.markup(m.children, env);
            break;
          }
          for (const a of m.attrs) this.expr(a.e, env, { scope: isHandler(a.name) ? "imperative" : "reactive" });
          this.markup(m.children, env);
          break;
        }
        case "mif": {
          this.expr(m.c, env, { scope: "reactive" });
          this.block(m.tDecls, m.t, new Env(env, this.region(env.region)), { scope: "reactive" });
          this.block(m.fDecls, m.f, new Env(env, this.region(env.region)), { scope: "reactive" });
          break;
        }
        case "mfor": {
          this.expr(m.xs, env, { scope: "reactive" });
          const src = m.xs.k === "id" ? env.lookup(m.xs.name) : undefined;
          if ((src?.mapsRecords) || mapsIntoRecords(m.xs)) this.err("UNSTABLE_LIST_IDENTITY", "ST-4b", `for ${m.name} in …: the rows are rebuilt as fresh records on every change — declare a key (\`x key id = …\`)`);
          const r = this.region(env.region); const inner = new Env(env, r);
          inner.vars.set(m.name, { kind: "value", name: m.name, region: r, line: this.line });   // RG-2b: the row binding is a constant
          this.block(m.decls, m.body, inner, { scope: "reactive" });
          break;
        }
        case "loading": {
          if (m.on) this.expr(m.on, env, { scope: "reactive" });
          this.markup(m.fallback, env);
          this.block(m.decls, m.body, new Env(env, this.region(env.region)), { scope: "reactive" });
          break;
        }
        case "errored": {
          const f = new Env(env, env.region); if (m.errName) f.vars.set(m.errName, { kind: "value", name: m.errName, region: env.region, line: this.line });
          this.markup(m.fallback, f);
          this.block(m.decls, m.body, new Env(env, this.region(env.region)), { scope: "reactive" });
          break;
        }
      }
    }
  }

  // ---- RG-7b over the static application tree ----
  private checkUses() {
    const memo = new Map<Region, Set<string> | null>(); const busy = new Set<Region>();
    const avail = (r: Region): Set<string> | null => {                                      // null: undecidable statically (never applied, or recursive)
      if (memo.has(r)) return memo.get(r)!;
      if (busy.has(r)) return null;
      busy.add(r);
      let out: Set<string> | null;
      if (r.isComponentRoot) {
        if (!r.appSites.length) out = null;
        else { out = null; for (const site of r.appSites) { const a = avail(site); if (!a) { out = null; break; } out = out ? new Set([...out].filter(x => a.has(x))) : new Set(a); } if (out) for (const p of r.provides) out.add(p); }
      } else if (r.provParent) { const a = avail(r.provParent); out = a ? new Set([...a, ...r.provides]) : null; }
      else out = new Set(r.provides);
      busy.delete(r); memo.set(r, out); return out;
    };
    for (const u of this.uses) {
      const a = avail(u.region);
      if (a && !a.has(u.name)) { this.line = u.line; this.err("CONTEXT_NOT_FOUND", "RG-7b", `use ${u.name}: no provision for ${u.name} above this region on any path that renders it`); }
    }
  }
}

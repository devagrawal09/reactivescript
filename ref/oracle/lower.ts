// Lowering of the abstract syntax (spec/02-core §1, 03, 05, 06) onto the real runtime:
// solid-js 2.0 flow components over @solidjs/universal with a string-tree renderer.
// This is the compiler's back half, run as an interpreter: every form maps to the primitive
// its rule names (ST-1, ST-4c, ST-6c, AC-3 …). Unsupported shapes throw `Unsupported`.
import type { Decl, Expr, Markup, Program, Stmt } from "../src/ast.ts";
import { createRenderer } from "@solidjs/universal";
import { Show, For, Loading, Errored } from "solid-js";
import {
  createSignal, createMemo, createEffect, createOptimistic, createStore, createProjection, createDeferred,
  createRoot, flush, untrack, latest, isPending, action, refresh, affects, NotReadyError, resetErrorHalt, createContext, getContext, setContext, getOwner, runWithOwner, $TARGET, createErrorBoundary
} from "@solidjs/signals";

const noFlight = (v: unknown) => { if (v instanceof Flight || v instanceof Promise) throw new Unsupported("`await` not in tail position (the oracle lowers a tail `await` to the memo's result)"); };
import { makeErrorClass, isA, PANIC } from "../src/failure.ts";
import { singleModule, type ModuleSet } from "../src/modules.ts";
import { nonTailAwaits } from "../src/awaits.ts";
const hoistedOf = new WeakMap<object, Map<Expr, () => unknown>>();
const NO_PROVISION = { k: "const", value: undefined } as const;
class Returned { value: unknown; constructor(v: unknown) { this.value = v; } }
/** R-f-4: a typed `errored` boundary's fallback for a failure of another class — the wrapper throws it to the next boundary up. */
class Forward { err: unknown; constructor(e: unknown) { this.err = e; } }
/** R-f-4: `e catch (x: C) => alt` as Solid code. A read of an errored node reaches the nearest boundary even inside a JS `try`
 *  (the status flows through the graph), so the catch is an error boundary around the read whose fallback is the value. */
function boundaryRead(f: () => unknown, match: (err: unknown) => boolean, alt: (err: unknown) => unknown): () => unknown {
  const acc = untrack(() => createErrorBoundary(f, (err: () => unknown) => new Fallback(() => { const e0 = err(); return match(e0) ? alt(e0) : new Forward(e0); })));
  return () => unwrapFallback(acc());
}
/** A boundary's fallback that is decided when read, so a failure that changes class while the fallback shows is re-decided. */
class Fallback { get: () => unknown; constructor(g: () => unknown) { this.get = g; } }
function unwrapFallback(v0: unknown): unknown { let v = v0; if (v instanceof Fallback) v = v.get(); if (v instanceof Forward) throw v.err; return v; }
export class Unsupported extends Error { name = "Unsupported"; static last = ""; constructor(m: string) { super(m); Unsupported.last = m; } }

// ---------------------------------------------------------------- string-tree renderer
type N = { kind: "el"; tag: string; children: N[]; parent?: N; props: Record<string, unknown> } | { kind: "text"; text: string; parent?: N };
const R = createRenderer<N>({
  createElement: tag => ({ kind: "el", tag, children: [], props: {} }),
  createTextNode: text => ({ kind: "text", text }),
  replaceText: (n, v) => { (n as Extract<N, { kind: "text" }>).text = v; },
  isTextNode: n => n.kind === "text",
  setProperty: (n, k, v) => { if (n.kind === "el") n.props[k] = v; },
  insertNode: (p, n, anchor) => { if (p.kind !== "el") return; if (n.parent) { const q = n.parent as Extract<N, { kind: "el" }>; const j = q.children.indexOf(n); if (j >= 0) q.children.splice(j, 1); } const i = anchor ? p.children.indexOf(anchor) : -1; if (i < 0) p.children.push(n); else p.children.splice(i, 0, n); n.parent = p; },   // a DOM insert moves
  removeNode: (p, n) => { if (p.kind !== "el") return; const i = p.children.indexOf(n); if (i >= 0) p.children.splice(i, 1); n.parent = undefined; },
  getParentNode: n => n.parent,
  getFirstChild: n => (n.kind === "el" ? n.children[0] : undefined),
  getNextSibling: n => { const p = n.parent; if (!p || p.kind !== "el") return undefined; return p.children[p.children.indexOf(n) + 1]; },
});
export const serialize = (n: N): string => n.kind === "text" ? n.text : n.children.map(serialize).join("");

const isView = (v: unknown): boolean => typeof v === "function" || (Array.isArray(v) && v.every(x => isView(x))) || (typeof v === "object" && v !== null && "kind" in (v as object) && ("tag" in (v as object) || "text" in (v as object)));
export const ERR = { toString: () => "#error" }; export const PENDING_MARK = { toString: () => "#pending" };
export const fmt = (v: unknown): string => v === ERR ? "#error" : v === PENDING_MARK ? "#pending" : v === undefined ? "undefined" : typeof v === "string" ? v : JSON.stringify(v);

// ---------------------------------------------------------------- scopes
type Binding =
  | { k: "sig"; get: () => unknown; set: (v: unknown) => void; question: boolean; optimistic: boolean; setGuess?: (v: unknown) => void }
  | { k: "store"; get: () => any; set: (v: unknown) => void; setPath: (f: (d: any) => any) => void; question: boolean }
  | { k: "memo"; get: () => unknown }
  | { k: "const"; value: unknown }
  | { k: "fn"; decl: Extract<Decl, { k: "fn" }>; home: Scope }        // home: the declaring scope — bodies are lexical (RG-7a, MO-6)
  | { k: "comp"; decl: Extract<Decl, { k: "component" }>; home: Scope }
  | { k: "action"; run: (...a: unknown[]) => unknown }
  | { k: "ctx"; ctx: ReturnType<typeof createContext<Binding | undefined>>; dflt: Expr | null; home: Scope; dv: Binding | null };   // RG-7: a declared context; its createContext is its identity
class Scope {
  static all: Scope[] = [];
  vars = new Map<string, Binding>();
  parent: Scope | null; owner: ReturnType<typeof getOwner>;
  constructor(parent: Scope | null) { this.parent = parent; this.owner = getOwner(); Scope.all.push(this); }   // the owner at declaration: provisions are read against it (RG-7)
  lookup(n: string): Binding | undefined { return this.vars.get(n) ?? this.parent?.lookup(n); }
}
/** Scenario handlers reach any live binding by name (ref/'s virtualScope). */
class VirtualScope extends Scope {
  lookup(n: string): Binding | undefined {
    let any: Binding | undefined;
    for (let i = Scope.all.length - 1; i >= 0; i--) { const b = Scope.all[i].vars.get(n); if (b && (b.k === "sig" || b.k === "store")) return b; any ??= b; }   // the source, not a narrowed copy of it
    return any;
  }
}

/** A controllable flight: an async iterable (a stream — ST-6, each `resolve` is one landing) that is also awaited by actions through `first`. */
class Flight {
  key: string; first: Promise<unknown>; private settleFirst!: (v: unknown) => void; private rejectFirst!: (e: unknown) => void;
  private queue: { v?: unknown; e?: unknown; done?: boolean }[] = []; private waiters: ((x: { v?: unknown; e?: unknown; done?: boolean }) => void)[] = []; private started = false;
  constructor(key: string) { this.key = key; this.first = new Promise((r, j) => { this.settleFirst = r; this.rejectFirst = j; }); this.first.catch(() => {}); }
  private push(x: { v?: unknown; e?: unknown; done?: boolean }) { const w = this.waiters.shift(); if (w) w(x); else this.queue.push(x); }
  resolve(v: unknown) { if (!this.started) { this.started = true; this.settleFirst(v); } this.push({ v }); }
  reject(e: unknown) { if (!this.started) { this.started = true; this.rejectFirst(e); } this.push({ e }); }
  [Symbol.asyncIterator]() {
    const next = (): Promise<IteratorResult<unknown>> => new Promise((res, rej) => { const take = (x: { v?: unknown; e?: unknown; done?: boolean }) => { if ("e" in x) rej(x.e); else res({ value: x.v, done: false }); }; const q = this.queue.shift(); if (q) take(q); else this.waiters.push(take); });
    return { next, return: async () => ({ value: undefined, done: true as const }) };
  }
}

export class Oracle {
  flights = new Map<string, Flight>();
  contexts = new Map<string, ReturnType<typeof createContext<Binding | undefined>>>();
  private ctxNamed(name: string, scope: Scope) { const c = scope.lookup(name); if (!c || c.k !== "ctx") throw new Error(`RG-7: ${name} is not a context`); return c; }
  /** RG-7b: the nearest provision of the context named `name` (lexically) above the scope's owner, else its default. */
  provision(name: string, scope: Scope): Binding {
    const c = this.ctxNamed(name, scope);
    const b = getContext(c.ctx, scope.owner ?? undefined); if (b && b !== NO_PROVISION) return b;
    if (c.dflt) { const de = c.dflt; return c.dv ??= { k: "memo", get: runWithOwner(c.home.owner ?? null, () => createMemo(() => this.ev(de, c.home)))! }; }
    throw new Error(`RG-7b: no provision for ${name}`);
  }
  lastKey = new Map<string, string>();                // equation name → the fetch key its last pass asked (for `resolve x v`)
  private currentEq: string | null = null;
  log: string[] = [];
  root!: N;
  dispose!: () => void;
  optimisticTargets = new Set<string>();
  rootScope!: Scope;
  program: Program;
  scanHandlers: Stmt[][] | undefined;

  /** 09 MO-1: each imported module's scope, declared once, dependencies first. */
  moduleScopes = new Map<string, Scope>();
  constructor(input: Program | ModuleSet, handlers?: Stmt[][]) {
    const set = "programs" in input ? input : singleModule(input);
    const program = set.programs.get(set.entry)!;
    this.program = program; this.scanHandlers = handlers;
    // usage over every module, deep (the compiler's usage(), ref/compile/emit.ts): guessed targets, path-written or path-probed sources
    const seen = new WeakSet<object>();
    const walk = (x: unknown): void => {
      if (!x || typeof x !== "object" || seen.has(x as object)) return; seen.add(x as object);
      if (Array.isArray(x)) { x.forEach(walk); return; }
      const o = x as Record<string, any>;
      if (o.k === "optimistic") this.optimisticTargets.add(o.target.name);
      if ((o.k === "write" || o.k === "optimistic") && o.target.path.length) this.pathTargets.add(o.target.name);
      if (o.k === "pending" && (o.e.k === "member" || o.e.k === "index")) { let y = o.e; while (y.k === "member" || y.k === "index") y = y.o; if (y.k === "id") this.pathTargets.add(y.name); }
      for (const v of Object.values(o)) walk(v);
    };
    for (const p of set.programs.values()) walk(p);
    this.scanHandlers?.forEach(walk);
    this.root = { kind: "el", tag: "root", children: [], props: {} };
    // The renderer's `render`: one scheduled insert for the whole tree, so uncaught async at the mount holds the
    // first commit as one frame (the same as @solidjs/web's `render`; H-2 on instant 0).
    this.rootScope = new VirtualScope(null);
    this.dispose = R.render(() => {
      for (const path of set.order) { if (path === set.entry) continue; const ms = new Scope(null); this.moduleScopes.set(path, ms); this.declare(set.programs.get(path)!.decls, ms); }
      const scope = new Scope(null); this.declare(program.decls, scope); return this.fragment(program.view, scope) as any;
    }, this.root);
  }

  frame() { return serialize(this.root); }

  // ---- flights ----
  flight(key: string): Flight {
    let f = this.flights.get(key);
    if (!f) { f = new Flight(key); this.flights.set(key, f); }
    if (this.currentEq) this.lastKey.set(this.currentEq, key);
    return f;
  }
  /** 07 §3 / R-1: each `await` that is not the equation's result becomes its own async memo, asked only while the conditions
   *  that reach it hold (E-11); the equation reads it where the `await` was (ref/src/awaits.ts). */
  hoistedByName = new Map<string, (() => unknown)[]>();
  private hoistAwaits(name: string, e: Expr, scope: Scope) {
    for (const h of nonTailAwaits(e)) {
      const lv = h.node.init ? { loadingValue: untrack(() => this.ev(h.node.init!, scope)) } : undefined;
      const m = createMemo(() => {
        for (const g of h.guards) { const v = this.ev(g.e, scope); if (!(g.nullish ? v == null : g.neg ? !v : !!v)) return undefined; }
        const was = this.currentEq; this.currentEq = name;
        try { const v = this.ev(h.node.e, scope); return !h.node.stream && v instanceof Flight ? v.first : v; } finally { this.currentEq = was; }   // a plain await: one answer
      }, lv as any);
      let map = hoistedOf.get(scope); if (!map) hoistedOf.set(scope, (map = new Map())); map.set(h.node, m);
      let byName = this.hoistedByName.get(name); if (!byName) this.hoistedByName.set(name, (byName = [])); byName.push(m);
    }
  }
  /** R-f-4: error class names → their values; undefined: every failure. */
  classValues(names: string[] | undefined, scope: Scope): unknown[] | undefined {
    if (!names) return undefined;
    return names.map(n => { if (n === "Error") return Error; if (n === "Panic") return PANIC; const b = scope.lookup(n); if (!b || b.k !== "const") throw new Error(`${n} is not an error class`); return b.value; });
  }
  /** `refresh x` must re-ask: the key's old promise is forgotten so the next fetch makes a new one. */
  forget(key: string) { this.flights.delete(key); }

  // ---- declarations ----
  declare(decls: Decl[], scope: Scope) {
    for (const d of decls) {
      if (d.k === "import" && d.resolved) { const ms = this.moduleScopes.get(d.resolved)!; for (const { name, alias } of d.names) { const b = ms.vars.get(name); if (b) scope.vars.set(alias, b); } continue; }   // MO-1: the module's own bindings
      if (d.k === "import") for (const { name, alias } of d.names) { const v = name === "log" ? (...a: unknown[]) => { this.log.push(`log(${a.map(fmt).join(", ")})`); } : d.declaredErrors?.includes(name) ? makeErrorClass(name, ["message"], a => String(a[0] ?? name)) : BUILTINS[name] ?? (d.from.endsWith("/api") ? (...a: unknown[]) => { const fl = this.flight(`${name}:${a.map(fmt).join(",")}`); return process.env.ORACLE_PROMISES ? fl.first : fl; } : undefined); if (v === undefined) throw new Error(`${name} from "${d.from}" is not in the scenario prelude`); scope.vars.set(alias, { k: "const", value: v }); }
      if (d.k === "error") { const msg = d.msg; scope.vars.set(d.name, { k: "const", value: makeErrorClass(d.name, d.params, args => msg ? String(untrack(() => this.ev(msg, scope, new Map(d.params.map((p, i) => [p, args[i]] as const))))) : d.name) }); }   // R-f-1
      if (d.k === "context") scope.vars.set(d.name, { k: "ctx", ctx: createContext<Binding | undefined>(NO_PROVISION as any, d.name), dflt: d.dflt ?? null, home: scope, dv: null });   // a sentinel default: absence is ours to decide (the default, or RG-7b)
      if (d.k === "fn") scope.vars.set(d.name, { k: "fn", decl: d, home: scope });
      if (d.k === "component") scope.vars.set(d.name, { k: "comp", decl: d, home: scope });
      if (d.k === "action") scope.vars.set(d.name, { k: "action", run: this.lowerAction(d.params, d.body, scope) });
    }
    for (const d of decls) {
      switch (d.k) {
        case "provide": {                                               // RG-7a: setContext on the current owner; a provided source is the source
          const ctx = this.ctxNamed(d.name, scope).ctx;
          const b = d.e.k === "id" ? scope.lookup(d.e.name) : undefined;
          if (b && (b.k === "sig" || b.k === "store")) setContext(ctx, b);
          else { const get = createMemo(() => this.ev(d.e, scope)); setContext(ctx, { k: "memo", get } as Binding); }
          break;
        }
        case "source": {
          if (d.question) {                                             // ST-5: createSignal(fn) / createOptimistic(fn) / createStore(fn, seed)
            this.hoistAwaits(d.name, d.init, scope);
            const compute = this.computeOf(d.name, d.init, scope);
            if (this.optimisticTargets.has(d.name)) {                   // AC-3 over ST-5: the truth is a signal with a question, written plainly; the guess layer is createOptimistic over it
              const [truth, setTruth] = createSignal(compute as any, this.loadingValue(d.init, scope) as any);
              const [get, setGuess] = createOptimistic(() => truth());
              scope.vars.set(d.name, { k: "sig", get, set: setTruth as any, setGuess: setGuess as any, question: true, optimistic: true });
            }
            else if (this.isStructuredAwait(d.init, d.name)) { const [store, setStore] = (createStore as any)(async (draft: Record<string, unknown>) => { const r = compute(draft); const v = r instanceof Flight ? await r.first : await r; if (v && typeof v === "object") { for (const k of Object.keys(draft)) if (!(k in (v as object))) delete draft[k]; Object.assign(draft, v); } }, {}); /* ST-5 structured: the derive writes its draft (Solid's createStore(fn, seed) idiom) */ scope.vars.set(d.name, { k: "store", get: () => store, set: () => { throw new Unsupported("root write to a derived store"); }, setPath: setStore, question: true }); }
            else { const [get, set] = createSignal(compute as any, this.loadingValue(d.init, scope) as any); scope.vars.set(d.name, { k: "sig", get, set: set as any, question: true, optimistic: false }); }
          } else {
            const init = untrack(() => this.ev(d.init, scope));
            if (typeof init === "object" && init !== null) {                // ST-1: structured → createStore; the root slot is a signal so the whole value can be replaced
              const [store, setStore] = createStore(init as any); const [get, set] = createSignal<unknown>(store);
              scope.vars.set(d.name, { k: "store", get, set: (v: unknown) => { if (typeof v === "function") { setStore(v as any); set(store); } else if (typeof v === "object" && v !== null) { setStore(() => v); set(store); } else set(v); }, setPath: setStore, question: false });   // ST-2a: a root write is reconciled per path; W-6: a function is the updater
            }
            else { const [get, set] = createSignal(init); scope.vars.set(d.name, { k: "sig", get, set: set as any, question: false, optimistic: false }); }
          }
          break;
        }
        case "eq": {
          if (d.e.k !== "draft") this.hoistAwaits(d.name, d.e, scope);
          if (d.e.k === "draft") {                                      // ST-3: createProjection((draft) => …, seed)
            const seedE = d.e.seed; if (seedE.k !== "pre" || seedE.name !== d.name || !seedE.init) throw new Unsupported("draft seed must be `pre self -> seed`");
            const seed = untrack(() => this.ev(seedE.init!, scope));
            const body = d.e.body;
            const proj = createProjection((draft: any) => { const s2 = new Scope(scope); s2.vars.set("d", { k: "const", value: draft }); this.runDraft(body, s2); }, seed as any);
            scope.vars.set(d.name, { k: "memo", get: () => proj });
            break;
          }
          if (d.key) {                                                  // ST-4: a keyed projection
            const compute = this.computeOf(d.name, d.e, scope);
            const src = createMemo(() => compute(undefined) as any, this.loadingValue(d.e, scope) as any);   // the answer (sync, or the tail await's) is a memo; the projection reconciles it by key (found by S-ai2-search)
            const proj = createProjection(() => src() as any, [] as any, { key: d.key } as any);
            scope.vars.set(d.name, { k: "memo", get: () => proj });
            break;
          }
          const fnDecl = this.fnOf(d.e, scope);
          if (fnDecl && (fnDecl.params.some(p => p.ref) || fnDecl.decls.length > 0)) { scope.vars.set(d.name, { k: "memo", get: this.instantiateFn(d.e as Extract<Expr, { k: "call" }>, fnDecl, scope) }); break; }   // RG-6
          if (d.e.k === "catch" && !d.deferred) {                      // R-f-4 over a tail await: the equation's flight is an inner memo, read through a boundary
            const c = d.e; const classes = this.classValues(c.classes, scope);
            const inner = createMemo(this.computeOf(d.name, c.e, scope) as any, this.loadingValue(c.e, scope) as any);
            const get = boundaryRead(() => inner(), err => isA(err, classes), err => { const en = new Map<string, unknown>(); if (c.name) en.set(c.name, err); return this.ev(c.alt, scope, en); });
            scope.vars.set(d.name, { k: "memo", get });
            break;
          }
          const compute = this.computeOf(d.name, d.e, scope);
          const opts = this.loadingValue(d.e, scope);
          const get = d.deferred ? createDeferred(compute as any, opts as any) : createMemo(compute as any, opts as any);
          scope.vars.set(d.name, { k: "memo", get });
          break;
        }
        case "effect": {                                                // EF: createEffect(compute, apply)
          const inputs = d.inputs;
          const apply = (vals: unknown[]) => { const env = new Map<string, unknown>(); vals.forEach((v, i) => env.set(`$${i}`, v)); const r = this.runStmts(d.body, scope, env); return typeof r === "function" ? (r as () => void) : undefined; };
          let last: unknown[] | null = null;
          createEffect(() => inputs.map(e => this.ev(e, scope)), {
            effect: (vals: unknown[]) => { if (last && last.length === vals.length && vals.every((v, i) => Object.is(v, last![i]))) return; last = vals; return apply(vals); },   // EF-3: fires when an input changed (an error in between is a change)
            error: () => { last = null; return apply(inputs.map(() => ERR)); },   // E-12: an error is an answer the apply receives
          } as any);
          break;
        }
      }
    }
  }
  /** ST-1 by usage: a question source written or probed by path is structured → createStore(fn, seed). */
  private isStructuredAwait(e: Expr, name?: string) { return name !== undefined && this.pathTargets.has(name); }
  pathTargets = new Set<string>();
  asyncError: unknown = null;
  private imperative = 0;
  /** A memo compute over an equation: `pre x` of itself is the previous value; `await e` as the whole body returns the promise. */
  private computeOf(name: string, e: Expr, scope: Scope) {
    return (prev: unknown) => {
      const s2 = new Scope(scope); s2.vars.set(`pre:${name}`, { k: "const", value: prev });
      const was = this.currentEq; this.currentEq = name;
      try {
        const body = e.k === "await" ? e.e : e;
        const v = this.ev(body, s2);
        return v;
      } finally { this.currentEq = was; }
    };
  }
  /** C-2: `pre y` of another node lowers to a companion memo `createMemo(st => ({ cur: y, prev: st?.cur }))` read at `.prev`. One per (scope, name). */
  private prevOf(name: string, scope: Scope): () => unknown {
    const key = `prev:${name}`;
    let b = scope.lookup(key);
    if (!b) {
      let def: Scope | null = scope; while (def && !def.vars.has(name)) def = def.parent;   // cache on the scope that declares `name`, not a per-compute scope
      const home = def ?? scope;
      const get = runWithOwner(home.owner ?? null, () => createMemo((st: any) => { const cur = this.ev({ k: "id", name }, home); return { cur, prev: st ? st.cur : undefined }; }))!;   // owned by the declaring scope, not by whichever computation first read it
      b = { k: "memo", get: () => (get() as { prev: unknown }).prev }; home.vars.set(key, b);
    }
    return (b as { get: () => unknown }).get;
  }
  private loadingValue(e: Expr, scope: Scope) {                     // R-7: the first paint of any `await … -> v` in the equation
    let init: Expr | undefined;
    const walk = (x: Expr): void => { if (init) return; if (x.k === "await" && x.init) { init = x.init; return; } for (const v of Object.values(x as object)) { if (Array.isArray(v)) v.forEach(y => y && typeof y === "object" && "k" in y && walk(y as Expr)); else if (v && typeof v === "object" && "k" in (v as object)) walk(v as Expr); } };
    walk(e);
    return init ? { loadingValue: untrack(() => this.ev(init!, scope)) } : undefined;
  }
  private fnOf(e: Expr, scope: Scope) { if (e.k !== "call" || e.f.k !== "id") return null; const b = scope.lookup(e.f.name); return b && b.k === "fn" ? b.decl : null; }
  private fnHome(e: Expr, scope: Scope): Scope { const b = e.k === "call" && e.f.k === "id" ? scope.lookup(e.f.name) : undefined; return b && b.k === "fn" ? b.home : scope; }
  private instantiateFn(call: Extract<Expr, { k: "call" }>, f: Extract<Decl, { k: "fn" }>, scope: Scope) {
    const s2 = new Scope(this.fnHome(call, scope));                   // names from the declaration; arguments from the call
    f.params.forEach((p, i) => {
      const arg = call.args[i];
      if (p.ref) { const b = arg?.k === "id" ? scope.lookup(arg.name) : undefined; if (b && (b.k === "sig" || b.k === "memo" || b.k === "store")) s2.vars.set(p.name, b); else s2.vars.set(p.name, { k: "memo", get: createMemo(() => arg ? this.ev(arg, scope) : undefined) }); }
      else s2.vars.set(p.name, { k: "const", value: arg ? untrack(() => this.ev(arg, scope)) : undefined });
    });
    this.declare(f.decls, s2);
    const tb = f.tail.k === "id" ? s2.lookup(f.tail.name) : undefined;
    if (tb && (tb.k === "memo" || tb.k === "sig")) return tb.get;
    return createMemo(() => this.ev(f.tail, s2));
  }

  // ---- expressions (reactive scope: tracked by whatever computation is running) ----
  ev(e: Expr, scope: Scope, env?: Map<string, unknown>): unknown {
    switch (e.k) {
      case "lit": return e.v;
      case "id": {
        if (env?.has(e.name)) return env.get(e.name);
        const b = scope.lookup(e.name);
        if (!b) { if (e.name in BUILTINS) return BUILTINS[e.name]; throw new Error(`unbound ${e.name}`); }
        switch (b.k) {
          case "const": return b.value;
          case "sig": case "memo": case "store": {
            if (!this.imperative) return b.get();
            try { return b.get(); } catch (e) { if (e instanceof NotReadyError) return PENDING_MARK; throw e; }   // H-10: an apply block or handler reads σ; R-f-7: a snapshot of an error throws it
          }
          case "fn": { const f = b.decl, home = b.home; return (...args: unknown[]) => { const en = new Map<string, unknown>(); f.params.forEach((p, i) => en.set(p.name, args[i])); return this.ev(f.tail, home, en); }; }
          case "action": return b.run;
          case "comp": throw new Error("component applied outside a view");
        }
      }
      case "member": { const o = this.ev(e.o, scope, env) as any; noFlight(o); return o == null ? undefined : o[e.p]; }
      case "index": { const o = this.ev(e.o, scope, env) as any; const i = this.ev(e.i, scope, env) as any; return o == null ? undefined : o[i]; }
      case "tpl": return e.parts.map(p => typeof p === "string" ? p : fmt(this.ev(p, scope, env))).join("");
      case "pre": {
        const own = scope.lookup(`pre:${e.name}`);
        if (own && own.k === "const") { if (own.value === undefined && e.init) return this.ev(e.init, scope, env); return own.value; }   // the equation's own previous value: the memo's `prev`
        const v = this.prevOf(e.name, scope)();                        // C-2 for another node: a companion memo carrying (current, previous)
        if (v === undefined && e.init) return this.ev(e.init, scope, env);
        return v;
      }
      case "peek": return untrack(() => this.ev(e.e, scope, env));
      case "await": {
        for (let s: Scope | null = scope; s; s = s.parent) { const h = hoistedOf.get(s)?.get(e); if (h) return h(); }   // a hoisted `await`: its own node, read here
        const v = this.ev(e.e, scope, env); return !e.stream && v instanceof Flight ? v.first : v;   // in tail position the memo returns the flight (R-1): a stream for `await*`, else its one answer
      }   // in tail position the memo returns the flight (R-1); elsewhere the operand checks below refuse it
      case "latest": return latest(() => this.ev(e.e, scope, env));
      case "pending": return isPending(() => this.ev(e.e, scope, env));
      case "if": return this.ev(e.c, scope, env) ? this.ev(e.t, scope, env) : this.ev(e.f, scope, env);
      case "throw": throw this.ev(e.e, scope, env);                    // R-f-3
      case "catch": {                                                  // R-f-4: a matching failure becomes a value
        const classes = this.classValues(e.classes, scope);
        const match = (err: unknown) => isA(err, classes);
        const alt = (err: unknown) => { const en = new Map(env); if (e.name) en.set(e.name, err); return this.ev(e.alt, scope, en); };
        if (this.imperative) { try { return this.ev(e.e, scope, env); } catch (err) { if (err instanceof NotReadyError || !match(err)) throw err; return alt(err); } }
        return boundaryRead(() => { const v = this.ev(e.e, scope, env); noFlight(v); return v; }, match, alt)();   // Solid: an error read inside try still reaches the boundary — a catch is a boundary around the read
      }
      case "un": { const v = this.ev(e.e, scope, env) as any; noFlight(v); return e.op === "!" ? !v : -v; }
      case "bin": {
        const l = this.ev(e.l, scope, env) as any; noFlight(l);
        if (e.op === "&&") return l ? this.ev(e.r, scope, env) : l;
        if (e.op === "||") return l ? l : this.ev(e.r, scope, env);
        if (e.op === "??") return l != null ? l : this.ev(e.r, scope, env);
        const r = this.ev(e.r, scope, env); noFlight(r);
        return BIN[e.op](l, r);
      }
      case "arr": { const out: unknown[] = []; for (const i of e.items) { if (i.k === "spread") out.push(...(this.ev(i.e, scope, env) as unknown[])); else out.push(this.ev(i, scope, env)); } return out; }
      case "rec": { const o: Record<string, unknown> = {}; for (const f of e.fields) { if ("spread" in f) Object.assign(o, this.ev(f.spread, scope, env)); else o[f.key] = this.ev(f.v, scope, env); } return o; }
      case "fn": return (...args: unknown[]) => { const en = new Map(env); e.params.forEach((p, i) => en.set(p, args[i])); return e.stmts ? this.runStmts(e.stmts, scope, en) : this.ev(e.body, scope, en); };
      case "call": {
        let f: any, self: any;
        if (e.f.k === "member") { self = this.ev(e.f.o, scope, env); f = self == null ? undefined : self[e.f.p]; } else f = this.ev(e.f, scope, env);
        const args = e.args.map(a => this.ev(a, scope, env));
        if (f === BUILTINS.fetch) { const fl = this.flight(String(args[0])); return process.env.ORACLE_PROMISES ? fl.first : fl; }
        if (typeof f !== "function") throw new Error("call of non-function");
        return f.apply(self, args);
      }
      case "draft": throw new Unsupported("draft outside an equation");
      case "use": { const b = this.provision(e.name, scope); return b.k === "const" ? b.value : (b as { get: () => unknown }).get(); }
      case "spread": throw new Error("spread outside an array literal");
    }
  }

  // ---- imperative scope ----
  runStmts(stmts: Stmt[], scope: Scope, env: Map<string, unknown>): unknown {
    env.set("log", (...a: unknown[]) => { this.log.push(`log(${a.map(fmt).join(", ")})`); });
    this.imperative++; try { let r: unknown; for (const s of stmts) { r = this.stmt(s, scope, env); if (r instanceof Returned) return r.value; } return r; } finally { this.imperative--; }
  }
  private stmt(s: Stmt, scope: Scope, env: Map<string, unknown>): unknown {
    switch (s.k) {
      case "let": env.set(s.name, untrack(() => this.ev(s.e, scope, env))); return;
      case "expr": return untrack(() => this.ev(s.e, scope, env));
      case "return": return new Returned(s.e ? untrack(() => this.ev(s.e!, scope, env)) : undefined);
      case "sif": { for (const st of untrack(() => this.ev(s.c, scope, env)) ? s.t : s.f) { const r = this.stmt(st, scope, env); if (r instanceof Returned) return r; } return undefined; }
      case "try": {
        const runBlock = (ss: Stmt[]) => { for (const st of ss) { const r = this.stmt(st, scope, env); if (r instanceof Returned) return r; } return undefined; };
        try { const r = runBlock(s.body); if (r) return r; } catch (e) { if (!s.handler || !isA(e, this.classValues(s.catchClasses, scope))) throw e; if (s.catchName) env.set(s.catchName, e); const r = runBlock(s.handler); if (r) return r; } finally { if (s.fin) { const r = runBlock(s.fin); if (r) return r; } }
        return undefined;
      }
      case "throw": throw untrack(() => this.ev(s.e, scope, env));
      case "action": this.lowerAction([], s.body, scope, env)(); return;
      case "refresh": { const b = scope.lookup(s.name); if (!b || !("get" in b)) throw new Error("INVALID_REFRESH_TARGET"); const key = this.lastKey.get(s.name); if (key) this.forget(key); for (const h of this.hoistedByName.get(s.name) ?? []) refresh(h as any); refresh((b.k === "store" ? b.get() : b.get) as any); return; }
      case "affects": { const b = scope.lookup(s.name); if (!b || !("get" in b)) throw new Error("INVALID_AFFECTS_TARGET"); affects(b.get as any); return; }
      case "optimistic": case "write": {
        const b = s.target.ctx ? this.provision(s.target.name, scope) : scope.lookup(s.target.name);
        const v = untrack(() => this.ev(s.e, scope, env));          // W-6: a function value is Solid's updater form — the setters take it as is
        if (!b) throw new Error(`unbound ${s.target.name}`);
        if (b.k === "sig") { if (s.target.path.length) throw new Unsupported("path write to a signal"); (s.k === "optimistic" ? (b.setGuess ?? b.set) : b.set)(v); return; }
        if (b.k === "store") {
          const path = s.target.path.map(p => typeof p === "string" ? p : String(untrack(() => this.ev(p, scope, env))));
          if (path.length === 0) b.set(v);
          else b.setPath((d: any) => { let o = d; for (const k of path.slice(0, -1)) o = o[k]; o[path[path.length - 1]] = v; });
          return;
        }
        throw new Error(`W-1: write to non-source ${s.target.name}`);
      }
    }
  }
  private runDraft(stmts: Stmt[], scope: Scope) {
    const env = new Map<string, unknown>();
    for (const s of stmts) {
      if (s.k === "let") env.set(s.name, this.ev(s.e, scope, env));
      else if (s.k === "expr") this.ev(s.e, scope, env);
      else if (s.k === "write") {
        const d = (scope.lookup("d") as Extract<Binding, { k: "const" }>).value as any;
        const path = s.target.path.map(p => typeof p === "string" ? p : String(this.ev(p, scope, env)));
        let o = d; for (const k of path.slice(0, -1)) { if (o[k] == null) o[k] = {}; o = o[k]; } o[path[path.length - 1]] = this.ev(s.e, scope, env);
      } else throw new Unsupported(`${s.k} in draft`);
    }
  }
  /** AC-1: an action body is a generator; a statement-level `await` is a hold-safe `yield` of the flight. */
  private lowerAction(params: string[], body: Stmt[], scope: Scope, outer?: Map<string, unknown>) {
    const self = this;
    /** AC-1/AC-7: a statement-level `await` is a hold-safe `yield`; `try`/`catch`/`finally`/`throw` are JavaScript's, around the yields. */
    function* block(stmts: Stmt[], env: Map<string, unknown>): Generator<unknown, Returned | undefined, unknown> {
      for (const s of stmts) {
        const awaited = (s.k === "let" || s.k === "expr") && s.e.k === "await" ? s.e : null;
        if (awaited) {
          const v = untrack(() => self.ev(awaited.e, scope, env));
          const r = v instanceof Flight ? yield v.first : v instanceof Promise ? yield v : v;
          if (s.k === "let") env.set(s.name, r);
          continue;
        }
        if (s.k === "sif") { const r = yield* block(untrack(() => self.ev(s.c, scope, env)) ? s.t : s.f, env); if (r) return r; continue; }
        if (s.k === "try") {
          try { const r = yield* block(s.body, env); if (r) return r; }
          catch (e) { if (!s.handler || !isA(e, self.classValues(s.catchClasses, scope))) throw e; if (s.catchName) env.set(s.catchName, e); const r = yield* block(s.handler, env); if (r) return r; }   // R-f-6: a typed catch rethrows other classes
          finally { if (s.fin) { const r = yield* block(s.fin, env); if (r) return r; } }
          continue;
        }
        if (s.k === "throw") throw untrack(() => self.ev(s.e, scope, env));
        let r: unknown; self.imperative++; try { r = self.stmt(s, scope, env); } finally { self.imperative--; }
        if (r instanceof Returned) return r;
      }
      return undefined;
    }
    const run = action(function* (...args: unknown[]) {
      const env = new Map(outer); params.forEach((p, i) => env.set(p, args[i]));
      env.set("log", (...a: unknown[]) => { self.log.push(`log(${a.map(fmt).join(", ")})`); });
      const r = yield* block(body, env); return r ? r.value : undefined;
    });
    return (...args: unknown[]) => { const p = run(...args); p.catch(e => { self.asyncError = e; }); return p; };
  }

  // ---- views ----
  /** A view's items, as Solid's compiled JSX shapes them: in a fragment a reader is a memo; an element's children are its
   *  holes, each inserted at its own marker (`inEl`), so each reader is its own render effect. */
  fragment(m: Markup[], scope: Scope, inEl = false): unknown[] { const items = m.map(x => this.node(x, scope, inEl)); return inEl ? items : items.map(x => (x as { $read?: boolean })?.$read ? R.memo(x as () => unknown) : x); }
  private node(m: Markup, scope: Scope, inEl = false): unknown {
    const self = this;
    switch (m.k) {
      case "text": return R.createTextNode(m.s);
      case "read": { const g = () => { const v = this.ev(m.e, scope); return isView(v) ? v : fmt(v); }; (g as { $read?: boolean }).$read = true; return g; }   // a view value (children) is inserted as structure
      case "el": {
        if (m.tag === "") return this.fragment(m.children, scope, inEl);     // `<>…</>`
        if (/^[A-Z]/.test(m.tag)) {
          const b = scope.lookup(m.tag); if (!b || b.k !== "comp") throw new Error(`unknown component ${m.tag}`);
          const comp = b.decl, home = b.home;
          const props: Record<string, unknown> = {};
          for (const a of m.attrs) Object.defineProperty(props, a.name, { enumerable: true, get: () => this.ev(a.e, scope) });
          Object.defineProperty(props, "children", { enumerable: true, get: () => this.fragment(m.children, scope) });
          return R.createComponent((p: any) => { const s2 = new Scope(home); s2.vars.set(comp.props, { k: "const", value: p }); this.declare(comp.decls, s2); return this.fragment(comp.view, s2); }, props);
        }
        const el = R.createElement(m.tag);
        for (const a of m.attrs) { if (/^on[A-Z:]/.test(a.name)) { const h = untrack(() => { this.imperative++; try { return this.ev(a.e, scope); } finally { this.imperative--; } }); R.setProp(el, a.name, h); } else R.effect(() => this.ev(a.e, scope), v => { R.setProp(el, a.name, v); }); }   // 07 §5: a handler is an imperative closure
        for (const item of (untrack(() => this.fragment(m.children, scope, true)) as unknown[]).flat(Infinity)) { const marker = R.createTextNode(""); R.insertNode(el, marker); R.insert(el, item as never, marker); }
        return el;
      }
      case "mif": {
        const narrowed = m.c.k === "id" ? m.c.name : null;
        return R.createComponent(Show as any, {
          get when() { return self.ev(m.c, scope); },
          get fallback() { const s2 = new Scope(scope); self.declare(m.fDecls, s2); return self.fragment(m.f, s2); },
          children: (item: () => unknown) => { const s2 = new Scope(scope); if (narrowed) s2.vars.set(narrowed, { k: "memo", get: item }); self.declare(m.tDecls, s2); return self.fragment(m.t, s2); },
        });
      }
      case "mfor": {
        return R.createComponent(For as any, {
          get each() { return self.ev(m.xs, scope); },
          children: (item: unknown) => { const s2 = new Scope(scope); s2.vars.set(m.name, { k: "const", value: item }); self.declare(m.decls, s2); return self.fragment(m.body, s2); },
        });
      }
      case "loading": {
        const props: Record<string, unknown> = {
          get fallback() { return self.fragment(m.fallback, scope); },
          get children() { const s2 = new Scope(scope); self.declare(m.decls, s2); return self.fragment(m.body, s2); },
        };
        if (m.on) Object.defineProperty(props, "on", { enumerable: true, get: () => this.ev(m.on!, scope) });
        return R.createComponent(Loading as any, props);
      }
      case "errored": {
        const classes = this.classValues(m.classes, scope);
        const view = (err: () => unknown) => { const s2 = new Scope(scope); if (m.errName) s2.vars.set(m.errName, { k: "memo", get: err }); return self.fragment(m.fallback, s2); };
        const out = R.createComponent(Errored as any, {
          fallback: (err: () => unknown) => {
            if (!classes) return view(err);
            const owner = getOwner(); const ok = createMemo(() => isA(err(), classes)); let shown: unknown = null;
            return new Fallback(() => ok() ? (shown ??= runWithOwner(owner, () => view(err))) : new Forward(err()));
          },
          get children() { const s2 = new Scope(scope); self.declare(m.decls, s2); return self.fragment(m.body, s2); },
        });
        if (!classes) return out;
        return createMemo(() => unwrapFallback(typeof out === "function" ? (out as () => unknown)() : out));   // R-f-4: another class passes to the boundary above (a rethrow from the fallback itself does not recover — ref/oracle/repros/dv7-rethrow.mjs)
      }
    }
  }
}

const raw = (x: any) => (x && typeof x === "object" && x[$TARGET]) ? x[$TARGET].v : x;
const BIN: Record<string, (a: any, b: any) => unknown> = {
  "+": (a, b) => a + b, "-": (a, b) => a - b, "*": (a, b) => a * b, "/": (a, b) => a / b, "%": (a, b) => a % b,
  "==": (a, b) => raw(a) === raw(b), "!=": (a, b) => raw(a) !== raw(b),   // identity through a store is the raw object's (ST-2 keeps identity; Solid wraps)
  "<": (a, b) => a < b, ">": (a, b) => a > b, "<=": (a, b) => a <= b, ">=": (a, b) => a >= b,
};
const BUILTINS: Record<string, unknown> = {
  len: (x: unknown) => (Array.isArray(x) || typeof x === "string") ? x.length : (typeof x === "object" && x) ? Object.keys(x).length : 0,
  str: (x: unknown) => fmt(x),
  map: (xs: unknown[], f: (x: unknown, i: number) => unknown) => xs.map(f),
  filter: (xs: unknown[], f: (x: unknown) => unknown) => xs.filter(f),
  sum: (xs: number[]) => xs.reduce((a, b) => a + b, 0),
  fail: (msg: string) => { throw Object.assign(new Error(msg), { panic: true }); },   // R-f-3: a JS throw — a panic, not in the failure row
  every: (xs: unknown[], f: (x: unknown) => unknown) => xs.every(f),
  fetch: (key: string) => key,
};
export { flush, NotReadyError, resetErrorHalt };
export function resetScopes() { Scope.all = []; }

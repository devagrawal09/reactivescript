// The runtime the compiled modules call (`__rt`). Thin wrappers over solid-js 2.0 that carry the lowering
// decisions the oracle established (ref/oracle/lower.ts): structured sources behind a signal slot (ST-1, ST-2a),
// question sources (ST-5) with an optimistic layer (AC-3), effects with an error arm (E-12) and last-received
// comparison (EF-2), actions as generators (AC-1, AC-7), provisions as context (RG-7), and a string-tree renderer
// for tests. A browser build swaps the renderer's node operations for the DOM's; nothing else changes.
import { createRenderer } from "@solidjs/universal";
import { Show, For, Loading, Errored } from "solid-js";
import {
  createSignal, createMemo, createEffect, createOptimistic, createStore, createProjection, createDeferred,
  flush, untrack, latest, isPending, action, refresh, affects, NotReadyError, createContext, getContext, setContext, getOwner, runWithOwner, $TARGET, createErrorBoundary,
} from "@solidjs/signals";

export { flush };
export type Acc = () => unknown;
export type Writer = { set: (v: unknown) => void; path: (keys: (string | number)[], v: unknown) => void; guess: (v: unknown) => void };
export type Entry = { get?: Acc; w?: Writer; value?: unknown };

// ---------------------------------------------------------------- values
export const ERR = { toString: () => "#error" }; export const PENDING_MARK = { toString: () => "#pending" };
export const fmt = (v: unknown): string => v === ERR ? "#error" : v === PENDING_MARK ? "#pending" : v === undefined ? "undefined" : typeof v === "string" ? v : JSON.stringify(v);
const raw = (x: any) => (x && typeof x === "object" && x[$TARGET]) ? x[$TARGET].v : x;
const isView = (v: unknown): boolean => typeof v === "function" || (Array.isArray(v) && v.every(isView)) || (typeof v === "object" && v !== null && (("kind" in (v as object) && ("tag" in (v as object) || "text" in (v as object))) || "nodeType" in (v as object)));   // string-tree nodes, or DOM nodes

// ---------------------------------------------------------------- failures (R-f; a copy of ref/src/failure.ts — this file is served alone)
type ErrorClass = ((...args: unknown[]) => Error) & { cls: new (...args: unknown[]) => Error; errorClass: string };
function errorClass(name: string, params: string[], message: (...args: unknown[]) => unknown): ErrorClass {
  const C = class extends Error { constructor(...args: unknown[]) { super(""); this.name = name; params.forEach((p, i) => { (this as unknown as Record<string, unknown>)[p] = args[i]; }); this.message = String(untrack(() => message(...args))); } };
  Object.defineProperty(C, "name", { value: name });
  const f = ((...args: unknown[]) => new C(...args)) as ErrorClass; f.cls = C; f.errorClass = name; return f;
}
const isA = (err: unknown, classes: unknown[] | undefined): boolean => !classes || classes.some(c => { const k = (c as { cls?: unknown })?.cls ?? c; return typeof k === "function" && err instanceof (k as new () => unknown); });
/** `e catch (x: C) => alt`, reactive: an error boundary around the read whose fallback is the value (Solid: an errored read
 *  reaches the nearest boundary even inside a JS `try`). The fallback is decided when read, so a change of class re-decides it. */
function catchAcc(f: () => unknown, match: (err: unknown) => boolean, alt: (err: unknown) => unknown): () => unknown {
  const acc = untrack(() => createErrorBoundary(f, (err: () => unknown) => new Fallback(() => { const e0 = err(); return match(e0) ? alt(e0) : new Forward(e0); })));
  return () => unwrapFallback(acc());
}
/** Imperative scope: an ordinary try. */
function tryCatch(f: () => unknown, match: (err: unknown) => boolean, alt: (err: unknown) => unknown): unknown {
  try { return f(); } catch (err) { if (err instanceof NotReadyError || !match(err)) throw err; return alt(err); }
}
class Fallback { get: () => unknown; constructor(g: () => unknown) { this.get = g; } }
function unwrapFallback(v0: unknown): unknown { let v = v0; if (v instanceof Fallback) v = v.get(); if (v instanceof Forward) throw (v as Forward).err; return v; }
const NO_PROVISION: Entry = {};
class Forward { err: unknown; constructor(e: unknown) { this.err = e; } }

// ---------------------------------------------------------------- flights (the scenario harness's async)
/** A controllable flight: an async iterable (a stream — each resolve is a landing) that actions await through `first`. */
export class Flight {
  key: string; first: Promise<unknown>; private settleFirst!: (v: unknown) => void; private rejectFirst!: (e: unknown) => void;
  private queue: { v?: unknown; e?: unknown }[] = []; private waiters: ((x: { v?: unknown; e?: unknown }) => void)[] = []; private started = false;
  constructor(key: string) { this.key = key; this.first = new Promise((r, j) => { this.settleFirst = r; this.rejectFirst = j; }); this.first.catch(() => {}); }
  private push(x: { v?: unknown; e?: unknown }) { const w = this.waiters.shift(); if (w) w(x); else this.queue.push(x); }
  resolve(v: unknown) { if (!this.started) { this.started = true; this.settleFirst(v); } this.push({ v }); }
  reject(e: unknown) { if (!this.started) { this.started = true; this.rejectFirst(e); } this.push({ e }); }
  [Symbol.asyncIterator]() {
    const next = (): Promise<IteratorResult<unknown>> => new Promise((res, rej) => { const take = (x: { v?: unknown; e?: unknown }) => { if ("e" in x) rej(x.e); else res({ value: x.v, done: false }); }; const q = this.queue.shift(); if (q) take(q); else this.waiters.push(take); });
    return { next, return: async () => ({ value: undefined, done: true as const }) };
  }
}

// ---------------------------------------------------------------- string-tree renderer
type N = { kind: "el"; tag: string; children: N[]; parent?: N; props: Record<string, unknown> } | { kind: "text"; text: string; parent?: N };
const stringNodes = {
  createElement: tag => ({ kind: "el", tag, children: [], props: {} }),
  createTextNode: text => ({ kind: "text", text }),
  replaceText: (n, v) => { (n as Extract<N, { kind: "text" }>).text = v; },
  isTextNode: n => n.kind === "text",
  setProperty: (n, k, v) => { if (n.kind === "el") n.props[k] = v; },
  insertNode: (p, n, anchor) => { if (p.kind !== "el") return; if (n.parent) { const q = n.parent as Extract<N, { kind: "el" }>; const j = q.children.indexOf(n); if (j >= 0) q.children.splice(j, 1); } const i = anchor ? p.children.indexOf(anchor) : -1; if (i < 0) p.children.push(n); else p.children.splice(i, 0, n); n.parent = p; },
  removeNode: (p, n) => { if (p.kind !== "el") return; const i = p.children.indexOf(n); if (i >= 0) p.children.splice(i, 1); n.parent = undefined; },
  getParentNode: n => n.parent,
  getFirstChild: n => (n.kind === "el" ? n.children[0] : undefined),
  getNextSibling: (n: N) => { const p = n.parent; if (!p || p.kind !== "el") return undefined; return p.children[p.children.indexOf(n) + 1]; },
};
/** The DOM's node operations, for a browser build. Event attributes (`onClick`) become listeners; `value`/`checked`/`disabled` are properties. */
export const domNodes = (document: any) => ({
  createElement: (tag: string) => document.createElement(tag),
  createTextNode: (t: string) => document.createTextNode(t),
  replaceText: (n: any, v: string) => { n.data = v; },
  isTextNode: (n: any) => n.nodeType === 3,
  setProperty(n: any, k: string, v: unknown, prev?: unknown) {
    if (/^on[A-Z]/.test(k)) { const ev = k.slice(2).toLowerCase(); if (prev) n.removeEventListener(ev, prev); if (v) n.addEventListener(ev, v); return; }
    if (k === "class") n.className = v ?? "";
    else if (k === "value" || k === "checked" || k === "disabled") n[k] = k === "value" ? (v ?? "") : !!v;
    else if (v === false || v == null) n.removeAttribute(k); else n.setAttribute(k, v === true ? "" : String(v));
  },
  insertNode: (p: any, n: any, a?: any) => p.insertBefore(n, a ?? null),
  removeNode: (p: any, n: any) => p.removeChild(n),
  getParentNode: (n: any) => n.parentNode ?? undefined,
  getFirstChild: (n: any) => n.firstChild ?? undefined,
  getNextSibling: (n: any) => n.nextSibling ?? undefined,
});
const serialize = (n: N): string => n.kind === "text" ? n.text : n.children.map(serialize).join("");

// ---------------------------------------------------------------- one app instance
export function createApp(opts: { nodes?: Record<string, any>; root?: any; api?: Record<string, (...a: any[]) => unknown> } = {}) {
  const R = createRenderer<any>((opts.nodes ?? stringNodes) as any);
  const flights = new Map<string, Flight>();
  const lastKey = new Map<string, string>();
  const registry = new Map<string, Entry[]>();
  const contexts = new Map<string, ReturnType<typeof createContext<Entry | undefined>>>();
  const storeAccs = new WeakSet<object>();
  const modules = new Map<string, Record<string, unknown>>();
  const log: string[] = [];
  let currentEq: string | null = null;
  type Ctx = { name: string; ctx: ReturnType<typeof createContext<Entry | undefined>>; dflt: (() => unknown) | null; owner: ReturnType<typeof getOwner>; dv: Entry | null };
  const flight = (key: string) => { let f = flights.get(key); if (!f) { f = new Flight(key); flights.set(key, f); } if (currentEq) lastKey.set(currentEq, key); return f; };
  const named = <T extends (...a: any[]) => unknown>(name: string | null, fn: T): T => (name ? ((...a: unknown[]) => { const was = currentEq; currentEq = name; try { return fn(...a); } finally { currentEq = was; } }) as T : fn);

  const app = {
    root: (opts.root ?? { kind: "el", tag: "root", children: [], props: {} }) as any,
    log, flights, lastKey, asyncError: null as unknown,
    frame: () => opts.root ? String(opts.root.textContent) : serialize(app.root),
    mount(view: () => unknown) { return R.render(view as never, app.root); },

    // the prelude: what `import pure { … } from "./prelude"` and the built-in names refer to
    B: {
      len: (x: unknown) => (Array.isArray(x) || typeof x === "string") ? x.length : (typeof x === "object" && x) ? Object.keys(x).length : 0,
      str: (x: unknown) => fmt(x),
      map: (xs: unknown[], f: (x: unknown, i: number) => unknown) => xs.map(f),
      filter: (xs: unknown[], f: (x: unknown) => unknown) => xs.filter(f),
      sum: (xs: number[]) => xs.reduce((a, b) => a + b, 0),
      every: (xs: unknown[], f: (x: unknown) => unknown) => xs.every(f),
      fail: (msg: string) => { throw Object.assign(new Error(msg), { panic: true }); },   // R-f-3: a JS throw — a panic, not in the failure row
      fetch: (key: string) => opts.api?.fetch ? opts.api.fetch(key) : flight(String(key)),
      log: (...a: unknown[]) => { log.push(`log(${a.map(fmt).join(", ")})`); },
    } as Record<string, any>,
    /** `import pure { f } from "./api"`: every function is a flight keyed by its name and formatted arguments. */
    api: (name: string) => opts.api ? (opts.api[name] ?? (() => { throw new Error(`./api has no ${name}`); })) : (...a: unknown[]) => flight(`${name}:${a.map(fmt).join(",")}`),

    // ---- the scenario harness's view of names (handler rows reach any live binding by name) ----
    reg(name: string, e: Entry) { let l = registry.get(name); if (!l) registry.set(name, (l = [])); l.push(e); },
    lookup(name: string): Entry { const l = registry.get(name); if (!l?.length) throw new Error(`unbound ${name}`); for (let i = l.length - 1; i >= 0; i--) if (l[i].w) return l[i]; return l[l.length - 1]; },
    dget(name: string) { const e = app.lookup(name); return e.get ? app.snap(e.get) : e.value; },
    dset(name: string, keys: (string | number)[], v: unknown, guess = false) { const w = app.lookup(name).w; if (!w) throw new Error(`W-1: write to non-source ${name}`); if (guess) w.guess(v); else if (keys.length) w.path(keys, v); else w.set(v); },

    // ---- declarations ----
    /** `source x := e`: atomic → a signal; structured → a store behind a signal slot, so the root can be replaced (ST-1, ST-2a). */
    source(name: string, init: unknown): [Acc, Writer] {
      void name;
      if (typeof init === "object" && init !== null) {
        const [store, setStore] = createStore(init as any); const [get, set] = createSignal<unknown>(store);
        const w: Writer = {
          set: v => { if (typeof v === "function") { setStore(v as any); set(store); } else if (typeof v === "object" && v !== null) { setStore(() => v as any); set(store); } else set(v); },
          path: (keys, v) => setStore((d: any) => { let o = d; for (const k of keys.slice(0, -1)) o = o[k]; o[keys[keys.length - 1]] = v; }),
          guess: () => { throw new Error("OPTIMISTIC_NO_QUESTION"); },
        };
        return [get, w];
      }
      const [get, set] = createSignal(init);
      return [get, { set: set as (v: unknown) => void, path: () => { throw new Error("a path write to an atomic source"); }, guess: () => { throw new Error("OPTIMISTIC_NO_QUESTION"); } }];
    },
    /** `source x = e` (ST-5): createSignal(fn); with a guess written to it, a createOptimistic layer over that truth (AC-3);
     *  written or probed by path, createStore(fn, {}) whose derive writes its draft. */
    qsource(name: string, compute: (prev: unknown) => unknown, opts: { loadingValue?: unknown } | undefined, mode: { optimistic: boolean; structured: boolean }): [Acc, Writer] {
      const fn = named(name, compute);
      if (mode.optimistic) {
        const [truth, setTruth] = createSignal(fn as any, opts as any);
        const [get, setGuess] = createOptimistic(() => truth());
        return [get, { set: setTruth as any, path: () => { throw new Error("optimistic path writes are not lowered yet"); }, guess: setGuess as any }];
      }
      if (mode.structured) {
        const [store, setStore] = (createStore as any)(async (draft: Record<string, unknown>) => { const r = fn(draft); const v = r instanceof Flight ? await r.first : await r; if (v && typeof v === "object") { for (const k of Object.keys(draft)) if (!(k in (v as object))) delete draft[k]; Object.assign(draft, v); } }, {});
        const get = () => store; storeAccs.add(get);
        return [get, { set: () => { throw new Error("a root write to a derived store is not lowered yet"); }, path: (keys, v) => setStore((d: any) => { let o = d; for (const k of keys.slice(0, -1)) o = o[k]; o[keys[keys.length - 1]] = v; }), guess: () => { throw new Error("optimistic over a structured question source is not lowered yet"); } }];
      }
      const [get, set] = createSignal(fn as any, opts as any);
      return [get, { set: set as any, path: () => { throw new Error("a path write to an atomic source"); }, guess: () => { throw new Error("OPTIMISTIC_NO_QUESTION"); } }];
    },
    memo: (name: string | null, fn: (prev: unknown) => unknown, opts?: { loadingValue?: unknown }): Acc => createMemo(named(name, fn) as any, opts as any) as Acc,
    deferred: (name: string, fn: (prev: unknown) => unknown, opts?: { loadingValue?: unknown }): Acc => createDeferred(named(name, fn) as any, opts as any) as Acc,
    /** `x key k = e` (ST-4): a keyed projection. */
    keyed: (name: string, key: string, fn: () => unknown): Acc => { const p = createProjection(named(name, () => fn()) as any, [] as any, { key } as any); return () => p; },
    /** `x = draft(pre x -> seed) { … }` (ST-3). */
    draft: (seed: unknown, body: (d: any) => void): Acc => { const p = createProjection(body as any, seed as any); return () => p; },
    /** `pre y` of another node (C-2): a companion memo carrying (current, previous), owned where `y` is declared. */
    prevOf: (get: Acc): Acc => { const m = createMemo((st: any) => ({ cur: get(), prev: st ? st.cur : undefined })); return () => (m() as { prev: unknown }).prev; },
    lv: (f: () => unknown) => ({ loadingValue: untrack(f) }),
    /** `effect (…) { … }`: compute, then apply; an error is an answer the apply receives (E-12); fires on a differing value (EF-2). */
    effect(n: number, inputs: () => unknown[], apply: (p: unknown[]) => unknown) {
      const run = (vals: unknown[]) => { const r = apply(vals); return typeof r === "function" ? (r as () => void) : undefined; };
      let last: unknown[] | null = null;
      createEffect(inputs as any, { effect: (vals: unknown[]) => { if (last && last.length === vals.length && vals.every((v, i) => Object.is(v, last![i]))) return; last = vals; return run(vals); }, error: () => { last = null; return run(Array.from({ length: n }, () => ERR)); } } as any);
    },
    /** `action f(…) { … }` (AC-1): a generator; a statement-level `await` is a hold-safe yield. */
    action(gen: (...a: unknown[]) => Generator<unknown, unknown, unknown>) {
      const run = action(gen as any) as (...a: unknown[]) => Promise<unknown>;
      return (...a: unknown[]) => { const p = run(...a); p.catch(e => { app.asyncError = e; }); return p; };
    },
    aw: (v: unknown) => v instanceof Flight ? v.first : v,
    refresh(name: string, get: Acc) { const key = lastKey.get(name); if (key) flights.delete(key); refresh((storeAccs.has(get) ? get() : get) as any); },
    affects: (get: Acc) => affects(get as any),
    orInit: (v: unknown, init: () => unknown) => v === undefined ? init() : v,

    // ---- modules (09 MO-1): a dependency's factory runs once per app; its exports are shared by every importer ----
    module(key: string, factory: (rt: unknown) => Record<string, unknown>) { let m = modules.get(key); if (!m) { m = factory(app); modules.set(key, m); } return m; },
    // ---- context (RG-7) ----
    owner: () => getOwner(),
    /** `context x: T = d` (RG-7): the declaration is the identity; `d`, if any, is evaluated once, owned where it is declared. */
    context(name: string, dflt: (() => unknown) | null): Ctx { return { name, ctx: createContext<Entry | undefined>(NO_PROVISION, name), dflt, owner: getOwner(), dv: null }; },   // a sentinel default: absence is ours to decide
    provide(c: Ctx, e: Entry) { setContext(c.ctx, e); },
    use(c: Ctx, owner: ReturnType<typeof getOwner>): Entry {
      const e = getContext(c.ctx, owner ?? undefined); if (e && e !== NO_PROVISION) return e;
      if (c.dflt) { const d = c.dflt; return c.dv ??= { get: runWithOwner(c.owner, () => createMemo(d as any)) as Acc }; }
      throw new Error(`RG-7b: no provision for ${c.name}`);
    },
    useGet(c: Ctx, owner: ReturnType<typeof getOwner>) { const e = app.use(c, owner); return e.get ? e.get() : e.value; },
    runWithOwner,

    // ---- reads ----
    /** An imperative read sees σ (H-10): a pending value is a value; a snapshot of an error throws it (R-f-7). */
    snap(get: Acc) { try { return untrack(get); } catch (e) { if (e instanceof NotReadyError) return PENDING_MARK; throw e; } },
    // ---- failures (R-f) ----
    errorClass, isA, catchAcc, tryCatch, caughtRead: (f: () => unknown, match: (err: unknown) => boolean, alt: (err: unknown) => unknown) => catchAcc(f, match, alt)(),
    raise: (e: unknown): never => { throw e; },
    eq: (a: unknown, b: unknown) => raw(a) === raw(b),
    untrack, latest: (f: () => unknown) => latest(f as any), isPending: (f: () => unknown) => isPending(f as any),
    fmt,

    // ---- views ----
    text: (s: string) => R.createTextNode(s),
    read: (f: () => unknown) => () => { const v = f(); return isView(v) ? v : fmt(v); },
    el(tag: string, attrs: [string, () => unknown, boolean][], kids: () => unknown) {
      const el = R.createElement(tag);
      for (const [name, f, handler] of attrs) { if (handler) R.setProp(el, name, untrack(f)); else R.effect(f, v => { R.setProp(el, name, v); }); }
      R.insert(el, kids);
      return el;
    },
    comp: (C: (p: any) => unknown, props: Record<string, unknown>) => R.createComponent(C as any, props),
    when: (cond: () => unknown, t: (item: Acc) => unknown, f: () => unknown) => R.createComponent(Show as any, { get when() { return cond(); }, get fallback() { return f(); }, children: t }),
    each: (xs: () => unknown, body: (item: unknown) => unknown) => R.createComponent(For as any, { get each() { return xs(); }, children: body }),
    loading(on: (() => unknown) | null, fallback: () => unknown, body: () => unknown) {
      const props: Record<string, unknown> = { get fallback() { return fallback(); }, get children() { return body(); } };
      if (on) Object.defineProperty(props, "on", { enumerable: true, get: on });
      return R.createComponent(Loading as any, props);
    },
    /** `errored fallback(e: A | B)`: a failure of another class passes to the boundary above (R-f-4) — the fallback hands it out
     *  and a wrapper throws it there (a rethrow from the fallback itself does not recover: ref/oracle/repros/dv7-rethrow.mjs). */
    errored(fallback: (err: Acc) => unknown, body: () => unknown, classes?: unknown[]) {
      const out = R.createComponent(Errored as any, {
        fallback: (err: Acc) => {
          if (!classes) return fallback(err);
          const owner = getOwner(); const ok = createMemo(() => isA(err(), classes)); let shown: unknown = null;
          return new Fallback(() => ok() ? (shown ??= runWithOwner(owner, () => fallback(err))) : new Forward(err()));
        },
        get children() { return body(); },
      });
      if (!classes) return out;
      return createMemo(() => unwrapFallback(typeof out === "function" ? (out as Acc)() : out));
    },
  };
  return app;
}
export type App = ReturnType<typeof createApp>;

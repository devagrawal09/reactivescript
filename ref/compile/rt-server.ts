// The server runtime (10-server): the same `__rt` API the compiled modules call (ref/compile/rt.ts), over solid-js 2.0's
// server build. What runs on the server is what the mount needs — equations, source initializers, awaits, the view —
// and nothing an instant after it would (SV-2): effects, actions and handlers do not run. The view renders to HTML
// that `renderToStream` streams, a boundary at a time. Every call mirrors rt-web.ts's (the browser runtime): the same
// solid-js primitives in the same order, so each owner, element and hole takes the id the client will look for (SV-3). A failure of a declared class (R-f-1, MO-8) is marked safe and goes
// to the client as it is; anything else that reaches a boundary — a panic, or a JS rejection of plain `Error` — goes as
// Solid's generic error (SV-5).
import { Show, For, Loading, Errored, createComponent, createSignal, createMemo, createEffect, createOptimistic, createStore, createProjection, createDeferred, untrack, latest, isPending, NotReadyError, getOwner, runWithOwner, getNextChildId, runInServerComponentScope } from "solid-js";
import { ssr, escape, renderToStream, markSafeError, generateHydrationScript, ssrHydrationKey, memo, scope as ssrScope } from "@solidjs/web";

export type Acc = () => unknown;
export type Writer = { set: (v: unknown) => void; path: (keys: (string | number)[], v: unknown) => void; guess: (v: unknown) => void };
export type Entry = { get?: Acc; w?: Writer; value?: unknown };
export { generateHydrationScript };

// ---------------------------------------------------------------- values (as rt.ts)
export const ERR = { toString: () => "#error" }; export const PENDING_MARK = { toString: () => "#pending" };
export const fmt = (v: unknown): string => v === ERR ? "#error" : v === PENDING_MARK ? "#pending" : v === undefined ? "undefined" : typeof v === "string" ? v : JSON.stringify(v);
const isView = (v: unknown): boolean => typeof v === "function" || (Array.isArray(v) && v.every(x => x == null || isView(x))) || (typeof v === "object" && v !== null && "t" in (v as object));   // ssr() results, text constants, readers
/** Take the ids a client-side owner the server has no counterpart for would take (rt-web.ts creates it; the server need not). */
const reserve = (n = 1) => { const o = getOwner() as any; if (o?.id != null) for (let i = 0; i < n; i++) getNextChildId(o); };
const onServer = (what: string) => () => { throw new Error(`SV-2: ${what} does not run on the server`); };

// ---------------------------------------------------------------- failures (R-f; SV-5: a failure is safe to send)
type ErrorClass = ((...args: unknown[]) => Error) & { cls: new (...args: unknown[]) => Error; errorClass: string };
function errorClass(name: string, params: string[], message: (...args: unknown[]) => unknown, id?: string): ErrorClass {
  const C = class extends Error { constructor(...args: unknown[]) { super(""); this.name = name; params.forEach((p, i) => { (this as unknown as Record<string, unknown>)[p] = args[i]; }); this.message = String(untrack(() => message(...args))); if (id) (this as unknown as { $class: string }).$class = id; markSafeError(this); } };
  Object.defineProperty(C, "name", { value: name });
  const f = ((...args: unknown[]) => new C(...args)) as ErrorClass; f.cls = C; f.errorClass = name; (f as { $class?: string }).$class = id; return f;
}
const PANIC = { panic: true } as const;
const isA = (err: unknown, classes: unknown[] | undefined): boolean => !classes || classes.includes(PANIC) || classes.some(c => { const k = (c as { cls?: unknown })?.cls ?? c; return typeof k === "function" && err instanceof (k as new () => unknown); });
/** The server renders once: an errored read throws where it is read, so a catch is an ordinary try around the read. (The
 *  client's is an error boundary: its ids are reserved.) */
function catchAcc(f: () => unknown, match: (err: unknown) => boolean, alt: (err: unknown) => unknown): () => unknown {
  reserve(2);   // a client error boundary takes two ids
  return () => { try { return f(); } catch (err) { if (err instanceof NotReadyError || !match(err)) throw err; return alt(err); } };
}
function tryCatch(f: () => unknown, match: (err: unknown) => boolean, alt: (err: unknown) => unknown): unknown {
  try { return f(); } catch (err) { if (err instanceof NotReadyError || !match(err)) throw err; return alt(err); }
}

// ---------------------------------------------------------------- flights (the harness's async)
/** As rt.ts's Flight. A rejection is sent as it is only when its class is declared (SV-5): `errorClass` marks those. */
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

// ---------------------------------------------------------------- one request (SV-4: module state is per request)
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
type Owner = ReturnType<typeof getOwner>;
type Ctx = { name: string; id: symbol; dflt: (() => unknown) | null; owner: Owner; dv: Entry | null };

export function createApp(opts: { api?: Record<string, (...a: any[]) => unknown> } = {}) {
  const flights = new Map<string, Flight>();
  const lastKey = new Map<string, string>();
  const registry = new Map<string, Entry[]>();
  const modules = new Map<string, Record<string, unknown>>();
  const log: string[] = [];
  const declared: unknown[] = [];
  let currentEq: string | null = null; let classSeq = 0;
  const flight = (key: string) => { let f = flights.get(key); if (!f) { f = new Flight(key); flights.set(key, f); } if (currentEq) lastKey.set(currentEq, key); return f; };
  const named = <T extends (...a: any[]) => unknown>(name: string | null, fn: T): T => (name ? ((...a: unknown[]) => { const was = currentEq; currentEq = name; try { return fn(...a); } finally { currentEq = was; } }) as T : fn);
  const ro = (get: Acc): [Acc, Writer] => [get, { set: onServer("a write"), path: onServer("a write"), guess: onServer("a write") }];

  const app = {
    log, flights, lastKey, asyncError: null as unknown,
    /** Render `view` as a stream: `write` receives each chunk, `end` the close. */
    stream(view: () => unknown, sink: { write: (s: string) => void; end: () => void }) { return renderToStream((process.env.SV_SCOPE ? () => runInServerComponentScope(view) : view) as never).pipe(sink as never); },

    B: {
      len: (x: unknown) => (Array.isArray(x) || typeof x === "string") ? x.length : (typeof x === "object" && x) ? Object.keys(x).length : 0,
      str: (x: unknown) => fmt(x),
      map: (xs: unknown[], f: (x: unknown, i: number) => unknown) => xs.map(f),
      filter: (xs: unknown[], f: (x: unknown) => unknown) => xs.filter(f),
      sum: (xs: number[]) => xs.reduce((a, b) => a + b, 0),
      every: (xs: unknown[], f: (x: unknown) => unknown) => xs.every(f),
      fail: (msg: string) => { throw Object.assign(new Error(msg), { panic: true }); },
      fetch: (key: string) => opts.api?.fetch ? opts.api.fetch(key) : flight(String(key)),
      log: (...a: unknown[]) => { log.push(`log(${a.map(fmt).join(", ")})`); },
    } as Record<string, any>,
    /** MO-8: a class a `.d.rx` declares — a failure the server sends as it is (SV-5). */
    jsError(name: string) { const C = (opts.api?.[name] as unknown) ?? errorClass(name, ["message"], (m?: unknown) => m ?? name, `${name}#${classSeq++}`); declared.push(C); return C; },
    /** A JS function's promise: a rejection with a declared class is marked safe to send; any other is redacted (SV-5). */
    api: (name: string) => {
      if (!opts.api) return (...a: unknown[]) => flight(`${name}:${a.map(fmt).join(",")}`);
      const f = opts.api[name] ?? (() => { throw new Error(`./api has no ${name}`); });
      return (...a: unknown[]) => { const r = f(...a); return r && typeof (r as PromiseLike<unknown>).then === "function" ? Promise.resolve(r).catch(e => { if (isA(e, declared)) markSafeError(e); throw e; }) : r; };
    },

    reg(name: string, e: Entry) { let l = registry.get(name); if (!l) registry.set(name, (l = [])); l.push(e); },
    dget(name: string) { const e = app.lookup(name); return e.get ? app.snap(e.get) : e.value; },
    lookup(name: string): Entry { const l = registry.get(name); if (!l?.length) throw new Error(`unbound ${name}`); return l[l.length - 1]; },

    // ---- declarations: the same primitives, from the server build. Writes do not happen on the server (SV-2). ----
    source(name: string, init: unknown): [Acc, Writer] {
      void name;
      if (typeof init === "object" && init !== null) { const [store] = createStore(init as any); const [get] = createSignal<unknown>(store); return ro(get as Acc); }
      const [get] = createSignal(init); return ro(get as Acc);
    },
    qsource(name: string, compute: (prev: unknown) => unknown, o: { loadingValue?: unknown } | undefined, mode: { optimistic: boolean; structured: boolean }): [Acc, Writer] {
      const fn = named(name, compute);
      if (mode.optimistic) { const [truth] = createSignal(fn as any, o as any); const [get] = createOptimistic(() => (truth as Acc)()); return ro(get as Acc); }
      if (mode.structured) {
        const [store] = (createStore as any)(async (draft: Record<string, unknown>) => { const r = fn(draft); const v = r instanceof Flight ? await r.first : await r; if (v && typeof v === "object") { for (const k of Object.keys(draft)) if (!(k in (v as object))) delete draft[k]; Object.assign(draft, v); } }, {});
        return ro(() => store);
      }
      const [get] = createSignal(fn as any, o as any); return ro(get as Acc);
    },
    memo: (name: string | null, fn: (prev: unknown) => unknown, o?: { loadingValue?: unknown }): Acc => createMemo(named(name, fn) as any, o as any) as Acc,
    deferred: (name: string, fn: (prev: unknown) => unknown, o?: { loadingValue?: unknown }): Acc => createDeferred(named(name, fn) as any, o as any) as Acc,
    keyed: (name: string, key: string, fn: () => unknown): Acc => { const src = createMemo(named(name, () => fn()) as any); const p = createProjection(() => (src as Acc)() as any, [] as any, { key } as any); return () => p; },
    draft: (seed: unknown, body: (d: any) => void): Acc => { const p = createProjection(body as any, seed as any); return () => p; },
    prevOf: (get: Acc): Acc => { const m = createMemo((st: any) => ({ cur: get(), prev: st ? st.cur : undefined })); return () => (m() as { prev: unknown }).prev; },
    lv: (f: () => unknown) => ({ loadingValue: untrack(f) }),
    /** SV-2: the apply half runs on the client, after hydration. The compute half is reactive scope — Solid's server runs it;
     *  an input's failure is an answer (E-12), not a server error. */
    effect(_n: number, inputs: () => unknown[], _apply: (p: unknown[]) => unknown) {
      createEffect((() => { try { return inputs(); } catch (e) { if (e instanceof NotReadyError) throw e; return ERR; } }) as any, { effect() {}, error() {} } as any);
    },
    action(_gen: (...a: unknown[]) => Generator<unknown, unknown, unknown>) { return onServer("an action"); },
    aw: (v: unknown) => v instanceof Flight ? v.first : v,
    hoisted(_name: string, _get: Acc) {},
    refresh: onServer("refresh"),
    affects: onServer("affects"),
    orInit: (v: unknown, init: () => unknown) => v === undefined ? init() : v,

    module(key: string, factory: (rt: unknown) => Record<string, unknown>) { let m = modules.get(key); if (!m) { m = factory(app); modules.set(key, m); } return m; },
    // ---- context (RG-7): the server build's owner context, keyed by the declaration ----
    owner: () => getOwner(),
    context(name: string, dflt: (() => unknown) | null): Ctx { return { name, id: Symbol(name), dflt, owner: getOwner(), dv: dflt ? { get: createMemo(dflt as any) as Acc } : null }; },
    provide(c: Ctx, e: Entry) { const o = getOwner() as any; o._context = { ...o._context, [c.id]: e }; },
    use(c: Ctx, owner: Owner): Entry {
      const e = ((owner ?? getOwner()) as any)?._context?.[c.id]; if (e) return e;
      if (c.dv) return c.dv;
      throw new Error(`RG-7b: no provision for ${c.name}`);
    },
    useGet(c: Ctx, owner: Owner) { const e = app.use(c, owner); return e.get ? e.get() : e.value; },
    runWithOwner,

    snap(get: Acc) { try { return untrack(get); } catch (e) { if (e instanceof NotReadyError) return PENDING_MARK; throw e; } },
    errorClass: (name: string, params: string[], message: (...args: unknown[]) => unknown) => errorClass(name, params, message, `${name}#${classSeq++}`),   // a declaration's identity, sent with its failures (SV-5a)
    isA, PANIC, catchAcc, tryCatch, caughtRead: (f: () => unknown, match: (err: unknown) => boolean, alt: (err: unknown) => unknown) => catchAcc(f, match, alt)(),
    raise: (e: unknown): never => { throw e; },
    eq: (a: unknown, b: unknown) => a === b,
    untrack, latest: (f: () => unknown) => latest(f as any), isPending: (f: () => unknown) => isPending(f as any),
    fmt,

    // ---- views, as HTML (as Solid's compiled SSR output; each call mirrors rt-web.ts's) ----
    text: (s: string) => { const t = escape(s); const f = () => t; (f as any).$text = true; return f; },
    read: (f: () => unknown) => { const g = () => { const v = f(); return isView(v) ? v : escape(fmt(v)); }; (g as { $read?: boolean }).$read = true; return g; },
    frag: (items: unknown[]): unknown[] => items.map(x => (x as { $read?: boolean })?.$read ? memo(x as Acc) : x),
    /** An element: its hydration key, then its children (built now, as the client builds them), each in a marker region. */
    el(tag: string, attrs: [string, () => unknown, boolean][], kids: () => unknown) {
      const hk = ssrHydrationKey();
      const items = (VOID.has(tag) ? [] : (untrack(kids) as unknown[]).flat(Infinity)).map(x => (x as { $read?: boolean })?.$read ? ssrScope(x as Acc) : x);
      const a = () => {
        let s = "";
        for (const [name, f, handler] of attrs) {
          if (handler) continue;                                  // a handler is attached at hydration
          const v = f(); if (v === false || v == null) continue;
          s += v === true ? ` ${name}` : ` ${name}="${escape(String(v), true)}"`;
        }
        return { t: s };
      };
      if (VOID.has(tag)) return ssr([`<${tag}`, "", ">"], hk, a);
      const t = [`<${tag}`, "", ">"]; for (let i = 0; i < items.length; i++) { t[t.length - 1] += "<!--$-->"; t.push("<!--/-->"); } t[t.length - 1] += `</${tag}>`;
      return ssr(t, hk, a, ...items);
    },
    comp: (C: (p: any) => unknown, props: Record<string, unknown>) => createComponent(C as any, props),
    when: (cond: () => unknown, t: (item: Acc) => unknown, f: () => unknown) => createComponent(Show as any, { get when() { return cond(); }, get fallback() { return f(); }, children: t }),
    each: (xs: () => unknown, body: (item: unknown) => unknown) => createComponent(For as any, { get each() { return xs(); }, children: body }),
    loading(on: (() => unknown) | null, fallback: () => unknown, body: () => unknown) {
      const props: Record<string, unknown> = { get fallback() { return fallback(); }, get children() { return body(); } };
      if (on) Object.defineProperty(props, "on", { enumerable: true, get: on });
      return createComponent(Loading as any, props);
    },
    /** A failure of another class passes to the boundary above (R-f-4): on the server, a rethrow from the fallback. */
    errored(fallback: (err: Acc) => unknown, body: () => unknown, classes?: unknown[]) {
      const out = createComponent(Errored as any, {
        fallback: (err: Acc) => { if (!classes) return fallback(err); const ok = createMemo(() => isA(err(), classes)); if (!ok()) throw err(); return fallback(err); },
        get children() { return body(); },
      });
      if (classes) reserve();   // the client's unwrapping memo
      return out;
    },
  };
  return app;
}
export type ServerApp = ReturnType<typeof createApp>;

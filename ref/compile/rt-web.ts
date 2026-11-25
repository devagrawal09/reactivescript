// The browser runtime (10-server SV-3): the `__rt` API of ref/compile/rt.ts over solid-js's DOM build, so a compiled
// program can mount on a page — or hydrate one the server runtime (rt-server.ts) streamed. Views are JSX that Solid's
// compiler lowers (compile/jsx.ts, generate "dom", hydratable); what remains here is the reactive lowering, which must
// create the same owners in the same order as rt-server.ts so each takes the same hydration id on both sides.
import { primsSolid } from "./prims-solid.ts";
import { actionInput } from "./action-input.ts";
import { Portal as WebPortal } from "@solidjs/web";
import { getObserver } from "solid-js";
import {
  createSignal, createMemo, createEffect, createOptimistic, createOptimisticStore, createStore, createProjection, createDeferred, createErrorBoundary, createContext,
  Show, For, Loading, Errored, createComponent,
  flush, untrack, latest, isPending, action, refresh, affects, until, onSettled, onFlush, onCleanup, createRenderEffect, createRoot, NotReadyError, getOwner, runWithOwner, sharedConfig, omit, DEV, OBSERVE,
} from "solid-js";
import { getContext, setContext, $REFRESH, $TARGET } from "@solidjs/signals";
import { hydrate, render } from "@solidjs/web";

// Inlined at each use by runtime/build.mjs. The raw reference runtime retains its test API.
const RX_INSTRUMENT = !!DEV;
const RX_HARNESS = true;

// 05 H-9 / Solid D-23: `isPending(fn)` judges the reads fn makes, never its return value, so `pending? x` over a structured
// value (a store, a keyed projection) reads its keys — Solid's "whole-store questions are asked through reads"
const readWhole = (v: unknown) => { if (v !== null && typeof v === "object") Reflect.ownKeys(v); return v; };
/** `latest x` (R-12) of a store is its whole value, read inside `latest` and handed out as a snapshot: a later read of a
 *  field outside `latest` would be a tracked read of the store (found by desk9-rx-7: `len(latest rows)` held a `loading on`). */
/** A store's whole value, copied by reading through the store (so a guess still in flight shows, as R-12 asks of
 *  `latest`); Solid's `deep(v)` serves the landed frame and would drop the guess (found by desk9-rx-7). */
const readCopy = (v: unknown): unknown => v === null || typeof v !== "object" ? v : Array.isArray(v) ? v.map(readCopy) : Object.fromEntries(Object.keys(v).map(k => [k, readCopy((v as any)[k])]));
const latestWhole = (v: unknown) => v !== null && typeof v === "object" && (v as any)[$TARGET] !== undefined ? readCopy(v) : v;
/** EF-2: effect inputs compare as values: arrays and plain objects (a store's snapshot) by their contents. */
const sameInput = (a: unknown, b: unknown): boolean => {
  if (Object.is(a, b)) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  const pa = Object.getPrototypeOf(a), plain = (p: unknown) => p === Object.prototype || p === null || p === Array.prototype;
  if (pa !== Object.getPrototypeOf(b) || !plain(pa)) return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every(k => Object.prototype.hasOwnProperty.call(b, k) && sameInput((a as any)[k], (b as any)[k]));
};
export { flush };

// ---------------------------------------------------------------- identity (11 CP-4b `key`, dev builds)
/** The key of the declaration whose nodes are being created (`__rt.key`), or null: each Solid primitive a helper creates
 *  while one is current is named `rx:` + key; with none, its options are as they were. Against Solid's production build
 *  (no `DEV`) both are the identity, and a bundler drops the names with them. */
let rxKey: string | null = null;
type Carry = { value: unknown; keepAnswer?: boolean; instance?: string };
let consumedCarry: { replaces?: string; carryStatus: string } | undefined;
type CarryGroup = { entries: Carry[]; used: number };
type DeferredCarries = Map<string, { path: string; value: Carry; used?: () => void }>;
let instanceId = 0;
let rxInstance: string | undefined;
type Inspect = (<T>(format: (value: unknown) => T) => { value?: T; error?: unknown; pending?: boolean; held?: boolean }) & {
  instance?: string; ownerPath?: string[];
  hmrValue?: () => { value?: unknown; held?: boolean };
  source?: boolean;
};
type BoundaryState = { state: "ok" | "fallback" | "error"; error?: unknown };
type DevEvent = { type: "boundary"; region: string } | { type: "dispose" | "write" | "node"; key: string; instance?: string; run?: number; origin?: string } | { type: "run"; key: string; id: number; ownerPath?: string[]; state: "start" | "end" | "error"; args?: unknown[]; error?: unknown } | { type: "caught"; key: string; id: number; site: number; class: string };
const dev = globalThis as typeof globalThis & {
  __RX_NODES__?: Map<string, Set<Inspect>>;
  __RX_BOUNDARIES__?: Map<string, Set<BoundaryState>>;
  __RX_TRACE__?: (event: DevEvent) => void;
};
const trace = (e: DevEvent) => { if (RX_INSTRUMENT) try { dev.__RX_TRACE__?.(e); } catch { /* observation must not affect the app */ } };
let runId = 0;
let currentRun: number | undefined;
let currentAction: string | undefined, callbackOrigin: string | undefined;
function remember<T>(map: Map<string, Set<T>>, k: string, value: T, removed?: () => void) {
  let set = map.get(k);
  if (!set) map.set(k, set = new Set());
  const entries = set;
  entries.add(value);
  if (getOwner()) onCleanup(() => { entries.delete(value); if (!entries.size) map.delete(k); removed?.(); });
}
const nm: <T>(o: T) => T = RX_INSTRUMENT ? o => rxKey === null ? o : ({ ...(o ?? {}), name: `rx:${rxKey}~i${rxInstance}` }) as typeof o : o => o;
const pathOfKey = (k: string) => {
  const path = OBSERVE?.ownerPath?.(getOwner());
  const scope = k.split("|").at(-2);
  return path?.length ? path : scope ? [`<${scope}>`] : undefined;
};
/** `__rt.key(k, () => …)`: a dev build's creating call of a source or an equation, run under its key. Solid's
 *  production build keeps no names, so there it is the call alone. */
const key: <T>(k: string, f: () => T, own?: Map<string, Set<Inspect>>, reads?: Set<Inspect>) => T = RX_INSTRUMENT
  ? (k, f, own, reads) => {
      const instance = String(++instanceId);
      const ownerPath = pathOfKey(k);
      const was = rxKey, wasInstance = rxInstance, previousCarry = consumedCarry;
      rxKey = k; rxInstance = instance;
      consumedCarry = undefined;
      try {
        const out = f();
        const get = Array.isArray(out) ? out[0] : out;
        if (typeof get === "function") {
          // Capture only the accessor, not a value at declaration. Hoisted awaits share this key; the
          // declared accessor registers last, and multiple mounted instances have separate lifetimes.
          const writer: Writer | undefined = Array.isArray(out) ? out[1] : undefined;
          const inspect: Inspect = format => runWithOwner(null, () => untrack(() => {
            try {
              const shown = get();
              const value = format(shown);
              const pending = isPending(() => readWhole(get()));
              let held = false;
              if (writer && pending) {
                try {
                  const proposal = latest(() => latestWhole(get()));
                  held = !sameInput(latestWhole(shown), proposal);
                } catch { /* no ahead value to compare */ }
              }
              return { value, pending, held };
            } catch (e) {
              if (e instanceof NotReadyError) return { pending: true };
              // Solid's unowned reads surface the status wrapper, whereas the
              // boundary gets its cause. Keep the declared error class.
              const status = e as Error & { source?: unknown };
              return { error: status?.constructor?.name === "StatusError" && status.source ? status.cause : e };
            }
          }, false));
          // The bridge keeps handles only for the lifetime of this declaration.
          Object.assign(inspect, { node: (get as any)[$REFRESH], hmrValue: () => inspect(latestWhole) });
          const nodes = dev.__RX_NODES__ ??= new Map();
          Object.assign(inspect, { instance, ownerPath, source: !!writer, ...consumedCarry });
          if (own && writer) remember(own, k, inspect);
          if (reads) {
            reads.add(inspect);
            if (getOwner()) onCleanup(() => { reads.delete(inspect); });
          }
          remember(nodes, k, inspect, () => trace({ type: "dispose", key: k, instance }));
          trace({ type: "node", key: k, instance });
          if (writer) {
            const { set, path, guess } = writer;
            const written = () => trace({ type: "write", key: k, instance, run: currentRun, origin: callbackOrigin });
            writer.set = v => { if (callbackOrigin) written(); set(v); if (!callbackOrigin) written(); };
            writer.path = (p, v) => { if (callbackOrigin) written(); path(p, v); if (!callbackOrigin) written(); };
            writer.guess = (v, p) => { if (callbackOrigin) written(); guess(v, p); };
          }
        }
        return out;
      } finally { rxKey = was; rxInstance = wasInstance; consumedCarry = previousCarry; }
    }
  : (_k, f) => f();

// Solid's boundary doesn't accept a name, and the fallback record only arrives when Loading hides.
// Use the fallback's render effect and disposal: Solid builds it separately, and disposes it on recovery.
function traceBoundary(region: string, state: "fallback" | "error") {
  if (!RX_INSTRUMENT) return (_error?: Acc) => {};
  const current: BoundaryState = { state: "ok" };
  const change = () => trace({ type: "boundary", region });
  remember(dev.__RX_BOUNDARIES__ ??= new Map(), region, current, change);
  change();
  return (error?: Acc) => {
    // Its own ownerless root, disposed with the fallback: an effect owned by the fallback would take a hydration id
    // the (non-dev) server never gave out, and the dev client's fallback would miss its keys (ssr/run.ts RX_DEV=1).
    const dispose = runWithOwner(null, () => createRoot(d => {
      createRenderEffect(() => error?.(), e => { current.state = state; current.error = e; change(); });
      return d;
    }));
    onCleanup(() => { dispose(); current.state = "ok"; delete current.error; change(); });
  };
}
export type Acc = () => unknown;
export type Writer = { set: (v: unknown) => void; path: (keys: (string | number)[], v: unknown) => void; guess: (v: unknown, keys?: (string | number)[]) => void };
export type Entry = { get?: Acc; w?: Writer; value?: unknown };

// ---------------------------------------------------------------- values
export const ERR = { toString: () => "#error" }; export const PENDING_MARK = { toString: () => "#pending" };
export const fmt = (v: unknown): string => v === ERR ? "#error" : v === PENDING_MARK ? "#pending" : v === undefined ? "undefined" : typeof v === "string" ? v : JSON.stringify(v);
const raw = (x: any) => (x && typeof x === "object" && x[$TARGET]) ? x[$TARGET].v : x;
/** A view: a DOM node, a function (a hole, a control-flow accessor), or an array of views — which compiled JSX mixes with
 *  its static strings. An array of strings alone is a value. */
const isNode = (v: unknown): boolean => typeof v === "function" || (typeof v === "object" && v !== null && "nodeType" in (v as object));
const isView = (v: unknown): boolean => isNode(v) || (Array.isArray(v) && (v.length === 0 || (v.every(x => x == null || typeof x === "string" || isView(x)) && v.some(x => x != null && typeof x !== "string"))));

// ---------------------------------------------------------------- failures (R-f; a copy of ref/src/failure.ts — this file is served alone)
type ErrorClass = ((...args: unknown[]) => Error) & { cls: new (...args: unknown[]) => Error; errorClass: string };
function errorClass(name: string, params: string[], message: (...args: unknown[]) => unknown, id?: string): ErrorClass {
  const C = class extends Error { constructor(...args: unknown[]) { super(""); this.name = name; params.forEach((p, i) => { (this as unknown as Record<string, unknown>)[p] = args[i]; }); this.message = String(untrack(() => message(...args))); if (id) (this as unknown as { $class: string }).$class = id; } };
  Object.defineProperty(C, "name", { value: name }); Object.defineProperty(C, "declared", { value: true });
  const f = ((...args: unknown[]) => new C(...args)) as ErrorClass; f.cls = C; f.errorClass = name; (f as { $class?: string }).$class = id; return f;
}
const PANIC = { panic: true } as const;   // R-f-10: statically discharges nothing; at run time takes whatever reaches it
/** SV-5a: a failure the server sent arrives as a plain `Error` carrying its declaration's identity (`$class`); the first
 *  test against that class gives it back its class. */
const isA = (err: unknown, classes: unknown[] | undefined): boolean => !classes || classes.includes(PANIC) || classes.some(c => {
  const k = (c as { cls?: unknown })?.cls ?? c; if (typeof k !== "function") return false;
  if (err instanceof (k as new () => unknown)) return true;
  const id = (c as { $class?: string }).$class;
  if (id && err && typeof err === "object" && (err as { $class?: string }).$class === id) { Object.setPrototypeOf(err, (k as { prototype: object }).prototype); return true; }
  return false;
});
/** `e catch (x: C) => alt`, reactive: an error boundary around the read whose fallback is the value (Solid: an errored read
 *  reaches the nearest boundary even inside a JS `try`). The fallback is decided when read, so a change of class re-decides it. */
function catchAcc(f: () => unknown, match: (err: unknown) => boolean, alt: (err: unknown) => unknown): () => unknown {
  const acc = untrack(() => createErrorBoundary(() => readWhole(f()), (err: () => unknown) => new Fallback(() => { const e0 = err(); return match(e0) ? alt(e0) : new Forward(e0); })));
  return () => unwrapFallback(acc());
}
/** Imperative scope: an ordinary try. */
function tryCatch(f: () => unknown, match: (err: unknown) => boolean, alt: (err: unknown) => unknown): unknown {
  try { return f(); } catch (err) { if (err instanceof NotReadyError || !match(err)) throw err; return alt(err); }
}
/** `e catch (x: C) => alt` read where it was written. In reactive scope it is `catchAcc`'s boundary. Read with no observer —
 *  a component `fn` called from a handler — it is a snapshot (04 R-8): the committed value, or `alt` on a matching failure
 *  (R-f-7), as `tryCatch`; a fresh boundary there would have no committed value while a question is out (S-catch-snapshot). */
function catchRead(f: () => unknown, match: (err: unknown) => boolean, alt: (err: unknown) => unknown): unknown {
  return getObserver() ? catchAcc(f, match, alt)() : tryCatch(f, match, alt);
}
class Fallback { get: () => unknown; constructor(g: () => unknown) { this.get = g; } }
function unwrapFallback(v0: unknown): unknown { let v = v0; if (v instanceof Fallback) v = v.get(); if (v instanceof Forward) throw (v as Forward).err; return v; }
const NO_PROVISION: Entry = {};
class Forward { err: unknown; constructor(e: unknown) { this.err = e; } }

// ---------------------------------------------------------------- the wire (12 SF-6; a copy of ref/src/failure.ts's)
function wireCopy(v: unknown, where: string, fail: (msg: string) => never): unknown {
  if (v === null || v === undefined || typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
  if (Array.isArray(v)) return v.map((x, i) => wireCopy(x, `${where}[${i}]`, fail));
  if (typeof v === "object") { const proto = Object.getPrototypeOf(v); if (proto === Object.prototype || proto === null) { const o: Record<string, unknown> = {}; for (const k of Object.keys(v as object)) o[k] = wireCopy((v as Record<string, unknown>)[k], `${where}.${k}`, fail); return o; } }
  return fail(`${where} is ${typeof v === "function" ? "a function" : `an instance of ${(v as object).constructor?.name ?? "a class"}`}, which the wire cannot carry: send data`);
}
const wireFailure = (err: unknown): unknown => err instanceof Error && (err.constructor as { declared?: boolean }).declared ? err : new Error("Internal Server Error");

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

// ---------------------------------------------------------------- one app instance
export function createApp(opts: { root: any; api?: Record<string, (...a: any[]) => unknown>; scenarioFlights?: boolean }) {
  const flights = new Map<string, Flight>();
  const lastKey = new Map<string, string>();
  const truthOf = new Map<Acc, Acc>();                                  // an optimistic signal-form source: its guess layer -> its question
  const registry = new Map<string, Entry[]>();
  const contexts = new Map<string, ReturnType<typeof createContext<Entry | undefined>>>();
  const storeAccs = new WeakSet<object>();
  const modules = new Map<unknown, Record<string, unknown>>();
  const sources = RX_INSTRUMENT ? new Map<string, Set<Inspect>>() : undefined;
  const reads = RX_INSTRUMENT ? new Set<Inspect>() : undefined;
  let carries: Map<string, CarryGroup> | undefined;
  let deferred: DeferredCarries | undefined;
  type EffectFrame = { path: string; signature: string; last: unknown[] | null };
  const effects = RX_INSTRUMENT ? new Map<string, Set<EffectFrame>>() : undefined;
  let previousEffects: Map<string, EffectFrame> | undefined;
  const inputEvents = ["pointerdown", "keydown", "input", "click"];
  const clearDeferred = () => {
    if (!deferred) return;
    deferred = undefined;
    previousEffects = undefined;
    for (const type of inputEvents) opts.root?.removeEventListener?.(type, clearDeferred, true);
  };
  const takeCarry = () => {
    if (rxKey === null) return;
    const group = carries?.get(rxKey);
    if (group) return group.entries[group.used++];
    const seed = deferred?.get(rxKey);
    if (!seed || pathOfKey(rxKey)?.join("/") !== seed.path) return;
    // There may be a second candidate mount as the pending ancestor lands.
    // Keep the seed for the bounded replacement window, not for user remounts.
    seed.used?.();
    return seed.value;
  };
  // Only a Vite hot boundary enables persistent module owners. Do not change
  // production or non-HMR hydration's owner order.
  let moduleOwner: ReturnType<typeof getOwner> | undefined;
  const persistent = new Map<string, { exports: Record<string, unknown>; dispose: () => void }>();
  // An equation's hoisted awaits, re-asked with it by `refresh`. They are emitted just before the equation and claimed
  // by its accessor when it registers, so a refresh reaches only its own instance's (never a disposed mount's).
  const hoistedBy = new Map<string, Acc[]>();
  const hoistedOf = new WeakMap<Acc, Acc[]>();
  const log: string[] = [];
  let currentEq: string | null = null; let serverSeq = 0; let classSeq = 0;
  const harnessErrors = RX_HARNESS ? new Map<string, unknown>() : undefined;
  type Ctx = { name: string; ctx: ReturnType<typeof createContext<Entry | undefined>>; dflt: (() => unknown) | null; owner: ReturnType<typeof getOwner>; dv: Entry | null };
  // During hydration Solid runs a compute under `subFetch` to learn its inputs, with `fetch` and `Promise` mocked, and keeps
  // the server's answer (SV-3b). A flight asked there is that trace, not a question: it is not registered.
  const tracing = () => { let ran = false; new Promise(() => { ran = true; }); return !ran; };
  const flight = (key: string) => { if (tracing()) return new Flight(key); let f = flights.get(key); if (!f) { f = new Flight(key); flights.set(key, f); } if (currentEq) lastKey.set(currentEq, key); return f; };
  const named = <T extends (...a: any[]) => unknown>(name: string | null, fn: T): T => (name ? ((...a: unknown[]) => { const was = currentEq; currentEq = name; try { return fn(...a); } finally { currentEq = was; } }) as T : fn);

  const app = {
    root: opts.root,
    log, flights, lastKey, asyncError: null as unknown,
    /** Mount `view` on the root: build it, or (SV-3) adopt the page the server streamed into it. */
    mount(view: () => unknown, hydrating = false) { return hydrating ? hydrate(view as never, app.root) : render(view as never, app.root); },

    // the prelude: what `import pure { … } from "./prelude"` and the built-in names refer to
    B: {
      len: (x: unknown) => (Array.isArray(x) || typeof x === "string") ? x.length : (typeof x === "object" && x) ? Object.keys(x).length : 0,
      str: (x: unknown) => fmt(x),
      map: (xs: unknown[], f: (x: unknown, i: number) => unknown) => xs.map(f),
      filter: (xs: unknown[], f: (x: unknown) => unknown) => xs.filter(f),
      sum: (xs: number[]) => xs.reduce((a, b) => a + b, 0),
      every: (xs: unknown[], f: (x: unknown) => unknown) => xs.every(f),
      indexOf: (xs: unknown[], f: (x: unknown) => unknown) => xs.findIndex(f),
      fail: (msg: string) => { throw Object.assign(new Error(msg), { panic: true }); },   // R-f-3: a JS throw — a panic, not in the failure row
      fetch: (key: string) => opts.api?.fetch ? opts.api.fetch(key) : flight(String(key)),
      log: (...a: unknown[]) => { log.push(`log(${a.map(fmt).join(", ")})`); },
    } as Record<string, any>,
    /** MO-8: a class `api.d.rx` declares as an error: the real module's, or (in the harness) a stand-in `C(message)`. */
    ...(RX_HARNESS ? { jsError: (name: string) => harnessErrors!.get(name) ?? (harnessErrors!.set(name, (opts.api?.[name] as unknown) ?? errorClass(name, ["message"], (m?: unknown) => m ?? name, `${name}#${classSeq++}`)), harnessErrors!.get(name)) } : {}),
    api: (name: string) => {
      if (!opts.api) {
        if (RX_HARNESS && opts.scenarioFlights) return (...a: unknown[]) => flight(`${name}:${a.map(fmt).join(",")}`);
        throw new Error(`${RX_HARNESS ? "MISSING_TEST_API: " : ""}cannot bind ${name} from "./api"; pass createApp({ api }) or provide a local JS module`);
      }
      return opts.api[name] ?? (() => { throw new Error(`./api has no ${name}`); });
    },
    /** MO-10: the scenario prelude's `./prims` — Solid primitives, as a library writes them (`ref/compile/prims-solid.ts`). */
    prim: (name: string) => primsSolid({ createSignal: createSignal as any, createMemo: createMemo as any })[name] ?? (() => { throw new Error(`./prims has no ${name}`); }),

    // ---- the scenario harness's view of names (handler rows reach any live binding by name) ----
    reg(name: string, e: Entry) { let l = registry.get(name); if (!l) registry.set(name, (l = [])); l.push(e); const h = hoistedBy.get(name); if (h && e.get) { hoistedOf.set(e.get, h); hoistedBy.delete(name); } },
    lookup(name: string): Entry { const l = registry.get(name); if (!l?.length) throw new Error(`unbound ${name}`); for (let i = l.length - 1; i >= 0; i--) if (l[i].w) return l[i]; return l[l.length - 1]; },
    dget(name: string, live = false) { const e = app.lookup(name); return e.get ? (live ? e.get() : app.snapshot(e.get)) : e.value; },   // live: inside a probe (R-12), the read itself
    dset(name: string, keys: (string | number)[], v: unknown, guess = false) { const w = app.lookup(name).w; if (!w) throw new Error(`W-1: write to non-source ${name}`); if (guess) w.guess(v, keys); else if (keys.length) w.path(keys, v); else w.set(v); },

    // ---- declarations ----
    /** `source x := e`: atomic → a signal; structured → a store behind a signal slot, so the root can be replaced (ST-1, ST-2a). */
    /** With a guess written to it (AC-3), the writable is the truth and an optimistic layer derives from it: plain writes
     *  go to the truth, guesses to the layer, and each guess ends when its action's hold commits, showing the truth then. */
    source(name: string, init: unknown, guessed = false): [Acc, Writer] {
      void name;
      if (typeof init === "object" && init !== null) {
        const [store, setStore] = createStore(init as any, nm(undefined)); const [get, set] = createSignal<unknown>(store, nm(undefined));
        const w: Writer = {
          set: v => { if (typeof v === "function") { setStore(v as any); set(store); } else if (typeof v === "object" && v !== null) { setStore(() => v as any); set(store); } else set(v); },
          path: pathWrite(setStore),
          guess: () => { throw new Error("a guess on a := source that the compiler did not mark as guessed"); },
        };
        if (guessed) {                                                    // createOptimisticStore(() => truth) over createStore(v)
          const [view, setView] = (createOptimisticStore as any)(() => get(), Array.isArray(init) ? [] : {}, nm(undefined));
          const acc = () => view; storeAccs.add(acc);
          return [acc, { ...w, guess: guessInto(setView) }];
        }
        return [get, w];
      }
      const [get, set] = createSignal(init, nm(undefined));
      if (guessed) {                                                      // createOptimistic(() => truth()) over createSignal(v)
        const [view, setGuess] = createOptimistic(() => get(), nm(undefined));
        return [view as Acc, { set: set as (v: unknown) => void, path: () => { throw new Error("a path write to an atomic source"); }, guess: setGuess as any }];
      }
      return [get, { set: set as (v: unknown) => void, path: () => { throw new Error("a path write to an atomic source"); }, guess: () => { throw new Error("a guess on a := source that the compiler did not mark as guessed"); } }];
    },
    ...(RX_INSTRUMENT || RX_HARNESS ? {
      sourceDev(name: string, init: Acc, guessed = false): [Acc, Writer] {
        const seed = takeCarry();
        if (seed) consumedCarry = { replaces: seed.instance, carryStatus: "carried" };
        return app.source(name, seed ? seed.value : untrack(init), guessed);
      },
    } : {}),
    /** `source x = e` (ST-5): createSignal(fn); with a guess written to it, a createOptimistic layer over that truth (AC-3);
     *  written or probed by path, createStore(fn, {}) whose derive writes its draft. */
    question(name: string, compute: (prev: unknown) => unknown, opts: { loadingValue?: unknown } | undefined, mode: { optimistic: boolean; structured: boolean; derived?: boolean; record?: boolean; plain?: boolean }, key?: string): [Acc, Writer] {
      const answer = RX_INSTRUMENT && !mode.derived ? takeCarry() : undefined;
      if (answer) {
        consumedCarry = { replaces: answer.instance, carryStatus: answer.keepAnswer && !hoistedBy.get(name)?.length ? "carried" : "re-asked" };
        // A question without tracked inputs can keep its answer without starting
        // I/O. Explicit refresh still calls the new question.
        if (answer.keepAnswer && !hoistedBy.get(name)?.length) {
          let first = true;
          const ask = compute;
          compute = prev => { if (!first) return ask(prev); first = false; return answer.value; };
        }
        opts = { ...opts, loadingValue: answer.value };
      }
      const fn = named(name, compute);
      const derive = (draft: any) => { const r = fn(draft); if (r instanceof Flight || r instanceof Promise) return (async () => landDraft(draft, r instanceof Flight ? await r.first : await r, key))(); return landDraft(draft, r, key); };
      const seed = () => answer && answer.value && typeof answer.value === "object" ? answer.value : key && !mode.record ? [] : {};
      const storeOptions = () => nm({ ...(key ? { key } : {}), ...(answer ? { seedLoadingValue: true } : {}) });
      if (mode.optimistic && mode.structured && mode.plain && !mode.derived) {   // AC-3 with plain writes too: createOptimisticStore(() => truth) over createStore(fn) — writes go to the truth, guesses to the layer
        const [truth, setTruth] = (createStore as any)(derive, seed(), answer ? storeOptions() : nm(key ? { key } : undefined));
        const tacc = () => truth; storeAccs.add(tacc);
        const [view, setView] = (createOptimisticStore as any)(() => truth, seed(), answer ? storeOptions() : nm(key ? { key } : undefined));
        const get = () => view; storeAccs.add(get); truthOf.set(get, tacc);   // AC-4: `refresh x` re-asks the truth
        return [get, { set: v => setTruth((d: any) => typeof v === "function" ? (v as (x: unknown) => unknown)(d) : v), path: pathWrite(setTruth), guess: guessInto(setView) }];
      }
      if (mode.optimistic && mode.structured) {                        // AC-3 path targets: createOptimisticStore(fn, seed) — the derive writes its draft; the setter guesses per key
        const [store, setStore] = (createOptimisticStore as any)(derive, seed(), answer ? storeOptions() : nm(key ? { key } : undefined));
        const get = () => store; storeAccs.add(get);
        const plain = () => { throw new Error("a plain write to an equation"); };
        return [get, { set: plain, path: plain, guess: guessInto(setStore) }];
      }
      if (mode.optimistic && mode.derived) {                             // AC-3 over an equation: createOptimistic(fn), whose setter only guesses
        const plain = () => { throw new Error("a plain write to an equation"); };
        const [get, setGuess] = createOptimistic(fn as any, nm(opts) as any);
        return [get as Acc, { set: plain, path: plain, guess: setGuess as any }];
      }
      if (mode.optimistic) {
        const [truth, setTruth] = createSignal(fn as any, nm(opts) as any);
        const [get, setGuess] = createOptimistic(() => truth(), nm(undefined));
        truthOf.set(get as Acc, truth as Acc);                            // AC-4: `refresh x` re-asks the truth, not the guess layer over it
        return [get, { set: setTruth as any, path: () => { throw new Error("optimistic path writes are not lowered yet"); }, guess: setGuess as any }];
      }
      if (mode.structured) {
        const [store, setStore] = (createStore as any)(async (draft: Record<string, unknown>) => { const r = fn(draft); const v = r instanceof Flight ? await r.first : await r; if (v && typeof v === "object") { for (const k of Object.keys(draft)) if (!(k in (v as object))) delete draft[k]; Object.assign(draft, v); } }, answer ? seed() : {}, answer ? storeOptions() : nm(undefined));
        const get = () => store; storeAccs.add(get);
        return [get, { set: () => { throw new Error("a root write to a derived store is not lowered yet"); }, path: (keys, v) => setStore((d: any) => { let o = d; for (const k of keys.slice(0, -1)) o = o[k]; o[keys[keys.length - 1]] = v; }), guess: () => { throw new Error("optimistic over a structured question source is not lowered yet"); } }];
      }
      const [get, set] = createSignal(fn as any, nm(opts) as any);
      return [get, { set: set as any, path: () => { throw new Error("a path write to an atomic source"); }, guess: () => { throw new Error("GUESS_NO_QUESTION"); } }];
    },
    memo: (name: string | null, fn: (prev: unknown) => unknown, opts?: { loadingValue?: unknown }): Acc => createMemo(named(name, fn) as any, nm(opts) as any) as Acc,
    // A dev-only wrapper must not consume an ID absent from the server render.
    ...(RX_INSTRUMENT || RX_HARNESS ? {
      observeRef: (read: Acc): Acc => sharedConfig.hydrating ? read : createMemo(() => read(), nm(undefined)),
    } : {}),
    deferred: (name: string, fn: (prev: unknown) => unknown, opts?: { loadingValue?: unknown }): Acc => createDeferred(named(name, fn) as any, nm(opts) as any) as Acc,
    /** `x key k = e` (ST-4): a keyed projection. */
    keyed: (name: string, key: string, fn: () => unknown, record = false): Acc => { const src = createMemo(named(name, () => fn()) as any, nm(undefined)); const p = createProjection(() => (src as Acc)() as any, (record ? {} : []) as any, nm({ key }) as any); const acc = () => p; truthOf.set(acc, src as Acc); return acc; },   // AC-4: `refresh rows` re-asks the memo under the projection   // the answer is a memo (sync, or the tail await's); the projection reconciles it by key
    /** `x = draft(pre x -> seed) { … }` (ST-3). */
    draft: (seed: unknown, body: (d: any) => void): Acc => { const p = createProjection(body as any, seed as any, nm(undefined)); return () => p; },
    /** `pre y` of another node (C-2): a companion memo carrying (current, previous), owned where `y` is declared. */
    pre: (get: Acc): Acc => { const m = createMemo((st: any) => ({ cur: get(), prev: st ? st.cur : undefined })); return () => (m() as { prev: unknown }).prev; },
    firstPaint: (f: () => unknown) => ({ loadingValue: untrack(f) }),
    /** `effect (…) { … }`: compute, then apply; fires on a differing value (EF-2); an input that failed doesn't fire it (EF-2a: the failure shows where it's read), and the next answer does; a store enters whole, as a snapshot. */
    effect(n: number, inputs: () => unknown[], apply: (p: unknown[]) => unknown, key?: string) {
      const run = (vals: unknown[]) => { const r = apply(vals); return typeof r === "function" ? (r as () => void) : undefined; };
      const path = RX_INSTRUMENT && key ? pathOfKey(key)?.join("/") : undefined;
      const signature = path ? `${inputs}\n${apply}` : "";
      const old = path && key ? previousEffects?.get(key) : undefined;
      let seed = old && old.path === path && old.signature === signature ? old.last : null;
      const frame: EffectFrame = { path: path ?? "", signature, last: null };
      if (key && path) remember(effects!, key, frame);
      createEffect((() => inputs().map(latestWhole)) as any, { effect: (vals: unknown[]) => {
        const last = frame.last ?? seed;
        seed = null;
        frame.last = vals;
        if (last && last.length === vals.length && vals.every((v, i) => sameInput(v, last[i]))) return;
        return run(vals);
      }, error: () => { seed = frame.last = null; } } as any);
    },
    ...(RX_INSTRUMENT ? {
      actionCaught(key: string, site: number, error: unknown, names: string[], classes: unknown[]) {
        // Same short circuit as isA, including Panic and restoring the class of wire errors.
        const panic = classes.indexOf(PANIC);
        const i = panic >= 0 ? panic : classes.findIndex(c => isA(error, [c]));
        if (i < 0) return false;
        if (currentRun !== undefined) trace({ type: "caught", key, id: currentRun, site, class: names[i] });
        return true;
      },
    } : {}),
    /** `action f(…) { … }` (AC-1): a generator; a statement-level `await` is a hold-safe yield. */
    action(gen: (...a: unknown[]) => Generator<unknown, unknown, unknown>, key?: string) {
      if (RX_INSTRUMENT && key) {
        const ownerPath = OBSERVE?.ownerPath?.(getOwner());
        const run = action(function* (id: number, ...a: unknown[]) {
          const iter = gen(...a);
          const step = (method: "next" | "throw" | "return") => (value: unknown) => {
            const previous = currentRun, previousAction = currentAction;
            currentRun = id;
            currentAction = callbackOrigin ?? `${key} #${id}`;
            try { return iter[method](value); } finally { currentRun = previous; currentAction = previousAction; }
          };
          return yield* { [Symbol.iterator]: () => ({ next: step("next"), throw: step("throw"), return: step("return") }) };
        } as any) as (id: number, ...a: unknown[]) => Promise<unknown>;
        return (...a: unknown[]) => {
          a = untrack(() => actionInput(a, $TARGET));
          const id = ++runId;
          trace({ type: "run", key, id, ownerPath, state: "start", args: a });
          const fail = (error: unknown) => { trace({ type: "run", key, id, ownerPath, state: "error", error }); };
          try {
            const p = run(id, ...a);
            p.then(() => trace({ type: "run", key, id, ownerPath, state: "end" }), e => { app.asyncError = e; fail(e); });
            return p;
          } catch (e) { fail(e); throw e; }
        };
      }
      const run = action(gen as any) as (...a: unknown[]) => Promise<unknown>;
      return (...a: unknown[]) => { const p = run(...untrack(() => actionInput(a, $TARGET))); p.catch(e => { app.asyncError = e; }); return p; };
    },
    traceCallback<T extends (...args: any[]) => any>(fn: T): T {
      const origin = currentAction ?? callbackOrigin;
      if (!RX_INSTRUMENT || !origin) return fn;
      return function (this: unknown, ...args: unknown[]) {
        const previous = callbackOrigin;
        callbackOrigin = origin;
        try { return fn.apply(this, args); } finally { callbackOrigin = previous; }
      } as T;
    },
    awaited: (v: unknown) => v instanceof Flight ? v.first : v,
    /** `x = await f() catch (e: C) => alt` (R-f-4): a matching rejection lands `alt` as the answer; others reject on. */
    settle: (p: unknown, match: (err: unknown) => boolean, alt: (err: unknown) => unknown) => p && typeof (p as Promise<unknown>).then === "function" ? (p as Promise<unknown>).then(v => v, err => { if (match(err)) return alt(err); throw err; }) : p,
    /** RG-8: Solid's Portal — client-only: the server renders nothing for it, the browser renders it once it has the page. */
    Portal: WebPortal,
    /** CSS-2: a dynamic class with the view's scope class after it. */
    scopedClass: (v: unknown, hash: string) => v == null || v === false || v === "" ? hash : `${v} ${hash}`,
    /** SV-7b: a client question — not asked on the server; the browser asks it once hydrated (Solid's \`ssrSource: "client"\`). */
    clientQuestion: (o?: { loadingValue?: unknown }) => ({ ...(o ?? {}), ssrSource: "client" }),
    /** 12 SF-2: a server fn as the client calls it — every call a flight. Asked in reactive scope it is a question, one
     *  flight per arguments, as a JS import's; in imperative scope each call is a new request. \`fn\` is the module-level
     *  \`"use server"\` function (SF-7a): the body in place, or — once Solid's \`transformDirectives\` has made it a reference
     *  — a request to the server. */
    serverRef(name: string, fn: (...a: unknown[]) => Promise<unknown>) {
      return (...args: unknown[]) => {
        const key = `${name}:${args.map(fmt).join(",")}`;
        const question = !!getObserver();
        if (question && flights.has(key)) return flights.get(key)!;
        const fl = question ? flight(key) : new Flight(`${key}#${serverSeq++}`);
        (globalThis as { __rx_app?: unknown }).__rx_app = app;   // the app a body run in place belongs to (it reads it once, at its start)
        let p: Promise<unknown>; try { p = Promise.resolve(fn(...args)); } catch (e) { p = Promise.reject(e); }
        p.then(v => fl.resolve(v), e => fl.reject(e));
        return fl;
      };
    },
    /** SF-6: a server fn's body (a generator, as an action's), driven by promises — not by an action: it is no change of
     *  the client's — behind a wire that copies arguments and result and lets only declared failures through. */
    serverCall(name: string, gen: (...a: unknown[]) => Generator<unknown, unknown, unknown>, args: unknown[]): Promise<unknown> {
      return new Promise((resolve, reject) => {
        const fail = (msg: string): never => { throw new Error(`WIRE_VALUE: ${name}: ${msg}`); };
        let g: Generator<unknown, unknown, unknown>;
        try { g = gen(...args.map((a, i) => wireCopy(a, `argument ${i + 1}`, fail))); } catch (e) { reject(e); return; }
        const step = (input: unknown, thrown: boolean) => {
          const was = currentEq; currentEq = null; let r: IteratorResult<unknown, unknown>;   // the body's flights are not the asking equation's
          try { r = untrack(() => thrown ? g.throw(input) : g.next(input)); } catch (e) { reject(wireFailure(e)); return; } finally { currentEq = was; }
          if (r.done) { try { resolve(wireCopy(r.value, "its result", fail)); } catch (e) { reject(e); } return; }
          Promise.resolve(r.value).then(v => step(v, false), e => step(e, true));
        };
        step(undefined, false);
      });
    },
    hoisted(name: string, get: Acc) { let l = hoistedBy.get(name); if (!l) hoistedBy.set(name, (l = [])); l.push(get); },
    until: (p: () => unknown) => until(p),                                   // AC-6
    onSettled: (f: () => void) => onSettled(f),                             // EF-7
    onFlush: (f: () => void) => onFlush(f),                                 // EF-8
    refresh(name: string, get: Acc) { const key = lastKey.get(name); if (key) flights.delete(key); for (const h of hoistedOf.get(get) ?? []) refresh(h as any); const t = truthOf.get(get) ?? get; refresh((storeAccs.has(t) ? t() : t) as any); },
    affects: (get: Acc) => affects((storeAccs.has(get) ? get() : get) as any),   // a structured source's accessor wraps its store: Solid takes the store (#50), as `refresh` above
    preOr: (v: unknown, init: () => unknown) => v === undefined ? init() : v,

    // ---- modules (09 MO-1): a dependency's factory runs once per app; its exports are shared by every importer ----
    module(key: unknown, factory: (rt: unknown) => Record<string, unknown>) { let m = modules.get(key); if (!m) { m = factory(app); modules.set(key, m); } return m; },
    // ---- context (RG-7) ----
    owner: () => getOwner(),
    /** `context x: T = d` (RG-7): the declaration is the identity; `d`, if any, is evaluated once, owned where it is declared. */
    /** `context x: T = d` (RG-7): the declaration is the identity (a sentinel default: absence is ours to decide); `d` is
     *  evaluated once, owned where it is declared — created now, so it takes its id there on both sides (SV-3). */
    context(name: string, dflt: (() => unknown) | null): Ctx { return { name, ctx: createContext<Entry | undefined>(NO_PROVISION, name), dflt, owner: getOwner(), dv: dflt ? { get: createMemo(dflt as any) as Acc } : null }; },
    provide(c: Ctx, e: Entry) { setContext(c.ctx, e); },
    use(c: Ctx, owner: ReturnType<typeof getOwner>): Entry {
      const e = getContext(c.ctx, owner ?? undefined); if (e && e !== NO_PROVISION) return e;
      if (c.dv) return c.dv;
      throw new Error(`RG-7b: no provision for ${c.name}`);
    },
    useGet(c: Ctx, owner: ReturnType<typeof getOwner>) { const e = app.use(c, owner); return e.get ? e.get() : e.value; },
    runWithOwner,

    // ---- reads ----
    /** An imperative read sees σ (H-10): a pending value is a value; a snapshot of an error throws it (R-f-7). */
    snapshot(get: Acc) { try { return untrack(get); } catch (e) { if (e instanceof NotReadyError) return PENDING_MARK; throw e; } },
    // ---- failures (R-f) ----
    errorClass: (name: string, params: string[], message: (...args: unknown[]) => unknown) => errorClass(name, params, message, `${name}#${classSeq++}`),   // a declaration's identity: the same on both sides (SV-5a)
    isA, PANIC, catchMemo: catchAcc, tryCatch, catchRead,
    key: RX_INSTRUMENT ? <T>(k: string, f: () => T) => key(k, f, sources, reads) : key,
    throw: (e: unknown): never => { throw e; },
    eq: (a: unknown, b: unknown) => raw(a) === raw(b),
    untrack, omit, latest: (f: () => unknown) => latest(() => latestWhole(f())), isPending: (f: () => unknown) => isPending(() => readWhole(f())),
    fmt,

    // ---- views: compiled JSX (compile/jsx.ts, generate "dom") does the rest ----
    show: (v: unknown) => isView(v) ? v : fmt(v),
    DevLoading(props: { region: string; on?: unknown; fallback: any; children: any }) {
      if (!RX_INSTRUMENT) return Loading(props);
      const show = traceBoundary(props.region, "fallback");
      const wrapped = { get fallback() { show(); return props.fallback; }, get children() { return props.children; } };
      if ("on" in props) Object.defineProperty(wrapped, "on", { get: () => props.on });
      return Loading(wrapped);
    },
    DevErrored(props: { region: string; fallback: (err: Acc, reset: () => void) => any; children: any }) {
      if (!RX_INSTRUMENT) return Errored(props);
      const show = traceBoundary(props.region, "error");
      return Errored({ fallback: (err, reset) => { show(err); return props.fallback(err, reset); }, get children() { return props.children; } });
    },
    /** `errored fallback(e: A | B)`: a failure of another class passes to the boundary above (R-f-4) — the fallback hands it out
     *  and a memo throws it there (a rethrow from the fallback itself did not recover until solidjs/solid#4277: ref/oracle/repros/dv7-rethrow.mjs). */
    TypedErrored(props: { region?: string; classes: unknown[]; fallback: (err: Acc) => unknown; children: unknown }) {
      const classes = props.classes;
      const region = RX_INSTRUMENT && props.region;
      const show = region ? traceBoundary(region, "error") : undefined;
      const out = createComponent(Errored as any, {
        fallback: (err: Acc) => {
          const owner = getOwner(); const ok = createMemo(() => isA(err(), classes)); let shown: unknown = null;
          return new Fallback(() => ok() ? (shown ??= runWithOwner(owner, () => { show?.(err); return props.fallback(err); })) : new Forward(err()));
        },
        get children() { return props.children; },
      });
      return createMemo(() => unwrapFallback(typeof out === "function" ? (out as Acc)() : out));
    },
  };
  const rt = Object.assign(app, RX_INSTRUMENT ? {
    moduleDev(path: string, factory: (rt: unknown) => Record<string, unknown>) {
      if (!moduleOwner || sharedConfig.hydrating) return app.module(path, factory);
      if (!persistent.has(path)) runWithOwner(moduleOwner, () => createRoot(dispose => {
        persistent.set(path, { exports: factory(rt), dispose });
      }, { transparent: true }));
      return persistent.get(path)!.exports;
    },
    hotRuntime: {
      activate() {
        if (moduleOwner !== undefined || sharedConfig.hydrating) return;
        moduleOwner = getOwner();
        if (moduleOwner) onCleanup(() => {
          clearDeferred();
          for (const m of [...persistent.values()].reverse()) m.dispose();
          persistent.clear();
          moduleOwner = undefined;
        });
      },
      sources,
      begin(carry: Map<string, CarryGroup>, modules: Set<string>) {
        clearDeferred();
        previousEffects = new Map([...effects!].flatMap(([key, frames]) => frames.size === 1 ? [[key, { ...[...frames][0] }]] : []));
        carries = carry;
        for (const [path, m] of [...persistent].reverse()) if (modules.has(path)) {
          persistent.delete(path);
          m.dispose();
        }
      },
      async defer(seeds: DeferredCarries) {
        // Without a pending read the branch is absent, not waiting to mount.
        const pending = () => [...reads!].some(read => read(() => undefined).pending);
        if ((!seeds.size && !previousEffects?.size) || !pending()) { previousEffects = undefined; return; }
        deferred = seeds;
        // Never restore a stale draft on a later user-driven remount.
        for (const type of inputEvents) opts.root?.addEventListener?.(type, clearDeferred, true);
        const deadline = performance.now() + 10000;
        while (deferred === seeds && pending() && performance.now() < deadline)
          await new Promise(resolve => setTimeout(resolve, 16));
        if (deferred === seeds) clearDeferred();
        previousEffects = undefined;
      },
      end() { carries = undefined; },
    },
  } : {});
  return rt;
}
export type App = ReturnType<typeof createApp>;

/** A path write `x.a.b := v` as a store setter's mutation. */
const pathWrite = (setStore: (f: (d: any) => unknown) => void) => (keys: (string | number)[], v: unknown) => setStore((d: any) => { let o = d; for (const k of keys.slice(0, -1)) o = o[k]; o[keys[keys.length - 1]] = v; });
/** A guess through an optimistic store's setter: per key, or whole — a whole guess is the setter's return, which Solid
 *  diffs shallowly against the view as guesses. */
const guessInto = (setStore: (f: (d: any) => unknown) => void) => (v: unknown, keys: (string | number)[] = []) => setStore((d: any) => { if (keys.length === 0) return typeof v === "function" ? (v as (x: unknown) => unknown)(d) : v; let o = d; for (const k of keys.slice(0, -1)) o = o[k]; const last = keys[keys.length - 1]; o[last] = typeof v === "function" ? (v as (x: unknown) => unknown)(o[last]) : v; });

/** A keyed answer is returned from the derive, and Solid reconciles it by key at any depth (ST-4a): a row whose key is
 *  still there keeps its object and takes the new leaves, so an equal answer changes nothing (#51, #64). Any other
 *  answer is assigned to the draft. */
function landDraft(draft: any, v: unknown, key: string | undefined): unknown {
  if (key && v && typeof v === "object") return v;
  assignDraft(draft, v);
  return undefined;
}
/** A store draft becomes `v`: keys `v` lacks are removed, the rest assigned (an array's length follows). */
function assignDraft(draft: any, v: unknown) {
  if (!v || typeof v !== "object") return;
  if (Array.isArray(draft) && Array.isArray(v)) { draft.length = v.length; v.forEach((x, i) => { draft[i] = x; }); return; }
  for (const k of Object.keys(draft)) if (!(k in (v as object))) delete draft[k];
  Object.assign(draft, v);
}

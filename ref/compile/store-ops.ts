// Store reads and writes on a store's target, with no proxy between the compiled code and Solid's store (spec/11 CP-4a:
// the same store, called through `storeGet`/`storeSet` instead of through a Proxy's traps). A store value inside compiled
// code may be its target ("handle"); it leaves compiled code — into a JS function, a literal, a signal, a DOM attribute —
// as the proxy Solid makes for it then (`out`). Every helper takes either form, so a value that is not a target (a proxy
// from a memo, a plain object, the server's stores) reads as it always did.
import { $TARGET, isStoreTarget, storeGet, storeHas, storeKeys, storeProxy, storeSet } from "@solidjs/signals";
import "./features.globals.ts";   // unbundled (the node runners), `__RX_STORES__` is a global, on
declare const __RX_STORES__: boolean;

// Each export is chosen by the constant itself (`__RX_STORES__ ? … : …`): a bundler that defines it false keeps the right-hand
// arm and drops the store's imports with the left one. A program with no structured value bundles none of the store.
const T: (v: unknown) => boolean = __RX_STORES__ ? isStoreTarget : () => false;
export const isT: (v: unknown) => boolean = __RX_STORES__ ? T : () => false;
/** A value as JS sees it: a target as its proxy. */
export const out: (v: any) => any = __RX_STORES__ ? v => T(v) ? storeProxy(v) : v : v => v;
/** `o?.[k]`. */
export const get: (o: any, k: PropertyKey) => any = __RX_STORES__ ? (o, k) => T(o) ? storeGet(o, k) : o?.[k as any] : (o, k) => o?.[k as any];
/** `o?.[k]` as a value that leaves: a store child as its proxy. */
export const val: (o: any, k: PropertyKey) => any = __RX_STORES__ ? (o, k) => { const r = T(o) ? storeGet(o, k) : o?.[k as any]; return T(r) ? storeProxy(r) : r; } : (o, k) => o?.[k as any];
/** `o[k] = v` inside a store setter. */
export const set: (o: any, k: PropertyKey, v: unknown) => void = __RX_STORES__ ? (o, k, v) => { if (T(o)) storeSet(o, k, v); else o[k as any] = v; } : (o, k, v) => { o[k as any] = v; };
/** A store proxy's target; any other value as it is. */
export const handleOf: (v: any) => any = __RX_STORES__ ? v => { if (v === null || typeof v !== "object" || T(v)) return v; const t = v[$TARGET]; return t !== undefined && t.px === v ? t : v; } : v => v;
/** The raw object under a store value (R-eq: `==` compares what the store holds). */
export const raw: (x: any) => any = __RX_STORES__ ? x => T(x) ? (x as any).v : (x && typeof x === "object" && x[$TARGET]) ? x[$TARGET].v : x : x => x;
/** An accessor's handle form: the same read, a store as its target. */
export const hacc = (acc: any): any => acc.h ?? acc;
/** The prelude over a list that may be a target: the reads `Array.prototype.<fn>` makes on a proxy, made on the target. */
const plainLen = (x: any): number => (Array.isArray(x) || typeof x === "string") ? x.length : (typeof x === "object" && x) ? Object.keys(x).length : 0;
export const B: { len(x: any): number; map(xs: any, f: (x: unknown, i: number) => unknown): unknown[]; filter(xs: any, f: (x: unknown) => unknown): unknown[]; every(xs: any, f: (x: unknown) => unknown): boolean; indexOf(xs: any, f: (x: unknown) => unknown): number; sum(xs: any): number } = __RX_STORES__ ? {
  len: x => T(x) ? ((x as any).ar ? storeGet(x, "length") : storeKeys(x).length) : plainLen(x),
  map: (xs, f) => { if (!T(xs)) return xs.map(f); const n = storeGet(xs, "length"); const r = new Array(n); for (let i = 0; i < n; i++) if (storeHas(xs, i)) r[i] = f(storeGet(xs, i), i); return r; },
  filter: (xs, f) => { if (!T(xs)) return xs.filter(f); const n = storeGet(xs, "length"); const r: unknown[] = []; for (let i = 0; i < n; i++) if (storeHas(xs, i)) { const x = storeGet(xs, i); if (f(x)) r.push(out(x)); } return r; },
  every: (xs, f) => { if (!T(xs)) return xs.every(f); const n = storeGet(xs, "length"); for (let i = 0; i < n; i++) if (storeHas(xs, i) && !f(storeGet(xs, i))) return false; return true; },
  indexOf: (xs, f) => { if (!T(xs)) return xs.findIndex(f); const n = storeGet(xs, "length"); for (let i = 0; i < n; i++) if (f(storeGet(xs, i))) return i; return -1; },
  sum: xs => { if (!T(xs)) return xs.reduce((a: number, b: number) => a + b, 0); const n = storeGet(xs, "length"); let s = 0; for (let i = 0; i < n; i++) if (storeHas(xs, i)) s += storeGet(xs, i); return s; },
} : {
  len: plainLen, map: (xs, f) => xs.map(f), filter: (xs, f) => xs.filter(f), every: (xs, f) => xs.every(f), indexOf: (xs, f) => xs.findIndex(f), sum: xs => xs.reduce((a: number, b: number) => a + b, 0),
};

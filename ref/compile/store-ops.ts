// Store reads and writes on a store's target, with no proxy between the compiled code and Solid's store (spec/11 CP-4a:
// the same store, called through `storeGet`/`storeSet` instead of through a Proxy's traps). A store value inside compiled
// code may be its target ("handle"); it leaves compiled code — into a JS function, a literal, a signal, a DOM attribute —
// as the proxy Solid makes for it then (`out`). Every helper takes either form, so a value that is not a target (a proxy
// from a memo, a plain object, the server's stores) reads as it always did.
import { $TARGET, isStoreTarget, storeGet, storeHas, storeKeys, storeProxy, storeSet, storeWrite } from "@solidjs/signals";

export const isT = isStoreTarget as (v: unknown) => boolean;
/** A value as JS sees it: a target as its proxy. */
export const out = (v: any): any => isStoreTarget(v) ? storeProxy(v) : v;
/** `o?.[k]`. */
export const get = (o: any, k: PropertyKey): any => isStoreTarget(o) ? storeGet(o, k) : o?.[k as any];
/** `o?.[k]` as a value that leaves: a store child as its proxy. */
export const val = (o: any, k: PropertyKey): any => { const r = isStoreTarget(o) ? storeGet(o, k) : o?.[k as any]; return isStoreTarget(r) ? storeProxy(r) : r; };
/** `o[k] = v` inside a store setter. */
export const set = (o: any, k: PropertyKey, v: unknown): void => { if (isStoreTarget(o)) storeSet(o, k, v); else o[k as any] = v; };
/** A store proxy's target; any other value as it is. */
export const handleOf = (v: any): any => { if (v === null || typeof v !== "object" || isStoreTarget(v)) return v; const t = v[$TARGET]; return t !== undefined && t.px === v ? t : v; };
/** The raw object under a store value (R-eq: `==` compares what the store holds). */
export const raw = (x: any): any => isStoreTarget(x) ? (x as any).v : (x && typeof x === "object" && x[$TARGET]) ? x[$TARGET].v : x;
/** An accessor's handle form: the same read, a store as its target. */
export const hacc = (acc: any): any => acc.h ?? acc;
/** The prelude over a list that may be a target: the reads `Array.prototype.<fn>` makes on a proxy, made on the target. */
export const B = {
  len: (x: any): number => isStoreTarget(x) ? ((x as any).ar ? storeGet(x, "length") : storeKeys(x).length) : (Array.isArray(x) || typeof x === "string") ? x.length : (typeof x === "object" && x) ? Object.keys(x).length : 0,
  map: (xs: any, f: (x: unknown, i: number) => unknown): unknown[] => { if (!isStoreTarget(xs)) return xs.map(f); const n = storeGet(xs, "length"); const r = new Array(n); for (let i = 0; i < n; i++) if (storeHas(xs, i)) r[i] = f(storeGet(xs, i), i); return r; },
  filter: (xs: any, f: (x: unknown) => unknown): unknown[] => { if (!isStoreTarget(xs)) return xs.filter(f); const n = storeGet(xs, "length"); const r: unknown[] = []; for (let i = 0; i < n; i++) if (storeHas(xs, i)) { const x = storeGet(xs, i); if (f(x)) r.push(out(x)); } return r; },
  every: (xs: any, f: (x: unknown) => unknown): boolean => { if (!isStoreTarget(xs)) return xs.every(f); const n = storeGet(xs, "length"); for (let i = 0; i < n; i++) if (storeHas(xs, i) && !f(storeGet(xs, i))) return false; return true; },
  indexOf: (xs: any, f: (x: unknown) => unknown): number => { if (!isStoreTarget(xs)) return xs.findIndex(f); const n = storeGet(xs, "length"); for (let i = 0; i < n; i++) if (f(storeGet(xs, i))) return i; return -1; },
  sum: (xs: any): number => { if (!isStoreTarget(xs)) return xs.reduce((a: number, b: number) => a + b, 0); const n = storeGet(xs, "length"); let s = 0; for (let i = 0; i < n; i++) if (storeHas(xs, i)) s += storeGet(xs, i); return s; },
};
/** A path write `x.a.b := v` (ST-2): Solid's setter scope around the one write, entered on the store's target (`storeWrite`)
 *  — no setter callback, no draft proxy. A store that is not a target (the server's) is written through its setter. */
export const pathWrite = (setStore: (f: (d: any) => unknown) => void, H: unknown) => (keys: (string | number)[], v: unknown): void => {
  if (isStoreTarget(H)) storeWrite(H as never, keys, v);
  else setStore((d: any) => { let o = d; for (const k of keys.slice(0, -1)) o = o[k]; o[keys[keys.length - 1]] = v; });
};

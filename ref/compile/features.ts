// The feature manifest at run time and at build time. The compiler's manifest (emit.ts `features`) becomes Solid's store
// switches: a bundler defines `__SOLID_STORE_<NAME>__` (build.ts), and Solid's `store-select` build folds the feature out.
// Under node (the runners) the same build reads the globals where it runs, so setting them per program prunes the same arms.
import type { Features } from "./emit.ts";
declare const __SOLID_STORE_FAMILIES__: boolean | undefined;
declare const __SOLID_STORE_OPTIMISTIC__: boolean | undefined;
const NAMES = ["accessors", "guards", "shallow", "families", "optimistic", "delete"] as const;
/** esbuild `define` entries for a manifest. */
export const defines = (f: Features): Record<string, string> => Object.fromEntries(NAMES.map(n => [`__SOLID_STORE_${n.toUpperCase()}__`, String(f[n])]));
/** The same switches as globals (node runners over Solid's `store-select` build). */
export function setGlobals(f: Features | undefined) { for (const n of NAMES) (globalThis as Record<string, unknown>)[`__SOLID_STORE_${n.toUpperCase()}__`] = f ? f[n] : true; }
/** The runtime's own arms for the features it lowers onto: folded with the store's when the manifest drops them. */
export const FAMILIES: boolean = typeof __SOLID_STORE_FAMILIES__ === "undefined" || __SOLID_STORE_FAMILIES__;
export const OPTIMISTIC: boolean = FAMILIES && (typeof __SOLID_STORE_OPTIMISTIC__ === "undefined" || __SOLID_STORE_OPTIMISTIC__);

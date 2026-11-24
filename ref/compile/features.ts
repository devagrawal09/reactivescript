// The feature manifest at run time and at build time. The compiler's manifest (emit.ts `features`) becomes Solid's store
// switches: a bundler defines `__SOLID_STORE_<NAME>__` (build.ts), and Solid's `store-select` build folds the feature out.
// Under node (the runners) the same build reads the globals where it runs, so setting them per program prunes the same arms.
import type { Features } from "./emit.ts";
const NAMES = ["accessors", "guards", "shallow", "families", "optimistic", "delete"] as const;
/** esbuild `define` entries for a manifest. */
export const defines = (f: Features): Record<string, string> => ({ ...Object.fromEntries(NAMES.map(n => [`__SOLID_STORE_${n.toUpperCase()}__`, String(f[n])])), __RX_STORES__: String(f.stores), __RX_FAMILIES__: String(f.families), __RX_OPTIMISTIC__: String(f.optimistic) });
/** The same switches as globals (node runners over Solid's `store-select` build). */
export function setGlobals(f: Features | undefined) { for (const n of NAMES) (globalThis as Record<string, unknown>)[`__SOLID_STORE_${n.toUpperCase()}__`] = f ? f[n] : true; }   // (`stores` is the runtime's own switch: a build-time constant here, so the runners keep it on)
/** The runtime's own arms (rt-web.ts, store-ops.ts) read three build constants, written bare so a bundler folds each site
 *  before it decides what is reachable: `__RX_STORES__` (any store at all), `__RX_FAMILIES__`, `__RX_OPTIMISTIC__`.
 *  Unbundled (the node runners) they are globals, all on. */
for (const n of ["__RX_STORES__", "__RX_FAMILIES__", "__RX_OPTIMISTIC__"]) (globalThis as Record<string, unknown>)[n] ??= true;
/** Every switch on (a development bundle). */
export const ALL_ON: Record<string, string> = { __RX_STORES__: "true", __RX_FAMILIES__: "true", __RX_OPTIMISTIC__: "true" };

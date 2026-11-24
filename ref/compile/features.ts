// The feature manifest at run time and at build time. The compiler's manifest (emit.ts `features`) becomes Solid's store
// switches: a bundler defines `__SOLID_STORE_<NAME>__` (build.ts), and Solid's `store-select` build folds the feature out.
// Under node (the runners) the same build reads the globals where it runs, so setting them per program prunes the same arms.
import type { Features } from "./emit.ts";
const NAMES = ["accessors", "guards", "shallow", "families", "optimistic", "delete"] as const;
/** Every `__rt` member and prelude function rt-web.ts guards (`__RX_USE_<member>__`, `__RX_B_<name>__`), read from its
 *  text, and the members each one calls on the app (`app.x`): a used member keeps those too. */
import { readFileSync } from "node:fs";
function runtimeMembers(): { members: string[]; prelude: string[]; calls: Map<string, string[]> } {
  const src = readFileSync(new URL("./rt-web.ts", import.meta.url), "utf8");
  const members = [...new Set([...src.matchAll(/!__RX_USE_(\w+?)__ \?/g)].map(m => m[1]))];
  const prelude = [...new Set([...src.matchAll(/!__RX_B_(\w+?)__ \?/g)].map(m => m[1]))];
  const calls = new Map<string, string[]>();
  const at = members.map(m => ({ m, i: src.indexOf(`    ${m}: !__RX_USE_${m}__`) })).sort((a, b) => a.i - b.i);
  at.forEach(({ m, i }, k) => { const seg = src.slice(i, at[k + 1]?.i ?? src.indexOf("\n  };\n  return app;", i)); calls.set(m, [...new Set([...seg.matchAll(/\bapp\.(\w+)/g)].map(x => x[1]))].filter(x => members.includes(x))); });
  return { members, prelude, calls };
}
/** esbuild `define` entries for a manifest: Solid's store switches, the runtime's areas, and one switch per runtime member
 *  and prelude function (on when the compiled program names it, or a member it names calls it). `hydrate`: the page was
 *  rendered on the server (SV-3); off, the views are lowered without hydration and the runtime bundles none of it. */
export function defines(f: Features | null, opts: { hydrate?: boolean } = {}): Record<string, string> {
  const { members, prelude, calls } = runtimeMembers();
  const used = new Set<string>(f ? f.rt : members);
  for (let grew = true; grew; ) { grew = false; for (const m of [...used]) for (const c of calls.get(m) ?? []) if (!used.has(c)) { used.add(c); grew = true; } }
  const d: Record<string, string> = { __RX_HYDRATE__: String(opts.hydrate ?? true), __RX_STORES__: String(f ? f.stores : true), __RX_FAMILIES__: String(f ? f.families : true), __RX_OPTIMISTIC__: String(f ? f.optimistic : true), __RX_GUESSES__: String(f ? f.guesses : true) };
  for (const n of NAMES) d[`__SOLID_STORE_${n.toUpperCase()}__`] = String(f ? f[n] : true);
  d.__SOLID_CORE_ASYNC__ = String(f ? f.asyncNodes : true);
  for (const m of members) d[`__RX_USE_${m}__`] = String(used.has(m));
  for (const b of prelude) d[`__RX_B_${b}__`] = String(f ? f.prelude.includes(b) : true);
  return d;
}
/** Every switch on (a development bundle, the hydration runner). */
export const ALL_ON = (): Record<string, string> => defines(null);
/** The same switches as globals (node runners over Solid's `store-select` build). */
export function setGlobals(f: Features | undefined) { for (const n of NAMES) (globalThis as Record<string, unknown>)[`__SOLID_STORE_${n.toUpperCase()}__`] = f ? f[n] : true; (globalThis as Record<string, unknown>).__SOLID_CORE_ASYNC__ = f ? f.asyncNodes : true; }

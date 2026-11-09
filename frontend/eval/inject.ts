// docs/EVAL.md, "TSX": the frontend derives each createEval site's binding interface (plan/resolve-v2.ts) and writes
// it into the call, so the runtime (eval/runtime.ts) checks code against the checker's types. This is the one source
// transform between the ReactiveScript frontend and Solid's compiler for a component with eval sites: it adds
// `interface: "…"` to each call's options and changes nothing else. A site whose interface cannot be derived (the
// enclosing component is outside plan v2) is refused unless the call already passes one.
import { parseSync } from 'oxc-parser/src-js/index';
import { loadTsxModules } from '../tsx/modules.ts';
import { checkModules, CheckError } from '../tsx/rx/compiler.ts';
import { resolvePlanV2 } from '../plan/resolve-v2.ts';
import { evalSitesOf } from './sites.ts';

export function injectInterfaces(entry: string, read: (path: string) => string | undefined): string {
  const source = read(entry);
  if (source === undefined) throw new Error('no module ' + entry);
  const set = loadTsxModules(entry, read);
  if (set.diags.length) throw new CheckError(set.diags);
  const checked = checkModules(set);
  if (checked.diags.length) throw new CheckError(checked.diags);
  resolvePlanV2(set);
  const sites = [...evalSitesOf(set.programs.get(set.entry)!).values()];
  const calls: { start: number; end: number; options?: { start: number; end: number; empty: boolean } }[] = [];
  const walk = (n: any): void => {
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (!n || typeof n !== 'object') return;
    if (n.type === 'CallExpression' && sites.some(s => s.at === n.start)) {
      const o = n.arguments[2];
      calls.push({ start: n.start, end: n.end, ...(o ? { options: { start: o.start, end: o.end, empty: o.properties.length === 0 } } : {}) });
    }
    for (const v of Object.values(n)) if (v && typeof v === 'object') walk(v);
  };
  walk(parseSync(entry, source, { sourceType: 'module', lang: 'tsx' }).program);
  if (calls.length !== sites.length) throw new Error('eval: ' + sites.length + ' sites, ' + calls.length + ' createEval calls');
  let out = source;
  for (const c of calls.sort((a, b) => b.start - a.start)) {
    const site = sites.find(s => s.at === c.start)!;
    if (site.options.interface !== undefined) continue;
    if (site.derived === undefined) throw new Error('eval: no interface for the createEval call at ' + c.start);
    const field = 'interface: ' + JSON.stringify(site.derived);
    if (c.options) out = out.slice(0, c.options.start + 1) + ' ' + field + (c.options.empty ? ' ' : ',') + out.slice(c.options.start + 1);
    else out = out.slice(0, c.end - 1) + ', { ' + field + ' }' + out.slice(c.end - 1);
  }
  return out;
}

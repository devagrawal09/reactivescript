// Request sites (docs/RESULTS.md, "Slice 6"; scenario format 2.2): a frames scenario addresses each request by the site
// that issued it, never by its wire function, so one scenario drives every placement. A site is a question memo
// (`issue`; a non-entry component's `Detail.issue`) or an action's await (`take/claim`; `ClaimButton.take/claim`).
// Each server function is awaited at one site (the builder refuses anything else, FRAMES_SITE_AMBIGUOUS), so a leg maps
// its wire functions to sites by name: the all-client twin's question `issue` calls `loadIssue`, the split's calls
// `Detail$server`.
import type { FramesPlan, FStep, FView } from '../plan/resolve-frames.ts';

/** Function name -> site. `placed`: the split's view (a sunk or owned question is its server component's call). */
export function siteNames(plan: FramesPlan, placed: boolean): Record<string, string> {
  const out: Record<string, string> = {};
  const add = (fn: string, site: string) => { if (out[fn] !== undefined && out[fn] !== site) throw new Error('FRAMES_SITE_AMBIGUOUS: ' + fn + ' is awaited at ' + out[fn] + ' and ' + site); out[fn] = site; };
  const steps = (ss: FStep[], at: string) => { for (const s of ss) { if (s.op === 'try') { steps(s.body, at); steps(s.catch, at); } else if (s.op === 'await') add(s.serverFn, at + '/' + s.serverFn); } };
  const comps = [{ name: '', memos: plan.memos, actions: plan.actions }, ...plan.components.map(c => ({ name: c.name + '.', memos: c.memos, actions: c.actions }))];
  for (const c of comps) {
    for (const m of c.memos) if ('await' in m) {
      const sc = placed ? plan.serverComponents.find(s => s.question.memo === m.name && (s.question.kind === 'sunk' ? c.name === '' : s.component + '.' === c.name)) : undefined;
      add(sc ? sc.name : m.await.serverFn, c.name + m.name);
    }
    for (const a of c.actions) steps(a.steps, c.name + a.name);
  }
  return out;
}

/** How many times each component is applied (a site under a `for` counts as many). */
export function applications(plan: FramesPlan): Map<string, number> {
  const out = new Map<string, number>();
  const comps = new Map(plan.components.map(c => [c.name, c]));
  const visit = (vs: FView[], times: number) => {
    for (const v of vs) {
      if (v.kind === 'component') { out.set(v.name, (out.get(v.name) ?? 0) + times); visit(comps.get(v.name)!.markup, times); }
      else if (v.kind === 'for') visit(v.children, Infinity);
      else if (v.kind === 'element') visit(v.children, times);
      else if (v.kind === 'show' || v.kind === 'loading' || v.kind === 'errored') { visit(v.children, times); visit(v.fallback, times); }
    }
  };
  visit(plan.markup, 1);
  return out;
}

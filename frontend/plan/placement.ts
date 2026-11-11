// Placement inference (plan/docs/PLAN-V2.md, "v2.2", rules PL-1..PL-9; docs/SLICE6-FRAMES.md §4): which component
// application sites of a frames program render on the server, as Solid 2 server components (Frames), and which stay
// client. It reads the all-client v2.2 plan, whose every read, write, call and region is a CP-6 fact checked in both
// directions (plan/resolve-frames.ts), plus the plan's static types (F-c). Client placement is always sound: the
// all-client program is the authored program. The inference is maximal server placement under the rules below; a site
// the rules cannot place stays client with the rule that kept it there.
//
// Client marks of a component C (any one makes C client-required; C's own markup, not its children's):
//   M1 a source; M2 a handler or an action; M3 a write (only in handlers and actions, so M2 covers it);
//   M4 a probe (pending/latest); M8 a loading or errored view; M9 a read of a through prop outside an island argument.
//   (M5 context, M6 client JS and M7 eval are refused by the v2.2 builder.)
// PL-3 server root (v1: a site of the entry, PL-1): a. C is server-eligible (no marks; every nested site is an inline
// server site or an island); b. not under a client `for`; c. exactly one server-fn question, owned by C (an async memo
// whose arguments read only C's wire props) or sunk (PL-4: an async memo of the entry passed as one argument and read
// nowhere else, never probed, refreshed or affected only in actions); d. every other wire argument is a literal or, with
// an owned question, a prop C reads only in that question's arguments.
// PL-5 islands: a client-required component inside a server subtree is a slot occurrence; its arguments are server
// values (scalars) or a through prop of C, verbatim; a stateful island under a server `for` makes C ineligible.
// PL-6 inline: an eligible component inside a server subtree renders there, and owns no question.
// PL-7 names: C$server, then C$server$2, … for roots of C that differ.
import type { FComponent, FExpr, FMemo, FramesPlan, FStep, FView, PropArg, ServerComponent } from './resolve-frames.ts';
import { printType, type Type } from './types.ts';

export type SitePath = (string | number)[];
export type Placement = {
  version: 1;
  client: { component: string; reason: string; site: SitePath }[];
  server: {
    component: string; fn: string; site: SitePath;
    question: { args: FExpr[]; kind: 'sunk' | 'owned'; memo: string; serverFn: string };
    props: Record<string, 'question' | 'wire' | 'through'>;
    inline: string[];
    slots: { args: string[]; component: string; name: string; through: string[] }[];
  }[];
  serverFns: string[]; serverHosts: string[];
};
export type Decision = { table: Placement; serverComponents: ServerComponent[]; annotate(plan: FramesPlan): void };

const walkExpr = (e: FExpr, f: (e: FExpr) => void): void => {
  f(e);
  const x = e as Record<string, unknown>;
  for (const k of ['object', 'array', 'left', 'right', 'value', 'test', 'then', 'else', 'body', 'code']) if (x[k] && typeof x[k] === 'object') walkExpr(x[k] as FExpr, f);
  if (Array.isArray(x.items)) for (const i of x.items as FExpr[]) walkExpr(i, f);
  if (Array.isArray(x.fields)) for (const fl of x.fields as { value: FExpr }[]) walkExpr(fl.value, f);
};
const walkSteps = (ss: FStep[], f: (e: FExpr) => void): void => {
  for (const s of ss) {
    if (s.op === 'try') { walkSteps(s.body, f); walkSteps(s.catch, f); continue; }
    if ('value' in s) walkExpr(s.value, f);
    if ('updater' in s) walkExpr(s.updater.body, f);
    if ('args' in s) s.args.forEach(a => walkExpr(a, f));
    if ('path' in s) for (const p of s.path ?? []) if ('index' in p) walkExpr(p.index, f);
  }
};
/** Every expression of a component outside its component views' arguments, and (separately) the views' arguments. */
function expressions(c: { sources: { seed: FExpr }[]; memos: FMemo[]; actions: { steps: FStep[] }[]; markup: FView[] }, f: (e: FExpr, where: 'body' | 'arg', site?: Extract<FView, { kind: 'component' }>, arg?: PropArg) => void) {
  for (const s of c.sources) walkExpr(s.seed, e => f(e, 'body'));
  for (const m of c.memos) ('await' in m ? m.await.args : [m.value]).forEach(a => walkExpr(a, e => f(e, 'body')));
  for (const a of c.actions) walkSteps(a.steps, e => f(e, 'body'));
  const views = (vs: FView[]) => {
    for (const v of vs) {
      if (v.kind === 'element') { for (const ev of v.events) walkSteps(ev.steps, e => f(e, 'body')); views(v.children); }
      else if (v.kind === 'text') walkExpr(v.value, e => f(e, 'body'));
      else if (v.kind === 'show') { walkExpr(v.when, e => f(e, 'body')); views(v.children); views(v.fallback); }
      else if (v.kind === 'for') { walkExpr(v.each, e => f(e, 'body')); views(v.children); }
      else if (v.kind === 'loading' || v.kind === 'errored') { views(v.fallback); views(v.children); }
      else if (v.kind === 'component') for (const p of v.props) if ('value' in p) walkExpr(p.value, e => f(e, 'arg', v, p));
    }
  };
  views(c.markup);
}
const hasEvents = (vs: FView[]): boolean => vs.some(v => v.kind === 'element' ? v.events.length > 0 || hasEvents(v.children) :
  v.kind === 'show' || v.kind === 'loading' || v.kind === 'errored' ? hasEvents(v.children) || hasEvents(v.fallback) : v.kind === 'for' ? hasEvents(v.children) : false);
const hasBoundary = (vs: FView[]): boolean => vs.some(v => v.kind === 'loading' || v.kind === 'errored' ||
  (v.kind === 'element' && hasBoundary(v.children)) || ((v.kind === 'show') && (hasBoundary(v.children) || hasBoundary(v.fallback))) || (v.kind === 'for' && hasBoundary(v.children)));

/** The component views of a markup list with their paths (view indices from the component's markup root; a
 *  `"fallback"` marks a Show's or boundary's fallback branch) and whether a `for` row encloses them. */
type SiteAt = { view: Extract<FView, { kind: 'component' }>; path: SitePath; underFor: boolean; locals: Map<string, Type> };
function sitesOf(vs: FView[], path: SitePath, underFor: boolean, out: SiteAt[] = [], locals: Map<string, Type> = new Map(), typeOf?: (e: FExpr, locals: Map<string, Type>) => Type): SiteAt[] {
  vs.forEach((v, i) => {
    const p = [...path, i];
    if (v.kind === 'component') out.push({ view: v, path: p, underFor, locals });
    else if (v.kind === 'element') sitesOf(v.children, p, underFor, out, locals, typeOf);
    else if (v.kind === 'show' || v.kind === 'loading' || v.kind === 'errored') { sitesOf(v.children, p, underFor, out, locals, typeOf); sitesOf(v.fallback, [...p, 'fallback'], underFor, out, locals, typeOf); }
    else if (v.kind === 'for') {
      let rows = locals;
      if (typeOf) { const t = typeOf(v.each, locals); rows = new Map(locals).set(v.item, t.k === 'array' ? t.item : t); }
      sitesOf(v.children, p, true, out, rows, typeOf);
    }
  });
  return out;
}

export function placement(plan: FramesPlan, exprType: (component: string, e: FExpr, locals: Map<string, Type>) => Type): Decision {
  const comps = new Map(plan.components.map(c => [c.name, c]));
  const entry: FComponent = { name: plan.component, props: [], sources: plan.sources, memos: plan.memos, actions: plan.actions, markup: plan.markup };
  const through = (c: FComponent) => new Set(c.props.filter(p => p.type === 'action').map(p => p.name));
  // Client marks (memoized per component).
  const markCache = new Map<string, string | null>();
  const mark = (c: FComponent): string | null => {
    if (markCache.has(c.name)) return markCache.get(c.name)!;
    let m: string | null = null;
    if (c.sources.length) m = 'M1';
    else if (c.actions.length || hasEvents(c.markup)) m = 'M2';
    else if (hasBoundary(c.markup)) m = 'M8';
    else {
      const t = through(c);
      expressions(c, (e, where, _site, arg) => {
        if (m) return;
        if (e.op === 'pending' || e.op === 'latest') m = 'M4';
        // A through prop is read verbatim as an island argument (arg value exactly `prop p`); anything else is M9.
        else if (e.op === 'prop' && t.has(e.name) && !(where === 'arg' && arg && 'value' in arg && arg.value === e)) m = 'M9';
      });
    }
    markCache.set(c.name, m);
    return m;
  };
  const asyncMemos = (c: FComponent) => c.memos.filter((m): m is Extract<FMemo, { await: unknown }> => 'await' in m);

  type Slot = { name: string; component: string; views: number[][]; sites: SitePath[]; args: string[]; through: string[]; resolve: Map<string, string> };
  type Sub = { ok: true; inline: string[]; slots: Slot[] } | { ok: false; reason: string };
  /** The server subtree of C: C's markup and its inline components' markup, with its islands. `forwards`: C's through
   *  props, mapped to the root's through props they forward. */
  const subtree = (c: FComponent, forwards: Map<string, string>, slots: Slot[], inline: string[], viewBase: number[]): Sub => {
    const m = mark(c);
    if (m) return { ok: false, reason: m };
    for (const s of sitesOf(c.markup, [], false, [], new Map(), (e, l) => exprType(c.name, e, l))) {
      const k = comps.get(s.view.name)!;
      const km = mark(k);
      if (km) {
        if (km === 'M1' && s.underFor) return { ok: false, reason: 'PL-5' };
        const args: string[] = [], thru: string[] = [];
        const resolve = new Map<string, string>();
        for (const p of s.view.props) {
          if ('forward' in p) {
            const root = forwards.get(p.forward);
            if (!root) return { ok: false, reason: 'PL-5' };
            thru.push(p.name); resolve.set(p.name, root);
          } else if ('action' in p) return { ok: false, reason: 'PL-5' };
          else {
            let bad = false;
            walkExpr(p.value, e => { if (e.op === 'prop' && through(c).has(e.name)) bad = true; });
            if (bad) return { ok: false, reason: 'PL-5' };
            const t = exprType(c.name, p.value, s.locals);
            if (t.k !== 'number' && t.k !== 'string' && t.k !== 'boolean') return { ok: false, reason: 'PL-5' };
            args.push(p.name);
          }
        }
        if (s.path.some(x => typeof x === 'string')) return { ok: false, reason: 'PL-5' };
        const view = [...viewBase, ...(s.path as number[])];
        const had = slots.find(x => x.name === k.name);
        if (had) {
          if (JSON.stringify(had.args) !== JSON.stringify(args) || JSON.stringify(had.through) !== JSON.stringify(thru) || JSON.stringify([...had.resolve]) !== JSON.stringify([...resolve])) return { ok: false, reason: 'PL-5' };
          had.views.push(view); had.sites.push([c.name, ...s.path]);
        } else slots.push({ name: k.name, component: k.name, views: [view], sites: [[c.name, ...s.path]], args, through: thru, resolve });
      } else {
        if (asyncMemos(k).length) return { ok: false, reason: 'PL-6' };
        const kf = new Map<string, string>();
        for (const p of s.view.props) {
          if ('forward' in p) { const root = forwards.get(p.forward); if (!root) return { ok: false, reason: 'PL-6' }; kf.set(p.name, root); }
          else if ('action' in p) return { ok: false, reason: 'PL-6' };
        }
        if (!inline.includes(k.name)) inline.push(k.name);
        const r = subtree(k, kf, slots, inline, [...viewBase, ...(s.path as number[]).map(Number)]);
        if (!r.ok) return r;
      }
    }
    return { ok: true, inline, slots };
  };

  // Reads of each entry memo, for PL-4.
  const readsOf = new Map<string, { where: 'body' | 'arg'; site?: Extract<FView, { kind: 'component' }>; arg?: PropArg; exact: boolean; probed: boolean }[]>();
  {
    const probedReads = new Set<FExpr>();
    expressions(entry, e => { if (e.op === 'pending' || e.op === 'latest') walkExpr(e.value, x => probedReads.add(x)); });
    expressions(entry, (e, where, site, arg) => {
      if (e.op !== 'read') return;
      const list = readsOf.get(e.source) ?? [];
      list.push({ where, site, arg, exact: !!arg && 'value' in arg && arg.value === e, probed: probedReads.has(e) });
      readsOf.set(e.source, list);
    });
  }
  const writesOf = (name: string) => {
    const out: { op: string; inAction: boolean }[] = [];
    const scan = (ss: FStep[], inAction: boolean) => { for (const s of ss) { if (s.op === 'try') { scan(s.body, inAction); scan(s.catch, inAction); } else if ('source' in s && s.source === name) out.push({ op: s.op, inAction }); } };
    for (const a of entry.actions) scan(a.steps, true);
    const views = (vs: FView[]) => { for (const v of vs) { if (v.kind === 'element') { for (const ev of v.events) scan(ev.steps, false); views(v.children); } else if ('children' in v) { views(v.children); if ('fallback' in v) views(v.fallback); } } };
    views(entry.markup);
    return out;
  };
  const sinkable = (q: string, site: Extract<FView, { kind: 'component' }>): boolean => {
    const m = entry.memos.find(m => m.name === q);
    if (!m || !('await' in m)) return false;
    const reads = readsOf.get(q) ?? [];
    if (reads.length !== 1 || !reads[0].exact || reads[0].site !== site || reads[0].probed) return false;
    return writesOf(q).every(w => (w.op === 'refresh' || w.op === 'affects') && w.inAction);
  };

  const table: Placement = { version: 1, client: [{ component: plan.component, reason: 'entry', site: [plan.component] }], server: [], serverFns: plan.serverFns.map(f => f.name).sort(), serverHosts: plan.serverHosts.map(h => h.name).sort() };
  const serverComponents: (ServerComponent & { key: string; site: Extract<FView, { kind: 'component' }>; sunk?: string })[] = [];
  const clientSites = (c: FComponent, reasonFor: (s: { view: Extract<FView, { kind: 'component' }>; path: SitePath }) => string | null) => {
    for (const s of sitesOf(c.markup, [], false)) {
      const reason = reasonFor(s);
      if (reason) table.client.push({ component: s.view.name, reason, site: [c.name, ...s.path] });
    }
  };
  const roots = new Map<Extract<FView, { kind: 'component' }>, { fn: string; sunk?: string }>();
  // Entry sites: server roots, or client with the failed rule.
  const decideSite = (s: { view: Extract<FView, { kind: 'component' }>; path: SitePath; underFor: boolean }): string | null => {
    const c = comps.get(s.view.name)!;
    const forwards = new Map<string, string>();
    for (const p of s.view.props) if ('action' in p) forwards.set(p.name, p.name);
    const sub = subtree(c, forwards, [], [], []);
    if (!sub.ok) return sub.reason === 'PL-5' || sub.reason === 'PL-6' ? sub.reason : sub.reason;
    if (s.underFor) return 'PL-3b';
    const owned = asyncMemos(c);
    const wire = s.view.props.filter((p): p is Extract<PropArg, { value: FExpr }> => 'value' in p);
    const sunkArgs = wire.filter(p => p.value.op === 'read' && sinkable(p.value.source, s.view));
    if (owned.length + sunkArgs.length !== 1) return 'PL-3c';
    const kind: 'sunk' | 'owned' = sunkArgs.length ? 'sunk' : 'owned';
    // PL-3d: the other wire arguments.
    const propsOfQuestion = new Set<string>();
    if (kind === 'owned') for (const a of owned[0].await.args) walkExpr(a, e => { if (e.op === 'prop') propsOfQuestion.add(e.name); });
    for (const p of wire) {
      if (kind === 'sunk' && p === sunkArgs[0]) continue;
      if (p.value.op === 'literal') continue;
      if (kind === 'owned' && propsOfQuestion.has(p.name)) {
        let elsewhere = false;
        expressions(c, (e, _where) => { if (e.op === 'prop' && e.name === p.name) elsewhere = true; });
        // Count the reads in the question's arguments: the prop may be read only there.
        let inQuestion = 0, total = 0;
        for (const a of owned[0].await.args) walkExpr(a, e => { if (e.op === 'prop' && e.name === p.name) inQuestion++; });
        expressions(c, e => { if (e.op === 'prop' && e.name === p.name) total++; });
        if (elsewhere && total === inQuestion) continue;
      }
      return 'PL-3d';
    }
    const question = kind === 'sunk'
      ? (() => { const q = entry.memos.find(m => m.name === (sunkArgs[0].value as { source: string }).source) as Extract<FMemo, { await: unknown }>; return { memo: q.name, kind, serverFn: q.await.serverFn, args: q.await.args }; })()
      : { memo: owned[0].name, kind, serverFn: owned[0].await.serverFn, args: owned[0].await.args };
    const params: string[] = [];
    const paramTypes = (e: FExpr) => printType(exprType(plan.component, e, new Map()));
    if (kind === 'sunk') for (const a of question.args) params.push(paramTypes(a));
    for (const p of wire) if (!(kind === 'sunk' && p === sunkArgs[0])) params.push(paramTypes(p.value));
    const props: Record<string, 'question' | 'wire' | 'through'> = {};
    for (const p of s.view.props) props[p.name] = 'value' in p ? (kind === 'sunk' && p === sunkArgs[0] ? 'question' : 'wire') : 'through';
    const slots = sub.slots.map(x => ({ name: x.name, component: x.component, views: x.views, args: x.args, through: x.through, from: Object.fromEntries(x.resolve) }));
    const key = JSON.stringify([c.name, question.serverFn, kind, params, slots.map(x => [x.name, x.args, x.through]), sub.inline, Object.entries(props)]);
    let fn = serverComponents.find(x => x.key === key)?.name;
    if (!fn) {
      const n = serverComponents.filter(x => x.component === c.name).length;
      fn = c.name + '$server' + (n ? '$' + (n + 1) : '');
      serverComponents.push({ key, site: s.view, name: fn, id: '', component: c.name, params, question: { memo: question.memo, kind }, slots, inline: [...sub.inline], ...(kind === 'sunk' ? { sunk: question.memo } : {}) });
    }
    roots.set(s.view, { fn, ...(kind === 'sunk' ? { sunk: question.memo } : {}) });
    table.server.push({ component: c.name, fn, site: [plan.component, ...s.path], question, props, inline: [...sub.inline].sort(), slots: slots.map(x => ({ args: [...x.args].sort(), component: x.component, name: x.name, through: [...x.through].sort() })) });
    for (const sl of sub.slots) for (const site of sl.sites) islands.push({ component: sl.component, reason: mark(comps.get(sl.component)!)!, site });
    return null;
  };
  const islands: Placement['client'] = [];
  clientSites(entry, s => decideSite(s as never));
  // Islands are client sites of the server-rendered components they are in. Every component rendered on the client (at
  // a client site of the entry, or as an island) renders its own sites on the client too (v1: server roots are sites
  // of the entry, PL-1).
  table.client.push(...islands);
  const clientRendered = [...new Set(table.client.filter(x => x.reason !== 'entry').map(x => x.component))];
  for (let i = 0; i < clientRendered.length; i++) {
    const c = comps.get(clientRendered[i])!;
    for (const s of sitesOf(c.markup, [], false)) {
      table.client.push({ component: s.view.name, reason: 'PL-1', site: [c.name, ...s.path] });
      if (!clientRendered.includes(s.view.name)) clientRendered.push(s.view.name);
    }
  }
  table.client.sort((a, b) => a.component < b.component ? -1 : a.component > b.component ? 1 : JSON.stringify(a.site) < JSON.stringify(b.site) ? -1 : 1);
  table.server.sort((a, b) => JSON.stringify(a.site) < JSON.stringify(b.site) ? -1 : 1);
  return {
    table: sortKeys(table) as Placement,
    serverComponents: serverComponents.map(({ key: _k, site: _s, sunk: _q, ...rest }) => rest),
    annotate(p: FramesPlan) {
      for (const [view, r] of roots) { view.place = 'server'; view.server = r.fn; if (r.sunk) { const m = p.memos.find(m => m.name === r.sunk); if (m && 'await' in m) m.sunk = r.fn; } }
    },
  };
}

/** Canonical JSON: object keys sorted, recursively (arrays keep their order). */
export function sortKeys(x: unknown): unknown {
  if (Array.isArray(x)) return x.map(sortKeys);
  if (x && typeof x === 'object') return Object.fromEntries(Object.keys(x as object).sort().map(k => [k, sortKeys((x as Record<string, unknown>)[k])]));
  return x;
}

// The placement fuzz's generator (docs/RESULTS.md, "Slice 6", "Placement fuzz"): seeded frames programs, each printed
// four ways — placement-free RX, the all-client TSX twin, its `db.d.rx` (with the server host table the native servers
// run), and an explicit split TSX (the oracle, N) from the generator's OWN placement model. That model is written here
// from the PL rules as a specification of the shapes this generator builds (each site recipe states the decision it
// expects and why); it never calls plan/placement.ts, so G1 compares two implementations.
//
// A program: a client root over 2–4 server fns (a row list, a record, a count, a top list, a one-row loader, a claim
// mutation) and 1–4 component sites in its loading boundary, chosen from recipes that exercise every rule: a sunk
// record or count (a server root), the same question read elsewhere (not sinkable: PL-3c), two questions (PL-3c), a prop
// the markup reads from client state (PL-3d), an owned question (a server root), a static component (the
// minimal-request rule, PL-3c), a stateful component (M1), a component with its own boundary (M8), a component in a
// client row (PL-3b), a structured island argument (PL-5), stateful islands under a server row (PL-5), stateless
// islands under a server row (placed), an inline component (PL-6), and sites under a Show.
import { rng } from '../../tsx/fuzz/gen.ts';
import type { Placement, SitePath } from '../../plan/placement.ts';
import { sortKeys } from '../../plan/placement.ts';
import type { HostSpec, Step, Target } from '../harness.ts';

type R = ReturnType<typeof rng>;
export type Recipe = 'record' | 'count' | 'pair' | 'owned' | 'owned-reactive' | 'static' | 'static-literal' | 'stateful' | 'boundary' | 'top' | 'top-stateful';
export type Site = { recipe: Recipe; show: boolean; variant: { elsewhere?: boolean; reactive?: boolean; structured?: boolean; inline?: boolean } };
export type Program = {
  seed: number;
  table: { id: number; title: string; body: string; owner: string }[];
  questions: { pick: boolean; total: boolean; top: boolean; one: boolean };
  sites: Site[];
  rowTag: boolean;
  affects: boolean;
  selected: number;
  /** The refusal family (docs/SLICE6-FRAMES.md 4.6): a form plan v2.2 refuses, added to an otherwise placeable program;
   *  both twins must refuse it with this form's code. Drawn from its own stream, so the rest of a seed's program is the
   *  same with or without it. */
  outside?: Outside;
};
export type Outside = 'ambiguous' | 'body' | 'children' | 'wire';
/** The diagnostic code each refused form must produce. */
export const OUTSIDE_CODE: Record<Outside, string> = { ambiguous: 'FRAMES_SITE_AMBIGUOUS', body: 'FRAMES_SERVER_FN_BODY', children: 'FRAMES_CHILDREN', wire: 'FRAMES_WIRE_TYPE' };

const TITLES = ['Crash on save', 'Slow search', 'Typo in footer', 'Dark mode', 'Login loop', 'Broken link'];
const BODIES = ['Stack trace attached', 'p95 is 4s', "'Copyrigth'", 'Too bright', 'After update', 'In the footer'];
const OWNERS = ['', '', 'ana', 'bo'];

export function generate(seed: number): Program {
  const r = rng(seed);
  const n = 3 + r.int(2);
  const ids = Array.from({ length: n }, (_, i) => i + 1);
  const table = ids.map(id => ({ id, title: TITLES[(id - 1 + seed) % TITLES.length], body: BODIES[(id + seed) % BODIES.length], owner: r.pick(OWNERS) }));
  // Recipes, each consuming at most one question.
  const sites: Site[] = [];
  const used = { pick: false, total: false, top: false, one: false };
  const recipes: Recipe[] = ['record', 'count', 'pair', 'owned', 'owned-reactive', 'static', 'static-literal', 'stateful', 'boundary', 'top', 'top-stateful'];
  const count = 1 + r.int(4);
  for (let k = 0; k < 12 && sites.length < count; k++) {
    const recipe = r.pick(recipes);
    const needs: (keyof typeof used)[] = recipe === 'record' ? ['pick'] : recipe === 'count' ? ['total'] : recipe === 'pair' ? ['pick', 'total'] : recipe === 'owned' || recipe === 'owned-reactive' ? ['one'] : recipe === 'top' || recipe === 'top-stateful' ? ['top'] : [];
    if (needs.some(q => used[q])) continue;
    // A stateless component appears once (each is its own component; a second copy adds nothing).
    if (sites.some(s => s.recipe === recipe)) continue;
    for (const q of needs) used[q] = true;
    const variant: Site['variant'] = {};
    if (recipe === 'record') {
      const v = r.int(6);
      if (v === 1) variant.elsewhere = true;
      else if (v === 2) variant.reactive = true;
      else if (v === 3) variant.structured = true;
      else if (v === 4) variant.inline = true;
    }
    if (recipe === 'count' && r.chance(0.25)) variant.elsewhere = true;
    sites.push({ recipe, show: r.chance(0.25), variant });
  }
  const o = rng(seed + 1_000_003);
  const outside = o.chance(0.1) ? o.pick<Outside>(['ambiguous', 'body', 'children', 'wire']) : undefined;
  return { seed, table, questions: used, sites, rowTag: r.chance(0.2), affects: r.chance(0.3), selected: r.pick(ids), ...(outside ? { outside } : {}) };
}

// ------------------------------------------------------------------------------------------------ the server side

export function hostSpec(p: Program): HostSpec {
  const hosts: HostSpec['hosts'] = [
    { name: 'rowsOf', kind: 'list', fields: ['id', 'title', 'owner'] },
    { name: 'claimRow', kind: 'assign', field: 'owner', value: 'me' },
  ];
  if (p.questions.pick) hosts.push({ name: 'rowOf', kind: 'record', fields: ['id', 'title', 'body', 'owner'] });
  if (p.questions.total) hosts.push({ name: 'countOpen', kind: 'count', field: 'owner', equals: '' });
  if (p.questions.top) hosts.push({ name: 'topOf', kind: 'list', fields: ['id', 'title'] });
  if (p.questions.one) hosts.push({ name: 'titleOf', kind: 'scalar', field: 'title' });
  return { table: p.table, hosts };
}

function dRx(p: Program): string {
  const lines = ['export server pure fn rowsOf(): { id: number, title: string, owner: string }[]', 'export server fn claimRow(id: number): string'];
  if (p.questions.pick) lines.push('export server pure fn rowOf(id: number): { id: number, title: string, body: string, owner: string }');
  if (p.questions.total) lines.push('export server pure fn countOpen(): number');
  if (p.questions.top) lines.push('export server pure fn topOf(): { id: number, title: string }[]');
  if (p.questions.one) lines.push('export server pure fn titleOf(id: number): string');
  return lines.join('\n') + '\n';
}

/** The server fns: name, params, body (host awaited), what each returns. */
function serverFns(p: Program) {
  const fns: { name: string; params: [string, string][]; host: string; args: string[]; ret: (bind: string) => string; tsRet: (bind: string) => string }[] = [
    { name: 'loadRows', params: [], host: 'rowsOf', args: [], ret: b => b, tsRet: b => b },
  ];
  if (p.questions.pick) fns.push({ name: 'loadPick', params: [['id', 'number']], host: 'rowOf', args: ['id'], ret: b => '{ id: ' + b + '.id, title: ' + b + '.title, body: ' + b + '.body, owner: ' + b + '.owner }', tsRet: b => '{ id: ' + b + '.id, title: ' + b + '.title, body: ' + b + '.body, owner: ' + b + '.owner }' });
  if (p.questions.total) fns.push({ name: 'loadTotal', params: [], host: 'countOpen', args: [], ret: b => b, tsRet: b => b });
  if (p.questions.top) fns.push({ name: 'loadTop', params: [], host: 'topOf', args: [], ret: b => b, tsRet: b => b });
  if (p.questions.one) fns.push({ name: 'loadOne', params: [['id', 'number']], host: 'titleOf', args: ['id'], ret: b => '{ title: ' + b + ' }', tsRet: b => '{ title: ' + b + ' }' });
  fns.push({ name: 'act', params: [['id', 'number']], host: 'claimRow', args: ['id'], ret: b => b, tsRet: b => b });
  return fns;
}

// ------------------------------------------------------------------------------------------------ the components

type C = { name: string; recipe: Recipe | 'island' | 'chip' | 'chip-stateful' | 'inline' | 'row' };

/** The components a program declares, in declaration order. */
function components(p: Program): C[] {
  const out: C[] = [];
  const add = (c: C) => { if (!out.some(x => x.name === c.name)) out.push(c); };
  for (const s of p.sites) {
    if (s.recipe === 'record') { add({ name: 'ActButton', recipe: 'island' }); if (s.variant.inline) add({ name: 'Tagline', recipe: 'inline' }); add({ name: 'RecordView', recipe: 'record' }); }
    if (s.recipe === 'count') add({ name: 'CountView', recipe: 'count' });
    if (s.recipe === 'pair') add({ name: 'PairView', recipe: 'pair' });
    if (s.recipe === 'owned') add({ name: 'Card', recipe: 'owned' });
    if (s.recipe === 'owned-reactive') add({ name: 'Card', recipe: 'owned-reactive' });
    if (s.recipe === 'static') add({ name: 'Banner', recipe: 'static' });
    if (s.recipe === 'static-literal') add({ name: 'Notice', recipe: 'static-literal' });
    if (s.recipe === 'stateful') add({ name: 'Counter', recipe: 'stateful' });
    if (s.recipe === 'boundary') add({ name: 'Boxed', recipe: 'boundary' });
    if (s.recipe === 'top') { add({ name: 'Chip', recipe: 'chip' }); add({ name: 'TopList', recipe: 'top' }); }
    if (s.recipe === 'top-stateful') { add({ name: 'Toggle', recipe: 'chip-stateful' }); add({ name: 'TopToggles', recipe: 'top-stateful' }); }
  }
  if (p.rowTag) add({ name: 'RowTag', recipe: 'row' });
  return out;
}

const q = (s: string) => JSON.stringify(s);

/** A component's RX declaration and its TSX twin. `split`: N's client print (islands) — same text as the twin. */
function componentText(c: C, p: Program): { rx: string; tsx: string } {
  const rec = '{ id: number; title: string; body: string; owner: string }';
  switch (c.recipe) {
    case 'island': {
      const structured = p.sites.some(s => s.recipe === 'record' && s.variant.structured);
      if (structured) return {
        rx: 'component ActButton(props) {\n  <button onClick={() => { props.act(props.item.id) }}>{props.item.owner == "" ? "take" : "taken by " + props.item.owner}</button>\n}',
        tsx: 'function ActButton(props: { item: ' + rec + '; act: (id: number) => void }) {\n  return <button onClick={() => props.act(props.item.id)}>{"" + (props.item.owner === "" ? "take" : "taken by " + props.item.owner)}</button>;\n}',
      };
      return {
        rx: 'component ActButton(props) {\n  <button onClick={() => { props.act(props.id) }}>{props.owner == "" ? "take" : "taken by " + props.owner}</button>\n}',
        tsx: 'function ActButton(props: { id: number; owner: string; act: (id: number) => void }) {\n  return <button onClick={() => props.act(props.id)}>{"" + (props.owner === "" ? "take" : "taken by " + props.owner)}</button>;\n}',
      };
    }
    case 'inline': return {
      rx: 'component Tagline(props) {\n  <small>{"by " + props.text}</small>\n}',
      tsx: 'function Tagline(props: { text: string }) {\n  return <small>{"by " + props.text}</small>;\n}',
    };
    case 'record': {
      const s = p.sites.find(s => s.recipe === 'record')!;
      const island = s.variant.structured ? '<ActButton item={props.item} act={props.act} />' : '<ActButton id={props.item.id} owner={props.item.owner} act={props.act} />';
      const tisland = island;
      const label = s.variant.reactive ? '<em>{props.label}</em>' : '';
      const tag = s.variant.inline ? '<Tagline text={props.item.owner} />' : '';
      const extra = s.variant.reactive ? '; label: string' : '';
      return {
        rx: 'component RecordView(props) {\n  <article><h2>{props.item.title}</h2>' + label + '<p>{props.item.body}</p>' + tag + island + '</article>\n}',
        tsx: 'function RecordView(props: { item: ' + rec + extra + '; act: (id: number) => void }) {\n  return <article><h2>{props.item.title}</h2>' + label + '<p>{props.item.body}</p>' + tag + tisland + '</article>;\n}',
      };
    }
    case 'count': return {
      rx: 'component CountView(props) {\n  <p>{"" + props.n + " open"}</p>\n}',
      tsx: 'function CountView(props: { n: number }) {\n  return <p>{"" + props.n + " open"}</p>;\n}',
    };
    case 'pair': return {
      rx: 'component PairView(props) {\n  <div><b>{props.item.title}</b><i>{"" + props.n}</i></div>\n}',
      tsx: 'function PairView(props: { item: ' + rec + '; n: number }) {\n  return <div><b>{props.item.title}</b><i>{"" + props.n}</i></div>;\n}',
    };
    case 'owned': return {
      rx: 'component Card(props) {\n  c = await loadOne(props.id);\n  <div><b>{c.title}</b></div>\n}',
      tsx: 'function Card(props: { id: number }) {\n  const c = createMemo(() => loadOne(props.id));\n  return <div><b>{c().title}</b></div>;\n}',
    };
    case 'owned-reactive': return {
      rx: 'component Card(props) {\n  c = await loadOne(props.id);\n  <div><b>{c.title}</b><i>{"#" + props.id}</i></div>\n}',
      tsx: 'function Card(props: { id: number }) {\n  const c = createMemo(() => loadOne(props.id));\n  return <div><b>{c().title}</b><i>{"#" + props.id}</i></div>;\n}',
    };
    case 'static': return {
      rx: 'component Banner(props) {\n  <h3>Open issues</h3>\n}',
      tsx: 'function Banner() {\n  return <h3>Open issues</h3>;\n}',
    };
    case 'static-literal': return {
      rx: 'component Notice(props) {\n  <h4>{"Note: " + props.text}</h4>\n}',
      tsx: 'function Notice(props: { text: string }) {\n  return <h4>{"Note: " + props.text}</h4>;\n}',
    };
    case 'stateful': return {
      rx: 'component Counter(props) {\n  source n := 0;\n  <button onClick={() => { n := n + 1 }}>{"Clicks " + n}</button>\n}',
      tsx: 'function Counter() {\n  const [n, setN] = createSignal(0);\n  return <button onClick={() => setN(n() + 1)}>{"Clicks " + n()}</button>;\n}',
    };
    case 'boundary': return {
      rx: 'component Boxed(props) {\n  <div>{loading fallback { <i>wait</i> } { <span>boxed</span> }}</div>\n}',
      tsx: 'function Boxed() {\n  return <div><Loading fallback={<i>wait</i>}><span>boxed</span></Loading></div>;\n}',
    };
    case 'chip': return {
      rx: 'component Chip(props) {\n  <button onClick={() => { props.act(props.id) }}>{props.label}</button>\n}',
      tsx: 'function Chip(props: { id: number; label: string; act: (id: number) => void }) {\n  return <button onClick={() => props.act(props.id)}>{props.label}</button>;\n}',
    };
    case 'top': return {
      rx: 'component TopList(props) {\n  <ul>{for x in props.items { <li><Chip id={x.id} label={x.title} act={props.act} /></li> }}</ul>\n}',
      tsx: 'function TopList(props: { items: { id: number; title: string }[]; act: (id: number) => void }) {\n  return <ul><For each={props.items}>{(x) => <li><Chip id={x.id} label={x.title} act={props.act} /></li>}</For></ul>;\n}',
    };
    case 'chip-stateful': return {
      rx: 'component Toggle(props) {\n  source lit := false;\n  <button onClick={() => { lit := lit ? false : true }}>{lit ? props.label : "-"}</button>\n}',
      tsx: 'function Toggle(props: { label: string }) {\n  const [lit, setLit] = createSignal(false);\n  return <button onClick={() => setLit(lit() ? false : true)}>{"" + (lit() ? props.label : "-")}</button>;\n}',
    };
    case 'top-stateful': return {
      rx: 'component TopToggles(props) {\n  <ul>{for x in props.items { <li><Toggle label={x.title} /></li> }}</ul>\n}',
      tsx: 'function TopToggles(props: { items: { id: number; title: string }[] }) {\n  return <ul><For each={props.items}>{(x) => <li><Toggle label={x.title} /></li>}</For></ul>;\n}',
    };
    case 'row': return {
      rx: 'component RowTag(props) {\n  <small>{props.label}</small>\n}',
      tsx: 'function RowTag(props: { label: string }) {\n  return <small>{props.label}</small>;\n}',
    };
  }
}

/** The entry's site markup for a recipe: RX, TSX twin. */
function siteText(s: Site): { rx: string; tsx: string } {
  switch (s.recipe) {
    case 'record': {
      const label = s.variant.reactive ? ' label={mode}' : '';
      return { rx: '<RecordView item={pick}' + label + ' act={take} />', tsx: '<RecordView item={pick()}' + (s.variant.reactive ? ' label={mode()}' : '') + ' act={take} />' };
    }
    case 'count': return { rx: '<CountView n={total} />', tsx: '<CountView n={total()} />' };
    case 'pair': return { rx: '<PairView item={pick} n={total} />', tsx: '<PairView item={pick()} n={total()} />' };
    case 'owned': case 'owned-reactive': return { rx: '<Card id={selected} />', tsx: '<Card id={selected()} />' };
    case 'static': return { rx: '<Banner />', tsx: '<Banner />' };
    case 'static-literal': return { rx: '<Notice text="read me" />', tsx: '<Notice text="read me" />' };
    case 'stateful': return { rx: '<Counter />', tsx: '<Counter />' };
    case 'boundary': return { rx: '<Boxed />', tsx: '<Boxed />' };
    case 'top': return { rx: '<TopList items={top} act={take} />', tsx: '<TopList items={top()} act={take} />' };
    case 'top-stateful': return { rx: '<TopToggles items={top} />', tsx: '<TopToggles items={top()} />' };
  }
}

// ------------------------------------------------------------------------------------------------ the generator's placement model

/** The decision the generator's model expects for a site, and why (the PL rule a recipe was built to exercise). */
export function expectedDecision(p: Program, s: Site): { server: false; reason: string } | { server: true; fn: string; question: 'sunk' | 'owned'; memo: string; serverFn: string } {
  switch (s.recipe) {
    case 'record':
      if (s.variant.elsewhere) return { server: false, reason: 'PL-3c' };   // `pick` read by the entry too: not sinkable
      if (s.variant.reactive) return { server: false, reason: 'PL-3d' };    // label={mode}: a client value the markup reads
      if (s.variant.structured) return { server: false, reason: 'PL-5' };   // a record island argument (v1: scalars)
      return { server: true, fn: 'RecordView$server', question: 'sunk', memo: 'pick', serverFn: 'loadPick' };
    case 'count':
      if (s.variant.elsewhere) return { server: false, reason: 'PL-3c' };
      return { server: true, fn: 'CountView$server', question: 'sunk', memo: 'total', serverFn: 'loadTotal' };
    case 'pair': return { server: false, reason: 'PL-3c' };                 // two questions
    case 'owned': return { server: true, fn: 'Card$server', question: 'owned', memo: 'c', serverFn: 'loadOne' };
    case 'owned-reactive': return { server: false, reason: 'PL-3d' };       // `id` read by the markup too
    case 'static': case 'static-literal': return { server: false, reason: 'PL-3c' };   // no question: minimal request
    case 'stateful': return { server: false, reason: 'M1' };
    case 'boundary': return { server: false, reason: 'M8' };
    case 'top': return { server: true, fn: 'TopList$server', question: 'sunk', memo: 'top', serverFn: 'loadTop' };
    case 'top-stateful': return { server: false, reason: 'PL-5' };          // a stateful island under a server row
  }
}

/** The entry's markup paths: sites in order (index in the loading's children), the row, the elsewhere headers. */
function layout(p: Program) {
  // section > [button, errored > loading > [(h1 elsewhere)?, sites (show-wrapped)…, for]], em
  const head = p.sites.some(s => s.variant.elsewhere) ? 1 : 0;
  const errored = 1;
  const sitePath = (k: number): SitePath => {
    const base: SitePath = ['App', 0, errored, 0, head + k];
    return p.sites[k].show ? [...base, 0] : base;
  };
  return { errored, sitePath, forIndex: head + p.sites.length };
}

/** The placement table the generator's model expects (canonical JSON, as plan/placement.ts writes it). */
export function expectedPlacement(p: Program): Placement {
  const L = layout(p);
  const client: Placement['client'] = [{ component: 'App', reason: 'entry', site: ['App'] }];
  const server: Placement['server'] = [];
  const clientRendered: string[] = [];
  p.sites.forEach((s, k) => {
    const d = expectedDecision(p, s);
    const comp = components(p).find(c => c.recipe === s.recipe)!.name;
    if (!d.server) { client.push({ component: comp, reason: d.reason, site: L.sitePath(k) }); clientRendered.push(comp); return; }
    const slots: Placement['server'][number]['slots'] = [];
    const props: Record<string, 'question' | 'wire' | 'through'> = {};
    const inline: string[] = [];
    let args: unknown[] = [];
    if (s.recipe === 'record') {
      props.item = 'question'; props.act = 'through';
      args = [{ op: 'read', source: 'selected' }];
      slots.push({ args: ['id', 'owner'], component: 'ActButton', name: 'ActButton', through: ['act'] });
      // The island's site in RecordView: article > [h2, p, (Tagline), ActButton].
      client.push({ component: 'ActButton', reason: 'M2', site: ['RecordView', 0, s.variant.inline ? 3 : 2] });
      if (s.variant.inline) inline.push('Tagline');
    } else if (s.recipe === 'count') props.n = 'question';
    else if (s.recipe === 'owned') { props.id = 'wire'; args = [{ op: 'prop', name: 'id' }]; }
    else if (s.recipe === 'top') {
      props.items = 'question'; props.act = 'through';
      slots.push({ args: ['id', 'label'], component: 'Chip', name: 'Chip', through: ['act'] });
      client.push({ component: 'Chip', reason: 'M2', site: ['TopList', 0, 0, 0, 0] });
    }
    server.push({ component: comp, fn: d.fn, site: L.sitePath(k), question: { args, kind: d.question, memo: d.memo, serverFn: d.serverFn }, props, inline, slots });
  });
  if (p.rowTag) client.push({ component: 'RowTag', reason: 'PL-3b', site: ['App', 0, L.errored, 0, L.forIndex, 0, 2] });
  // Components rendered on the client render their sites there (v1: server roots are sites of the entry).
  for (const c of clientRendered) {
    if (c === 'RecordView') {
      const s = p.sites.find(s => s.recipe === 'record')!;
      if (s.variant.inline) client.push({ component: 'Tagline', reason: 'PL-1', site: ['RecordView', 0, s.variant.reactive ? 3 : 2] });
      client.push({ component: 'ActButton', reason: 'PL-1', site: ['RecordView', 0, (s.variant.reactive ? 3 : 2) + (s.variant.inline ? 1 : 0)] });
    }
    if (c === 'TopToggles') client.push({ component: 'Toggle', reason: 'PL-1', site: ['TopToggles', 0, 0, 0, 0] });
  }
  client.sort((a, b) => a.component < b.component ? -1 : a.component > b.component ? 1 : JSON.stringify(a.site) < JSON.stringify(b.site) ? -1 : 1);
  server.sort((a, b) => JSON.stringify(a.site) < JSON.stringify(b.site) ? -1 : 1);
  const fns = serverFns(p).map(f => f.name).sort();
  const hosts = hostSpec(p).hosts.map(h => h.name).sort();
  return sortKeys({ version: 1, client, server, serverFns: fns, serverHosts: hosts }) as Placement;
}

// ------------------------------------------------------------------------------------------------ printing

/** The program's files: `app.rx`, `app.tsx` (the all-client twin), `db.d.rx`, and N's `app.server.tsx` +
 *  `app.split.tsx`. */
export function emit(p: Program): Record<string, string> {
  const comps = components(p);
  const fns = serverFns(p);
  const hostNames = hostSpec(p).hosts.map(h => h.name);
  const elsewhere = p.sites.some(s => s.variant.elsewhere);
  const pickElsewhere = p.sites.some(s => s.recipe === 'record' && s.variant.elsewhere);
  const totalElsewhere = p.sites.some(s => s.recipe === 'count' && s.variant.elsewhere);
  // ---- RX
  const rx: string[] = ['import { ' + hostNames.join(', ') + ' } from "./db";', ''];
  for (const f of fns) rx.push('server fn ' + f.name + '(' + f.params.map(([n, t]) => n + ': ' + t).join(', ') + ') {', '  let v = await ' + f.host + '(' + f.args.join(', ') + ');', '  return ' + f.ret('v') + ';', '}');
  rx.push('');
  for (const c of comps) rx.push(componentText(c, p).rx, '');
  const memos: { name: string; rx: string; tsx: string }[] = [{ name: 'rows', rx: 'await loadRows()', tsx: 'loadRows()' }];
  if (p.questions.pick) memos.push({ name: 'pick', rx: 'await loadPick(selected)', tsx: 'loadPick(selected())' });
  if (p.questions.total) memos.push({ name: 'total', rx: 'await loadTotal()', tsx: 'loadTotal()' });
  if (p.questions.top) memos.push({ name: 'top', rx: 'await loadTop()', tsx: 'loadTop()' });
  memos.push({ name: 'shown', rx: 'filter(rows, r => mode == "all" || r.owner == "")', tsx: 'rows().filter((r) => mode() === "all" || r.owner === "")' });
  const refreshes = memos.filter(m => m.rx.startsWith('await')).map(m => m.name);
  const affected = p.affects && p.questions.pick ? 'pick' : undefined;
  rx.push('export default component App() {', '  source mode := "all";', '  source selected := ' + p.selected + ';', '  source status := "";');
  for (const m of memos) rx.push('  ' + m.name + ' = ' + m.rx + ';');
  rx.push('  action take(id: number) {', ...(affected ? ['    affects ' + affected + ';'] : []), '    try {', '      let w = await act(id);', ...refreshes.map(n => '      refresh ' + n + ';'), '      status := "#" + id + " to " + w;', '    } catch (e) {', '      status := "failed #" + id;', '    }', '  }');
  const parts = (tsx: boolean) => [...(pickElsewhere ? [tsx ? 'pick().title' : 'pick.title'] : []), ...(totalElsewhere ? [tsx ? '"" + total()' : '"" + total'] : [])].join(' + " " + ');
  const head = elsewhere ? '<h1>{' + parts(false) + '}</h1>' : '';
  const thead = elsewhere ? '<h1>{' + parts(true) + '}</h1>' : '';
  const rowRx = '<p>{r.title}<button onClick={() => { selected := r.id }}>show</button>' + (p.rowTag ? '<RowTag label={r.title} />' : '') + '</p>';
  const rowTsx = '<p>{r.title}<button onClick={() => setSelected(r.id)}>show</button>' + (p.rowTag ? '<RowTag label={r.title} />' : '') + '</p>';
  const sitesRx = p.sites.map(s => s.show ? '{if mode == "all" { ' + siteText(s).rx + ' }}' : siteText(s).rx).join('\n        ');
  const sitesTsx = p.sites.map(s => s.show ? '<Show when={mode() === "all"}>' + siteText(s).tsx + '</Show>' : siteText(s).tsx).join('');
  rx.push('  <section>', '    <button onClick={() => { mode := mode == "all" ? "open" : "all" }}>{"Mode: " + mode}</button>',
    '    {errored fallback(e) { <p>Could not load</p> } {', '      loading fallback { <i>Loading…</i> } {', ...(head ? ['        ' + head] : []), '        ' + sitesRx, '        for r in shown { ' + rowRx + ' }', '      }', '    }}', '    <em>{status}</em>', '  </section>', '}');
  // ---- TSX twin
  const uses = (n: string) => new RegExp('\\b' + n + '\\b').test(rx.join('\n'));
  const prims = ['action', 'createMemo', 'createSignal', 'Errored', 'For', 'Loading', 'refresh', ...(affected ? ['affects'] : []), ...(p.sites.some(s => s.show) ? ['Show'] : [])].sort();
  void uses;
  const tsx: string[] = ['import { ' + prims.join(', ') + ' } from "solid-js";', 'import { ' + hostNames.join(', ') + ' } from "./db";', ''];
  for (const f of fns) tsx.push('async function ' + f.name + '(' + f.params.map(([n, t]) => n + ': ' + t).join(', ') + ') {', '  "use server";', '  const v = await ' + f.host + '(' + f.args.join(', ') + ');', '  return ' + f.tsRet('v') + ';', '}');
  tsx.push('');
  for (const c of comps) tsx.push(componentText(c, p).tsx, '');
  tsx.push('export default function App() {', '  const [mode, setMode] = createSignal("all");', '  const [selected, setSelected] = createSignal(' + p.selected + ');', '  const [status, setStatus] = createSignal("");');
  for (const m of memos) tsx.push('  const ' + m.name + ' = createMemo(() => ' + m.tsx + ');');
  tsx.push('  const take = action(function* (id: number) {', ...(affected ? ['    affects(' + affected + ');'] : []), '    try {', '      const w: string = yield act(id);', ...refreshes.map(n => '      refresh(' + n + ');'), '      setStatus("#" + id + " to " + w);', '    } catch (e) {', '      setStatus("failed #" + id);', '    }', '  });');
  tsx.push('  return (', '    <section><button onClick={() => setMode(mode() === "all" ? "open" : "all")}>{"Mode: " + mode()}</button><Errored fallback={(e) => <p>Could not load</p>}><Loading fallback={<i>Loading…</i>}>' + thead + sitesTsx + '<For each={shown()}>{(r) => ' + rowTsx + '}</For></Loading></Errored><em>{status()}</em></section>', '  );', '}');
  const files = { 'app.rx': rx.join('\n') + '\n', 'app.tsx': tsx.join('\n') + '\n', 'db.d.rx': dRx(p), ...splitFiles(p, comps, fns, hostNames, memos, refreshes, affected, thead, rowTsx) };
  if (p.outside) outsideForm(p.outside, files);
  return files;
}

/** Adds a refused form to both twins (the split files stay as they are: the program never reaches a leg). */
function outsideForm(o: Outside, f: Record<string, string>) {
  const edit = (file: string, from: string, to: string) => {
    if (!f[file].includes(from)) throw new Error('outsideForm ' + o + ': no ' + JSON.stringify(from) + ' in ' + file);
    f[file] = f[file].replace(from, to);
  };
  if (o === 'ambiguous') {
    // loadRows awaited at a second site.
    edit('app.rx', '  rows = await loadRows();\n', '  rows = await loadRows();\n  again = await loadRows();\n');
    edit('app.rx', 'loading fallback { <i>Loading…</i> } {\n', 'loading fallback { <i>Loading…</i> } {\n        <b>{"" + again.length}</b>\n');
    edit('app.tsx', '  const rows = createMemo(() => loadRows());\n', '  const rows = createMemo(() => loadRows());\n  const again = createMemo(() => loadRows());\n');
    edit('app.tsx', '<Loading fallback={<i>Loading…</i>}>', '<Loading fallback={<i>Loading…</i>}><b>{"" + again().length}</b>');
  } else if (o === 'body') {
    // A non-await binding in a server fn body.
    edit('app.rx', 'server fn loadRows() {\n', 'server fn loadRows() {\n  let n = 1;\n');
    edit('app.tsx', 'async function loadRows() {\n  "use server";\n', 'async function loadRows() {\n  "use server";\n  const n = 1;\n');
  } else if (o === 'children') {
    // A component reading props.children.
    edit('app.rx', 'export default component App', 'component Box(props) {\n  <div>{props.children}</div>\n}\n\nexport default component App');
    edit('app.rx', '<em>{status}</em>', '<em>{status}</em><Box><b>boxed</b></Box>');
    edit('app.tsx', 'export default function App', 'function Box(props: { children: JSX.Element }) {\n  return <div>{props.children}</div>;\n}\n\nexport default function App');
    edit('app.tsx', '<em>{status()}</em>', '<em>{status()}</em><Box><b>boxed</b></Box>');
  } else {
    // A server fn parameter outside the wire scalars.
    edit('app.rx', '\nserver fn act(', '\nserver fn probe(flags: number[]) {\n  let v = await rowsOf();\n  return v;\n}\nserver fn act(');
    edit('app.tsx', '\nasync function act(', '\nasync function probe(flags: number[]) {\n  "use server";\n  const v = await rowsOf();\n  return v;\n}\nasync function act(');
  }
}

/** N, the explicit split, from the generator's own model: server roots become `<C>$server` functions and frames. */
function splitFiles(p: Program, comps: C[], fns: ReturnType<typeof serverFns>, hostNames: string[], memos: { name: string; tsx: string }[], refreshes: string[], affected: string | undefined, thead: string, rowTsx: string): Record<string, string> {
  const server: string[] = ['import { ' + hostNames.join(', ') + ' } from "./db";', ''];
  for (const f of fns) server.push('export async function ' + f.name + '(' + f.params.map(([n, t]) => n + ': ' + t).join(', ') + ') {', '  "use server";', '  const v = await ' + f.host + '(' + f.args.join(', ') + ');', '  return ' + f.tsRet('v') + ';', '}', '');
  const roots = p.sites.map((s, k) => ({ s, k, d: expectedDecision(p, s) })).filter(x => x.d.server);
  const serverComponents = new Set<string>();
  for (const { s, d } of roots) {
    if (!d.server) continue;
    if (s.recipe === 'record') {
      const tag = s.variant.inline ? '<Tagline text={pick.owner} />' : '';
      server.push('export async function RecordView$server(a0: number) {', '  "use server";', '  const pick = await loadPick(a0);', '  return (props: any) => (', '    <article><h2>{pick.title}</h2><p>{pick.body}</p>' + tag + '<props.ActButton id={pick.id} owner={pick.owner} /></article>', '  );', '}', '');
      if (s.variant.inline) server.push('function Tagline(props: { text: string }) {', '  return <small>{"by " + props.text}</small>;', '}', '');
    } else if (s.recipe === 'count') server.push('export async function CountView$server() {', '  "use server";', '  const total = await loadTotal();', '  return (props: any) => (', '    <p>{"" + total + " open"}</p>', '  );', '}', '');
    else if (s.recipe === 'owned') server.push('export async function Card$server(id: number) {', '  "use server";', '  const c = await loadOne(id);', '  return (props: any) => (', '    <div><b>{c.title}</b></div>', '  );', '}', '');
    else if (s.recipe === 'top') server.push('export async function TopList$server() {', '  "use server";', '  const top = await loadTop();', '  return (props: any) => (', '    <ul><For each={top}>{(x) => <li><props.Chip id={x.id} label={x.title} /></li>}</For></ul>', '  );', '}', '');
    serverComponents.add(d.fn);
  }
  if (roots.some(x => x.s.recipe === 'top')) server.unshift('import { For } from "solid-js";');
  // The client: components still rendered on the client (sites placed client, and islands).
  const islandNames = new Set<string>();
  for (const { s } of roots) { if (s.recipe === 'record') islandNames.add('ActButton'); if (s.recipe === 'top') islandNames.add('Chip'); }
  const serverOnly = new Set(roots.map(x => comps.find(c => c.recipe === x.s.recipe)!.name));
  if (roots.some(x => x.s.recipe === 'record' && x.s.variant.inline)) serverOnly.add('Tagline');
  const clientComps = comps.filter(c => !serverOnly.has(c.name) || islandNames.has(c.name));
  // Sunk roots: frames in site order, after the memos; an owned root: its client stub.
  const frameOf = new Map<number, string>();
  const ownedCalls: string[] = [];
  const frames: string[] = [];
  roots.forEach(({ s, k, d }, i) => {
    if (!d.server) return;
    // An owned question lives in its component instance on the twin (created at mount, disposed with it, so a Show
    // that hides the site drops it and showing it asks again): the split applies a client stub with the twin's
    // props, which asks the server component and mounts its frame.
    if (d.question === 'owned') {
      ownedCalls.push('function Card$frame(props: { id: number }) {', '  const frame = createMemo(() => ' + d.fn + '(props.id));', '  const Frame = dynamicComponent(() => frame());', '  return <Frame />;', '}', '');
      frameOf.set(k, 'Card$frame');
      return;
    }
    frames.push('  const Frame' + i + ' = dynamicComponent(() => ' + d.memo + '());');
    frameOf.set(k, 'Frame' + i);
    void s;
  });
  const sunkCall: Record<string, string> = {};
  for (const { s, d } of roots) if (d.server && d.question === 'sunk') sunkCall[d.memo] = d.fn + '(' + (s.recipe === 'record' ? 'selected()' : '') + ')';
  const siteTsx = (s: Site, k: number) => {
    const f = frameOf.get(k);
    if (!f) return siteText(s).tsx;
    if (s.recipe === 'record') return '<' + f + ' ActButton={(p) => <ActButton id={p.id} owner={p.owner} act={take} />} />';
    if (s.recipe === 'top') return '<' + f + ' Chip={(p) => <Chip id={p.id} label={p.label} act={take} />} />';
    if (s.recipe === 'owned') return '<' + f + ' id={selected()} />';
    return '<' + f + ' />';
  };
  const sitesTsx = p.sites.map((s, k) => s.show ? '<Show when={mode() === "all"}>' + siteTsx(s, k) + '</Show>' : siteTsx(s, k)).join('');
  const prims = ['action', 'createMemo', 'createSignal', 'Errored', 'For', 'Loading', 'refresh', ...(affected ? ['affects'] : []), ...(p.sites.some(s => s.show) ? ['Show'] : []), ...(frames.length || ownedCalls.length ? ['dynamicComponent'] : [])].sort();
  const refs = [...fns.map(f => f.name), ...serverComponents].filter(n => n !== 'loadPick' || !sunkCall.pick).filter(n => n !== 'loadTotal' || !sunkCall.total).filter(n => n !== 'loadTop' || !sunkCall.top).filter(n => n !== 'loadOne' || !roots.some(x => x.s.recipe === 'owned'));
  const client: string[] = ['import { ' + prims.join(', ') + ' } from "solid-js";', 'import { ' + refs.join(', ') + ' } from "./app.server.tsx";', ''];
  for (const c of clientComps) client.push(componentText(c, p).tsx, '');
  client.push(...ownedCalls);
  client.push('export default function App() {', '  const [mode, setMode] = createSignal("all");', '  const [selected, setSelected] = createSignal(' + p.selected + ');', '  const [status, setStatus] = createSignal("");');
  for (const m of memos) client.push('  const ' + m.name + ' = createMemo(() => ' + (sunkCall[m.name] ?? m.tsx) + ');');
  client.push(...frames);
  client.push('  const take = action(function* (id: number) {', ...(affected ? ['    affects(' + affected + ');'] : []), '    try {', '      const w: string = yield act(id);', ...refreshes.map(n => '      refresh(' + n + ');'), '      setStatus("#" + id + " to " + w);', '    } catch (e) {', '      setStatus("failed #" + id);', '    }', '  });');
  client.push('  return (', '    <section><button onClick={() => setMode(mode() === "all" ? "open" : "all")}>{"Mode: " + mode()}</button><Errored fallback={(e) => <p>Could not load</p>}><Loading fallback={<i>Loading…</i>}>' + thead + sitesTsx + '<For each={shown()}>{(r) => ' + rowTsx + '}</For></Loading></Errored><em>{status()}</em></section>', '  );', '}');
  return { 'app.server.tsx': server.join('\n'), 'app.split.tsx': client.join('\n') + '\n' };
}

/** Request sites (frames/sites.ts) by function name, for the twin and for N. */
export function sitesOf(p: Program, placed: boolean): Record<string, string> {
  const out: Record<string, string> = { loadRows: 'rows', act: 'take/act' };
  const sunk = (memo: string, fn: string, sc: string) => { out[placed && p.sites.some(s => { const d = expectedDecision(p, s); return d.server && d.memo === memo && d.question === 'sunk'; }) ? sc : fn] = memo; };
  if (p.questions.pick) sunk('pick', 'loadPick', 'RecordView$server');
  if (p.questions.total) sunk('total', 'loadTotal', 'CountView$server');
  if (p.questions.top) sunk('top', 'loadTop', 'TopList$server');
  if (p.questions.one) {
    const owned = p.sites.find(s => s.recipe === 'owned' || s.recipe === 'owned-reactive')!;
    const d = expectedDecision(p, owned);
    out[placed && d.server ? 'Card$server' : 'loadOne'] = 'Card.c';
  }
  return out;
}

/** The scenario chooser (recorded on T): clicks on live clickables and deliveries of held requests, in any order, then
 *  every held request delivered. */
export function chooserFor(p: Program) {
  const r = rng(p.seed * 7919 + 13);
  const budget = 6 + r.int(8);
  return (live: { targets: Target[]; held: { site: string; call: number }[] }, index: number): Step | null => {
    const draining = index > budget;
    if (live.held.length && (draining || r.chance(0.45) || !live.targets.length)) {
      const h = r.pick(live.held);
      return { type: 'deliver', site: h.site, call: h.call };
    }
    if (draining || !live.targets.length) return null;
    return { type: 'click', target: r.pick(live.targets) };
  };
}

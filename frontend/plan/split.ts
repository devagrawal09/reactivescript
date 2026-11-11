// The JS consumer of plan v2.2's placement (plan/docs/PLAN-V2.md, "v2.2"): a plan lowered to the canonical split, Solid
// TSX that states the split as a Solid 2 Frames app (docs/SLICE6-FRAMES.md §3): `src/<stem>.server.tsx` holds every
// server fn and every server component (`<C>$server`, a `"use server"` function returning a component whose props are
// its slots), and `src/<stem>.split.tsx` is the client: the entry and every client-rendered component, each server
// root's question memo calling its server component, and `dynamicComponent(() => memo())` mounting it with its slot
// fills. Without placement (`twin: true`) the same printer gives the all-client twin: one module, the server fns as
// `"use server"` functions, every component on the client.
//
// Canonical spellings (the oracle's explicit split and this printer agree on them, which G2 checks byte for byte):
// - declarations: sources, then memos (a sunk memo keeps its place, calling the server component), then one
//   `dynamicComponent` per sunk-question root in site order, then actions; an owned-question root is applied as its
//   client stub `<C>$frame` (the twin's component boundary: the site's wire props in, its own call memo and frame);
// - a text hole whose value is an integer or a conditional is coerced (`{"" + (…)}`), as the plan fuzz's twins do;
// - binary operators, conditionals and lambdas parenthesized as the plan fuzz's generator prints them.
import type { FAction, FComponent, FExpr, FMemo, FramesPlan, FSource, FStep, FView, PropArg, ServerComponent } from './resolve-frames.ts';
import { framesTypes } from './resolve-frames.ts';
import type { Type } from './types.ts';

const quote = (s: string) => JSON.stringify(s);
const setter = (name: string) => 'set' + name[0].toUpperCase() + name.slice(1);
type Ctx = {
  /** Server context: names are plain values, props are server values or slot accessors. */
  server?: { props: Map<string, string> };
  sources: Map<string, FSource['kind']>;
  draft?: string;
};
function pe(e: FExpr, c: Ctx): string {
  switch (e.op) {
    case 'literal': return typeof e.value === 'string' ? quote(e.value) : String(e.value);
    case 'array': return '[' + e.items.map(x => pe(x, c)).join(', ') + ']';
    case 'object': return '{ ' + e.fields.map(f => f.key + ': ' + pe(f.value, c)).join(', ') + ' }';
    case 'read': {
      if (c.server) return e.source;
      const k = c.sources.get(e.source);
      if (k === 'store') return c.draft ?? e.source;
      return e.source + '()';
    }
    case 'prop': return c.server ? c.server.props.get(e.name) ?? ('props.' + e.name) : 'props.' + e.name;
    case 'local': return e.name;
    case 'get': return /^\d+$/.test(e.key) ? pe(e.object, c) + '[' + e.key + ']' : pe(e.object, c) + '.' + e.key;
    case 'length': return pe(e.array, c) + '.length';
    case 'filter': case 'map': case 'findIndex': {
      const body = e.body.op === 'object' ? '(' + pe(e.body, c) + ')' : pe(e.body, c);
      return pe(e.array, c) + '.' + e.op + '((' + e.param + ') => ' + body + ')';
    }
    case 'add': case 'eq': case 'ne': case 'lt': case 'le': case 'gt': case 'ge': case 'and': case 'or': {
      const op = { add: '+', eq: '===', ne: '!==', lt: '<', le: '<=', gt: '>', ge: '>=', and: '&&', or: '||' }[e.op];
      return '(' + pe(e.left, c) + ' ' + op + ' ' + pe(e.right, c) + ')';
    }
    case 'not': return '!' + pe(e.value, c);
    case 'cond': return '(' + pe(e.test, c) + ' ? ' + pe(e.then, c) + ' : ' + pe(e.else, c) + ')';
    case 'pending': return 'isPending(() => ' + pe(e.value, c) + ')';
    case 'latest': return 'latest(() => ' + pe(e.value, c) + ')';
    default: throw new Error('split: unsupported expression ' + (e as { op: string }).op);
  }
}
function ps(s: FStep, c: Ctx, indent: string): string[] {
  switch (s.op) {
    case 'write': {
      if (!s.path) return [indent + setter(s.source) + '(' + pe(s.value, c) + ');'];
      const d = { ...c, draft: 'draft' };
      return [indent + setter(s.source) + '((draft) => {', indent + '  draft' + s.path.map(p => 'key' in p ? '.' + p.key : '[' + pe(p.index, d) + ']').join('') + ' = ' + pe(s.value, d) + ';', indent + '});'];
    }
    case 'optimistic': return [indent + setter(s.source) + '(' + ('updater' in s ? '(' + s.updater.param + ') => ' + pe(s.updater.body, c) : pe(s.value, c)) + ');'];
    case 'await': return [indent + 'const ' + s.bind + ' = yield ' + s.serverFn + '(' + s.args.map(a => pe(a, c)).join(', ') + ');'];
    case 'try': return [indent + 'try {', ...s.body.flatMap(x => ps(x, c, indent + '  ')), indent + '} catch (error) {', ...s.catch.flatMap(x => ps(x, c, indent + '  ')), indent + '}'];
    case 'call': return [indent + ('prop' in s ? 'props.' + s.prop : s.action) + '(' + s.args.map(a => pe(a, c)).join(', ') + ');'];
    case 'refresh': case 'affects': return [indent + s.op + '(' + s.source + ');'];
  }
}
const handler = (steps: FStep[], c: Ctx) => {
  if (steps.length === 1 && !(steps[0].op === 'write' && steps[0].path)) return '() => ' + ps(steps[0], c, '')[0].replace(/;$/, '');
  return '() => { ' + steps.flatMap(x => ps(x, c, '')).join(' ') + ' }';
};
const jsxText = (s: string) => /^[^{}<>&\s][^{}<>&]*$/.test(s) && !/\s$/.test(s) ? s : '{' + quote(s) + '}';

export type Printer = {
  /** The type of a component's expression, to decide hole coercion. */
  type(component: string, e: FExpr, locals: Map<string, Type>): Type;
  /** Prints a component view (a client site, a server root, an island or an inline site). */
  site(v: Extract<FView, { kind: 'component' }>, c: Ctx, component: string): string;
};
function pv(v: FView, c: Ctx, component: string, p: Printer, locals: Map<string, Type>): string {
  const list = (vs: FView[], l = locals) => vs.map(k => pv(k, c, component, p, l)).join('');
  const one = (vs: FView[], l = locals) => vs.length === 1 ? list(vs, l) : '<>' + list(vs, l) + '</>';
  switch (v.kind) {
    case 'text': {
      if (v.value.op === 'literal') return jsxText(String(v.value.value));
      const t = p.type(component, v.value, locals);
      return '{' + (t.k === 'number' || v.value.op === 'cond' ? '"" + ' : '') + pe(v.value, c) + '}';
    }
    case 'element': {
      const click = v.events.map(ev => ' ' + ev.name + '={' + handler(ev.steps, c) + '}').join('');
      return '<' + v.tag + click + '>' + list(v.children) + '</' + v.tag + '>';
    }
    case 'show': {
      const fb = v.fallback.length === 0 ? '' : ' fallback={' + one(v.fallback) + '}';
      return '<Show when={' + pe(v.when, c) + '}' + fb + '>' + list(v.children) + '</Show>';
    }
    case 'for': {
      const each = p.type(component, v.each, locals);
      const rows = new Map(locals).set(v.item, each.k === 'array' ? each.item : each);
      return '<For each={' + pe(v.each, c) + '}>{(' + v.item + ') => ' + one(v.children, rows) + '}</For>';
    }
    case 'loading': return '<Loading fallback={' + one(v.fallback) + '}>' + list(v.children) + '</Loading>';
    case 'errored': return '<Errored fallback={(error) => ' + one(v.fallback) + '}>' + list(v.children) + '</Errored>';
    case 'component': return p.site(v, c, component);
  }
}
const propArg = (a: PropArg, c: Ctx) => ' ' + a.name + '={' + ('value' in a ? pe(a.value, c) : 'action' in a ? a.action : 'props.' + a.forward) + '}';

function declarations(x: { sources: FSource[]; memos: FMemo[]; actions: FAction[] }, c: Ctx, memo: (m: FMemo) => string, extra: string[]): string[] {
  const out: string[] = [];
  for (const s of x.sources) {
    if (s.kind === 'optimistic') out.push('  const [' + s.name + ', ' + setter(s.name) + '] = createOptimistic(() => ' + pe(s.seed, c) + ');');
    else out.push('  const [' + s.name + ', ' + setter(s.name) + '] = ' + (s.kind === 'store' ? 'createStore' : 'createSignal') + '(' + pe(s.seed, c) + ');');
  }
  for (const m of x.memos) out.push('  const ' + m.name + ' = createMemo(() => ' + memo(m) + ');');
  out.push(...extra);
  for (const a of x.actions) out.push('  const ' + a.name + ' = action(function* (' + a.params.join(', ') + ') {', ...a.steps.flatMap(s => ps(s, c, '    ')), '  });');
  return out;
}
const sourcesOf = (x: { sources: FSource[] }) => new Map(x.sources.map(s => [s.name, s.kind]));
const SOLID = ['Errored', 'For', 'Loading', 'Show', 'action', 'affects', 'createMemo', 'createOptimistic', 'createSignal', 'createStore', 'dynamicComponent', 'isPending', 'latest', 'refresh'];
const used = (text: string) => SOLID.filter(n => new RegExp('(^|[^\\w$.])' + n.replace('$', '\\$') + '\\b').test(text) && (n !== 'action' || /\baction\(function\*/.test(text)));
const serverFnText = (f: FramesPlan['serverFns'][number]) => {
  const c: Ctx = { server: { props: new Map() }, sources: new Map() };
  const body = f.steps.map(s => s.op === 'return' ? '  return ' + pe(s.value, c) + ';' : '  const ' + s.bind + ' = await ' + ('serverHost' in s ? s.serverHost : s.serverFn) + '(' + s.args.map(a => pe(a, c)).join(', ') + ');');
  return ['export async function ' + f.name + '(' + f.params.map(p => p.name + ': ' + p.type).join(', ') + ') {', '  "use server";', ...body, '}'];
};

/** The canonical split of a placed plan: { server: src/<stem>.server.tsx, client: src/<stem>.split.tsx }. */
export function splitTsx(plan: FramesPlan, stem: string): Record<string, string> {
  const types = framesTypes(plan);
  const comps = new Map(plan.components.map(c => [c.name, c]));
  const entry: FComponent = { name: plan.component, props: [], sources: plan.sources, memos: plan.memos, actions: plan.actions, markup: plan.markup };
  const roots: { view: Extract<FView, { kind: 'component' }>; sc: ServerComponent; frame: string; memo: string; args: string[] }[] = [];
  const findRoots = (vs: FView[]) => { for (const v of vs) {
    if (v.kind === 'component' && v.place === 'server') {
      const sc = plan.serverComponents.find(s => s.name === v.server)!;
      roots.push({ view: v, sc, frame: 'Frame' + roots.length, memo: sc.question.kind === 'sunk' ? sc.question.memo : 'frame' + roots.length, args: [] });
    } else if (v.kind === 'element' || v.kind === 'for') findRoots(v.children);
    else if (v.kind === 'show' || v.kind === 'loading' || v.kind === 'errored') { findRoots(v.children); findRoots(v.fallback); }
  } };
  findRoots(plan.markup);
  const entryCtx: Ctx = { sources: sourcesOf(entry) };
  // A root's call arguments: the sunk question's arguments, then the other wire props in site order (owned: every wire
  // prop in site order).
  for (const r of roots) {
    const q = plan.memos.find(m => m.name === r.sc.question.memo);
    const sunkProp = r.sc.question.kind === 'sunk' ? r.view.props.find(a => 'value' in a && a.value.op === 'read' && a.value.source === r.sc.question.memo) : undefined;
    if (q && 'await' in q && r.sc.question.kind === 'sunk') r.args.push(...q.await.args.map(a => pe(a, entryCtx)));
    for (const a of r.view.props) if ('value' in a && a !== sunkProp) r.args.push(pe(a.value, entryCtx));
  }
  // ----------------------------------------------------------------------------- the client module
  const clientRendered = new Set<string>();
  const islands = new Set(plan.serverComponents.flatMap(s => s.slots.map(x => x.component)));
  const visitClient = (vs: FView[]) => { for (const v of vs) {
    if (v.kind === 'component') { if (v.place !== 'server' && !clientRendered.has(v.name)) { clientRendered.add(v.name); visitClient(comps.get(v.name)!.markup); } }
    else if (v.kind === 'element' || v.kind === 'for') visitClient(v.children);
    else if (v.kind === 'show' || v.kind === 'loading' || v.kind === 'errored') { visitClient(v.children); visitClient(v.fallback); }
  } };
  visitClient(plan.markup);
  for (const k of islands) if (!clientRendered.has(k)) { clientRendered.add(k); visitClient(comps.get(k)!.markup); }
  const clientPrinter: Printer = {
    type: types.exprType,
    site(v, c, component) {
      const r = roots.find(r => r.view === v);
      if (!r) return '<' + v.name + v.props.map(a => propArg(a, c)).join('') + ' />';
      // A server root: its slot fills, one per island component, through props resolved to this site's arguments.
      const fills = r.sc.slots.map(sl => {
        const k = comps.get(sl.component)!;
        const at = (() => { let found: Extract<FView, { kind: 'component' }> | undefined; const look = (vs: FView[]) => { for (const x of vs) { if (found) return; if (x.kind === 'component' && x.name === sl.component) found = x; else if ('children' in x) { look(x.children); if ('fallback' in x) look(x.fallback); } } }; for (const name of [r.sc.component, ...r.sc.inline]) look(comps.get(name)!.markup); return found!; })();
        void k;
        const attrs = at.props.map(a => {
          if ('value' in a) return ' ' + a.name + '={p.' + a.name + '}';
          const root = sl.from[a.name];
          const arg = v.props.find(x => x.name === root)!;
          return ' ' + a.name + '={' + ('action' in arg ? arg.action : 'value' in arg ? pe(arg.value, c) : 'props.' + arg.forward) + '}';
        }).join('');
        return ' ' + sl.name + '={(p) => <' + sl.component + attrs + ' />}';
      }).join('');
      void component;
      // An owned root's site keeps the twin's component boundary: its stub (below) is applied with the site's wire
      // props, so the question is asked by the instance and lives as long as it does.
      if (r.sc.question.kind === 'owned') return '<' + r.sc.component + '$frame' + v.props.filter(a => 'value' in a).map(a => ' ' + a.name + '={' + pe((a as { value: FExpr }).value, c) + '}').join('') + fills + ' />';
      return '<' + r.frame + fills + ' />';
    },
  };
  const client: string[] = [];
  const body: string[] = [];
  for (const c of plan.components) {
    if (!clientRendered.has(c.name)) continue;
    const ctx: Ctx = { sources: sourcesOf(c) };
    body.push('function ' + c.name + '(props) {', ...declarations(c, ctx, m => 'await' in m ? m.await.serverFn + '(' + m.await.args.map(a => pe(a, ctx)).join(', ') + ')' : pe(m.value, ctx), []),
      '  return (', '    ' + (c.markup.length === 1 ? pv(c.markup[0], ctx, c.name, clientPrinter, new Map()) : '<>' + c.markup.map(v => pv(v, ctx, c.name, clientPrinter, new Map())).join('') + '</>'), '  );', '}', '');
  }
  // An owned question is its component instance's, as on the twin: the root's client stub `<C>$frame` takes the site's
  // wire props, asks the server component from them and mounts the frame, forwarding the slot fills. It is created
  // when the site mounts and disposed with it (a site under a Show that is hidden asks nothing).
  for (const r of roots.filter(r => r.sc.question.kind === 'owned')) {
    const wire = r.view.props.filter(a => 'value' in a).map(a => 'props.' + a.name);
    body.push('function ' + r.sc.component + '$frame(props) {', '  const frame = createMemo(() => ' + r.sc.name + '(' + wire.join(', ') + '));', '  const Frame = dynamicComponent(() => frame());',
      '  return <Frame' + r.sc.slots.map(sl => ' ' + sl.name + '={props.' + sl.name + '}').join('') + ' />;', '}', '');
  }
  const frames = roots.filter(r => r.sc.question.kind === 'sunk').map(r => '  const ' + r.frame + ' = dynamicComponent(() => ' + r.memo + '());');
  body.push('export default function ' + plan.component + '() {',
    ...declarations(entry, entryCtx, m => {
      if ('await' in m && m.sunk) { const r = roots.find(r => r.sc.name === m.sunk && r.memo === m.name)!; return m.sunk + '(' + r.args.join(', ') + ')'; }
      return 'await' in m ? m.await.serverFn + '(' + m.await.args.map(a => pe(a, entryCtx)).join(', ') + ')' : pe(m.value, entryCtx);
    }, frames),
    '  return (', '    ' + (plan.markup.length === 1 ? pv(plan.markup[0], entryCtx, plan.component, clientPrinter, new Map()) : '<>' + plan.markup.map(v => pv(v, entryCtx, plan.component, clientPrinter, new Map())).join('') + '</>'), '  );', '}');
  const text = body.join('\n');
  const refs = [...new Set([...plan.serverFns.map(f => f.name), ...plan.serverComponents.map(s => s.name)].filter(n => new RegExp('\\b' + n.replace(/\$/g, '\\$') + '\\(').test(text)))].sort();
  client.push('import { ' + used(text).join(', ') + ' } from "solid-js";');
  if (refs.length) client.push('import { ' + refs.join(', ') + ' } from "./' + stem + '.server.tsx";');
  client.push('', text, '');
  // ----------------------------------------------------------------------------- the server module
  const server: string[] = [];
  const hostsUsed = plan.serverHosts.map(h => h.name).filter(h => plan.serverFns.some(f => f.steps.some(s => s.op === 'await' && 'serverHost' in s && s.serverHost === h)));
  if (hostsUsed.length) server.push('import { ' + hostsUsed.join(', ') + ' } from "./db";', '');
  for (const f of plan.serverFns) server.push(...serverFnText(f), '');
  const inlineDone = new Set<string>();
  const serverComponent = (sc: ServerComponent) => {
    const c = comps.get(sc.component)!;
    const r = roots.find(r => r.sc === sc)!;
    const params: string[] = [];
    const props = new Map<string, string>();
    const lines: string[] = [];
    const q = sc.question.kind === 'sunk' ? plan.memos.find(m => m.name === sc.question.memo) : c.memos.find(m => m.name === sc.question.memo);
    const sunkProp = sc.question.kind === 'sunk' ? r.view.props.find(a => 'value' in a && a.value.op === 'read' && a.value.source === sc.question.memo) : undefined;
    let k = 0;
    if (sc.question.kind === 'sunk' && q && 'await' in q) {
      const qargs = q.await.args.map(() => 'a' + k++);
      params.push(...qargs);
      lines.push('  const ' + q.name + ' = await ' + q.await.serverFn + '(' + qargs.join(', ') + ');');
      props.set(sunkProp!.name, q.name);
    }
    for (const a of r.view.props) if ('value' in a && a !== sunkProp) { params.push(a.name); props.set(a.name, a.name); }
    for (const sl of sc.slots) props.set(sl.name, 'props.' + sl.name);
    const sctx: Ctx = { server: { props }, sources: new Map() };
    if (sc.question.kind === 'owned' && q && 'await' in q) lines.push('  const ' + q.name + ' = await ' + q.await.serverFn + '(' + q.await.args.map(a => pe(a, sctx)).join(', ') + ');');
    for (const m of c.memos) if (!('await' in m)) lines.push('  const ' + m.name + ' = ' + pe(m.value, sctx) + ';');
    const slotNames = new Set(sc.slots.map(s => s.name));
    const serverPrinter: Printer = {
      type: types.exprType,
      site(v, ctx, component) {
        void component;
        if (slotNames.has(v.name)) return '<props.' + v.name + v.props.filter(a => 'value' in a).map(a => propArg(a, ctx)).join('') + ' />';
        // An inline site: a server-only component, given the slot accessors its islands use.
        inline.add(v.name);
        return '<' + v.name + v.props.filter(a => 'value' in a).map(a => propArg(a, ctx)).join('') + [...slotNames].map(s => ' ' + s + '={props.' + s + '}').join('') + ' />';
      },
    };
    const inline = new Set<string>();
    const markup = c.markup.length === 1 ? pv(c.markup[0], sctx, c.name, serverPrinter, new Map()) : '<>' + c.markup.map(v => pv(v, sctx, c.name, serverPrinter, new Map())).join('') + '</>';
    const out = ['export async function ' + sc.name + '(' + params.join(', ') + ') {', '  "use server";', ...lines, '  return (props) => (', '    ' + markup, '  );', '}', ''];
    for (const name of inline) {
      if (inlineDone.has(name)) continue;
      inlineDone.add(name);
      const kc = comps.get(name)!;
      const kprops = new Map<string, string>();
      for (const pp of kc.props) kprops.set(pp.name, 'props.' + pp.name);
      for (const s of slotNames) kprops.set(s, 'props.' + s);
      const kctx: Ctx = { server: { props: kprops }, sources: new Map() };
      const klines = kc.memos.map(m => '  const ' + m.name + ' = ' + pe((m as { value: FExpr }).value, kctx) + ';');
      out.push('function ' + name + '(props) {', ...klines, '  return (', '    ' + (kc.markup.length === 1 ? pv(kc.markup[0], kctx, name, serverPrinter, new Map()) : '<>' + kc.markup.map(v => pv(v, kctx, name, serverPrinter, new Map())).join('') + '</>'), '  );', '}', '');
    }
    return out;
  };
  for (const sc of plan.serverComponents) server.push(...serverComponent(sc));
  return { [stem + '.server.tsx']: server.join('\n'), [stem + '.split.tsx']: client.join('\n') };
}

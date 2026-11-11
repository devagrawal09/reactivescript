// G1's oracle side (docs/RESULTS.md, "Slice 6"): the placement a native explicit split states, read from its two
// modules with oxc-parser and `transformDirectives`' function list. Written separately from plan/placement.ts: it never
// sees a plan, only the oracle's TSX.
//
// - `"use server"` functions of `src/<stem>.server.tsx` whose body returns a function are server components; their
//   question is the `const q = await f(…)` they open with; their slots are the `<props.K …/>` positions of the returned
//   markup (and of the server-only components it applies, which are its inline components);
// - the client sites of server roots are `<F …fills/>` in the entry's markup with `F = dynamicComponent(() => m())`
//   and `m = createMemo(() => C$server(…))`; a question is sunk when `m` is the server component's own `q` (the
//   canonical split keeps a sunk question's name); an owned question's site is `<S …props …fills/>` of a client stub
//   `S(props)` whose body is `frame = createMemo(() => C$server(props.…))`, `Frame = dynamicComponent(() => frame())`,
//   `return <Frame …/>`;
// - each slot fill `K={(p) => <K a={p.a} t={…}/>}` gives the island's server arguments (`p.a`) and through props;
// - server hosts are the imports of the server-only module `./db`.
//
// What a split cannot state is left out of the projection both sides are compared in (projectPlacement): the props
// map, the question's memo name, and why a client site is client (only `entry` and an island's client mark are
// readable from TSX; any other client site reads `client`).
import { parseSync } from 'oxc-parser/src-js/index';
import type { Placement, SitePath } from '../plan/placement.ts';
import { sortKeys } from '../plan/placement.ts';
import { wireIds } from './compile.ts';

type N = { type: string; [k: string]: any };
export type Projection = {
  client: { component: string; reason: string; site: SitePath }[];
  server: { component: string; fn: string; site: SitePath; question: { kind: string; serverFn: string; args: unknown[] }; inline: string[]; slots: { args: string[]; component: string; name: string; through: string[] }[] }[];
  serverFns: string[]; serverHosts: string[];
};

/** The comparable part of a placement table. */
export function projectPlacement(t: Placement): Projection {
  return sortKeys({
    client: t.client.map(c => ({ component: c.component, reason: c.reason === 'entry' || /^M\d$/.test(c.reason) ? c.reason : 'client', site: c.site })),
    server: t.server.map(s => ({ component: s.component, fn: s.fn, site: s.site, question: { kind: s.question.kind, serverFn: s.question.serverFn, args: s.question.args }, inline: s.inline, slots: s.slots })),
    serverFns: t.serverFns, serverHosts: t.serverHosts,
  }) as Projection;
}

const parse = (file: string, text: string): N[] => {
  const r = parseSync(file, text, { sourceType: 'module', lang: 'tsx' });
  if (r.errors.length) throw new Error(file + ': ' + r.errors[0].message);
  return r.program.body as N[];
};
const fnDecl = (n: N): N | undefined => n.type === 'FunctionDeclaration' ? n : (n.type === 'ExportNamedDeclaration' || n.type === 'ExportDefaultDeclaration') && n.declaration?.type === 'FunctionDeclaration' ? n.declaration : undefined;
const isDirective = (n: N) => n.body?.body?.[0]?.directive === 'use server';
const tagName = (n: N): string => n.type === 'JSXIdentifier' ? n.name : n.type === 'JSXMemberExpression' ? tagName(n.object) + '.' + n.property.name : '?';
const attr = (el: N, name: string) => el.openingElement.attributes.find((a: N) => a.type === 'JSXAttribute' && a.name.name === name);
const attrValue = (a: N | undefined) => a?.value?.type === 'JSXExpressionContainer' ? a.value.expression : a?.value;
const returned = (fn: N): N | undefined => { const last = fn.body.body.at(-1); return last?.type === 'ReturnStatement' ? last.argument : undefined; };
const unparen = (n: N): N => n?.type === 'ParenthesizedExpression' ? unparen(n.expression) : n;

/** The views of a JSX child list as the plan builder sees them: a text run (adjacent static texts are one view, an
 *  all-whitespace text with a line break is dropped), an expression, an element, a component. */
function views(children: N[]): N[] {
  const out: N[] = [];
  let lastText = false;
  for (const c of children) {
    if (c.type === 'JSXText') {
      if (/^\s*$/.test(c.value) && c.value.includes('\n')) continue;
      if (!lastText) out.push(c);
      lastText = true;
      continue;
    }
    lastText = false;
    if (c.type === 'JSXExpressionContainer' && c.expression.type === 'JSXEmptyExpression') continue;
    out.push(c);
  }
  return out;
}
const fragment = (n: N): N[] => { n = unparen(n); return n.type === 'JSXFragment' ? views(n.children) : [n]; };

/** Every JSX element under a node with its view path (indices; `"fallback"` before a Show's or boundary's fallback). */
function walkJsx(list: N[], path: SitePath, visit: (el: N, path: SitePath) => boolean | void) {
  list.forEach((v, i) => {
    const p = [...path, i];
    if (v.type !== 'JSXElement') return;
    if (visit(v, p) === false) return;
    const tag = tagName(v.openingElement.name);
    if (tag === 'Show' || tag === 'Loading' || tag === 'Errored') {
      walkJsx(views(v.children), p, visit);
      const fb = attrValue(attr(v, 'fallback'));
      if (fb) walkJsx(fragment(fb.type === 'ArrowFunctionExpression' ? fb.body : fb), [...p, 'fallback'], visit);
    } else if (tag === 'For') {
      const body = views(v.children)[0]?.expression;
      if (body?.type === 'ArrowFunctionExpression') walkJsx(fragment(body.body), p, visit);
    } else if (/^[a-z]/.test(tag)) walkJsx(views(v.children), p, visit);
  });
}

/** A client expression as a plan expression (the forms a question's arguments take). */
function planExpr(n: N, reads: Set<string>, params: Map<string, unknown> = new Map()): unknown {
  n = unparen(n);
  if (n.type === 'Literal') return { op: 'literal', value: n.value };
  if (n.type === 'Identifier' && params.has(n.name)) return params.get(n.name);
  if (n.type === 'CallExpression' && n.callee.type === 'Identifier' && !n.arguments.length && reads.has(n.callee.name)) return { op: 'read', source: n.callee.name };
  if (n.type === 'MemberExpression' && !n.computed) return n.property.name === 'length' ? { op: 'length', array: planExpr(n.object, reads, params) } : { op: 'get', object: planExpr(n.object, reads, params), key: n.property.name };
  const ops: Record<string, string> = { '+': 'add', '===': 'eq', '!==': 'ne', '<': 'lt', '<=': 'le', '>': 'gt', '>=': 'ge', '&&': 'and', '||': 'or' };
  if ((n.type === 'BinaryExpression' || n.type === 'LogicalExpression') && ops[n.operator]) return { op: ops[n.operator], left: planExpr(n.left, reads, params), right: planExpr(n.right, reads, params) };
  if (n.type === 'ConditionalExpression') return { op: 'cond', test: planExpr(n.test, reads, params), then: planExpr(n.consequent, reads, params), else: planExpr(n.alternate, reads, params) };
  if (n.type === 'UnaryExpression' && n.operator === '!') return { op: 'not', value: planExpr(n.argument, reads, params) };
  throw new Error('extract: an argument the extractor does not read: ' + n.type);
}

/** The client mark of a client component, read from its TSX (the order plan/placement.ts checks them in). */
function clientMark(fn: N): string | null {
  const text = JSON.stringify(fn.body);
  const calls = (name: string) => text.includes('"type":"Identifier","decorators":[],"name":"' + name + '"');
  if (calls('createSignal') || calls('createStore') || calls('createOptimistic')) return 'M1';
  let handler = false, boundary = false;
  const scan = (n: unknown): void => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) { n.forEach(scan); return; }
    const x = n as N;
    if (x.type === 'JSXAttribute' && /^on[A-Z]/.test(x.name?.name ?? '')) handler = true;
    if (x.type === 'JSXOpeningElement' && ['Loading', 'Errored'].includes(tagName(x.name))) boundary = true;
    for (const v of Object.values(x)) scan(v);
  };
  scan(fn.body);
  if (calls('action') || handler) return 'M2';
  if (boundary) return 'M8';
  if (calls('isPending') || calls('latest')) return 'M4';
  return null;
}

/** The placement the native split states. `files`: its two modules by name under src/. */
export function extractPlacement(files: Record<string, string>, stem: string): Projection {
  const serverFile = stem + '.server.tsx', clientFile = stem + '.split.tsx';
  const server = parse(serverFile, files[serverFile]), client = parse(clientFile, files[clientFile]);
  const ids = wireIds(files[serverFile], serverFile);
  const serverFns: string[] = [], serverHosts: string[] = [];
  const components = new Map<string, { fn: N; question: { memo: string; serverFn: string; awaitArgs: N[] }; params: string[] }>();
  const serverLocal = new Map<string, N>();
  for (const n of server) {
    if (n.type === 'ImportDeclaration' && n.source.value === './db') for (const s of n.specifiers) serverHosts.push(s.imported.name);
    const f = fnDecl(n);
    if (!f) continue;
    if (!isDirective(f) || !f.async) { serverLocal.set(f.id.name, f); continue; }
    if (!ids[f.id.name]) throw new Error('extract: transformDirectives does not list ' + f.id.name);
    const ret = unparen(returned(f));
    if (ret?.type === 'ArrowFunctionExpression' || ret?.type === 'FunctionExpression') {
      const first = f.body.body[1];
      const d = first?.type === 'VariableDeclaration' ? first.declarations[0] : undefined;
      if (!d || d.init?.type !== 'AwaitExpression') throw new Error('extract: a server component without its question: ' + f.id.name);
      components.set(f.id.name, { fn: f, question: { memo: d.id.name, serverFn: d.init.argument.callee.name, awaitArgs: d.init.argument.arguments }, params: f.params.map((p: N) => p.name) });
    } else serverFns.push(f.id.name);
  }
  const clientFns = new Map<string, N>();
  let entry: N | undefined;
  for (const n of client) {
    const f = fnDecl(n);
    if (!f) continue;
    clientFns.set(f.id.name, f);
    if (n.type === 'ExportDefaultDeclaration') entry = f;
  }
  if (!entry) throw new Error('extract: no default export in ' + clientFile);
  const reads = new Set<string>(), memoCalls = new Map<string, { fn: string; args: N[] }>(), frames = new Map<string, string>();
  for (const st of entry.body.body) {
    if (st.type !== 'VariableDeclaration') continue;
    const d = st.declarations[0], init = d.init;
    if (d.id.type === 'ArrayPattern') { reads.add(d.id.elements[0].name); continue; }
    if (init?.type !== 'CallExpression' || init.callee.type !== 'Identifier') continue;
    const prim = init.callee.name, body = init.arguments[0]?.body && unparen(init.arguments[0].body);
    if (prim === 'createMemo') {
      reads.add(d.id.name);
      if (body?.type === 'CallExpression' && body.callee.type === 'Identifier' && components.has(body.callee.name)) memoCalls.set(d.id.name, { fn: body.callee.name, args: body.arguments });
    } else if (prim === 'dynamicComponent' && body?.type === 'CallExpression' && body.callee.type === 'Identifier') frames.set(d.id.name, body.callee.name);
  }
  // Client stubs of owned roots: a body of a call memo of a server component and a dynamicComponent over it.
  const stubs = new Map<string, string>();
  for (const [name, f] of clientFns) {
    if (f === entry) continue;
    const [m, d] = f.body.body;
    const mi = m?.type === 'VariableDeclaration' ? m.declarations[0].init : undefined;
    const di = d?.type === 'VariableDeclaration' ? d.declarations[0].init : undefined;
    const call = mi?.type === 'CallExpression' && mi.callee.name === 'createMemo' ? unparen(mi.arguments[0]?.body) : undefined;
    if (call?.type === 'CallExpression' && components.has(call.callee.name) && di?.type === 'CallExpression' && di.callee.name === 'dynamicComponent') stubs.set(name, call.callee.name);
  }
  const table: Projection = { client: [{ component: entry.id.name, reason: 'entry', site: [entry.id.name] }], server: [], serverFns, serverHosts };
  const slotsOf = (fn: N, comp: string, inline: string[], slots: Map<string, Projection['server'][number]['slots'][number] & { sites: SitePath[] }>) => {
    walkJsx(fragment(unparen(returned(fn)).body), [], (el, path) => {
      const tag = tagName(el.openingElement.name);
      if (tag.startsWith('props.')) {
        const name = tag.slice(6);
        const s = slots.get(name) ?? { name, component: name, args: [], through: [], sites: [] };
        s.args = el.openingElement.attributes.map((a: N) => a.name.name);
        s.sites.push([comp, ...path]);
        slots.set(name, s);
        return false;
      }
      if (/^[A-Z]/.test(tag) && serverLocal.has(tag)) {
        if (!inline.includes(tag)) inline.push(tag);
        const k = serverLocal.get(tag)!;
        walkJsx(fragment(unparen(returned(k))), [], (el2, path2) => {
          const t2 = tagName(el2.openingElement.name);
          if (!t2.startsWith('props.')) return;
          const name = t2.slice(6);
          const s = slots.get(name) ?? { name, component: name, args: [], through: [], sites: [] };
          s.args = el2.openingElement.attributes.map((a: N) => a.name.name);
          s.sites.push([tag, ...path2]);
          slots.set(name, s);
          return false;
        });
        return false;
      }
    });
  };
  walkJsx(fragment(returned(entry)!), [], (el, path) => {
    const tag = tagName(el.openingElement.name);
    const memo = frames.get(tag), stub = stubs.get(tag);
    if (memo !== undefined || stub !== undefined) {
      const call = stub !== undefined ? { fn: stub, args: [] } : memoCalls.get(memo!);
      if (!call) throw new Error('extract: ' + tag + ' mounts ' + memo + ', which calls no server component');
      const sc = components.get(call.fn)!;
      const sunk = stub === undefined && memo === sc.question.memo;
      const inline: string[] = [];
      const slots = new Map<string, Projection['server'][number]['slots'][number] & { sites: SitePath[] }>();
      slotsOf(sc.fn, sc.fn.id.name.replace(/\$server(\$\d+)?$/, ''), inline, slots);
      // Each fill: the island's server arguments (`p.a`) and its through props (anything else).
      for (const a of el.openingElement.attributes) {
        const fill = attrValue(a);
        // A stub's wire props are its call's arguments, not fills.
        if (stub !== undefined && fill?.type !== 'ArrowFunctionExpression') continue;
        const k = fill?.type === 'ArrowFunctionExpression' ? unparen(fill.body) : undefined;
        if (!k || k.type !== 'JSXElement') throw new Error('extract: a slot fill that is not (p) => <K …/>');
        const s = slots.get(a.name.name);
        if (!s) throw new Error('extract: a fill for ' + a.name.name + ', which the server component never places');
        s.component = tagName(k.openingElement.name);
        s.through = k.openingElement.attributes.filter((x: N) => !(attrValue(x)?.type === 'MemberExpression' && attrValue(x).object.name === fill.params[0].name)).map((x: N) => x.name.name);
        s.args = k.openingElement.attributes.map((x: N) => x.name.name).filter((x: string) => !s.through.includes(x));
        const mark = clientMark(clientFns.get(s.component)!);
        for (const site of s.sites) table.client.push({ component: s.component, reason: mark ?? 'client', site });
      }
      const params = new Map<string, unknown>(sc.params.map(p => [p, { op: 'prop', name: p }]));
      const args = sunk ? call.args.slice(0, sc.question.awaitArgs.length).map(a => planExpr(a, reads)) : sc.question.awaitArgs.map(a => planExpr(a, reads, params));
      table.server.push({
        component: sc.fn.id.name.replace(/\$server(\$\d+)?$/, ''), fn: call.fn, site: [entry!.id.name, ...path],
        question: { kind: sunk ? 'sunk' : 'owned', serverFn: sc.question.serverFn, args }, inline: inline.sort(),
        slots: [...slots.values()].map(s => ({ args: [...s.args].sort(), component: s.component, name: s.name, through: [...s.through].sort() })),
      });
      return false;
    }
    // A client site of the entry: its component's client mark when it has one (what a split can state about why).
    if (/^[A-Z]/.test(tag) && clientFns.has(tag)) { table.client.push({ component: tag, reason: clientMark(clientFns.get(tag)!) ?? 'client', site: [entry!.id.name, ...path] }); return false; }
  });
  // Client components render their own sites on the client.
  const rendered = [...new Set(table.client.filter(c => c.reason !== 'entry').map(c => c.component))];
  for (let i = 0; i < rendered.length; i++) {
    const f = clientFns.get(rendered[i]);
    if (!f) continue;
    walkJsx(fragment(returned(f)!), [], (el, path) => {
      const tag = tagName(el.openingElement.name);
      if (/^[A-Z]/.test(tag) && clientFns.has(tag)) {
        table.client.push({ component: tag, reason: 'client', site: [rendered[i], ...path] });
        if (!rendered.includes(tag)) rendered.push(tag);
        return false;
      }
    });
  }
  table.client.sort((a, b) => a.component < b.component ? -1 : a.component > b.component ? 1 : JSON.stringify(a.site) < JSON.stringify(b.site) ? -1 : 1);
  table.server.sort((a, b) => JSON.stringify(a.site) < JSON.stringify(b.site) ? -1 : 1);
  table.serverFns.sort(); table.serverHosts.sort();
  return sortKeys(table) as Projection;
}

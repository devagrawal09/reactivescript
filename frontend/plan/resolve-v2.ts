// Plan schema v2 (docs/PLAN-V2.md): the slice-2 tracker as data. Same contract as resolve.ts (v1, unchanged): run the
// pinned checker, refuse diagnostics, take identities, kinds, reads, writes, calls and regions from CP-6, and read only
// what CP-6 lacks from the checked RX AST. Every CP-6 read, write and call of a used computation must appear in the
// plan, and every reactive read, write and call in the plan must be a CP-6 fact. Unsupported forms throw.
import { checkModules, type ModuleSet } from '../tsx/rx/compiler.ts';
import { actionInference } from '../tsx/rx/infer.ts';
import type { Expr, Stmt, Markup } from '../tsx/rx/ast.ts';
import { evalSitesOf, type EvalSite } from '../eval/sites.ts';
import { parseInterface, printInterface, sameInterface, type BindingDecl } from '../eval/interface.ts';
import { printType, typePlan } from './types.ts';

export type Scalar = string | number | boolean;
export type Lambda = { param: string; body: Expression };
export type Expression =
  | { op: 'literal'; value: Scalar }
  | { op: 'array'; items: Expression[] }
  | { op: 'object'; fields: { key: string; value: Expression }[] }
  | { op: 'read'; source: string }
  | { op: 'local'; name: string }
  | { op: 'get'; object: Expression; key: string }
  | { op: 'length'; array: Expression }
  | ({ op: 'filter' | 'map' | 'findIndex'; array: Expression } & Lambda)
  | { op: 'add' | 'eq' | 'ne' | 'lt' | 'le' | 'gt' | 'ge' | 'and' | 'or'; left: Expression; right: Expression }
  | { op: 'not'; value: Expression }
  | { op: 'cond'; test: Expression; then: Expression; else: Expression }
  /** docs/EVAL.md: a value eval, the whole value of a memo. */
  | ({ op: 'eval' } & EvalNode & { type: HostType });
/** An eval site in the enclosing plan (docs/EVAL.md): its code (a reactive string), each binding's inner name and the
 *  outer source, memo, action or host it refers to, the derived binding interface, and the code's options. */
export type EvalNode = { code: Expression; bindings: { name: string; target: string }[]; interface: string; syntax: 'rx' | 'tsx'; check: 'strict' | 'lenient' };
/** An evaluated plan's bindings (docs/EVAL.md): names it reads (`read`, `store`) or calls (`action`) but never writes. */
export type InnerBinding = { name: string; kind: 'read' | 'store'; type: string } | { name: string; kind: 'action'; params: HostType[] };
export type PathSegment = { key: string } | { index: Expression };
export type Step =
  | { op: 'write'; source: string; path?: PathSegment[]; value: Expression }
  | { op: 'optimistic'; source: string; value: Expression }
  | { op: 'optimistic'; source: string; updater: Lambda }
  | { op: 'await'; host: string; args: Expression[]; bind: string }
  | { op: 'try'; body: Step[]; catch: Step[] }
  | { op: 'call'; action: string; args: Expression[] };
export type View =
  | { kind: 'element'; tag: string; events: { name: string; steps: Step[] }[]; children: View[] }
  | { kind: 'text'; value: Expression }
  | { kind: 'show'; when: Expression; children: View[]; fallback: View[] }
  | { kind: 'for'; each: Expression; item: string; key: 'identity'; children: View[] }
  /** docs/EVAL.md: a markup eval, an element child. */
  | ({ kind: 'eval' } & EvalNode);
export type HostType = 'number' | 'string' | 'boolean';
export type Plan = {
  version: 2;
  component: string;
  hosts: { name: string; params: HostType[]; returns: HostType }[];
  /** Evaluated code only (docs/EVAL.md). */
  bindings?: InnerBinding[];
  sources: { name: string; kind: 'signal' | 'store' | 'optimistic'; seed: Expression }[];
  memos: { name: string; value: Expression }[];
  actions: { name: string; params: string[]; steps: Step[] }[];
  markup: View[];
  /** A value eval's code (docs/EVAL.md): its one expression. */
  value?: Expression;
};

const BINARY: Record<string, Exclude<Expression['op'], 'literal'>> = { '+': 'add', '==': 'eq', '!=': 'ne', '<': 'lt', '<=': 'le', '>': 'gt', '>=': 'ge', '&&': 'and', '||': 'or' };
const BUILTIN: Record<string, 'filter' | 'map' | 'findIndex'> = { filter: 'filter', map: 'map', indexOf: 'findIndex' };
const TYPES = new Set(['number', 'string', 'boolean']);

/** Babel's confident evaluation, which Solid's compiler uses to fold a JSX child to static text: literals, `!`, the
 *  binary operators of the plan, short-circuiting `&&`/`||` and a conditional on a confident test (only the branch
 *  taken is evaluated). Any read, local or call is not confident. */
type Confident = { ok: true; v: unknown } | { ok: false };
export function confident(e: Expr): Confident {
  const no: Confident = { ok: false };
  if (e.k === 'lit') return { ok: true, v: e.v };
  if (e.k === 'un' && e.op === '!') { const x = confident(e.e); return x.ok ? { ok: true, v: !x.v } : no; }
  if (e.k === 'if') { const c = confident(e.c); return c.ok ? confident(c.v ? e.t : e.f) : no; }
  if (e.k !== 'bin') return no;
  const l = confident(e.l);
  if (e.op === '&&' || e.op === '||') return !l.ok ? no : (e.op === '&&' ? !l.v : l.v) ? l : confident(e.r);
  const r = confident(e.r);
  if (!l.ok || !r.ok) return no;
  const a = l.v as any, b = r.v as any;
  switch (e.op) {
    case '+': return { ok: true, v: a + b };
    case '==': return { ok: true, v: a === b };
    case '!=': return { ok: true, v: a !== b };
    case '<': return { ok: true, v: a < b };
    case '<=': return { ok: true, v: a <= b };
    case '>': return { ok: true, v: a > b };
    case '>=': return { ok: true, v: a >= b };
    default: return no;
  }
}

/** `bindings`: the plan is evaluated code (docs/EVAL.md, eval/compile.ts). The frontend declared each binding at the top
 *  of the component (a placeholder source, or an action with an empty body); they become the plan's `bindings`, and any
 *  write to one is refused. */
export function resolvePlanV2(set: ModuleSet, opts: { bindings?: BindingDecl[] } = {}): Plan {
  const checked = checkModules(set);
  if (checked.diags.length) throw new Error(JSON.stringify(checked.diags));
  if (set.order.length !== 1) throw new Error('plan v2 supports one RX module plus host imports');
  const file = set.order[0], program = set.programs.get(file)!, model = checked.models.get(file)!;
  const entry = program.decls.find(d => d.k === 'component' && d.isDefault);
  if (!entry || entry.k !== 'component') throw new Error('expected one default component');
  if (program.decls.some(d => d.k !== 'import' && d !== entry)) throw new Error('plan v2 supports one component and imports');
  if (entry.propsType) throw new Error('the entry component takes no props');
  const region = model.regions.find(r => r.kind === 'component' && r.name === entry.name);
  if (!region) throw new Error('missing resolved component');
  const symbols = model.symbols.filter(s => s.region === region.id || s.kind === 'import');
  const sites = evalSitesOf(program);
  const inner = opts.bindings ? new Map(opts.bindings.filter(d => d.kind !== 'host').map(d => [d.name, d])) : undefined;
  const symbol = (name: string) => { const s = symbols.find(s => s.name === name); if (!s) throw new Error('unresolved ' + name); return s; };
  type Comp = typeof model.computations[number];
  type Sym = typeof model.symbols[number];
  const comp = (kind: string, name: string) => { const c = model.computations.find(c => c.region === region.id && c.kind === kind && c.name === name); if (!c) throw new Error('missing computation ' + kind + ':' + name); return c; };

  // Each used computation collects the facts its plan encodes; finish() requires them to equal CP-6's exactly.
  type Seen = { c: Comp; reads: Set<number>; writes: Set<string>; calls: Set<number> };
  const used: Seen[] = [];
  const seen = (c: Comp): Seen => { const s = { c, reads: new Set<number>(), writes: new Set<string>(), calls: new Set<number>() }; used.push(s); return s; };
  const finish = () => {
    for (const { c, reads, writes, calls } of used) {
      const want = (xs: (string | number)[]) => JSON.stringify([...new Set(xs)].sort());
      const at = c.kind + ':' + (c.name ?? c.at);
      if (want([...reads]) !== want(c.reads.map(r => r.sym))) throw new Error('reads differ from CP-6 in ' + at);
      if (want([...writes]) !== want(c.writes.map(w => w.sym + ' ' + w.op + (w.path ? ' path' : '')))) throw new Error('writes differ from CP-6 in ' + at);
      if (want([...calls]) !== want(c.calls)) throw new Error('calls differ from CP-6 in ' + at);
    }
  };

  type Locals = Map<string, Expression>;
  const lambda = (e: Expr, s: Seen, locals: Locals): Lambda => {
    if (e.k !== 'fn' || e.params.length !== 1 || e.stmts?.length) throw new Error('a builtin or updater takes one (x) => expression');
    const param = e.params[0];
    if (symbols.some(x => x.name === param)) throw new Error('a local shadows a resolved name: ' + param);
    return { param, body: expression(e.body, s, new Map(locals).set(param, { op: 'local', name: param })) };
  };
  const reactive = (sym: Sym) => sym.kind === 'source' || sym.kind === 'eq';
  const expression = (e: Expr, s: Seen, locals: Locals): Expression => {
    switch (e.k) {
      case 'lit':
        if (typeof e.v === 'string' || typeof e.v === 'boolean' || (typeof e.v === 'number' && Number.isInteger(e.v))) return { op: 'literal', value: e.v };
        throw new Error('unsupported literal ' + JSON.stringify(e.v));
      case 'id': {
        if (locals.has(e.name)) return locals.get(e.name)!;
        const sym = symbol(e.name);
        if (!reactive(sym)) throw new Error('not a value: ' + e.name);
        if (!s.c.reads.some(r => r.sym === sym.id)) throw new Error('read absent from CP-6: ' + e.name);
        s.reads.add(sym.id);
        return { op: 'read', source: sym.name };
      }
      case 'member':
        if (e.opt) throw new Error('optional member access is outside plan v2');
        return e.p === 'length' ? { op: 'length', array: expression(e.o, s, locals) } : { op: 'get', object: expression(e.o, s, locals), key: e.p };
      case 'arr': return { op: 'array', items: e.items.map(x => expression(x, s, locals)) };
      case 'rec': return { op: 'object', fields: e.fields.map(f => { if (!('key' in f)) throw new Error('object spreads are outside plan v2'); return { key: f.key, value: expression(f.v, s, locals) }; }) };
      case 'bin': {
        const op = BINARY[e.op];
        if (!op) throw new Error('unsupported operator ' + e.op);
        return { op, left: expression(e.l, s, locals), right: expression(e.r, s, locals) } as Expression;
      }
      case 'un':
        if (e.op === '!') return { op: 'not', value: expression(e.e, s, locals) };
        throw new Error('unsupported operator ' + e.op);
      case 'if': return { op: 'cond', test: expression(e.c, s, locals), then: expression(e.t, s, locals), else: expression(e.f, s, locals) };
      case 'call': {
        if (e.f.k !== 'id' || !BUILTIN[e.f.name] || symbols.some(x => x.name === (e.f as { name: string }).name) || e.args.length !== 2) throw new Error('unsupported call');
        return { op: BUILTIN[e.f.name], array: expression(e.args[0], s, locals), ...lambda(e.args[1], s, locals) } as Expression;
      }
      default: throw new Error('unsupported expression ' + e.k);
    }
  };

  let temporary = 0;
  const host = (call: Expr, s: Seen, locals: Locals) => {
    if (call.k !== 'call' || call.f.k !== 'id') throw new Error('only await of a host call is supported');
    const h = symbol(call.f.name);
    if (h.kind !== 'import' || !s.c.calls.includes(h.id)) throw new Error('host call absent from CP-6');
    s.calls.add(h.id);
    return { host: h.name, args: call.args.map(a => expression(a, s, locals)) };
  };
  // inAction: an action body (awaits allowed, action calls not: nested actions are outside v2); otherwise a plain handler.
  const steps = (body: Stmt[], s: Seen, locals: Locals, inAction: boolean): Step[] => body.flatMap((st): Step[] => {
    if (st.k === 'let') {
      if (!inAction) throw new Error('a plain handler never awaits');
      if (st.e.k !== 'await' || st.e.init || st.e.stream) throw new Error('only let x = await host(…) is supported');
      if (symbols.some(x => x.name === st.name)) throw new Error('a local shadows a resolved name: ' + st.name);
      const bind = '$await' + temporary++;
      const step: Step = { op: 'await', ...host(st.e.e, s, locals), bind };
      locals.set(st.name, { op: 'local', name: bind });
      return [step];
    }
    if (st.k === 'try') {
      if (!inAction) throw new Error('a plain handler has no try: it never awaits, so nothing in it is caught');
      if (!st.handler || st.catchClasses || st.fin) throw new Error('only untyped try/catch is supported');
      // The catch binding is not a plan local: a catch body that reads the error fails to resolve and is refused.
      return [{ op: 'try', body: steps(st.body, s, new Map(locals), inAction), catch: steps(st.handler, s, new Map(locals), inAction) }];
    }
    if (st.k === 'expr') {
      const call = st.e;
      if (call.k !== 'call' || call.f.k !== 'id') throw new Error('only an action call is an expression statement');
      if (inAction) throw new Error('an action calling an action (nested transactions) is outside plan v2');
      const a = symbol(call.f.name);
      if (a.kind !== 'action' || !s.c.calls.includes(a.id)) throw new Error('action call absent from CP-6');
      s.calls.add(a.id);
      return [{ op: 'call', action: a.name, args: call.args.map(x => expression(x, s, locals)) }];
    }
    if (st.k !== 'write' && st.k !== 'optimistic') throw new Error('unsupported step ' + st.k);
    if (st.target.ctx) throw new Error('context writes are outside plan v2');
    const target = symbol(st.target.name);
    const path = st.target.path.length > 0;
    if (target.kind !== 'source') throw new Error('writes target sources');
    if (!s.c.writes.some(w => w.sym === target.id && w.op === st.k && !!w.path === path)) throw new Error('write absent from CP-6');
    s.writes.add(target.id + ' ' + st.k + (path ? ' path' : ''));
    if (st.k === 'optimistic') {
      if (!inAction) throw new Error('a plain handler never guesses: RX infers a guessing handler as an action (AC-1b)');
      if (path) throw new Error('optimistic path writes (createOptimisticStore) are outside plan v2');
      if (st.e.k === 'fn') return [{ op: 'optimistic', source: target.name, updater: lambda(st.e, s, locals) }];
      return [{ op: 'optimistic', source: target.name, value: expression(st.e, s, locals) }];
    }
    if (st.e.k === 'fn') throw new Error('functional plain writes are outside plan v2');
    const before: Step[] = [];
    let value: Expression;
    if (st.e.k === 'await') {
      if (!inAction) throw new Error('a plain handler never awaits');
      if (st.e.init || st.e.stream) throw new Error('only await host(…) is supported');
      const bind = '$await' + temporary++;
      before.push({ op: 'await', ...host(st.e.e, s, locals), bind });
      value = { op: 'local', name: bind };
    } else value = expression(st.e, s, locals);
    const segments = st.target.path.map((p): PathSegment => typeof p === 'string' ? { key: p } : { index: expression(p, s, locals) });
    return [...before, { op: 'write', source: target.name, ...(path ? { path: segments } : {}), value }];
  });

  // ------------------------------------------------------------- declarations, in resolved symbol order
  const plan: Plan = { version: 2, component: entry.name, hosts: [], ...(inner ? { bindings: [] } : {}), sources: [], memos: [], actions: [], markup: [] };
  // ------------------------------------------------------------- eval sites (docs/EVAL.md)
  const evalNodes: { node: EvalNode; site: EvalSite }[] = [];
  const evalNode = <T extends object>(head: T, site: EvalSite, s: Seen, locals: Locals, tail: object = {}): T & EvalNode => {
    const bindings = site.bindings.map(b => {
      const t = symbols.find(x => x.name === b.target);
      if (!t || locals.has(b.target) || !['source', 'eq', 'action', 'import'].includes(t.kind))
        throw new Error('eval binding ' + b.name + ': ' + b.target + ' is not a source, memo, action or host import of ' + entry.name);
      return { name: b.name, target: b.target };
    });
    const node = { ...head, code: expression(site.code, s, locals), bindings, interface: '', syntax: site.options.syntax, check: site.options.check, ...tail };
    evalNodes.push({ node, site });
    return node;
  };
  for (const sym of symbols.filter(s => s.kind === 'import')) {
    const imp = program.decls.find(d => d.k === 'import' && d.names.some(n => n.alias === sym.name));
    if (!imp || imp.k !== 'import' || !imp.declared) throw new Error('host ' + sym.name + ' needs a declaration file');
    const name = imp.names.find(n => n.alias === sym.name)!.name;
    const decl = set.declarations?.get(imp.declared)?.find(d => d.name === name);
    if (!decl || decl.kind !== 'fn' || decl.pure || decl.rejects || decl.side || !decl.ret || !TYPES.has(decl.ret) || decl.ptypes?.length !== decl.params.length || !decl.ptypes.every(t => t && TYPES.has(t)))
      throw new Error('host ' + sym.name + ' must be declared fn ' + name + '(scalar…): scalar');
    if (name !== sym.name) throw new Error('aliased host imports are outside plan v2');
    plan.hosts.push({ name, params: decl.ptypes as HostType[], returns: decl.ret as HostType });
  }
  for (const sym of symbols.filter(s => s.region === region.id)) {
    const d = entry.decls.find(d => 'name' in d && d.name === sym.name);
    const bound = inner?.get(sym.name);
    if (bound) {
      // A binding of evaluated code: declared by the frontend, read here, written only through actions it is passed.
      const writes = model.computations.flatMap(c => c.writes.filter(w => w.sym === sym.id));
      if (writes.length) throw new Error('writing the read-only binding ' + sym.name + ': evaluated code writes only through an action it is passed (docs/EVAL.md)');
      if (bound.kind === 'action') {
        if (sym.kind !== 'action' || !d || d.k !== 'action' || d.body.length) throw new Error('binding ' + sym.name + ' is not the declared action');
        seen(comp('action', sym.name));
        plan.bindings!.push({ name: sym.name, kind: 'action', params: [...bound.params] });
      } else if (sym.kind === 'eq' && bound.kind === 'read') {
        // A structured read binding in TSX syntax: a memo (TSX has no structured signal).
        if (!d || d.k !== 'eq' || sites.has(d)) throw new Error('binding ' + sym.name + ' is not the declared memo');
        const c = seen(comp('memo', sym.name));
        if (c.c.reads.length) throw new Error('binding ' + sym.name + ' is not the declared memo');
        plan.bindings!.push({ name: sym.name, kind: bound.kind, type: printType(bound.type) });
      } else {
        if (sym.kind !== 'source' || !d || d.k !== 'source' || sym.question) throw new Error('binding ' + sym.name + ' is not the declared source');
        seen(comp('seed', sym.name));
        plan.bindings!.push({ name: sym.name, kind: bound.kind, type: printType(bound.type) });
      }
      continue;
    }
    if (sym.kind === 'source') {
      if (!d || d.k !== 'source' || d.key || d.type) throw new Error('source shape unsupported: ' + sym.name);
      const writes = model.computations.flatMap(c => c.writes.filter(w => w.sym === sym.id));
      const optimistic = writes.some(w => w.op === 'optimistic'), store = writes.some(w => w.path);
      if (writes.some(w => w.op !== 'write' && w.op !== 'optimistic')) throw new Error('refresh/affects are outside plan v2');
      if (!!sym.question !== !!d.question) throw new Error('question mismatch');
      if (sym.question !== optimistic) throw new Error(optimistic ? 'an optimistic source must be derived (createOptimistic(fn))' : 'async questions are outside plan v2');
      if (optimistic && store) throw new Error('optimistic stores are outside plan v2');
      const seedComp = comp(sym.question ? 'question' : 'seed', sym.name);
      if (!optimistic && seedComp.reads.length) throw new Error('a signal or store seeded from a snapshot of another source (E-4) is outside plan v2: ' + sym.name);
      // A structured seed (a record or array literal) is a store: RX lowers `source x := {…}` to createStore (ST-1) and
      // TSX's createStore lowers to it, whether or not anything writes a path. A scalar seed is a signal.
      const structured = d.init.k === 'rec' || d.init.k === 'arr';
      if (!optimistic && store && !structured) throw new Error('a path write to a source with a scalar seed is outside plan v2: ' + sym.name);
      if (!optimistic && structured && writes.some(w => !w.path)) throw new Error('a root write to a store is outside plan v2: ' + sym.name);
      const seed = expression(d.init, seen(seedComp), new Map());
      plan.sources.push({ name: sym.name, kind: optimistic ? 'optimistic' : structured ? 'store' : 'signal', seed });
    } else if (sym.kind === 'eq') {
      if (!d || d.k !== 'eq' || d.deferred || d.key) throw new Error('memo shape unsupported: ' + sym.name);
      const site = sites.get(d);
      if (site) {
        plan.memos.push({ name: sym.name, value: evalNode({ op: 'eval' as const }, site, seen(comp('memo', sym.name)), new Map(), { type: site.options.type! }) as Expression });
      } else plan.memos.push({ name: sym.name, value: expression(d.e, seen(comp('memo', sym.name)), new Map()) });
    } else if (sym.kind === 'action') {
      if (!d || d.k !== 'action') throw new Error('action shape missing');
      const locals: Locals = new Map();
      for (const p of d.params) {
        if (symbols.some(x => x.name === p)) throw new Error('a parameter shadows a resolved name: ' + p);
        locals.set(p, { op: 'local', name: p });
      }
      plan.actions.push({ name: sym.name, params: [...d.params], steps: steps(d.body, seen(comp('action', sym.name)), locals, true) });
    } else if (sym.kind !== 'props') throw new Error('unsupported resolved symbol ' + sym.kind);
  }
  if (entry.decls.some(d => d.k !== 'source' && d.k !== 'eq' && d.k !== 'action')) throw new Error('unsupported component declaration');

  // ------------------------------------------------------------- markup, in checker walk order
  const inside = (r: number): boolean => r === region.id || (model.regions.find(x => x.id === r)?.parent !== undefined && inside(model.regions.find(x => x.id === r)!.parent!));
  const walk = model.computations.filter(c => (c.kind === 'reader' || c.kind === 'handler') && inside(c.region));
  let next = 0;
  const take = (kind: string, at: RegExp, r: number): Comp => {
    const c = walk[next++];
    if (!c || c.kind !== kind || !at.test(c.at ?? '') || c.region !== r) throw new Error('markup ' + kind + ' absent from CP-6 at ' + at);
    return c;
  };
  const opened = new Map<string, number>();
  const child = (parent: number, kind: 'then' | 'else' | 'for'): number => {
    const key = parent + ' ' + kind, n = opened.get(key) ?? 0;
    const r = model.regions.filter(x => x.parent === parent && x.kind === kind)[n];
    if (!r) throw new Error(kind + ' region absent from CP-6');
    opened.set(key, n + 1);
    return r.id;
  };
  const handler = (tag: string, a: { name: string; e: Expr }, r: number, locals: Locals): { name: string; steps: Step[] } => {
    if (!/^on[A-Z]/.test(a.name) || a.e.k !== 'fn' || a.e.params.length) throw new Error('attributes other than parameterless event handlers are outside plan v2: ' + a.name);
    const c = take('handler', new RegExp('^' + tag + ' ' + a.name + '$'), r);
    const s = seen(c);
    const body: Stmt[] = a.e.stmts ?? [{ k: 'expr', e: a.e.body }];
    if (body.length === 1 && body[0].k === 'action') {
      // An inline action (TSX action(function* () { … }) at the binding): a nested CP-6 action computation.
      const ac = model.computations.find(x => x.kind === 'action' && x.in === c.id);
      if (!ac) throw new Error('inline action absent from CP-6');
      return { name: a.name, steps: [lift(body[0].body, seen(ac))] };
    }
    if (actionInference(body).trigger) return { name: a.name, steps: [lift(body, s)] };
    return { name: a.name, steps: steps(body, s, locals, false) };
  };
  // An action boundary RX infers (AC-1b) or an inline action: a lifted parameterless action, called by the handler.
  // It may not capture markup locals (a row item): those are refused as unresolved names.
  const lift = (body: Stmt[], s: Seen): Step => {
    const name = '$action' + plan.actions.length;
    const action = { name, params: [] as string[], steps: [] as Step[] };
    plan.actions.push(action);
    action.steps = steps(body, s, new Map(), true);
    return { op: 'call', action: name, args: [] };
  };
  const text = (m: Markup, r: number, locals: Locals): View => {
    if (m.k !== 'read') throw new Error('text');
    const site = sites.get(m);
    if (site) return evalNode({ kind: 'eval' as const }, site, seen(take('reader', /^\{…\}$/, r)), locals);
    // TSX and yield make text coercion explicit ("" + x); a text hole renders ToString(x) anyway (PLAN-V2 fallback 8).
    // Every leading coercion is dropped: TSX's lowering adds one over an authored `"" + x`, and ToString is idempotent.
    let e = m.e;
    while (e.k === 'bin' && e.op === '+' && e.l.k === 'lit' && e.l.v === '') e = e.r;
    // Solid's compiler folds a JSX expression it can evaluate with confidence to static text (createTextNode, never
    // insert), even when a dead branch reads (`(false ? x : "a") + ""`); RX inserts it. Neither is the other's twin.
    if (confident(e).ok) throw new Error('a text hole with a constant value (Solid\'s compiler folds it to static text) is outside plan v2');
    // In an uncoerced TSX hole `{(a() && b()) || c}` Solid's compiler memoizes the `&&` test (transformCondition); a
    // coerced hole and RX's do not. The plan cannot tell them apart, so such a hole is refused (conservatively: any
    // operand that is not a literal or a local counts as dynamic).
    const dynamic = (x: Expr): boolean => x.k === 'lit' ? false : x.k === 'id' ? !locals.has(x.name) : true;
    const memoized = (x: Expr): boolean => x.k === 'bin' && (x.op === '&&' ? dynamic(x.l) && dynamic(x.r) : x.op === '||' && memoized(x.l));
    if (memoized(e)) throw new Error('a text hole whose value has `&&` on its `||` spine (Solid\'s compiler memoizes its test in a TSX hole) is outside plan v2');
    return { kind: 'text', value: expression(e, seen(take('reader', /^\{…\}$/, r)), locals) };
  };
  const markup = (ms: Markup[], r: number, locals: Locals): View[] => {
    const out: View[] = [];
    for (const [i, m] of ms.entries()) {
      if (m.k === 'text') {
        // Adjacent static text renders as its concatenation; the RX parser may split it where JSX does not.
        const last = out.at(-1);
        if (i > 0 && ms[i - 1].k === 'text' && last?.kind === 'text' && last.value.op === 'literal')
          last.value = { op: 'literal', value: String(last.value.value) + m.s };
        else out.push({ kind: 'text', value: { op: 'literal', value: m.s } });
      } else if (m.k === 'read') out.push(text(m, r, locals));
      else if (m.k === 'el') {
        if (!/^[a-z][a-z0-9]*$/.test(m.tag)) throw new Error('only host elements are supported: ' + m.tag);
        const events = m.attrs.map(a => handler(m.tag, a, r, locals));
        out.push({ kind: 'element', tag: m.tag, events, children: markup(m.children, r, locals) });
      } else if (m.k === 'mif') {
        if (m.tDecls.length || m.fDecls.length) throw new Error('branch declarations are outside plan v2');
        const when = expression(m.c, seen(take('reader', /^if$/, r)), locals);
        const children = markup(m.t, child(r, 'then'), locals);
        // CP-6 opens an else region for every if, with or without an else branch.
        const fallback = markup(m.f, child(r, 'else'), locals);
        out.push({ kind: 'show', when, children, fallback });
      } else if (m.k === 'mfor') {
        if (m.decls.length) throw new Error('row declarations are outside plan v2');
        if (symbols.some(x => x.name === m.name)) throw new Error('a row item shadows a resolved name: ' + m.name);
        const each = expression(m.xs, seen(take('reader', /^for$/, r)), locals);
        const rows = new Map(locals).set(m.name, { op: 'local', name: m.name });
        out.push({ kind: 'for', each, item: m.name, key: 'identity', children: markup(m.body, child(r, 'for'), rows) });
      } else throw new Error('unsupported markup ' + m.k);
    }
    return out;
  };
  // Solid's compiler lowers text in a component position (the markup, a Show branch, a For row) to a string or a memo,
  // not to a text node in a template; the consumers mirror the compiler only for elements, Show and For there.
  const component = (vs: View[]) => {
    if (vs.some(v => v.kind === 'text')) throw new Error('text directly in a component position (the markup, a Show branch, a For row) is outside plan v2');
    // docs/EVAL.md: the compiler lowers a child there differently from an element's; eval sites are element children.
    if (vs.some(v => v.kind === 'eval')) throw new Error('an eval site directly in a component position (the markup, a Show branch, a For row) is outside plan v2: make it an element child');
    for (const v of vs) visit(v);
  };
  const visit = (v: View): void => {
    if (v.kind === 'element') v.children.forEach(visit);
    else if (v.kind === 'show') { component(v.children); component(v.fallback); }
    else if (v.kind === 'for') component(v.children);
  };
  plan.markup = markup(entry.view, region.id, new Map());
  component(plan.markup);
  if (next !== walk.length) throw new Error('CP-6 has markup computations the plan does not encode');
  const missing = model.computations.filter(c => c.region === region.id || inside(c.region)).filter(c => !used.some(u => u.c === c));
  if (missing.length) throw new Error('CP-6 computations absent from the plan: ' + missing.map(c => c.kind + ':' + (c.name ?? c.at)).join(', '));
  finish();
  if (evalNodes.length) deriveInterfaces(plan, entry.decls, evalNodes);
  return plan;
}

/** docs/EVAL.md, "Bindings and their types": each eval site's interface is derived from the enclosing plan's types
 *  (plan/types.ts); an interface written at the site must equal it. */
function deriveInterfaces(plan: Plan, decls: { k: string; name?: string; ptypes?: (string | undefined)[] }[], nodes: { node: EvalNode; site: EvalSite }[]) {
  const actionTypes = new Map(decls.flatMap(d => d.k === 'action' ? [[d.name!, (d.ptypes ?? []).map(t => TYPES.has(t ?? '') ? t as HostType : undefined)] as const] : []));
  const typed = typePlan(plan, actionTypes);
  const sourceKind = new Map(plan.sources.map(s => [s.name, s.kind]));
  for (const { node, site } of nodes) {
    const ds: BindingDecl[] = node.bindings.map(b => {
      const host = plan.hosts.find(h => h.name === b.target);
      if (host) return { name: b.name, kind: 'host', params: [...host.params], returns: host.returns };
      const t = typed.names.get(b.target);
      if (!t) throw new Error('eval binding ' + b.name + ': the type of ' + b.target + ' cannot be derived (' + (typed.errors.join('; ') || 'untyped') + ')');
      if (t.kind === 'action') return { name: b.name, kind: 'action', params: t.params.map(p => p.k as HostType) };
      return { name: b.name, kind: sourceKind.get(b.target) === 'store' ? 'store' : 'read', type: t.type };
    });
    if (site.options.interface !== undefined && !sameInterface(parseInterface(site.options.interface), ds))
      throw new Error('eval: the interface written at the site differs from the one derived from ' + plan.component + ':\n' + printInterface(ds));
    node.interface = site.derived = printInterface(ds);
  }
}

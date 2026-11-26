// Plan schema v2 (docs/PLAN-V2.md): the slice-2 tracker as data. Same contract as resolve.ts (v1, unchanged): run the
// pinned checker, refuse diagnostics, take identities, kinds, reads, writes, calls and regions from CP-6, and read only
// what CP-6 lacks from the checked RX AST. Every CP-6 read, write and call of a used computation must appear in the
// plan, and every reactive read, write and call in the plan must be a CP-6 fact. Unsupported forms throw.
import { checkModules, type ModuleSet } from '../tsx/rx/compiler.ts';
import { actionInference } from '../tsx/rx/infer.ts';
import type { Expr, Stmt, Markup } from '../tsx/rx/ast.ts';
import { evalSitesOf, type EvalSite } from '../eval/sites.ts';
import { InterfaceError, parseInterface, parseType, printInterface, sameInterface, type BindingDecl } from '../eval/interface.ts';
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
  /** v2.1 (PLAN-V2.md, "v2.1: async data"): Solid's isPending(() => value) and latest(() => value). */
  | { op: 'pending' | 'latest'; value: Expression }
  /** v2.3: a prop read (`props.x`), through the site's getter: tracked in reactive contexts. */
  | { op: 'prop'; name: string }
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
  | { op: 'call'; action: string; args: Expression[] }
  /** v2.3: a handler's call of a function prop (`props.onPick(x)`): a callback or an action its site passed. */
  | { op: 'call'; prop: string; args: Expression[] }
  /** v2.1: Solid's refresh(memo) and affects(memo), on an async memo. */
  | { op: 'refresh' | 'affects'; source: string };
export type View =
  /** v2.3 (PLAN-V2.md, "v2.3: composition"): an element with a value attribute lists every attribute in `attrs`, in
   *  source order, and has no `events`. */
  | { kind: 'element'; tag: string; attrs?: Attr[]; events: { name: string; steps: Step[]; param?: string }[]; children: View[] }
  /** v2.3: an application of a component of the plan (`createComponent(Name, props)`). */
  | { kind: 'component'; name: string; props: PropArg[]; children?: View[] }
  /** v2.3: `{props.children}`, an element child: whatever the site passed, inserted as given. */
  | { kind: 'children' }
  | { kind: 'text'; value: Expression }
  | { kind: 'show'; when: Expression; children: View[]; fallback: View[] }
  | { kind: 'for'; each: Expression; item: string; key: 'identity'; children: View[] }
  /** docs/EVAL.md: a markup eval, an element child. */
  | ({ kind: 'eval' } & EvalNode)
  /** v2.1: Solid's <Loading fallback>children</Loading> and <Errored fallback={(err) => …}>children</Errored>. */
  | { kind: 'loading' | 'errored'; fallback: View[]; children: View[] };
export type HostType = 'number' | 'string' | 'boolean';
/** A memo: a derived value, or (v2.1) an async memo over one host call, Solid's createMemo(() => host(…args)). */
export type Memo = { name: string; value: Expression } | { name: string; await: { host: string; args: Expression[] } };
/** A host's result: a scalar type name, or (v2.1) a structured type in the eval interface grammar (printType's form). */
export type Host = { name: string; params: HostType[]; returns: string; pure?: true };
/** v2.3: an element attribute, a value or an event handler. A value the compiler sees as static (no call or member
 *  access in the TSX twin) is a prop of createElement with the events; the others are set by the template's one
 *  attribute effect (PLAN-V2.md, "v2.3: composition"). */
export type Attr = { name: string; value: Expression } | { name: string; steps: Step[]; param?: string };
/** v2.3: an argument at a component site: a value (a getter when dynamic), a callback (its parameters are locals of its
 *  steps), an action of the parent passed by name, or one of the parent's own function props passed on. */
export type PropArg =
  | { name: string; value: Expression }
  | { name: string; handler: { params: string[]; steps: Step[] } }
  | { name: string; action: string }
  | { name: string; forward: string };
/** v2.3: a component of the plan other than the entry: the props it reads, as values or as functions it calls. */
export type Component = {
  name: string;
  props: { name: string; kind: 'value' | 'function' | 'children' }[];
  sources: Plan['sources'];
  memos: Memo[];
  actions: Plan['actions'];
  markup: View[];
};
export type Plan = {
  /** 2, or 2.1 when the plan uses any v2.1 form (PLAN-V2.md, "v2.1: async data"), or 2.3 when it uses any v2.3 form
   *  (PLAN-V2.md, "v2.3: composition"; a v2.3 plan may use v2.1 forms too). */
  version: 2 | 2.1 | 2.3;
  component: string;
  hosts: Host[];
  /** Evaluated code only (docs/EVAL.md). */
  bindings?: InnerBinding[];
  sources: { name: string; kind: 'signal' | 'store' | 'optimistic'; seed: Expression }[];
  memos: Memo[];
  actions: { name: string; params: string[]; steps: Step[] }[];
  markup: View[];
  /** A value eval's code (docs/EVAL.md): its one expression. */
  value?: Expression;
  /** v2.3: the module's other components the entry applies, in declaration order. */
  components?: Component[];
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
/** `async`: also accept plan v2.1's forms (PLAN-V2.md, "v2.1: async data"); a plan that uses none of them is the v2
 *  plan byte for byte. Without it (the v2 builder) they are refused as before. */
export function resolvePlanV2(set: ModuleSet, opts: { bindings?: BindingDecl[]; async?: boolean; compose?: boolean } = {}): Plan {
  const checked = checkModules(set);
  if (checked.diags.length) throw new Error(JSON.stringify(checked.diags));
  if (set.order.length !== 1) throw new Error('plan v2 supports one RX module plus host imports');
  const file = set.order[0], program = set.programs.get(file)!, model = checked.models.get(file)!;
  const entry = program.decls.find(d => d.k === 'component' && d.isDefault);
  if (!entry || entry.k !== 'component') throw new Error('expected one default component');
  type ComponentDecl = typeof entry;
  // v2.3 (PLAN-V2.md, "v2.3: composition"): the module's other components, applied by name from the entry down.
  const others = program.decls.filter((d): d is ComponentDecl => d.k === 'component' && d !== entry);
  if (program.decls.some(d => d.k !== 'import' && d !== entry && !(opts.compose && d.k === 'component'))) throw new Error('plan v2 supports one component and imports');
  if (entry.propsType) throw new Error('the entry component takes no props');
  const imports = model.symbols.filter(s => s.kind === 'import');
  const propsSyms = new Set(model.symbols.filter(s => s.kind === 'props').map(s => s.id));
  const sites = evalSitesOf(program);
  const inner = opts.bindings ? new Map(opts.bindings.filter(d => d.kind !== 'host').map(d => [d.name, d])) : undefined;
  type Comp = typeof model.computations[number];
  type Sym = typeof model.symbols[number];
  let v21 = false, v23 = false;

  // Each used computation collects the facts its plan encodes; finish() requires them to equal CP-6's exactly. A prop is
  // read by name (CP-6's `field` on a props symbol); any other symbol by itself (CP-6 also records the first member name
  // of a member read, which the plan's `get` carries).
  type Seen = { c: Comp; reads: Set<string>; writes: Set<string>; calls: Set<number> };
  const used: Seen[] = [];
  const seen = (c: Comp): Seen => { const s = { c, reads: new Set<string>(), writes: new Set<string>(), calls: new Set<number>() }; used.push(s); return s; };
  const readKey = (sym: number, field?: string) => sym + (propsSyms.has(sym) && field !== undefined ? '.' + field : '');
  const finish = () => {
    for (const { c, reads, writes, calls } of used) {
      const want = (xs: (string | number)[]) => JSON.stringify([...new Set(xs.map(String))].sort());
      const at = c.kind + ':' + (c.name ?? c.at);
      if (want([...reads]) !== want(c.reads.map(r => readKey(r.sym, r.field)))) throw new Error('reads differ from CP-6 in ' + at);
      if (want([...writes]) !== want(c.writes.map(w => w.sym + ' ' + w.op + (w.path ? ' path' : '')))) throw new Error('writes differ from CP-6 in ' + at);
      if (want([...calls]) !== want(c.calls)) throw new Error('calls differ from CP-6 in ' + at);
    }
  };
  let temporary = 0;

  // ------------------------------------------------------------- hosts, the module's imports
  const hosts: Host[] = [];
  for (const sym of imports) {
    const imp = program.decls.find(d => d.k === 'import' && d.names.some(n => n.alias === sym.name));
    if (!imp || imp.k !== 'import' || !imp.declared) throw new Error('host ' + sym.name + ' needs a declaration file');
    const name = imp.names.find(n => n.alias === sym.name)!.name;
    const decl = set.declarations?.get(imp.declared)?.find(d => d.name === name);
    // v2.1: a host may be pure (a query: RX calls only pure hosts in reactive scope, IO-2) and return a structured type.
    const returns = decl?.kind === 'fn' && decl.ret && opts.async ? hostResult(decl.ret) : decl?.kind === 'fn' && decl.ret && TYPES.has(decl.ret) ? decl.ret : undefined;
    if (!decl || decl.kind !== 'fn' || (decl.pure && !opts.async) || decl.rejects || decl.side || !returns || decl.ptypes?.length !== decl.params.length || !decl.ptypes.every(t => t && TYPES.has(t)))
      throw new Error('host ' + sym.name + ' must be declared fn ' + name + '(scalar…): ' + (opts.async ? 'type (pure allowed)' : 'scalar'));
    if (name !== sym.name) throw new Error('aliased host imports are outside plan v2');
    if (decl.pure || !TYPES.has(returns)) v21 = true;
    hosts.push({ name, params: decl.ptypes as HostType[], returns, ...(decl.pure ? { pure: true as const } : {}) });
  }

  // ------------------------------------------------------------- eval sites (docs/EVAL.md), in the entry only
  const evalNodes: { node: EvalNode; site: EvalSite }[] = [];
  type Body = Pick<Plan, 'sources' | 'memos' | 'actions' | 'markup'> & { props: Component['props']; bindings?: InnerBinding[] };

  const build = (decl: ComponentDecl, isEntry: boolean): Body => {
    const region = model.regions.find(r => r.kind === 'component' && r.name === decl.name);
    if (!region) throw new Error('missing resolved component ' + decl.name);
    const symbols = model.symbols.filter(s => s.region === region.id || s.kind === 'import');
    const propsSym = isEntry ? undefined : symbols.find(s => s.kind === 'props');
    const symbol = (name: string) => { const s = symbols.find(s => s.name === name); if (!s) throw new Error('unresolved ' + name); return s; };
    const bindings = isEntry ? inner : undefined;
    // v2.1: the async memos (`x = await host(…)`), known before any body that refreshes or probes them is read.
    const asyncNames = new Set(opts.async ? decl.decls.flatMap(d => d.k === 'eq' && d.e.k === 'await' ? [d.name] : []) : []);
    const comp = (kind: string, name: string) => { const c = model.computations.find(c => c.region === region.id && c.kind === kind && c.name === name); if (!c) throw new Error('missing computation ' + kind + ':' + name); return c; };
    const body: Body = { sources: [], memos: [], actions: [], markup: [], props: [], ...(bindings ? { bindings: [] } : {}) };
    // v2.3: each prop this component reads, as a value (`props.x`) or as a function it calls (`props.f(…)`).
    const useProp = (name: string, kind: Component['props'][number]['kind']) => {
      const had = body.props.find(p => p.name === name);
      if (had && had.kind !== kind) throw new Error('the prop ' + name + ' of ' + decl.name + ' is both read as a value and called');
      if (!had) body.props.push({ name, kind });
    };
    const isProps = (e: Expr, locals: Locals) => propsSym !== undefined && e.k === 'id' && e.name === decl.props && !locals.has(e.name);
    const propRead = (s: Seen, p: string) => {
      if (!s.c.reads.some(r => r.sym === propsSym!.id && r.field === p)) throw new Error('prop read absent from CP-6: ' + p);
      s.reads.add(readKey(propsSym!.id, p));
      v23 = true;
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
          if (asyncNames.has(sym.name) && (s.c.kind === 'handler' || s.c.kind === 'action'))
            throw new Error('an async memo is read only in reactive contexts in plan v2.1: ' + e.name);
          if (!s.c.reads.some(r => r.sym === sym.id)) throw new Error('read absent from CP-6: ' + e.name);
          s.reads.add(readKey(sym.id));
          return { op: 'read', source: sym.name };
        }
        case 'member':
          if (e.opt) throw new Error('optional member access is outside plan v2');
          if (isProps(e.o, locals)) {
            if (e.p === 'children') throw new Error('props.children is read only as an element child in plan v2.3');
            propRead(s, e.p);
            useProp(e.p, 'value');
            return { op: 'prop', name: e.p };
          }
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
        // createOptimistic(value): a constant seed the optimistic source reverts to.
        case 'peek':
          if (e.e.k !== 'lit') throw new Error('createOptimistic takes a function or a constant');
          return expression(e.e, s, locals);
        case 'pending': case 'latest':
          if (!opts.async) throw new Error('unsupported expression ' + e.k);
          v21 = true;
          return { op: e.k, value: expression(e.e, s, locals) };
        case 'call': {
          if (e.f.k !== 'id' || !BUILTIN[e.f.name] || symbols.some(x => x.name === (e.f as { name: string }).name) || e.args.length !== 2) throw new Error('unsupported call');
          return { op: BUILTIN[e.f.name], array: expression(e.args[0], s, locals), ...lambda(e.args[1], s, locals) } as Expression;
        }
        default: throw new Error('unsupported expression ' + e.k);
      }
    };

    const host = (call: Expr, s: Seen, locals: Locals) => {
      if (call.k !== 'call' || call.f.k !== 'id') throw new Error('only await of a host call is supported');
      const h = symbol(call.f.name);
      if (h.kind !== 'import' || !s.c.calls.includes(h.id)) throw new Error('host call absent from CP-6');
      s.calls.add(h.id);
      return { host: h.name, args: call.args.map(a => expression(a, s, locals)) };
    };
    // inAction: an action body (awaits allowed, action calls not: nested actions are outside v2); otherwise a plain handler.
    const steps = (stmts: Stmt[], s: Seen, locals: Locals, inAction: boolean): Step[] => stmts.flatMap((st): Step[] => {
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
        if (call.k === 'call' && call.f.k === 'member' && isProps(call.f.o, locals)) {
          // v2.3: a call of a function prop (a callback or an action its site passed), a snapshot read of the prop.
          if (inAction) throw new Error('an action calling a function prop is outside plan v2.3');
          propRead(s, call.f.p);
          useProp(call.f.p, 'function');
          return [{ op: 'call', prop: call.f.p, args: call.args.map(x => expression(x, s, locals)) }];
        }
        if (call.k !== 'call' || call.f.k !== 'id') throw new Error('only an action call is an expression statement');
        if (inAction) throw new Error('an action calling an action (nested transactions) is outside plan v2');
        const a = symbol(call.f.name);
        if (a.kind !== 'action' || !s.c.calls.includes(a.id)) throw new Error('action call absent from CP-6');
        s.calls.add(a.id);
        return [{ op: 'call', action: a.name, args: call.args.map(x => expression(x, s, locals)) }];
      }
      if ((st.k === 'refresh' || st.k === 'affects') && opts.async) {
        // v2.1: Solid's refresh(memo) / affects(memo), on an async memo. affects marks pending until the action's
        // transaction lands, so it is an action step; a plain refresh is a quiet re-ask.
        if (st.k === 'affects' && !inAction) throw new Error('affects is an action step');
        const target = symbol(st.name);
        if (target.kind !== 'eq' || !asyncNames.has(target.name)) throw new Error(st.k + ' targets an async memo in plan v2.1: ' + st.name);
        if (!s.c.writes.some(w => w.sym === target.id && w.op === st.k && !w.path)) throw new Error(st.k + ' absent from CP-6');
        s.writes.add(target.id + ' ' + st.k);
        v21 = true;
        return [{ op: st.k, source: target.name }];
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

    const evalNode = <T extends object>(head: T, site: EvalSite, s: Seen, locals: Locals, tail: object = {}): T & EvalNode => {
      if (!isEntry) throw new Error('eval sites are outside the components a v2.3 entry applies');
      const bound = site.bindings.map(b => {
        const t = symbols.find(x => x.name === b.target);
        if (!t || locals.has(b.target) || !['source', 'eq', 'action', 'import'].includes(t.kind))
          throw new Error('eval binding ' + b.name + ': ' + b.target + ' is not a source, memo, action or host import of ' + decl.name);
        return { name: b.name, target: b.target };
      });
      const node = { ...head, code: expression(site.code, s, locals), bindings: bound, interface: '', syntax: site.options.syntax, check: site.options.check, ...tail };
      evalNodes.push({ node, site });
      return node;
    };

    // ------------------------------------------------------------- declarations, in resolved symbol order
    for (const sym of symbols.filter(s => s.region === region.id)) {
      const d = decl.decls.find(d => 'name' in d && d.name === sym.name);
      const bound = bindings?.get(sym.name);
      if (bound) {
        // A binding of evaluated code: declared by the frontend, read here, written only through actions it is passed.
        const writes = model.computations.flatMap(c => c.writes.filter(w => w.sym === sym.id));
        if (writes.length) throw new Error('writing the read-only binding ' + sym.name + ': evaluated code writes only through an action it is passed (docs/EVAL.md)');
        if (bound.kind === 'action') {
          if (sym.kind !== 'action' || !d || d.k !== 'action' || d.body.length) throw new Error('binding ' + sym.name + ' is not the declared action');
          seen(comp('action', sym.name));
          body.bindings!.push({ name: sym.name, kind: 'action', params: [...bound.params] });
        } else if (sym.kind === 'eq' && bound.kind === 'read') {
          // A structured read binding in TSX syntax: a memo (TSX has no structured signal).
          if (!d || d.k !== 'eq' || sites.has(d)) throw new Error('binding ' + sym.name + ' is not the declared memo');
          const c = seen(comp('memo', sym.name));
          if (c.c.reads.length) throw new Error('binding ' + sym.name + ' is not the declared memo');
          body.bindings!.push({ name: sym.name, kind: bound.kind, type: printType(bound.type) });
        } else {
          if (sym.kind !== 'source' || !d || d.k !== 'source' || sym.question) throw new Error('binding ' + sym.name + ' is not the declared source');
          seen(comp('seed', sym.name));
          body.bindings!.push({ name: sym.name, kind: bound.kind, type: printType(bound.type) });
        }
        continue;
      }
      if (sym.kind === 'source') {
        if (!d || d.k !== 'source' || d.key || d.type) throw new Error('source shape unsupported: ' + sym.name);
        const writes = model.computations.flatMap(c => c.writes.filter(w => w.sym === sym.id));
        const optimistic = writes.some(w => w.op === 'optimistic'), store = writes.some(w => w.path);
        if (writes.some(w => w.op !== 'write' && w.op !== 'optimistic')) throw new Error(opts.async ? 'refresh/affects target an async memo in plan v2.1: ' + sym.name : 'refresh/affects are outside plan v2');
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
        body.sources.push({ name: sym.name, kind: optimistic ? 'optimistic' : structured ? 'store' : 'signal', seed });
      } else if (sym.kind === 'eq') {
        if (!d || d.k !== 'eq' || d.deferred || d.key) throw new Error('memo shape unsupported: ' + sym.name);
        const site = sites.get(d);
        if (asyncNames.has(sym.name) && d.e.k === 'await') {
          // v2.1: an async memo, the whole value one awaited host call (R-1): Solid's createMemo(() => host(…args)).
          if (d.e.init || d.e.stream) throw new Error('an async memo is await host(…), without a first-paint value or a stream: ' + sym.name);
          body.memos.push({ name: sym.name, await: host(d.e.e, seen(comp('memo', sym.name)), new Map()) });
          v21 = true;
        } else if (site) {
          body.memos.push({ name: sym.name, value: evalNode({ op: 'eval' as const }, site, seen(comp('memo', sym.name)), new Map(), { type: site.options.type! }) as Expression });
        } else body.memos.push({ name: sym.name, value: expression(d.e, seen(comp('memo', sym.name)), new Map()) });
      } else if (sym.kind === 'action') {
        if (!d || d.k !== 'action') throw new Error('action shape missing');
        const locals: Locals = new Map();
        for (const p of d.params) {
          if (symbols.some(x => x.name === p)) throw new Error('a parameter shadows a resolved name: ' + p);
          locals.set(p, { op: 'local', name: p });
        }
        body.actions.push({ name: sym.name, params: [...d.params], steps: steps(d.body, seen(comp('action', sym.name)), locals, true) });
      } else if (sym.kind !== 'props') throw new Error('unsupported resolved symbol ' + sym.kind);
    }
    if (decl.decls.some(d => d.k !== 'source' && d.k !== 'eq' && d.k !== 'action')) throw new Error('unsupported component declaration');

    // ------------------------------------------------------------- markup, in checker walk order
    const inside = (r: number): boolean => r === region.id || (model.regions.find(x => x.id === r)?.parent !== undefined && inside(model.regions.find(x => x.id === r)!.parent!));
    const walk = model.computations.filter(c => (c.kind === 'reader' || c.kind === 'handler' || c.kind === 'prop') && inside(c.region));
    let next = 0;
    const take = (kind: string, at: RegExp, r: number): Comp => {
      const c = walk[next++];
      if (!c || c.kind !== kind || !at.test(c.at ?? '') || c.region !== r) throw new Error('markup ' + kind + ' absent from CP-6 at ' + at);
      return c;
    };
    const at = (tag: string, name: string) => new RegExp('^' + (tag + ' ' + name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$');
    const opened = new Map<string, number>();
    const child = (parent: number, kind: 'then' | 'else' | 'for' | 'loading' | 'errored' | 'children', name?: string): number => {
      const key = parent + ' ' + kind + ' ' + (name ?? ''), n = opened.get(key) ?? 0;
      const r = model.regions.filter(x => x.parent === parent && x.kind === kind && (name === undefined || x.name === name))[n];
      if (!r) throw new Error(kind + ' region absent from CP-6');
      opened.set(key, n + 1);
      return r.id;
    };
    // A handler's body: plain steps, or an action RX infers (AC-1b) or an inline action, lifted. `params` are the
    // callback's parameters, bound as locals of its steps.
    const handlerSteps = (c: Comp, e: Extract<Expr, { k: 'fn' }>, locals: Locals): Step[] => {
      const s = seen(c);
      const stmts: Stmt[] = e.stmts ?? [{ k: 'expr', e: e.body }];
      if (stmts.length === 1 && stmts[0].k === 'action') {
        // An inline action (TSX action(function* () { … }) at the binding): a nested CP-6 action computation.
        const ac = model.computations.find(x => x.kind === 'action' && x.in === c.id);
        if (!ac) throw new Error('inline action absent from CP-6');
        return [lift(stmts[0].body, seen(ac))];
      }
      if (actionInference(stmts).trigger) return [lift(stmts, s)];
      return steps(stmts, s, locals, false);
    };
    const handler = (tag: string, a: { name: string; e: Expr }, r: number, locals: Locals): { name: string; steps: Step[]; param?: string } => {
      if (!/^on[A-Z]/.test(a.name) || a.e.k !== 'fn' || (a.e.params.length && !opts.compose)) throw new Error('attributes other than parameterless event handlers are outside plan v2: ' + a.name);
      const c = take('handler', at(tag, a.name), r);
      // v2.3: an event handler may take the event (`(e) => …`). One that reads it (DOM input) reads only
      // `e.target.value` / `e.currentTarget.value`, the text an input event carries, and is a plain handler.
      if (a.e.params.length) {
        v23 = true;
        if (mentions(a.e, new Set(a.e.params))) {
          const param = a.e.params[0];
          if (a.e.params.length > 1) throw new Error('an event handler takes one event: ' + tag + ' ' + a.name);
          if (model.symbols.some(x => x.name === param) || locals.has(param)) throw new Error('an event parameter shadows a resolved name: ' + param);
          const stmts: Stmt[] = a.e.stmts ?? [{ k: 'expr', e: a.e.body }];
          if (stmts.length === 1 && stmts[0].k === 'action' || actionInference(stmts).trigger) throw new Error('a handler that reads its event is a plain handler: call an action with what it reads (' + tag + ' ' + a.name + ')');
          return { name: a.name, param, steps: steps(stmts, seen(c), new Map(locals).set(param, { op: 'local', name: param }), false) };
        }
      }
      return { name: a.name, steps: handlerSteps(c, a.e, locals) };
    };
    // An action boundary RX infers (AC-1b) or an inline action: a lifted parameterless action, called by the handler.
    // It may not capture markup locals (a row item) or a callback's parameters: those are refused as unresolved names.
    const lift = (stmts: Stmt[], s: Seen): Step => {
      const name = '$action' + body.actions.length;
      const action = { name, params: [] as string[], steps: [] as Step[] };
      body.actions.push(action);
      action.steps = steps(stmts, s, new Map(), true);
      return { op: 'call', action: name, args: [] };
    };
    const text = (m: Markup, r: number, locals: Locals): View => {
      if (m.k !== 'read') throw new Error('text');
      const site = sites.get(m);
      if (site) return evalNode({ kind: 'eval' as const }, site, seen(take('reader', /^\{…\}$/, r)), locals);
      // v2.3: `{props.children}`, whatever the site passed, inserted as given.
      if (m.e.k === 'member' && m.e.p === 'children' && isProps(m.e.o, locals)) {
        propRead(seen(take('reader', /^\{…\}$/, r)), 'children');
        useProp('children', 'children');
        return { kind: 'children' };
      }
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
    // v2.3: an application of another component of the module. Its arguments, in source order: values (CP-6 `prop`
    // computations), callbacks, actions and function props passed on (`handler` computations); then its children, in the
    // region CP-6 opens for every application.
    const application = (m: Extract<Markup, { k: 'el' }>, r: number, locals: Locals): View => {
      if (!others.some(d => d.name === m.tag)) throw new Error('<' + m.tag + '> is not a component of this module');
      const names = new Set<string>();
      const props = m.attrs.map((a): PropArg => {
        if (names.has(a.name)) throw new Error('a repeated prop ' + m.tag + ' ' + a.name);
        names.add(a.name);
        if (a.name === 'children') throw new Error('children are passed as the children of <' + m.tag + '>');
        if (/^on[A-Z:]/.test(a.name)) {
          const c = take('handler', at(m.tag, a.name), r);
          if (a.e.k === 'fn') {
            const params = a.e.params;
            for (const p of params) if (symbols.some(x => x.name === p) || locals.has(p)) throw new Error('a parameter shadows a resolved name: ' + p);
            return { name: a.name, handler: { params: [...params], steps: handlerSteps(c, a.e, new Map([...locals, ...params.map(p => [p, { op: 'local', name: p }] as [string, Expression])])) } };
          }
          if (a.e.k === 'id' && !locals.has(a.e.name) && symbols.find(x => x.name === (a.e as { name: string }).name)?.kind === 'action') { seen(c); return { name: a.name, action: a.e.name }; }
          if (a.e.k === 'member' && isProps(a.e.o, locals)) { propRead(seen(c), a.e.p); useProp(a.e.p, 'function'); return { name: a.name, forward: a.e.p }; }
          throw new Error('a function prop is a callback, an action or a function prop passed on: ' + m.tag + ' ' + a.name);
        }
        const c = take('prop', at(m.tag, a.name), r);
        if (a.e.k === 'fn') throw new Error('a function-valued prop other than an on* handler (a render prop) is outside plan v2.3: ' + m.tag + ' ' + a.name);
        return { name: a.name, value: expression(a.e, seen(c), locals) };
      });
      const kids = child(r, 'children', m.tag);
      const children = markup(m.children, kids, locals);
      v23 = true;
      return { kind: 'component', name: m.tag, props, ...(children.length ? { children } : {}) };
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
          if (opts.compose && /^[A-Z]/.test(m.tag)) { out.push(application(m, r, locals)); continue; }
          if (!/^[a-z][a-z0-9]*$/.test(m.tag)) throw new Error('only host elements are supported: ' + m.tag);
          const names = new Set<string>();
          const attrs: Attr[] = m.attrs.map(a => {
            if (names.has(a.name)) throw new Error('a repeated attribute ' + m.tag + ' ' + a.name);
            names.add(a.name);
            if (/^on[A-Z:]/.test(a.name) || !opts.compose) return handler(m.tag, a, r, locals);
            // v2.3: a value attribute, a CP-6 reader at `tag name`.
            if (a.name === 'ref') throw new Error('ref is outside plan v2.3');
            const c = take('reader', at(m.tag, a.name), r);
            return { name: a.name, value: expression(a.e, seen(c), locals) };
          });
          const children = markup(m.children, r, locals);
          if (attrs.some(a => 'value' in a)) { v23 = true; out.push({ kind: 'element', tag: m.tag, attrs, events: [], children }); }
          else out.push({ kind: 'element', tag: m.tag, events: attrs as { name: string; steps: Step[]; param?: string }[], children });
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
        } else if ((m.k === 'loading' || m.k === 'errored') && opts.async) {
          // v2.1: CP-6 walks the fallback in the enclosing region, then the content in the boundary's own region.
          if (m.decls.length) throw new Error(m.k + ' declarations are outside plan v2.1');
          if (m.k === 'loading' && m.on) throw new Error('loading on(…) is outside plan v2.1');
          if (m.k === 'errored' && m.classes) throw new Error('typed errored boundaries are outside plan v2.1');
          // The error is not bound: a fallback that reads it is refused (it fails to resolve), as a catch's is.
          if (m.k === 'errored' && m.errName && (locals.has(m.errName) || symbols.some(x => x.name === m.errName)))
            throw new Error('an errored fallback\'s error name shadows a resolved name: ' + m.errName);
          const fallback = markup(m.fallback, r, locals);
          out.push({ kind: m.k, fallback, children: markup(m.body, child(r, m.k), locals) });
          v21 = true;
        } else throw new Error('unsupported markup ' + m.k);
      }
      return out;
    };
    // Solid's compiler lowers text in a component position (the markup, a Show branch, a For row) to a string or a memo,
    // not to a text node in a template; the consumers mirror the compiler only for elements, Show and For there.
    const position = (vs: View[]) => {
      if (vs.some(v => v.kind === 'text')) throw new Error('text directly in a component position (the markup, a Show branch, a For row) is outside plan v2');
      // docs/EVAL.md: the compiler lowers a child there differently from an element's; eval sites are element children.
      if (vs.some(v => v.kind === 'eval')) throw new Error('an eval site directly in a component position (the markup, a Show branch, a For row) is outside plan v2: make it an element child');
      if (vs.some(v => v.kind === 'children')) throw new Error('props.children directly in a component position is outside plan v2.3: make it an element child');
      for (const v of vs) visit(v);
    };
    const visit = (v: View): void => {
      if (v.kind === 'element') v.children.forEach(visit);
      else if (v.kind === 'show') { position(v.children); position(v.fallback); }
      else if (v.kind === 'for') position(v.children);
      else if (v.kind === 'loading' || v.kind === 'errored') { position(v.children); position(v.fallback); }
      // A component's children are a component position, except one text child: the compiler passes its value as the
      // children prop itself (a string, or a getter).
      else if (v.kind === 'component' && v.children && !(v.children.length === 1 && v.children[0].kind === 'text')) position(v.children);
    };
    body.markup = markup(decl.view, region.id, new Map());
    position(body.markup);
    if (next !== walk.length) throw new Error('CP-6 has markup computations the plan does not encode');
    const missing = model.computations.filter(c => c.region === region.id || inside(c.region)).filter(c => !used.some(u => u.c === c));
    if (missing.length) throw new Error('CP-6 computations absent from the plan: ' + missing.map(c => c.kind + ':' + (c.name ?? c.at)).join(', '));
    return body;
  };

  const main = build(entry, true);
  const built: Component[] = others.map(d => { const b = build(d, false); return { name: d.name, props: b.props, sources: b.sources, memos: b.memos, actions: b.actions, markup: b.markup }; });
  finish();
  // Only the components the entry applies, directly or not, in declaration order.
  const reached = built.length ? checkApplications(entry.name, main.markup, built) : new Set<string>();
  const components = built.filter(c => reached.has(c.name));
  const plan: Plan = { version: 2, component: entry.name, hosts, ...(main.bindings ? { bindings: main.bindings } : {}), sources: main.sources, memos: main.memos, actions: main.actions, markup: main.markup };
  if (evalNodes.length) deriveInterfaces(plan, entry.decls, evalNodes);
  if (v21) plan.version = 2.1;
  if (v23 || components.length) plan.version = 2.3;
  if (components.length) plan.components = components;
  return plan;
}

/** v2.3: true when `x` (an RX AST) mentions any of `names` as an identifier. */
function mentions(x: unknown, names: Set<string>): boolean {
  if (Array.isArray(x)) return x.some(y => mentions(y, names));
  if (typeof x !== 'object' || x === null) return false;
  const o = x as Record<string, unknown>;
  if (o.k === 'id' && typeof o.name === 'string' && names.has(o.name)) return true;
  return Object.values(o).some(y => mentions(y, names));
}

/** v2.3: every site passes what its component reads (a value prop a value, a function prop a callback, an action or a
 *  function prop passed on, and children when it reads them), and no component applies itself, directly or not.
 *  Returns the names of the components the entry reaches. */
function checkApplications(entry: string, markup: View[], components: Component[]): Set<string> {
  const byName = new Map(components.map(c => [c.name, c]));
  const applied = (vs: View[], out: Extract<View, { kind: 'component' }>[] = []) => {
    for (const v of vs) {
      if (v.kind === 'component') { out.push(v); applied(v.children ?? [], out); }
      else if (v.kind === 'element' || v.kind === 'for') applied(v.children, out);
      else if (v.kind === 'show' || v.kind === 'loading' || v.kind === 'errored') { applied(v.children, out); applied(v.fallback, out); }
    }
    return out;
  };
  const visiting: string[] = [];
  const done = new Set<string>();
  const visit = (name: string, vs: View[]) => {
    if (visiting.includes(name)) throw new Error('recursive components are outside plan v2.3: ' + [...visiting, name].join(' -> '));
    if (done.has(name)) return;
    visiting.push(name);
    for (const site of applied(vs)) {
      const c = byName.get(site.name)!;
      for (const p of c.props) {
        if (p.kind === 'children') { if (!site.children) throw new Error('<' + c.name + '> reads its children, which a site does not pass'); continue; }
        const arg = site.props.find(a => a.name === p.name);
        if (!arg) throw new Error('<' + c.name + '> reads the prop ' + p.name + ', which a site does not pass');
        if ((p.kind === 'value') !== ('value' in arg)) throw new Error('<' + c.name + '> ' + (p.kind === 'value' ? 'reads the prop ' + p.name + ' as a value, which a site passes as a function' : 'calls the prop ' + p.name + ', which a site passes as a value'));
      }
      visit(c.name, c.markup);
    }
    visiting.pop();
    done.add(name);
  };
  visit(entry, markup);
  return done;
}

/** v2.1: a host's declared result, printed canonically (eval/interface.ts's type grammar; a scalar is its name). */
function hostResult(ret: string): string | undefined {
  try { return printType(parseType(ret)); } catch (e) { if (e instanceof InterfaceError) return undefined; throw e; }
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
      if (host) return { name: b.name, kind: 'host', params: [...host.params], returns: host.returns, ...(host.pure ? { pure: true as const } : {}) };
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

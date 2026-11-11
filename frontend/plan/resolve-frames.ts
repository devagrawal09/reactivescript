// Plan schema v2.2 (plan/docs/PLAN-V2.md, "v2.2: server functions, components and placement"): a frames program as data.
// Same contract as resolve-v2.ts: run the pinned checker, refuse diagnostics, take identities, kinds, reads, writes,
// calls and regions from CP-6, read only what CP-6 lacks from the checked RX AST, and check both directions (every
// CP-6 read, write and call of every computation is encoded; every encoded reactive read, write and call is a fact).
//
// v2.2 adds what slice 6 needs: `server fn`s over `server` JS hosts (RX 12 SF-1, SF-5a), non-entry components with
// props, component applications in markup, async memos and action awaits over server fns, and a call of an action
// passed as a prop. A program with none of these is not a v2.2 program: the builder hands it to resolve-v2.ts with the
// async tier (v2.1 or v2, byte for byte). The placement (plan/placement.ts) is computed from the all-client plan built
// here and written into it as annotations (`sunk`, `place`, `server`, `serverComponents`, `placement`); a consumer that
// ignores them runs the all-client twin.
//
// Refusals are FramesRefusal errors with a code (PLAN-V2.md, "Refused by the v2.2 builder").
import { checkModules, type ModuleSet } from '../tsx/rx/compiler.ts';
import { actionInference } from '../tsx/rx/infer.ts';
import type { Expr, Stmt, Markup, Decl } from '../tsx/rx/ast.ts';
import { confident, resolvePlanV2, type Expression, type Lambda, type PathSegment, type Plan, type Scalar } from './resolve-v2.ts';
import { InterfaceError, parseType } from '../eval/interface.ts';
import { joinType, printType, sameType, BOOLEAN, NUMBER, STRING, type Type } from './types.ts';
import { wireIds } from '../frames/compile.ts';
import { placement, type Placement } from './placement.ts';
import { applications, siteNames } from '../frames/sites.ts';

export class FramesRefusal extends Error {
  code: string;
  constructor(code: string, message: string) { super(code + ': ' + message); this.code = code; }
}
const refuse = (code: string, message: string): never => { throw new FramesRefusal(code, message); };

/** v2.2 expressions: v2.1's, plus a prop read (`props.x`, through the props getter: tracked in reactive contexts). */
export type FExpr = Expression | { op: 'prop'; name: string };
export type FLambda = { param: string; body: FExpr };
export type FStep =
  | { op: 'write'; source: string; path?: PathSegment[]; value: FExpr }
  | { op: 'optimistic'; source: string; value: FExpr }
  | { op: 'optimistic'; source: string; updater: FLambda }
  /** An action's request to a server function (RX SF-2c): `let x = await f(…)`. */
  | { op: 'await'; serverFn: string; args: FExpr[]; bind: string }
  | { op: 'try'; body: FStep[]; catch: FStep[] }
  | { op: 'call'; action: string; args: FExpr[] }
  /** A handler's call of an action passed as a prop (`props.take(props.id)`). */
  | { op: 'call'; prop: string; args: FExpr[] }
  | { op: 'refresh' | 'affects'; source: string };
export type PropArg = { name: string; value: FExpr } | { name: string; action: string } | { name: string; forward: string };
export type FView =
  | { kind: 'element'; tag: string; events: { name: string; steps: FStep[] }[]; children: FView[] }
  | { kind: 'text'; value: FExpr }
  | { kind: 'show'; when: FExpr; children: FView[]; fallback: FView[] }
  | { kind: 'for'; each: FExpr; item: string; key: 'identity'; children: FView[] }
  | { kind: 'loading' | 'errored'; fallback: FView[]; children: FView[] }
  /** A component application: Solid's createComponent(C, { get p() {…} }) as the compiler emits it. `place`/`server`:
   *  the placement annotation (a server root, served by `server`). */
  | { kind: 'component'; name: string; props: PropArg[]; place?: 'server'; server?: string };
export type FMemo =
  | { name: string; value: FExpr }
  /** An async memo over a server function: Solid's createMemo(() => f(…args)), RX `x = await f(…)`. `sunk`: the
   *  server component whose call replaces it under placement (PL-4). */
  | { name: string; await: { serverFn: string; args: FExpr[] }; sunk?: string };
export type FSource = { name: string; kind: 'signal' | 'store' | 'optimistic'; seed: FExpr };
export type FAction = { name: string; params: string[]; steps: FStep[] };
export type FComponent = {
  name: string; props: { name: string; type: string }[];
  sources: FSource[]; memos: FMemo[]; actions: FAction[]; markup: FView[];
};
export type ServerHost = { name: string; params: string[]; returns: string; pure?: true };
export type ServerStep =
  | { op: 'await'; serverHost: string; args: FExpr[]; bind: string }
  | { op: 'await'; serverFn: string; args: FExpr[]; bind: string }
  | { op: 'return'; value: FExpr };
export type ServerFn = { name: string; id: string; io?: true; params: { name: string; type: string }[]; returns: string; steps: ServerStep[] };
export type ServerComponent = {
  name: string; id: string; component: string; params: string[];
  /** The question it serves: a sunk memo of the client site's component, or an owned memo of `component`. */
  question: { memo: string; kind: 'sunk' | 'owned' };
  slots: { name: string; component: string; views: number[][]; args: string[]; through: string[]; from: Record<string, string> }[];
  inline: string[];
};
export type FramesPlan = {
  version: 2.2; component: string;
  hosts: never[]; serverHosts: ServerHost[]; serverFns: ServerFn[]; components: FComponent[];
  sources: FSource[]; memos: FMemo[]; actions: FAction[]; markup: FView[];
  serverComponents: ServerComponent[];
  placement: Placement;
};

const BINARY: Record<string, string> = { '+': 'add', '==': 'eq', '!=': 'ne', '<': 'lt', '<=': 'le', '>': 'gt', '>=': 'ge', '&&': 'and', '||': 'or' };
const BUILTIN: Record<string, 'filter' | 'map' | 'findIndex'> = { filter: 'filter', map: 'map', indexOf: 'findIndex' };
const SCALAR = new Set(['number', 'string', 'boolean']);

/** True when the program uses a v2.2 form: a server fn, a `server` JS import, or a component besides the entry. */
export function isFramesProgram(set: ModuleSet): boolean {
  return [...set.programs.values()].some(p => p.decls.some(d => d.k === 'server' || (d.k === 'component' && !d.isDefault) ||
    (d.k === 'import' && Object.values(d.declaredSide ?? {}).includes('server'))));
}

/** The v2.2 builder. `stem`: the slice's file stem; the canonical split's server module is `src/<stem>.server.tsx`,
 *  whose `transformDirectives` ids the plan carries. A program without a v2.2 form is resolve-v2.ts's (async tier). */
export function resolvePlanFrames(set: ModuleSet, opts: { stem: string }): FramesPlan | Plan {
  if (!isFramesProgram(set)) return resolvePlanV2(set, { async: true });
  const checked = checkModules(set);
  if (checked.diags.length) throw new Error(JSON.stringify(checked.diags));
  if (set.order.length !== 1) refuse('FRAMES_MODULES', 'plan v2.2 supports one RX module plus its JS declarations');
  const file = set.order[0], program = set.programs.get(file)!, model = checked.models.get(file)!;
  const entry = program.decls.find(d => d.k === 'component' && d.isDefault);
  if (!entry || entry.k !== 'component') throw new Error('expected one default component');
  for (const d of program.decls) {
    if (d.k === 'import' || d.k === 'server' || d.k === 'component') continue;
    refuse('FRAMES_MODULES', 'plan v2.2 supports imports, server fns and components, not a module-level ' + d.k);
  }
  if (entry.propsType) throw new Error('the entry component takes no props');
  type Comp = typeof model.computations[number];
  type Sym = typeof model.symbols[number];
  const program0 = model.regions.find(r => r.kind === 'program')!;
  const moduleSyms = model.symbols.filter(s => s.region === program0.id);

  // ------------------------------------------------------------- server hosts (SF-5a) and server fns (SF-1)
  const serverHosts: ServerHost[] = [];
  const hostTypes = new Map<string, { params: Type[]; returns: Type }>();
  for (const sym of moduleSyms.filter(s => s.kind === 'import')) {
    const imp = program.decls.find(d => d.k === 'import' && d.names.some(n => n.alias === sym.name));
    if (!imp || imp.k !== 'import' || !imp.declared) refuse('FRAMES_WIRE_TYPE', 'host ' + sym.name + ' needs a declaration file');
    const im = imp as Extract<Decl, { k: 'import' }>;
    const name = im.names.find(n => n.alias === sym.name)!.name;
    if (name !== sym.name) refuse('FRAMES_MODULES', 'aliased host imports are outside plan v2.2');
    const decl = set.declarations?.get(im.declared!)?.find(d => d.name === name);
    if (!decl || decl.kind !== 'fn') throw refuse('FRAMES_WIRE_TYPE', 'host ' + name + ' must be declared as a fn');
    if (decl.side === 'client') refuse('FRAMES_CLIENT_JS', 'client JS (' + name + ') is outside plan v2.2');
    if (decl.side !== 'server') refuse('FRAMES_CLIENT_JS', 'a JS host without a side (' + name + '): frames programs reach data through server fns over server JS');
    if (decl.rejects) refuse('FRAMES_ERROR_CLASS', 'declared rejections of ' + name + ' are outside plan v2.2');
    let returns: Type;
    try { returns = parseType(decl.ret ?? ''); } catch (e) { if (e instanceof InterfaceError) return refuse('FRAMES_WIRE_TYPE', 'host ' + name + ' result ' + JSON.stringify(decl.ret) + ' is outside the wire types'); throw e; }
    if (decl.ptypes?.length !== decl.params.length || !decl.ptypes.every(t => t && SCALAR.has(t))) refuse('FRAMES_WIRE_TYPE', 'host ' + name + ' parameters must be number, string or boolean');
    serverHosts.push({ name, params: decl.ptypes as string[], returns: printType(returns), ...(decl.pure ? { pure: true as const } : {}) });
    hostTypes.set(name, { params: (decl.ptypes as string[]).map(t => parseType(t)), returns });
  }
  const serverFns: ServerFn[] = [];
  const serverTypes = new Map<string, { params: Type[]; returns: Type }>();
  for (const sym of moduleSyms.filter(s => s.kind === 'server')) {
    const d = program.decls.find(d => d.k === 'server' && d.name === sym.name);
    if (!d || d.k !== 'server') refuse('FRAMES_WRAPPED_SERVER_FN', sym.name + ' is a wrapped server fn (SF-1d)');
    const sd = d as Extract<Decl, { k: 'server' }>;
    const c = model.computations.find(c => c.kind === 'server' && c.name === sym.name);
    if (!c) throw new Error('missing server computation ' + sym.name);
    if (sd.ptypes?.length !== sd.params.length || !sd.ptypes.every(t => t && SCALAR.has(t))) refuse('FRAMES_WIRE_TYPE', 'server fn ' + sd.name + ' parameters must be typed number, string or boolean');
    const locals = new Map<string, Type>(sd.params.map((p, i) => [p, parseType(sd.ptypes![i]!)]));
    const steps: ServerStep[] = [];
    const calls = new Set<number>();
    let returned: Type | undefined;
    for (const [i, st] of sd.body.entries()) {
      const last = i === sd.body.length - 1;
      if (st.k === 'let' && !last && st.e.k === 'await' && !st.e.init && !st.e.stream && st.e.e.k === 'call' && st.e.e.f.k === 'id') {
        const callee = moduleSyms.find(s => s.name === (st.e as { e: { f: { name: string } } }).e.f.name);
        if (!callee || (callee.kind !== 'import' && callee.kind !== 'server') || !c.calls.includes(callee.id)) throw new Error('server call absent from CP-6 in ' + sd.name);
        if (locals.has(st.name) || moduleSyms.some(s => s.name === st.name)) refuse('FRAMES_SERVER_FN_BODY', 'a local shadows a name: ' + st.name);
        calls.add(callee.id);
        const sig = callee.kind === 'import' ? hostTypes.get(callee.name)! : serverTypes.get(callee.name) ?? refuse('FRAMES_SERVER_FN_BODY', 'a server fn calls a later server fn: ' + callee.name);
        const args = st.e.e.args.map(a => serverExpr(a, locals));
        if (args.length !== sig.params.length) refuse('FRAMES_SERVER_FN_BODY', callee.name + ' takes ' + sig.params.length + ' arguments');
        args.forEach((a, k) => { if (!joinType(typeExpr(a, locals, noNames), sig.params[k])) refuse('FRAMES_WIRE_TYPE', 'argument ' + (k + 1) + ' of ' + callee.name); });
        steps.push(callee.kind === 'import' ? { op: 'await', serverHost: callee.name, args, bind: st.name } : { op: 'await', serverFn: callee.name, args, bind: st.name });
        locals.set(st.name, sig.returns);
      } else if (st.k === 'return' && last && st.e) {
        const value = serverExpr(st.e, locals);
        returned = typeExpr(value, locals, noNames);
        steps.push({ op: 'return', value });
      } else refuse('FRAMES_SERVER_FN_BODY', 'server fn ' + sd.name + ': its body is `let x = await h(…)`* `return e` (statement ' + (i + 1) + ' is ' + st.k + ')');
    }
    if (!returned) refuse('FRAMES_SERVER_FN_BODY', 'server fn ' + sd.name + ' returns nothing');
    if (c.reads.length || c.writes.length || JSON.stringify([...calls].sort()) !== JSON.stringify([...c.calls].sort())) throw new Error('server fn ' + sd.name + ' differs from CP-6');
    serverFns.push({ name: sd.name, id: '', ...(sym.io ? { io: true as const } : {}), params: sd.params.map((p, i) => ({ name: p, type: sd.ptypes![i]! })), returns: printType(returned!), steps });
    serverTypes.set(sd.name, { params: sd.ptypes!.map(t => parseType(t!)), returns: returned! });
  }

  // ------------------------------------------------------------- components
  const componentDecls = program.decls.filter((d): d is Extract<Decl, { k: 'component' }> => d.k === 'component');
  const built = new Map<string, FComponent & { propsUsed: Set<string> }>();
  let entryPlan: (FComponent & { propsUsed: Set<string> }) | undefined;
  const asyncMemos = new Map<string, Map<string, string>>(); // component -> async memo -> server fn
  for (const decl of componentDecls) {
    const region = model.regions.find(r => r.kind === 'component' && r.name === decl.name);
    if (!region) throw new Error('missing resolved component ' + decl.name);
    const c = buildComponent(decl, region.id, decl === entry);
    if (decl === entry) entryPlan = c; else built.set(decl.name, c);
  }

  function buildComponent(decl: Extract<Decl, { k: 'component' }>, regionId: number, isEntry: boolean) {
    const symbols = model.symbols.filter(s => s.region === regionId);
    const propsSym = symbols.find(s => s.kind === 'props');
    const symbol = (name: string): Sym => {
      const s = symbols.find(s => s.name === name && s.kind !== 'props') ?? moduleSyms.find(s => s.name === name);
      if (!s) throw new Error('unresolved ' + name);
      return s;
    };
    const resolved = (name: string) => symbols.some(s => s.name === name) || moduleSyms.some(s => s.name === name);
    const asyncNames = new Map(decl.decls.flatMap(d => d.k === 'eq' && d.e.k === 'await' && d.e.e.k === 'call' && d.e.e.f.k === 'id' &&
      moduleSyms.some(s => s.kind === 'server' && s.name === (d.e as { e: { f: { name: string } } }).e.f.name) ? [[d.name, (d.e as { e: { f: { name: string } } }).e.f.name] as [string, string]] : []));
    asyncMemos.set(decl.name, asyncNames);
    const comp = (kind: string, name: string) => { const c = model.computations.find(c => c.region === regionId && c.kind === kind && c.name === name); if (!c) throw new Error('missing computation ' + kind + ':' + name + ' in ' + decl.name); return c; };
    type Seen = { c: Comp; reads: Set<string>; writes: Set<string>; calls: Set<number> };
    const used: Seen[] = [];
    const seen = (c: Comp): Seen => { const s = { c, reads: new Set<string>(), writes: new Set<string>(), calls: new Set<number>() }; used.push(s); return s; };
    // A prop is read by name (CP-6's `field` on the props symbol); any other symbol by itself (CP-6 also records the
    // first member name of a member read there, which the plan's `get` carries).
    const readKey = (sym: number, field?: string) => sym + (propsSym && sym === propsSym.id && field !== undefined ? '.' + field : '');
    const finish = () => {
      for (const { c, reads, writes, calls } of used) {
        const want = (xs: (string | number)[]) => JSON.stringify([...new Set(xs.map(String))].sort());
        const at = decl.name + ' ' + c.kind + ':' + (c.name ?? c.at);
        if (want([...reads]) !== want(c.reads.map(r => readKey(r.sym, r.field)))) throw new Error('reads differ from CP-6 in ' + at + ': ' + want([...reads]) + ' vs ' + want(c.reads.map(r => readKey(r.sym, r.field))));
        if (want([...writes]) !== want(c.writes.map(w => w.sym + ' ' + w.op + (w.path ? ' path' : '')))) throw new Error('writes differ from CP-6 in ' + at);
        if (want([...calls]) !== want(c.calls)) throw new Error('calls differ from CP-6 in ' + at);
      }
    };
    const propsUsed = new Set<string>();
    type Locals = Map<string, FExpr>;
    const lambda = (e: Expr, s: Seen, locals: Locals): FLambda => {
      if (e.k !== 'fn' || e.params.length !== 1 || e.stmts?.length) throw new Error('a builtin or updater takes one (x) => expression');
      const param = e.params[0];
      if (resolved(param)) throw new Error('a local shadows a resolved name: ' + param);
      return { param, body: expression(e.body, s, new Map(locals).set(param, { op: 'local', name: param })) };
    };
    const isProps = (e: Expr) => e.k === 'id' && e.name === decl.props && !isEntry && propsSym !== undefined;
    const expression = (e: Expr, s: Seen, locals: Locals): FExpr => {
      switch (e.k) {
        case 'lit':
          if (typeof e.v === 'string' || typeof e.v === 'boolean' || (typeof e.v === 'number' && Number.isInteger(e.v))) return { op: 'literal', value: e.v as Scalar };
          throw new Error('unsupported literal ' + JSON.stringify(e.v));
        case 'id': {
          if (locals.has(e.name)) return locals.get(e.name)!;
          if (e.name === decl.props && !isEntry) refuse('FRAMES_CHILDREN', 'props as a value (' + decl.name + ')');
          const sym = symbol(e.name);
          if (sym.kind !== 'source' && sym.kind !== 'eq') throw new Error('not a value: ' + e.name);
          if (asyncNames.has(sym.name) && (s.c.kind === 'handler' || s.c.kind === 'action')) throw new Error('an async memo is read only in reactive contexts: ' + e.name);
          if (!s.c.reads.some(r => r.sym === sym.id)) throw new Error('read absent from CP-6: ' + e.name);
          s.reads.add(readKey(sym.id));
          return { op: 'read', source: sym.name };
        }
        case 'member':
          if (e.opt) throw new Error('optional member access is outside plan v2');
          if (isProps(e.o)) {
            if (e.p === 'children') refuse('FRAMES_CHILDREN', 'props.children');
            if (!s.c.reads.some(r => r.sym === propsSym!.id && r.field === e.p)) throw new Error('prop read absent from CP-6: ' + e.p);
            s.reads.add(readKey(propsSym!.id, e.p));
            propsUsed.add(e.p);
            return { op: 'prop', name: e.p };
          }
          return e.p === 'length' ? { op: 'length', array: expression(e.o, s, locals) as Expression } : { op: 'get', object: expression(e.o, s, locals) as Expression, key: e.p };
        case 'arr': return { op: 'array', items: e.items.map(x => expression(x, s, locals) as Expression) };
        case 'rec': return { op: 'object', fields: e.fields.map(f => { if (!('key' in f)) throw new Error('object spreads are outside plan v2'); return { key: f.key, value: expression(f.v, s, locals) as Expression }; }) };
        case 'bin': {
          const op = BINARY[e.op];
          if (!op) throw new Error('unsupported operator ' + e.op);
          return { op, left: expression(e.l, s, locals), right: expression(e.r, s, locals) } as Expression;
        }
        case 'un':
          if (e.op === '!') return { op: 'not', value: expression(e.e, s, locals) as Expression };
          throw new Error('unsupported operator ' + e.op);
        case 'if': return { op: 'cond', test: expression(e.c, s, locals) as Expression, then: expression(e.t, s, locals) as Expression, else: expression(e.f, s, locals) as Expression };
        case 'pending': case 'latest': return { op: e.k, value: expression(e.e, s, locals) as Expression };
        case 'call': {
          if (e.f.k !== 'id' || !BUILTIN[e.f.name] || resolved(e.f.name) || e.args.length !== 2) throw new Error('unsupported call');
          return { op: BUILTIN[e.f.name], array: expression(e.args[0], s, locals), ...lambda(e.args[1], s, locals) } as Expression;
        }
        default: throw new Error('unsupported expression ' + e.k);
      }
    };
    const serverCall = (call: Expr, s: Seen, locals: Locals) => {
      if (call.k !== 'call' || call.f.k !== 'id') throw new Error('only await of a server fn call is supported');
      const f = symbol(call.f.name);
      if (f.kind === 'import') refuse('FRAMES_CLIENT_JS', 'a JS host awaited outside a server fn: ' + f.name);
      if (f.kind !== 'server' || !s.c.calls.includes(f.id)) throw new Error('server fn call absent from CP-6');
      s.calls.add(f.id);
      return { serverFn: f.name, args: call.args.map(a => expression(a, s, locals)) };
    };
    let temporary = 0;
    const steps = (body: Stmt[], s: Seen, locals: Locals, inAction: boolean): FStep[] => body.flatMap((st): FStep[] => {
      if (st.k === 'let') {
        if (!inAction) throw new Error('a plain handler never awaits');
        if (st.e.k !== 'await' || st.e.init || st.e.stream) throw new Error('only let x = await f(…) is supported');
        if (resolved(st.name)) throw new Error('a local shadows a resolved name: ' + st.name);
        const bind = '$await' + temporary++;
        const step: FStep = { op: 'await', ...serverCall(st.e.e, s, locals), bind };
        locals.set(st.name, { op: 'local', name: bind });
        return [step];
      }
      if (st.k === 'try') {
        if (!inAction) throw new Error('a plain handler has no try');
        if (!st.handler || st.catchClasses || st.fin) refuse('FRAMES_ERROR_CLASS', 'only untyped try/catch is supported');
        return [{ op: 'try', body: steps(st.body, s, new Map(locals), inAction), catch: steps(st.handler!, s, new Map(locals), inAction) }];
      }
      if (st.k === 'expr') {
        const call = st.e;
        if (call.k === 'call' && call.f.k === 'member' && isProps(call.f.o)) {
          // A through prop's call: the action a parent passed (`props.take(props.id)`), a snapshot read of the prop.
          if (inAction) throw new Error('an action calling an action is outside plan v2');
          const p = call.f.p;
          if (!s.c.reads.some(r => r.sym === propsSym!.id && r.field === p)) throw new Error('prop read absent from CP-6: ' + p);
          s.reads.add(readKey(propsSym!.id, p));
          propsUsed.add(p);
          return [{ op: 'call', prop: p, args: call.args.map(x => expression(x, s, locals)) }];
        }
        if (call.k !== 'call' || call.f.k !== 'id') throw new Error('only an action call is an expression statement');
        if (inAction) throw new Error('an action calling an action is outside plan v2');
        const a = symbol(call.f.name);
        if (a.kind !== 'action' || !s.c.calls.includes(a.id)) throw new Error('action call absent from CP-6');
        s.calls.add(a.id);
        return [{ op: 'call', action: a.name, args: call.args.map(x => expression(x, s, locals)) }];
      }
      if (st.k === 'refresh' || st.k === 'affects') {
        if (st.k === 'affects' && !inAction) throw new Error('affects is an action step');
        const target = symbol(st.name);
        if (target.kind !== 'eq' || !asyncNames.has(target.name)) throw new Error(st.k + ' targets an async memo: ' + st.name);
        if (!s.c.writes.some(w => w.sym === target.id && w.op === st.k && !w.path)) throw new Error(st.k + ' absent from CP-6');
        s.writes.add(target.id + ' ' + st.k);
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
        if (!inAction) throw new Error('a plain handler never guesses');
        if (path) throw new Error('optimistic path writes are outside plan v2');
        if (st.e.k === 'fn') return [{ op: 'optimistic', source: target.name, updater: lambda(st.e, s, locals) }];
        return [{ op: 'optimistic', source: target.name, value: expression(st.e, s, locals) }];
      }
      if (st.e.k === 'fn') throw new Error('functional plain writes are outside plan v2');
      const before: FStep[] = [];
      let value: FExpr;
      if (st.e.k === 'await') {
        if (!inAction) throw new Error('a plain handler never awaits');
        if (st.e.init || st.e.stream) throw new Error('only await f(…) is supported');
        const bind = '$await' + temporary++;
        before.push({ op: 'await', ...serverCall(st.e.e, s, locals), bind });
        value = { op: 'local', name: bind };
      } else value = expression(st.e, s, locals);
      const segments = st.target.path.map((p): PathSegment => typeof p === 'string' ? { key: p } : { index: expression(p, s, locals) as Expression });
      return [...before, { op: 'write', source: target.name, ...(path ? { path: segments } : {}), value }];
    });

    const out: FComponent & { propsUsed: Set<string> } = { name: decl.name, props: [], sources: [], memos: [], actions: [], markup: [], propsUsed };
    for (const sym of symbols) {
      if (sym.kind === 'props') continue;
      const d = decl.decls.find(d => 'name' in d && d.name === sym.name);
      if (sym.kind === 'source') {
        if (!d || d.k !== 'source' || d.key || d.type) throw new Error('source shape unsupported: ' + sym.name);
        const writes = model.computations.flatMap(c => c.writes.filter(w => w.sym === sym.id));
        const optimistic = writes.some(w => w.op === 'optimistic'), store = writes.some(w => w.path);
        if (writes.some(w => w.op !== 'write' && w.op !== 'optimistic')) throw new Error('refresh/affects target an async memo: ' + sym.name);
        if (!!sym.question !== !!d.question) throw new Error('question mismatch');
        if (sym.question !== optimistic) throw new Error(optimistic ? 'an optimistic source must be derived' : 'async questions are outside plan v2');
        if (optimistic && store) throw new Error('optimistic stores are outside plan v2');
        const seedComp = comp(sym.question ? 'question' : 'seed', sym.name);
        if (!optimistic && seedComp.reads.length) throw new Error('a signal or store seeded from another source is outside plan v2: ' + sym.name);
        const structured = d.init.k === 'rec' || d.init.k === 'arr';
        if (!optimistic && store && !structured) throw new Error('a path write to a source with a scalar seed is outside plan v2: ' + sym.name);
        if (!optimistic && structured && writes.some(w => !w.path)) throw new Error('a root write to a store is outside plan v2: ' + sym.name);
        out.sources.push({ name: sym.name, kind: optimistic ? 'optimistic' : structured ? 'store' : 'signal', seed: expression(d.init, seen(seedComp), new Map()) });
      } else if (sym.kind === 'eq') {
        if (!d || d.k !== 'eq' || d.deferred || d.key) throw new Error('memo shape unsupported: ' + sym.name);
        if (d.e.k === 'await') {
          if (!asyncNames.has(sym.name)) refuse('FRAMES_CLIENT_JS', 'an async memo awaits a server fn in plan v2.2: ' + sym.name);
          if (d.e.init || d.e.stream) throw new Error('an async memo is await f(…), without a first-paint value or a stream: ' + sym.name);
          out.memos.push({ name: sym.name, await: serverCall(d.e.e, seen(comp('memo', sym.name)), new Map()) });
        } else out.memos.push({ name: sym.name, value: expression(d.e, seen(comp('memo', sym.name)), new Map()) });
      } else if (sym.kind === 'action') {
        if (!d || d.k !== 'action') throw new Error('action shape missing');
        const locals: Locals = new Map();
        for (const p of d.params) {
          if (resolved(p)) throw new Error('a parameter shadows a resolved name: ' + p);
          locals.set(p, { op: 'local', name: p });
        }
        out.actions.push({ name: sym.name, params: [...d.params], steps: steps(d.body, seen(comp('action', sym.name)), locals, true) });
        actionParamTypes.set(decl.name + '.' + sym.name, (d.ptypes ?? []).map(t => t));
      } else throw new Error('unsupported resolved symbol ' + sym.kind);
    }
    if (decl.decls.some(d => d.k !== 'source' && d.k !== 'eq' && d.k !== 'action')) refuse('FRAMES_MODULES', 'unsupported component declaration in ' + decl.name);

    // markup, in checker walk order
    const inside = (r: number): boolean => r === regionId || (model.regions.find(x => x.id === r)?.parent !== undefined && inside(model.regions.find(x => x.id === r)!.parent!));
    const walk = model.computations.filter(c => (c.kind === 'reader' || c.kind === 'handler' || c.kind === 'prop') && inside(c.region));
    let next = 0;
    const take = (kind: string, at: RegExp, r: number): Comp => {
      const c = walk[next++];
      if (!c || c.kind !== kind || !at.test(c.at ?? '') || c.region !== r) throw new Error('markup ' + kind + ' absent from CP-6 at ' + at + ' in ' + decl.name);
      return c;
    };
    const opened = new Map<string, number>();
    const child = (parent: number, kind: string, name?: string): number => {
      const key = parent + ' ' + kind + ' ' + (name ?? ''), n = opened.get(key) ?? 0;
      const r = model.regions.filter(x => x.parent === parent && x.kind === kind && (name === undefined || x.name === name))[n];
      if (!r) throw new Error(kind + ' region absent from CP-6');
      opened.set(key, n + 1);
      return r.id;
    };
    const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const handler = (tag: string, a: { name: string; e: Expr }, r: number, locals: Locals): { name: string; steps: FStep[] } => {
      if (!/^on[A-Z]/.test(a.name) || a.e.k !== 'fn' || a.e.params.length) throw new Error('attributes other than parameterless event handlers are outside plan v2: ' + a.name);
      const c = take('handler', new RegExp('^' + tag + ' ' + a.name + '$'), r);
      const s = seen(c);
      const body: Stmt[] = a.e.stmts ?? [{ k: 'expr', e: a.e.body }];
      if (body.length === 1 && body[0].k === 'action') {
        const ac = model.computations.find(x => x.kind === 'action' && x.in === c.id);
        if (!ac) throw new Error('inline action absent from CP-6');
        return { name: a.name, steps: [lift(body[0].body, seen(ac))] };
      }
      if (actionInference(body).trigger) return { name: a.name, steps: [lift(body, s)] };
      return { name: a.name, steps: steps(body, s, locals, false) };
    };
    const lift = (body: Stmt[], s: Seen): FStep => {
      const name = '$action' + out.actions.length;
      const action: FAction = { name, params: [], steps: [] };
      out.actions.push(action);
      action.steps = steps(body, s, new Map(), true);
      return { op: 'call', action: name, args: [] };
    };
    const text = (m: Markup, r: number, locals: Locals): FView => {
      if (m.k !== 'read') throw new Error('text');
      let e = m.e;
      while (e.k === 'bin' && e.op === '+' && e.l.k === 'lit' && e.l.v === '') e = e.r;
      if (confident(e).ok) throw new Error('a text hole with a constant value (Solid\'s compiler folds it to static text) is outside plan v2');
      const dynamic = (x: Expr): boolean => x.k === 'lit' ? false : x.k === 'id' ? !locals.has(x.name) : true;
      const memoized = (x: Expr): boolean => x.k === 'bin' && (x.op === '&&' ? dynamic(x.l) && dynamic(x.r) : x.op === '||' && memoized(x.l));
      if (memoized(e)) throw new Error('a text hole whose value has `&&` on its `||` spine is outside plan v2');
      return { kind: 'text', value: expression(e, seen(take('reader', /^\{…\}$/, r)), locals) };
    };
    const component = (m: Extract<Markup, { k: 'el' }>, r: number, locals: Locals): FView => {
      if (m.tag === decl.name || !componentDecls.some(d => d.name === m.tag)) refuse('FRAMES_MODULES', 'an unknown, recursive or cross-module component: ' + m.tag);
      if (m.children.length) refuse('FRAMES_CHILDREN', 'component children (<' + m.tag + '>…</' + m.tag + '>)');
      child(r, 'children', m.tag);
      const props: PropArg[] = m.attrs.map(a => {
        const c = take('prop', new RegExp('^' + escapeRe(m.tag + ' ' + a.name) + '$'), r);
        const s = seen(c);
        if (a.e.k === 'id' && !locals.has(a.e.name) && symbols.some(x => x.name === (a.e as { name: string }).name && x.kind === 'action')) return { name: a.name, action: a.e.name };
        if (a.e.k === 'member' && isProps(a.e.o)) {
          const v = expression(a.e, s, locals);
          // Classified once the parent's prop types are known (wire value or forwarded action).
          return { name: a.name, value: v };
        }
        if (a.e.k === 'fn') refuse('FRAMES_CHILDREN', 'a function-valued prop (' + m.tag + ' ' + a.name + ')');
        return { name: a.name, value: expression(a.e, s, locals) };
      });
      return { kind: 'component', name: m.tag, props };
    };
    const markup = (ms: Markup[], r: number, locals: Locals): FView[] => {
      const res: FView[] = [];
      for (const [i, m] of ms.entries()) {
        if (m.k === 'text') {
          const last = res.at(-1);
          if (i > 0 && ms[i - 1].k === 'text' && last?.kind === 'text' && last.value.op === 'literal') last.value = { op: 'literal', value: String(last.value.value) + m.s };
          else res.push({ kind: 'text', value: { op: 'literal', value: m.s } });
        } else if (m.k === 'read') res.push(text(m, r, locals));
        else if (m.k === 'el') {
          if (/^[A-Z]/.test(m.tag)) { res.push(component(m, r, locals)); continue; }
          if (!/^[a-z][a-z0-9]*$/.test(m.tag)) throw new Error('only host elements are supported: ' + m.tag);
          const events = m.attrs.map(a => handler(m.tag, a, r, locals));
          res.push({ kind: 'element', tag: m.tag, events, children: markup(m.children, r, locals) });
        } else if (m.k === 'mif') {
          if (m.tDecls.length || m.fDecls.length) throw new Error('branch declarations are outside plan v2');
          const when = expression(m.c, seen(take('reader', /^if$/, r)), locals);
          const children = markup(m.t, child(r, 'then'), locals);
          const fallback = markup(m.f, child(r, 'else'), locals);
          res.push({ kind: 'show', when, children, fallback });
        } else if (m.k === 'mfor') {
          if (m.decls.length) throw new Error('row declarations are outside plan v2');
          if (resolved(m.name)) throw new Error('a row item shadows a resolved name: ' + m.name);
          const each = expression(m.xs, seen(take('reader', /^for$/, r)), locals);
          const rows = new Map(locals).set(m.name, { op: 'local', name: m.name } as FExpr);
          res.push({ kind: 'for', each, item: m.name, key: 'identity', children: markup(m.body, child(r, 'for'), rows) });
        } else if (m.k === 'loading' || m.k === 'errored') {
          if (m.decls.length) throw new Error(m.k + ' declarations are outside plan v2.1');
          if (m.k === 'loading' && m.on) throw new Error('loading on(…) is outside plan v2.1');
          if (m.k === 'errored' && m.classes) refuse('FRAMES_ERROR_CLASS', 'typed errored boundaries');
          if (m.k === 'errored' && m.errName && (locals.has(m.errName) || resolved(m.errName))) throw new Error('an errored fallback\'s error name shadows a resolved name: ' + m.errName);
          const fallback = markup(m.fallback, r, locals);
          res.push({ kind: m.k, fallback, children: markup(m.body, child(r, m.k), locals) });
        } else throw new Error('unsupported markup ' + m.k);
      }
      return res;
    };
    const positions = (vs: FView[]) => {
      if (vs.some(v => v.kind === 'text')) throw new Error('text directly in a component position (the markup, a Show branch, a For row) is outside plan v2');
      for (const v of vs) visit(v);
    };
    const visit = (v: FView): void => {
      if (v.kind === 'element') v.children.forEach(visit);
      else if (v.kind === 'show' || v.kind === 'loading' || v.kind === 'errored') { positions(v.children); positions(v.fallback); }
      else if (v.kind === 'for') positions(v.children);
    };
    out.markup = markup(isEntry ? (decl.view.length === 1 && decl.view[0].k === 'el' ? decl.view : decl.view) : decl.view, regionId, new Map());
    positions(out.markup);
    if (next !== walk.length) throw new Error('CP-6 has markup computations the plan does not encode in ' + decl.name);
    const missing = model.computations.filter(c => inside(c.region)).filter(c => !used.some(u => u.c === c));
    if (missing.length) throw new Error('CP-6 computations absent from the plan in ' + decl.name + ': ' + missing.map(c => c.kind + ':' + (c.name ?? c.at)).join(', '));
    finish();
    return out;
  }

  // ------------------------------------------------------------- types, props, and the all-client plan
  const entryC = entryPlan!;
  const types = typeComponents(entryC, built, serverTypes, actionParamTypes);
  const plan: FramesPlan = {
    version: 2.2, component: entry.name, hosts: [], serverHosts, serverFns,
    components: componentDecls.filter(d => d !== entry).map(d => { const c = built.get(d.name)!; return { name: c.name, props: c.props, sources: c.sources, memos: c.memos, actions: c.actions, markup: c.markup }; }),
    sources: entryC.sources, memos: entryC.memos, actions: entryC.actions, markup: entryC.markup,
    serverComponents: [], placement: undefined as never,
  };
  for (const c of plan.components) c.props = types.props.get(c.name) ?? [];
  // FRAMES_SITE_AMBIGUOUS: a scenario addresses a request by its site (frames/sites.ts), so each server fn is awaited at
  // one site, and a component that asks (an async memo or an action's await) is applied once.
  try { siteNames(plan, false); } catch (e) { refuse('FRAMES_SITE_AMBIGUOUS', String((e as Error).message).replace(/^FRAMES_SITE_AMBIGUOUS: /, '')); }
  for (const [name, n] of applications(plan)) {
    const c = plan.components.find(c => c.name === name)!;
    const asks = c.memos.some(m => 'await' in m) || JSON.stringify(c.actions).includes('"serverFn"');
    if (asks && n !== 1) refuse('FRAMES_SITE_AMBIGUOUS', 'the component ' + name + ' asks the server and is applied ' + (n === Infinity ? 'in a row' : n + ' times'));
  }
  // Wire ids: the canonical split's server module, src/<stem>.server.tsx, holds every server fn and every server
  // component; transformDirectives names each `<name>-<xxHash32(path)>`.
  const decide = placement(plan, types.exprType);
  const names = [...serverFns.map(f => f.name), ...decide.serverComponents.map(c => c.name)];
  const ids = wireIds(names.map(n => 'export async function ' + n + '() {\n  "use server";\n}\n').join(''), opts.stem + '.server.tsx');
  for (const f of serverFns) f.id = ids[f.name] ?? refuse('FRAMES_MODULES', 'no wire id for ' + f.name);
  for (const c of decide.serverComponents) c.id = ids[c.name] ?? refuse('FRAMES_MODULES', 'no wire id for ' + c.name);
  plan.serverComponents = decide.serverComponents;
  plan.placement = decide.table;
  decide.annotate(plan);
  return canonicalOrder(plan);
}

const actionParamTypes = new Map<string, (string | undefined)[]>();
const noNames = { value: () => { throw new Error('a server fn names no reactive state'); }, prop: () => { throw new Error('a server fn has no props'); } };

/** A server fn body's expression: locals (parameters and await bindings), literals, fields, records, arrays, operators. */
function serverExpr(e: Expr, locals: Map<string, Type>): FExpr {
  switch (e.k) {
    case 'lit':
      if (typeof e.v === 'string' || typeof e.v === 'boolean' || (typeof e.v === 'number' && Number.isInteger(e.v))) return { op: 'literal', value: e.v as Scalar };
      return refuse('FRAMES_SERVER_FN_BODY', 'unsupported literal ' + JSON.stringify(e.v));
    case 'id': if (locals.has(e.name)) return { op: 'local', name: e.name }; return refuse('FRAMES_SERVER_FN_BODY', 'a server fn names ' + e.name + ' (only its parameters and locals)');
    case 'member': if (e.opt) refuse('FRAMES_SERVER_FN_BODY', 'optional member'); return e.p === 'length' ? { op: 'length', array: serverExpr(e.o, locals) as Expression } : { op: 'get', object: serverExpr(e.o, locals) as Expression, key: e.p };
    case 'arr': return { op: 'array', items: e.items.map(x => serverExpr(x, locals) as Expression) };
    case 'rec': return { op: 'object', fields: e.fields.map(f => { if (!('key' in f)) return refuse('FRAMES_SERVER_FN_BODY', 'object spreads'); return { key: f.key, value: serverExpr(f.v, locals) as Expression }; }) };
    case 'bin': { const op = BINARY[e.op]; if (!op) refuse('FRAMES_SERVER_FN_BODY', 'operator ' + e.op); return { op, left: serverExpr(e.l, locals), right: serverExpr(e.r, locals) } as Expression; }
    case 'un': if (e.op === '!') return { op: 'not', value: serverExpr(e.e, locals) as Expression }; return refuse('FRAMES_SERVER_FN_BODY', 'operator ' + e.op);
    case 'if': return { op: 'cond', test: serverExpr(e.c, locals) as Expression, then: serverExpr(e.t, locals) as Expression, else: serverExpr(e.f, locals) as Expression };
    default: return refuse('FRAMES_SERVER_FN_BODY', 'unsupported expression ' + e.k + ' in a server fn');
  }
}

/** Static types over a v2.2 expression (plan/types.ts's rules, plus `prop`). */
export function typeExpr(e: FExpr, locals: Map<string, Type>, names: { value(n: string): Type; prop(n: string): Type }): Type {
  const fail = (m: string): never => { throw new FramesRefusal('FRAMES_WIRE_TYPE', m); };
  const arrayItem = (t: Type, what: string): Type => t.k === 'array' ? t.item : fail(what + ' of a ' + printType(t) + ', not an array');
  const ex = (e: FExpr, locals: Map<string, Type>): Type => {
    switch (e.op) {
      case 'literal': return typeof e.value === 'number' ? NUMBER : typeof e.value === 'string' ? STRING : BOOLEAN;
      case 'array': { let item: Type = { k: 'never' }; for (const x of e.items) item = joinType(item, ex(x, locals)) ?? fail('array items of different types'); return { k: 'array', item }; }
      case 'object': return { k: 'record', fields: e.fields.map(f => [f.key, ex(f.value, locals)] as [string, Type]) };
      case 'read': return names.value(e.source);
      case 'prop': return names.prop(e.name);
      case 'local': return locals.get(e.name) ?? fail('unbound local ' + e.name);
      case 'get': { const o = ex(e.object, locals); if (o.k !== 'record') return fail('field ' + e.key + ' of a ' + printType(o)); return o.fields.find(([k]) => k === e.key)?.[1] ?? fail('no field ' + e.key + ' in ' + printType(o)); }
      case 'length': arrayItem(ex(e.array, locals), 'length'); return NUMBER;
      case 'filter': { const a = ex(e.array, locals); ex(e.body, new Map(locals).set(e.param, arrayItem(a, 'filter'))); return a; }
      case 'map': { const a = ex(e.array, locals); return { k: 'array', item: ex(e.body, new Map(locals).set(e.param, arrayItem(a, 'map'))) }; }
      case 'findIndex': { const a = ex(e.array, locals); ex(e.body, new Map(locals).set(e.param, arrayItem(a, 'indexOf'))); return NUMBER; }
      case 'add': {
        const l = ex(e.left, locals), r = ex(e.right, locals);
        if (l.k === 'number' && r.k === 'number') return NUMBER;
        const text = (t: Type) => t.k === 'number' || t.k === 'string';
        if ((l.k === 'string' || r.k === 'string') && text(l) && text(r)) return STRING;
        return fail('+ of ' + printType(l) + ' and ' + printType(r));
      }
      case 'eq': case 'ne': { const l = ex(e.left, locals), r = ex(e.right, locals); if (!joinType(l, r)) fail('== of ' + printType(l) + ' and ' + printType(r)); return BOOLEAN; }
      case 'lt': case 'le': case 'gt': case 'ge': { const l = ex(e.left, locals), r = ex(e.right, locals); if (l.k !== 'number' || r.k !== 'number') fail('comparison of ' + printType(l) + ' and ' + printType(r)); return BOOLEAN; }
      case 'and': case 'or': { const l = ex(e.left, locals), r = ex(e.right, locals); return joinType(l, r) ?? fail(e.op + ' of different types'); }
      case 'not': ex(e.value, locals); return BOOLEAN;
      case 'cond': { ex(e.test, locals); const t = ex(e.then, locals), f = ex(e.else, locals); return joinType(t, f) ?? fail('?: branches of different types'); }
      case 'pending': ex(e.value, locals); return BOOLEAN;
      case 'latest': return ex(e.value, locals);
      default: return fail('unsupported op ' + (e as { op: string }).op);
    }
  };
  return ex(e, locals);
}

export type FramesTypes = {
  /** Every component's props, typed from its sites' arguments (a wire type, or `action`). */
  props: Map<string, { name: string; type: string }[]>;
  /** The type of an expression of `component` (locals: the view's row items). */
  exprType(component: string, e: FExpr, locals: Map<string, Type>): Type;
  /** The type of each component's sources and memos. */
  names: Map<string, Map<string, Type>>;
};

/** Types the components from the entry down: a component's prop types are its sites' argument types (all sites of one
 *  component must agree), so parents are typed before children. */
function typeComponents(entry: FComponent, children: Map<string, FComponent>, serverTypes: Map<string, { params: Type[]; returns: Type }>, actionTypes: Map<string, (string | undefined)[]>): FramesTypes {
  const names = new Map<string, Map<string, Type>>();
  const propTypes = new Map<string, Map<string, Type | 'action'>>();
  const order: string[] = [];
  const all = new Map<string, FComponent>([[entry.name, entry], ...children]);
  const exprIn = (comp: string) => (e: FExpr, locals: Map<string, Type>): Type => typeExpr(e, locals, {
    value: n => names.get(comp)!.get(n) ?? (() => { throw new FramesRefusal('FRAMES_WIRE_TYPE', 'untyped name ' + n + ' in ' + comp); })(),
    prop: n => { const t = propTypes.get(comp)?.get(n); if (!t) throw new FramesRefusal('FRAMES_WIRE_TYPE', 'untyped prop ' + n + ' of ' + comp); if (t === 'action') throw new FramesRefusal('FRAMES_CHILDREN', 'the action prop ' + n + ' of ' + comp + ' read as a value'); return t; },
  });
  // Parents before children: a topological order of the application graph from the entry.
  const applied = (vs: FView[], out: Set<string> = new Set()) => {
    for (const v of vs) {
      if (v.kind === 'component') out.add(v.name);
      else if (v.kind === 'element' || v.kind === 'for') applied(v.children, out);
      else if (v.kind === 'show' || v.kind === 'loading' || v.kind === 'errored') { applied(v.children, out); applied(v.fallback, out); }
    }
    return out;
  };
  const visiting = new Set<string>(), done = new Set<string>();
  const post: string[] = [];
  const dfs = (n: string) => {
    if (done.has(n)) return;
    if (visiting.has(n)) throw new FramesRefusal('FRAMES_MODULES', 'recursive components: ' + n);
    visiting.add(n);
    for (const k of applied(all.get(n)!.markup)) dfs(k);
    visiting.delete(n); done.add(n); post.push(n);
  };
  dfs(entry.name);
  order.push(...post.reverse());
  const typeOne = (c: FComponent) => {
    const ns = new Map<string, Type>();
    names.set(c.name, ns);
    const ex = exprIn(c.name);
    for (const s of c.sources) ns.set(s.name, ex(s.seed, new Map()));
    for (const m of c.memos) {
      if ('await' in m) {
        const sig = serverTypes.get(m.await.serverFn)!;
        m.await.args.forEach((a, i) => { if (!joinType(ex(a, new Map()), sig.params[i])) throw new FramesRefusal('FRAMES_WIRE_TYPE', 'argument ' + (i + 1) + ' of ' + m.await.serverFn); });
        ns.set(m.name, sig.returns);
      } else ns.set(m.name, ex(m.value, new Map()));
    }
    const sites = (vs: FView[], locals: Map<string, Type>) => {
      for (const v of vs) {
        if (v.kind === 'element') sites(v.children, locals);
        else if (v.kind === 'show' || v.kind === 'loading' || v.kind === 'errored') { sites(v.children, locals); sites(v.fallback, locals); }
        else if (v.kind === 'for') sites(v.children, new Map(locals).set(v.item, (() => { const t = ex(v.each, locals); if (t.k !== 'array') throw new FramesRefusal('FRAMES_WIRE_TYPE', 'For over a non-array'); return t.item; })()));
        else if (v.kind === 'component') {
          const pts = propTypes.get(v.name) ?? new Map<string, Type | 'action'>();
          propTypes.set(v.name, pts);
          for (const p of v.props) {
            let t: Type | 'action';
            if ('action' in p || 'forward' in p) t = 'action';
            else if (p.value.op === 'prop' && propTypes.get(c.name)?.get(p.value.name) === 'action') { (p as { forward?: string }).forward = p.value.name; delete (p as { value?: unknown }).value; t = 'action'; }
            else t = ex(p.value, locals);
            const had = pts.get(p.name);
            if (had !== undefined && (had === 'action' || t === 'action' ? had !== t : !sameType(had, t))) throw new FramesRefusal('FRAMES_WIRE_TYPE', 'the sites of ' + v.name + ' pass ' + p.name + ' different types');
            pts.set(p.name, t);
          }
        }
      }
    };
    sites(c.markup, new Map());
  };
  for (const n of order) typeOne(all.get(n)!);
  for (const name of children.keys()) if (!order.includes(name)) throw new FramesRefusal('FRAMES_MODULES', 'the component ' + name + ' is never applied');
  const props = new Map<string, { name: string; type: string }[]>();
  for (const [name, pts] of propTypes) {
    const c = children.get(name)!;
    const declared = [...pts.keys()];
    for (const used of (c as FComponent & { propsUsed?: Set<string> }).propsUsed ?? []) if (!pts.has(used)) throw new FramesRefusal('FRAMES_WIRE_TYPE', name + ' reads the prop ' + used + ', which a site does not pass');
    props.set(name, declared.map(p => ({ name: p, type: pts.get(p) === 'action' ? 'action' : printType(pts.get(p) as Type) })));
  }
  void actionTypes;
  return { props, names, exprType: (comp, e, locals) => exprIn(comp)(e, locals) };
}

/** The static types of a built v2.2 plan (its consumers' view: placement is recomputed from them). */
export function framesTypes(plan: FramesPlan): FramesTypes {
  const serverTypes = new Map(plan.serverFns.map(f => [f.name, { params: f.params.map(p => parseType(p.type)), returns: parseType(f.returns) }]));
  const entry: FComponent = { name: plan.component, props: [], sources: plan.sources, memos: plan.memos, actions: plan.actions, markup: plan.markup };
  return typeComponents(structuredClone(entry), new Map(plan.components.map(c => [c.name, structuredClone(c)])), serverTypes, new Map());
}

/** Key order of the emitted plan (JSON.stringify keeps insertion order). */
function canonicalOrder(p: FramesPlan): FramesPlan {
  return {
    version: p.version, component: p.component, hosts: p.hosts, serverHosts: p.serverHosts, serverFns: p.serverFns, components: p.components,
    sources: p.sources, memos: p.memos, actions: p.actions, markup: p.markup, serverComponents: p.serverComponents, placement: p.placement,
  };
}

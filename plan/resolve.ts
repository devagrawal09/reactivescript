import { checkModules, type ModuleSet } from '../tsx/rx/compiler.ts';
import type { Expr, Stmt, Markup } from '../tsx/rx/ast.ts';

export type Expression = { op: 'literal'; value: unknown } | { op: 'read'; source: string } | { op: 'local'; name: string } | { op: 'current'; source: string } | { op: 'add'; left: Expression; right: Expression };
export type Step = { op: 'write' | 'optimistic'; source: string; value: Expression } | { op: 'await'; host: string; args: Expression[]; bind: string } | { op: 'try'; body: Step[]; catch: Step[] };
export type Plan = { version: 1; sources: { name: string; kind: 'source' | 'optimistic'; seed: Expression }[]; equations: { name: string; value: Expression }[]; actions: { name: string; steps: Step[] }[]; handlers: { name: string; action: string }[]; markup: View[] };
export type View = { kind: 'element'; tag: string; events: { name: string; handler: string }[]; children: View[] } | { kind: 'text'; value: Expression };

/** CP-6 decides identities, kinds, reads, writes and calls. See docs/PLAN.md for the AST gaps. */
export function resolvePlan(set: ModuleSet): Plan {
  const checked = checkModules(set);
  if (checked.diags.length) throw new Error(JSON.stringify(checked.diags));
  if (set.order.length !== 1) throw new Error('slice 1 supports one RX module plus host imports');
  const file = set.order[0], program = set.programs.get(file)!, model = checked.models.get(file)!;
  const entry = program.decls.find(d => d.k === 'component' && d.isDefault);
  if (!entry || entry.k !== 'component') throw new Error('expected one default component');
  const region = model.regions.find(r => r.kind === 'component' && r.name === entry.name)!;
  if (!region) throw new Error('missing resolved component');
  const symbols = model.symbols.filter(s => s.region === region.id || s.kind === 'import');
  const symbol = (name: string) => { const s = symbols.find(s => s.name === name); if (!s) throw new Error('unresolved ' + name); return s; };
  type Comp = typeof model.computations[number];
  const comp = (kind: string, name: string) => { const c = model.computations.find(c => c.region === region.id && c.kind === kind && c.name === name); if (!c) throw new Error('missing computation ' + kind + ':' + name); return c; };
  const expression = (e: Expr, c?: Comp, locals = new Map<string, Expression>()): Expression => {
    if (e.k === 'lit') return { op: 'literal', value: e.v };
    if (e.k === 'id') {
      if (locals.has(e.name)) return locals.get(e.name)!;
      const s = symbol(e.name);
      if (c && !c.reads.some(r => r.sym === s.id)) throw new Error('read absent from CP-6: ' + e.name);
      return { op: 'read', source: s.name };
    }
    if (e.k === 'bin' && e.op === '+') return { op: 'add', left: expression(e.l,c,locals), right: expression(e.r,c,locals) };
    throw new Error('unsupported expression ' + e.k);
  };
  let temporary = 0;
  const steps = (body: Stmt[], c: Comp, locals = new Map<string, Expression>()): Step[] => body.flatMap((s): Step[] => {
    if (s.k === 'let' && s.e.k === 'await' && s.e.e.k === 'call' && s.e.e.f.k === 'id') {
      const host = symbol(s.e.e.f.name);
      if (s.e.init || s.e.stream || host.kind !== 'import' || !c.calls.includes(host.id)) throw new Error('host await absent from CP-6');
      const bind = '$await' + temporary++;
      locals.set(s.name,{op:'local',name:bind});
      return [{op:'await',host:host.name,args:s.e.e.args.map(e => expression(e,c,locals)),bind}];
    }
    if (s.k === 'try') { if (!s.handler || s.catchClasses || s.fin) throw new Error('only untyped try/catch supported'); return [{ op: 'try', body: steps(s.body,c,new Map(locals)), catch: steps(s.handler,c,new Map(locals)) }]; }
    if (s.k !== 'write' && s.k !== 'optimistic') throw new Error('unsupported action step ' + s.k);
    const target = symbol(s.target.name);
    if (s.target.path.length || s.target.ctx || !c.writes.some(w => w.sym === target.id && w.op === s.k && !w.path)) throw new Error('write absent from CP-6');
    const before: Step[] = [];
    let value: Expression;
    if (s.e.k === 'await') {
      const call = s.e.e;
      if (s.e.init || s.e.stream || call.k !== 'call' || call.f.k !== 'id') throw new Error('only await host call supported');
      const host = symbol(call.f.name);
      if (host.kind !== 'import' || !c.calls.includes(host.id)) throw new Error('host call absent from CP-6');
      const bind = '$await' + temporary++;
      before.push({ op: 'await', host: host.name, args: call.args.map(e => expression(e,c)), bind });
      value = { op: 'local', name: bind };
    } else if (s.e.k === 'fn') {
      if (s.e.params.length !== 1 || s.e.stmts?.length) throw new Error('only expression updaters supported');
      value = expression(s.e.body,c,new Map([[s.e.params[0],{ op:'current',source:target.name }]]));
    } else value = expression(s.e,c,locals);
    return [...before,{ op: s.k, source: target.name, value }];
  });
  const plan: Plan = { version:1, sources:[], equations:[], actions:[], handlers:[], markup:[] };
  for (const s of symbols.filter(s => s.region === region.id)) {
    const d = entry.decls.find(d => 'name' in d && d.name === s.name);
    if (s.kind === 'source') {
      if (!d || d.k !== 'source') throw new Error('source shape missing');
      const optimistic = model.computations.some(c => c.writes.some(w => w.sym === s.id && w.op === 'optimistic'));
      if (!!s.question !== !!d.question) throw new Error('question mismatch');
      if (s.question && !optimistic) throw new Error('async questions are outside slice 1');
      plan.sources.push({ name:s.name, kind:optimistic?'optimistic':'source', seed:expression(d.init,comp(s.question?'question':'seed',s.name)) });
    } else if (s.kind === 'eq') {
      if (!d || d.k !== 'eq') throw new Error('equation shape missing');
      plan.equations.push({ name:s.name, value:expression(d.e,comp('memo',s.name)) });
    } else if (s.kind === 'action') {
      if (!d || d.k !== 'action' || d.params.length) throw new Error('action shape unsupported');
      plan.actions.push({ name:s.name, steps:steps(d.body,comp('action',s.name)) });
    } else if (s.kind !== 'props') throw new Error('unsupported resolved symbol ' + s.kind);
  }
  const handlers = model.computations.filter(c => c.kind === 'handler' && c.region === region.id);
  const readers = model.computations.filter(c => c.kind === 'reader' && c.region === region.id);
  let hi = 0, ri = 0;
  const markup = (m: Markup): View => {
    if (m.k === 'text') return { kind:'text', value:{op:'literal',value:m.s} };
    if (m.k === 'read') {
      // TSX lowering makes numeric text coercion explicit; text holes do it at the renderer boundary.
      const e = m.e.k === 'bin' && m.e.op === '+' && m.e.l.k === 'lit' && m.e.l.v === '' ? m.e.r : m.e;
      return { kind:'text', value:expression(e,readers[ri++]) };
    }
    if (m.k !== 'el' || !/^[a-z]/.test(m.tag)) throw new Error('only host elements supported');
    const events = m.attrs.map(a => {
      if (!a.name.startsWith('on') || a.e.k !== 'fn') throw new Error('only event attributes supported');
      const c = handlers[hi], name = '$handler' + hi++;
      if (!c) throw new Error('handler absent from CP-6');
      let action: string;
      const call = a.e.body;
      if (call.k === 'call' && call.f.k === 'id' && !call.args.length) {
        const target = symbol(call.f.name);
        if (target.kind !== 'action' || !c.calls.includes(target.id)) throw new Error('action call absent from CP-6');
        action = target.name;
      } else if (a.e.stmts?.length === 1 && a.e.stmts[0].k === 'action') {
        action = '$action' + plan.actions.length;
        const ac = model.computations.find(x => x.kind === 'action' && x.in === c.id);
        if (!ac) throw new Error('inline action absent from CP-6');
        plan.actions.push({name:action,steps:steps(a.e.stmts[0].body,ac)});
      } else if (a.e.stmts?.length) {
        action = '$action' + plan.actions.length;
        plan.actions.push({name:action,steps:steps(a.e.stmts,c)});
      } else throw new Error('only action handlers supported');
      plan.handlers.push({name,action}); return {name:a.name,handler:name};
    });
    return {kind:'element',tag:m.tag,events,children:m.children.map(markup)};
  };
  plan.markup = entry.view.map(markup);
  return plan;
}

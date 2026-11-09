// Static types over plan v2 (docs/EVAL.md, "Typing"). The pinned RX checker does not type a program (spec 13: types
// are TypeScript's, through a projection this package does not run), so the eval checker types the plan it emits: the
// value domain of PLAN-V2.md (integers, strings, booleans, arrays, records) and the operations each op accepts there.
// Most rules are ones a plan consumer already enforces at run time (a value outside its op's types fails the run);
// typing finds those before anything runs. Three are stricter, as TypeScript is: `==`/`!=` across types, and `&&`, `||`
// and `?:` whose values have different types. It is used to derive an eval site's binding interface from the enclosing
// component, and to check evaluated code against that interface. It does not refuse ordinary (non-eval) plans.
import type { Expression, Plan, Step, View, HostType } from './resolve-v2.ts';

export type Type =
  | { k: 'number' } | { k: 'string' } | { k: 'boolean' }
  | { k: 'array'; item: Type }
  | { k: 'record'; fields: [string, Type][] }
  /** The item type of an empty array literal: it joins with any type. */
  | { k: 'never' };

export const NUMBER: Type = { k: 'number' }, STRING: Type = { k: 'string' }, BOOLEAN: Type = { k: 'boolean' };
export const scalarType = (t: HostType): Type => t === 'number' ? NUMBER : t === 'string' ? STRING : BOOLEAN;

export function printType(t: Type): string {
  switch (t.k) {
    case 'array': return (t.item.k === 'array' ? '(' + printType(t.item) + ')' : printType(t.item)) + '[]';
    case 'record': return '{ ' + t.fields.map(([k, v]) => k + ': ' + printType(v)).join(', ') + ' }';
    default: return t.k;
  }
}

/** Equal types: records compare by their field set, not field order. */
export function sameType(a: Type, b: Type): boolean {
  if (a.k !== b.k) return false;
  if (a.k === 'array') return sameType(a.item, (b as typeof a).item);
  if (a.k === 'record') {
    const bf = (b as typeof a).fields;
    return a.fields.length === bf.length && a.fields.every(([k, v]) => bf.some(([k2, v2]) => k2 === k && sameType(v, v2)));
  }
  return true;
}

/** The least type of two (for array literal items and `never`), or undefined when they do not join. */
export function joinType(a: Type, b: Type): Type | undefined {
  if (a.k === 'never') return b;
  if (b.k === 'never') return a;
  if (a.k === 'array' && b.k === 'array') { const i = joinType(a.item, b.item); return i && { k: 'array', item: i }; }
  if (a.k === 'record' && b.k === 'record') {
    if (a.fields.length !== b.fields.length) return undefined;
    const fields: [string, Type][] = [];
    for (const [k, v] of a.fields) {
      const other = b.fields.find(([k2]) => k2 === k);
      const j = other && joinType(v, other[1]);
      if (!j) return undefined;
      fields.push([k, j]);
    }
    return { k: 'record', fields };
  }
  return sameType(a, b) ? a : undefined;
}

/** What a name means to the typer: a readable value, a store root (readable, written only by path), an action, or a
 *  host. Bindings of evaluated code are names of the first three kinds that the code cannot write (docs/EVAL.md). */
export type NameType =
  | { kind: 'value' | 'store'; type: Type; binding?: boolean }
  | { kind: 'action'; params: Type[]; binding?: boolean };

export class TypeError_ extends Error {}

export type Typed = {
  /** Every source's, memo's and action's type (sources and memos: their value; actions: their parameters). */
  names: Map<string, NameType>;
  /** Type errors, in plan order. Empty: the plan is well typed. */
  errors: string[];
};

/**
 * Types a plan. `actionTypes` gives each declared action's parameter types (the plan keeps only names; the types come
 * from the checked AST: RX `action f(x: number)`, TSX `function* (x: number)`). `bindings` are an evaluated plan's
 * bindings (docs/EVAL.md); they shadow nothing, because the frontend declares them.
 */
export function typePlan(plan: Plan & { bindings?: unknown[]; value?: Expression }, actionTypes: Map<string, (HostType | undefined)[]>, bindings: Map<string, NameType> = new Map()): Typed {
  const errors: string[] = [];
  const names = new Map<string, NameType>(bindings);
  const hosts = new Map(plan.hosts.map(h => [h.name, h]));
  const memos = new Map(plan.memos.map(m => [m.name, m]));
  const pending = new Set<string>();
  const fail = (m: string): never => { throw new TypeError_(m); };
  const attempt = <T>(where: string, f: () => T): T | undefined => {
    try { return f(); } catch (e) { if (e instanceof TypeError_) { errors.push(where + ': ' + e.message); return undefined; } throw e; }
  };
  type Locals = Map<string, Type>;

  const valueOf = (name: string): Type => {
    const n = names.get(name);
    if (n) { if (n.kind === 'action') fail('the action ' + name + ' is not a value'); return (n as { type: Type }).type; }
    const m = memos.get(name);
    if (!m) fail('unknown name ' + name);
    if (pending.has(name)) fail('the memo ' + name + ' depends on itself');
    pending.add(name);
    try {
      const t = expr(m!.value, new Map());
      names.set(name, { kind: 'value', type: t });
      return t;
    } finally { pending.delete(name); }
  };
  const lambda = (param: string, item: Type, body: Expression, locals: Locals) => expr(body, new Map(locals).set(param, item));
  const arrayItem = (t: Type, what: string): Type => t.k === 'array' ? t.item : fail(what + ' of a ' + printType(t) + ', not an array');
  const expr = (e: Expression, locals: Locals): Type => {
    switch (e.op) {
      case 'literal': return typeof e.value === 'number' ? NUMBER : typeof e.value === 'string' ? STRING : BOOLEAN;
      case 'array': {
        let item: Type = { k: 'never' };
        for (const x of e.items) item = joinType(item, expr(x, locals)) ?? fail('array items of different types');
        return { k: 'array', item };
      }
      case 'object': return { k: 'record', fields: e.fields.map(f => [f.key, expr(f.value, locals)] as [string, Type]) };
      case 'read': return valueOf(e.source);
      case 'local': return locals.get(e.name) ?? fail('unbound local ' + e.name);
      case 'get': {
        const o = expr(e.object, locals);
        if (o.k !== 'record') return fail('field ' + e.key + ' of a ' + printType(o) + ', not a record');
        return o.fields.find(([k]) => k === e.key)?.[1] ?? fail('no field ' + e.key + ' in ' + printType(o));
      }
      case 'length': arrayItem(expr(e.array, locals), 'length'); return NUMBER;
      case 'filter': { const a = expr(e.array, locals); lambda(e.param, arrayItem(a, 'filter'), e.body, locals); return a; }
      case 'map': { const a = expr(e.array, locals); return { k: 'array', item: lambda(e.param, arrayItem(a, 'map'), e.body, locals) }; }
      case 'findIndex': { const a = expr(e.array, locals); lambda(e.param, arrayItem(a, 'indexOf'), e.body, locals); return NUMBER; }
      case 'add': {
        const l = expr(e.left, locals), r = expr(e.right, locals);
        if (l.k === 'number' && r.k === 'number') return NUMBER;
        const text = (t: Type) => t.k === 'number' || t.k === 'string';
        if ((l.k === 'string' || r.k === 'string') && text(l) && text(r)) return STRING;
        return fail('+ of ' + printType(l) + ' and ' + printType(r) + ' (integers add, strings concatenate strings and integers)');
      }
      case 'eq': case 'ne': {
        const l = expr(e.left, locals), r = expr(e.right, locals);
        if (!joinType(l, r)) fail((e.op === 'eq' ? '==' : '!=') + ' of ' + printType(l) + ' and ' + printType(r) + ' (never equal)');
        return BOOLEAN;
      }
      case 'lt': case 'le': case 'gt': case 'ge': {
        const l = expr(e.left, locals), r = expr(e.right, locals);
        if (l.k !== 'number' || r.k !== 'number') fail('comparison of ' + printType(l) + ' and ' + printType(r) + ' (integers only)');
        return BOOLEAN;
      }
      case 'and': case 'or': {
        const l = expr(e.left, locals), r = expr(e.right, locals);
        return joinType(l, r) ?? fail((e.op === 'and' ? '&&' : '||') + ' of ' + printType(l) + ' and ' + printType(r) + ' (its value is one operand: give both one type)');
      }
      case 'not': expr(e.value, locals); return BOOLEAN;
      case 'cond': {
        expr(e.test, locals);
        const t = expr(e.then, locals), f = expr(e.else, locals);
        return joinType(t, f) ?? fail('?: branches of ' + printType(t) + ' and ' + printType(f));
      }
      case 'eval': {
        if (expr(e.code, locals).k !== 'string') fail('eval code is a string');
        return scalarType(e.type);
      }
      default: return fail('unknown op ' + (e as { op: string }).op);
    }
  };
  const want = (t: Type, w: Type, what: string) => { if (!joinType(t, w)) fail(what + ': a ' + printType(t) + ' where a ' + printType(w) + ' is wanted'); };
  const steps = (ss: Step[], locals: Locals): void => {
    for (const s of ss) {
      if (s.op === 'write') {
        const n = names.get(s.source);
        if (!n || n.kind === 'action') return fail('write of ' + s.source + ', not a source');
        let t = n.type;
        for (const seg of s.path ?? []) {
          if ('key' in seg) t = t.k === 'record' ? t.fields.find(([k]) => k === seg.key)?.[1] ?? fail('no field ' + seg.key + ' in ' + printType(t)) : fail('field ' + seg.key + ' of a ' + printType(t));
          else { want(expr(seg.index, locals), NUMBER, 'store index'); t = arrayItem(t, 'index'); }
        }
        want(expr(s.value, locals), t, 'write of ' + s.source);
      } else if (s.op === 'optimistic') {
        const n = names.get(s.source);
        if (!n || n.kind !== 'value') return fail('guess of ' + s.source);
        if ('updater' in s) want(lambda(s.updater.param, n.type, s.updater.body, locals), n.type, 'guess of ' + s.source);
        else want(expr(s.value, locals), n.type, 'guess of ' + s.source);
      } else if (s.op === 'await') {
        const h = hosts.get(s.host) ?? fail('unknown host ' + s.host);
        if (h.params.length !== s.args.length) fail(s.host + ' takes ' + h.params.length + ' arguments');
        s.args.forEach((a, i) => want(expr(a, locals), scalarType(h.params[i]), 'argument ' + (i + 1) + ' of ' + s.host));
        locals.set(s.bind, scalarType(h.returns));
      } else if (s.op === 'try') { steps(s.body, new Map(locals)); steps(s.catch, new Map(locals)); }
      else if (s.op === 'call') {
        const a = names.get(s.action);
        if (!a || a.kind !== 'action') return fail('call of ' + s.action + ', not an action');
        if (a.params.length !== s.args.length) fail(s.action + ' takes ' + a.params.length + ' arguments');
        s.args.forEach((x, i) => want(expr(x, locals), a.params[i], 'argument ' + (i + 1) + ' of ' + s.action));
      }
    }
  };
  const views = (vs: View[], locals: Locals) => {
    for (const v of vs) attempt('markup', () => {
      if (v.kind === 'element') { for (const e of v.events) attempt(v.tag + ' ' + e.name, () => steps(e.steps, new Map(locals))); views(v.children, locals); }
      else if (v.kind === 'text') { const t = expr(v.value, locals); if (t.k !== 'number' && t.k !== 'string') fail('text of a ' + printType(t) + ' (text shows strings and integers)'); }
      else if (v.kind === 'show') { expr(v.when, locals); views(v.children, locals); views(v.fallback, locals); }
      else if (v.kind === 'for') views(v.children, new Map(locals).set(v.item, arrayItem(expr(v.each, locals), 'For')));
      else if (v.kind === 'eval') { if (expr(v.code, locals).k !== 'string') fail('eval code is a string'); }
    });
  };

  for (const s of plan.sources) attempt('source ' + s.name, () => {
    const t = expr(s.seed, new Map());
    names.set(s.name, { kind: s.kind === 'store' ? 'store' : 'value', type: t });
  });
  for (const a of plan.actions) {
    const ts = actionTypes.get(a.name);
    if (a.params.length && (!ts || ts.length !== a.params.length || ts.some(t => t === undefined))) {
      errors.push('action ' + a.name + ': parameter types are required (number, string or boolean)');
      continue;
    }
    names.set(a.name, { kind: 'action', params: (ts ?? []).map(t => scalarType(t!)) });
  }
  for (const m of plan.memos) attempt('memo ' + m.name, () => valueOf(m.name));
  for (const a of plan.actions) {
    const n = names.get(a.name);
    if (!n || n.kind !== 'action') continue;
    attempt('action ' + a.name, () => steps(a.steps, new Map(a.params.map((p, i) => [p, n.params[i]]))));
  }
  views(plan.markup, new Map());
  if (plan.value) attempt('value', () => names.set('$value', { kind: 'value', type: expr(plan.value!, new Map()) }));
  return { names, errors };
}

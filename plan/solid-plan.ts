// A JS reference consumer of plan v2 (docs/PLAN-V2.md): it builds the plan with Solid 2's own primitives and its
// universal renderer, the same calls Solid's compiler emits for the TSX twin (createSignal, createStore,
// createOptimistic(fn), createMemo, action(function*), Show, For, insert with a static-sibling marker). It checks that
// the plan alone carries what the scenario's frames need. It is not a second runtime: Solid does the scheduling.
// Every op outside the schema, and every value outside its types, throws.
import { action, createMemo, createOptimistic, createSignal, createStore, For, Show } from 'solid-js';
import { createComponent, createElement, createTextNode, insert, insertNode } from '../tsx/test-renderer.ts';
import type { Expression, Plan, Step, View } from './resolve-v2.ts';

type Env = Map<string, unknown>;
type Api = Record<string, (...args: unknown[]) => Promise<unknown>>;

const truthy = (v: unknown): boolean => {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') return v !== '';
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'object' && v !== null) return true;
  throw new Error('plan value outside the schema: ' + String(v));
};
const integer = (v: unknown): number => { if (typeof v !== 'number' || !Number.isInteger(v)) throw new Error('expected an integer'); return v; };
/** ToString for text and concatenation: strings as they are, integers in base ten. */
const text = (v: unknown): string => typeof v === 'string' ? v : String(integer(v));

export function planComponent(plan: Plan, api: Api): () => unknown {
  if (plan.version !== 2) throw new Error('plan version 2');
  for (const h of plan.hosts) if (typeof api[h.name] !== 'function') throw new Error('missing host ' + h.name);
  return () => {
    const reads = new Map<string, () => unknown>();
    const setters = new Map<string, (v: unknown) => unknown>();
    const kinds = new Map<string, string>();
    const actions = new Map<string, (...args: unknown[]) => Promise<unknown>>();

    const lambda = (param: string, body: Expression, env: Env) => (x: unknown) => evaluate(body, new Map(env).set(param, x));
    const evaluate = (e: Expression, env: Env): unknown => {
      switch (e.op) {
        case 'literal': return e.value;
        case 'array': return e.items.map(x => evaluate(x, env));
        case 'object': return Object.fromEntries(e.fields.map(f => [f.key, evaluate(f.value, env)]));
        case 'read': { const r = reads.get(e.source); if (!r) throw new Error('unknown source ' + e.source); return r(); }
        case 'local': { if (!env.has(e.name)) throw new Error('unbound local ' + e.name); return env.get(e.name); }
        case 'get': {
          const o = evaluate(e.object, env) as Record<string, unknown>;
          if (typeof o !== 'object' || o === null || Array.isArray(o) || !(e.key in o)) throw new Error('get ' + e.key + ' of a non-record');
          return o[e.key];
        }
        case 'length': { const a = evaluate(e.array, env); if (!Array.isArray(a)) throw new Error('length of a non-array'); return a.length; }
        case 'filter': case 'map': case 'findIndex': {
          const a = evaluate(e.array, env);
          if (!Array.isArray(a)) throw new Error(e.op + ' of a non-array');
          const f = lambda(e.param, e.body, env);
          return e.op === 'map' ? a.map(x => f(x)) : e.op === 'filter' ? a.filter(x => truthy(f(x))) : a.findIndex(x => truthy(f(x)));
        }
        case 'add': {
          const l = evaluate(e.left, env), r = evaluate(e.right, env);
          if (typeof l === 'string' || typeof r === 'string') return text(l) + text(r);
          return integer(l) + integer(r);
        }
        case 'eq': case 'ne': {
          const l = evaluate(e.left, env), r = evaluate(e.right, env);
          return e.op === 'eq' ? l === r : l !== r;
        }
        case 'lt': case 'le': case 'gt': case 'ge': {
          const l = integer(evaluate(e.left, env)), r = integer(evaluate(e.right, env));
          return e.op === 'lt' ? l < r : e.op === 'le' ? l <= r : e.op === 'gt' ? l > r : l >= r;
        }
        case 'and': { const l = evaluate(e.left, env); return truthy(l) ? evaluate(e.right, env) : l; }
        case 'or': { const l = evaluate(e.left, env); return truthy(l) ? l : evaluate(e.right, env); }
        case 'not': return !truthy(evaluate(e.value, env));
        case 'cond': return truthy(evaluate(e.test, env)) ? evaluate(e.then, env) : evaluate(e.else, env);
        default: throw new Error('unknown expression op ' + (e as { op: string }).op);
      }
    };

    // Steps run as a generator: an await yields the host's promise to Solid's action runner, which resumes the body in
    // the action's transaction with the value, or throws the rejection at that point (into the enclosing try).
    function* exec(steps: Step[], env: Env): Generator<unknown, void, unknown> {
      for (const s of steps) {
        if (s.op === 'write') {
          const value = evaluate(s.value, env);
          if (!s.path) {
            if (kinds.get(s.source) !== 'signal') throw new Error('a plain write targets a signal');
            setters.get(s.source)!(() => value);
            continue;
          }
          if (kinds.get(s.source) !== 'store') throw new Error('a path write targets a store');
          const keys = s.path.map(p => 'key' in p ? p.key : integer(evaluate(p.index, env)));
          setters.get(s.source)!((draft: any) => {
            let o = draft;
            for (const k of keys.slice(0, -1)) { o = o[k]; if (typeof o !== 'object' || o === null) throw new Error('store path does not exist'); }
            o[keys[keys.length - 1]] = value;
          });
        } else if (s.op === 'optimistic') {
          if (kinds.get(s.source) !== 'optimistic') throw new Error('an optimistic write targets an optimistic source');
          setters.get(s.source)!('updater' in s ? lambda(s.updater.param, s.updater.body, env) : (() => { const v = evaluate(s.value, env); return () => v; })());
        } else if (s.op === 'await') {
          const host = api[s.host];
          if (!host) throw new Error('unknown host ' + s.host);
          env.set(s.bind, yield host(...s.args.map(a => evaluate(a, env))));
        } else if (s.op === 'try') {
          try { yield* exec(s.body, new Map(env)); } catch { yield* exec(s.catch, new Map(env)); }
        } else if (s.op === 'call') {
          const a = actions.get(s.action);
          if (!a) throw new Error('unknown action ' + s.action);
          // An uncaught failure is a run failure: it surfaces as an unhandled rejection.
          void a(...s.args.map(x => evaluate(x, env)));
        } else throw new Error('unknown step op ' + (s as { op: string }).op);
      }
    }

    for (const s of plan.sources) {
      kinds.set(s.name, s.kind);
      if (s.kind === 'signal') {
        const [get, set] = createSignal(evaluate(s.seed, new Map()));
        reads.set(s.name, get); setters.set(s.name, set as never);
      } else if (s.kind === 'store') {
        const [store, set] = createStore(evaluate(s.seed, new Map()) as object);
        reads.set(s.name, () => store); setters.set(s.name, set as never);
      } else if (s.kind === 'optimistic') {
        const [get, set] = createOptimistic(() => evaluate(s.seed, new Map()));
        reads.set(s.name, get); setters.set(s.name, set as never);
      } else throw new Error('unknown source kind ' + (s as { kind: string }).kind);
    }
    for (const m of plan.memos) { kinds.set(m.name, 'memo'); reads.set(m.name, createMemo(() => evaluate(m.value, new Map()))); }
    for (const a of plan.actions)
      actions.set(a.name, action(function* (...args: unknown[]) {
        if (args.length !== a.params.length) throw new Error(a.name + ' arity');
        yield* exec(a.steps, new Map(a.params.map((p, i) => [p, args[i]])));
      }));

    const handler = (steps: Step[], env: Env) => () => {
      const run = exec(steps, new Map(env));
      if (!run.next().done) throw new Error('a plain handler never awaits');
    };
    // One view: a static node, or a dynamic part (an accessor or a control-flow component) inserted before a marker.
    const node = (v: View, env: Env): { node: unknown } | { dynamic: unknown } => {
      if (v.kind === 'text') return v.value.op === 'literal' ? { node: createTextNode(text(v.value.value)) } : { dynamic: () => text(evaluate(v.value, env)) };
      if (v.kind === 'element') {
        const props = Object.fromEntries(v.events.map(e => [e.name, handler(e.steps, env)]));
        const el = createElement(v.tag, props);
        children(el, v.children, env);
        return { node: el };
      }
      if (v.kind === 'show') return { dynamic: createComponent(Show, {
        get when() { return evaluate(v.when, env); },
        get fallback() { return fragment(v.fallback, env); },
        get children() { return fragment(v.children, env); },
      }) };
      if (v.kind === 'for') {
        if (v.key !== 'identity') throw new Error('For keys rows by identity');
        return { dynamic: createComponent(For, {
          get each() { const xs = evaluate(v.each, env); if (!Array.isArray(xs)) throw new Error('For of a non-array'); return xs; },
          children: (item: unknown) => fragment(v.children, new Map(env).set(v.item, item)),
        }) };
      }
      throw new Error('unknown view kind ' + (v as { kind: string }).kind);
    };
    const children = (parent: unknown, views: View[], env: Env) => {
      const parts = views.map(v => node(v, env));
      parts.forEach(p => { if ('node' in p) insertNode(parent, p.node); });
      parts.forEach((p, i) => {
        if (!('dynamic' in p)) return;
        if ('dynamic' in (parts[i + 1] ?? {})) throw new Error('adjacent dynamic children need a marker this consumer does not invent');
        const next = parts.slice(i + 1).find(q => 'node' in q) as { node: unknown } | undefined;
        if (parts.length === 1) insert(parent, p.dynamic); else insert(parent, p.dynamic, next ? next.node : null);
      });
    };
    const fragment = (views: View[], env: Env): unknown => {
      const parts = views.map(v => node(v, env)).map(p => 'node' in p ? p.node : p.dynamic);
      return parts.length === 1 ? parts[0] : parts;
    };
    return fragment(plan.markup, new Map());
  };
}

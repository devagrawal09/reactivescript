// A JS reference consumer of plan v2 (docs/PLAN-V2.md): it builds the plan with Solid 2's own primitives and its
// universal renderer, the same calls Solid's compiler emits for the TSX twin (createSignal, createStore,
// createOptimistic(fn), createMemo, action(function*), Show, For), in the order the compiler emits them: an element tree
// is one template, whose elements and hoisted texts are created first, in pre-order, with events as static props of
// createElement; then each element's children are appended, then its dynamic children are inserted, each before its next
// static sibling (docs/PLAN-V2.md, "Markup"). It checks that the plan alone carries what the scenario's frames need, and
// the plan fuzz (plan/fuzz/) that it makes the same host calls as native Solid. It is not a second runtime: Solid does
// the scheduling. Every op outside the schema, and every value outside its types, throws.
import { action, createMemo, createOptimistic, createSignal, createStore, For, Show } from 'solid-js';
import * as testRenderer from '../tsx/test-renderer.ts';
import type { EvalNode, Expression, HostType, Plan, Step, View } from './resolve-v2.ts';

/** The renderer helpers a plan is built with: Solid's universal renderer over some host (default: the test renderer). */
export type Renderer = {
  createElement: (tag: string, props?: Record<string, unknown>) => unknown;
  createTextNode: (value: string) => unknown;
  insertNode: (parent: unknown, node: unknown) => void;
  insert: (parent: unknown, value: unknown, marker?: unknown) => unknown;
  createComponent: (component: (props: any) => unknown, props: object) => unknown;
  memo: (fn: () => unknown, equal?: boolean) => () => unknown;
};
/** An evaluated plan's bindings (docs/EVAL.md): a read is an accessor, a store its root, an action a function that
 *  starts it (whoever passes it reports the call, as the enclosing component would). */
export type Binding = { kind: 'read' | 'store'; read: () => unknown } | { kind: 'action'; call: (...args: unknown[]) => Promise<unknown> };
/** What an eval site asks to compile (eval/compile.ts EvalRequest). */
export type EvalCompile = (request: { code: string; interface: string; syntax: 'rx' | 'tsx'; check: 'strict' | 'lenient'; type?: HostType }) => Plan;
/** renderer: the host's helpers; onAction: told each action call's name and promise (the plan fuzz logs outcomes);
 *  bindings: an evaluated plan's bindings; compile: compiles an eval site's code to a plan, or throws its typed refusal
 *  (docs/EVAL.md). Without compile, an eval site fails the run. */
export type Options = { renderer?: Renderer; onAction?: (name: string, run: Promise<unknown>) => void; bindings?: Map<string, Binding>; compile?: EvalCompile };
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

export function planComponent(plan: Plan, api: Api, options: Options = {}): () => unknown {
  check(plan, api, options);
  if (plan.value) throw new Error('a value plan is evaluated with planValue');
  return () => instance(plan, api, options).render();
}

/** docs/EVAL.md: a value eval's plan, evaluated where it is called (in the caller's reactive context). */
export function planValue(plan: Plan, api: Api, options: Options = {}): () => unknown {
  check(plan, api, options);
  if (!plan.value || plan.sources.length || plan.memos.length || plan.actions.length || plan.markup.length) throw new Error('a value plan is one expression');
  return () => instance(plan, api, options).value();
}

function check(plan: Plan, api: Api, options: Options) {
  if (plan.version !== 2) throw new Error('plan version 2');
  for (const h of plan.hosts) if (typeof api[h.name] !== 'function') throw new Error('missing host ' + h.name);
  const want = plan.bindings ?? [], given = options.bindings ?? new Map();
  if (want.length !== given.size || want.some(b => given.get(b.name)?.kind !== b.kind)) throw new Error('the bindings given are not the plan\'s: ' + want.map(b => b.kind + ' ' + b.name).join(', '));
}

/** A scalar of a value eval's declared type, or an error (docs/EVAL.md). */
const typed = (v: unknown, type: HostType): unknown => {
  if (type === 'number' ? typeof v === 'number' && Number.isInteger(v) : typeof v === type) return v;
  throw new Error('eval value ' + String(v) + ' is not a ' + type);
};

function instance(plan: Plan, api: Api, options: Options) {
  const { createComponent, createElement, createTextNode, insert, insertNode, memo } = options.renderer ?? (testRenderer as unknown as Renderer);
  {
    const reads = new Map<string, () => unknown>();
    const setters = new Map<string, (v: unknown) => unknown>();
    const kinds = new Map<string, string>();
    const actions = new Map<string, (...args: unknown[]) => Promise<unknown>>();
    // docs/EVAL.md: bindings read like sources and memos, are never written, and bound actions are called as given.
    const bound = new Map<string, (...args: unknown[]) => Promise<unknown>>();
    for (const [name, b] of options.bindings ?? []) {
      if (b.kind === 'action') bound.set(name, b.call);
      else { reads.set(name, b.read); kinds.set(name, b.kind === 'store' ? 'store-binding' : 'binding'); }
    }
    // docs/EVAL.md: an eval node's bindings, linked to this plan's names; a bound action reports its call as a call
    // step of this plan does.
    const linked = (node: EvalNode) => {
      const bindings = new Map<string, Binding>(), innerApi: Api = {};
      for (const b of node.bindings) {
        const host = plan.hosts.find(h => h.name === b.target);
        const a = actions.get(b.target) ?? bound.get(b.target);
        if (host) innerApi[b.name] = api[b.target];
        else if (a) bindings.set(b.name, { kind: 'action', call: (...args: unknown[]) => {
          const run = a(...args);
          if (actions.has(b.target) && options.onAction) options.onAction(b.target, run);
          return run;
        } });
        else if (reads.has(b.target)) bindings.set(b.name, { kind: kinds.get(b.target) === 'store' || kinds.get(b.target) === 'store-binding' ? 'store' : 'read', read: reads.get(b.target)! });
        else throw new Error('eval binding ' + b.name + ': unknown ' + b.target);
      }
      return { bindings, api: innerApi };
    };
    const compile: EvalCompile = request => {
      if (!options.compile) throw new Error('an eval site needs a compiler (Options.compile)');
      return options.compile(request);
    };

    const lambda = (param: string, body: Expression, env: Env) => (x: unknown) => evaluate(body, new Map(env).set(param, x));
    const evaluate = (e: Expression, env: Env): unknown => {
      switch (e.op) {
        case 'literal': return e.value;
        case 'array': return e.items.map(x => evaluate(x, env));
        case 'object': return Object.fromEntries(e.fields.map(f => [f.key, evaluate(f.value, env)]));
        case 'read': { const r = reads.get(e.source); if (!r) throw new Error('unknown source ' + e.source); return r(); }
        case 'local': { if (!env.has(e.name)) throw new Error('unbound local ' + e.name); return env.get(e.name); }
        case 'get': {
          // `o.key` alone, as the TSX twin reads it (a store's `get` trap, never `has`): no plan value is undefined, so
          // an undefined result is a missing field.
          const o = evaluate(e.object, env) as Record<string, unknown>;
          if (typeof o !== 'object' || o === null || Array.isArray(o)) throw new Error('get ' + e.key + ' of a non-record');
          const v = o[e.key];
          if (v === undefined) throw new Error('get ' + e.key + ': no such field');
          return v;
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
        case 'eval': {
          // docs/EVAL.md: the code, then the compiled expression over the bindings, in this reactive context.
          const code = evaluate(e.code, env);
          if (typeof code !== 'string') throw new Error('eval code is a string');
          const inner = linked(e);
          const p = compile({ code, interface: e.interface, syntax: e.syntax, check: e.check, type: e.type });
          return typed(planValue(p, inner.api, { ...options, bindings: inner.bindings })(), e.type);
        }
        default: throw new Error('unknown expression op ' + (e as { op: string }).op);
      }
    };

    const rejections = new WeakSet<object>();
    // Steps run as a generator: an await yields the host's promise to Solid's action runner, which resumes the body in
    // the action's transaction with the value, or throws the rejection at that point (into the enclosing try).
    function* exec(steps: Step[], env: Env): Generator<unknown, void, unknown> {
      for (const s of steps) {
        if (s.op === 'write') {
          if (!s.path) {
            const value = evaluate(s.value, env);
            if (kinds.get(s.source) !== 'signal') throw new Error('a plain write targets a signal');
            setters.get(s.source)!(() => value);
            continue;
          }
          if (kinds.get(s.source) !== 'store') throw new Error('a path write targets a store');
          // Inside the store setter, as the TSX twin `setStore(draft => { draft.a[i].b = v })` evaluates it: each
          // segment in turn (an index is evaluated when reached), then the value, then the set. Reads there see a node
          // a pending transaction holds as that transaction has it, so evaluating before the setter would differ.
          const path = s.path, write = s;
          setters.get(s.source)!((draft: any) => {
            let o = draft;
            for (const [i, p] of path.entries()) {
              if (typeof o !== 'object' || o === null) throw new Error('store path does not exist');
              const k = 'key' in p ? p.key : integer(evaluate(p.index, env));
              if (typeof k === 'number' && (!Array.isArray(o) || k < 0 || k >= o.length)) throw new Error('store path index ' + k);
              if (i < path.length - 1) { o = o[k]; continue; }
              o[k] = evaluate(write.value, env);
            }
          });
        } else if (s.op === 'optimistic') {
          if (kinds.get(s.source) !== 'optimistic') throw new Error('an optimistic write targets an optimistic source');
          setters.get(s.source)!('updater' in s ? lambda(s.updater.param, s.updater.body, env) : (() => { const v = evaluate(s.value, env); return () => v; })());
        } else if (s.op === 'await') {
          const host = api[s.host];
          if (!host) throw new Error('unknown host ' + s.host);
          let result: unknown;
          try { result = yield host(...s.args.map(a => evaluate(a, env))); } catch (e) { if (typeof e === 'object' && e !== null) rejections.add(e); throw e; }
          env.set(s.bind, result);
        } else if (s.op === 'try') {
          // Only a host rejection thrown in at an await is caught; a runtime error fails the run (PLAN-V2.md).
          try { yield* exec(s.body, new Map(env)); } catch (e) { if (!rejections.has(e as object)) throw e; yield* exec(s.catch, new Map(env)); }
        } else if (s.op === 'call') {
          const b = bound.get(s.action);
          if (b) { void b(...s.args.map(x => evaluate(x, env))); continue; }
          const a = actions.get(s.action);
          if (!a) throw new Error('unknown action ' + s.action);
          // An uncaught failure is a run failure: it surfaces as an unhandled rejection, or through onAction.
          const run = a(...s.args.map(x => evaluate(x, env)));
          if (options.onAction) options.onAction(s.action, run); else void run;
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
    // An element tree is one template, lowered as Solid's universal compiler lowers JSX (compiler
    // src/universal/transform.rs, lower_native_element and lower_universal_children): `declare` creates the elements
    // and, when an element has more than one child, its static texts, in pre-order; `exprs` then appends each element's
    // static children in order (a lone static text is created at its append), and runs its children's own exprs and its
    // dynamic children's inserts in child order. A dynamic child of a multi-child element is inserted before the next
    // static sibling (null if none follows); a lone dynamic child has no marker.
    type Lowered = { view: Extract<View, { kind: 'element' }>; node?: unknown; texts: Map<number, unknown>; kids: Map<number, Lowered>; env: Env };
    const isStatic = (v: View) => v.kind === 'text' && v.value.op === 'literal';
    const lower = (view: Extract<View, { kind: 'element' }>, env: Env): Lowered => {
      const kids = new Map<number, Lowered>();
      view.children.forEach((c, i) => { if (c.kind === 'element') kids.set(i, lower(c, env)); });
      return { view, texts: new Map(), kids, env };
    };
    const declare = (l: Lowered) => {
      const events = l.view.events;
      l.node = events.length ? createElement(l.view.tag, Object.fromEntries(events.map(e => [e.name, handler(e.steps, l.env)]))) : createElement(l.view.tag);
      const multi = l.view.children.length > 1;
      l.view.children.forEach((c, i) => {
        if (isStatic(c) && multi) l.texts.set(i, createTextNode(text((c as { value: { value: unknown } }).value.value)));
        else if (c.kind === 'element') declare(l.kids.get(i)!);
      });
    };
    const exprs = (l: Lowered) => {
      const cs = l.view.children, multi = cs.length > 1;
      cs.forEach((c, i) => {
        if (isStatic(c)) insertNode(l.node, multi ? l.texts.get(i) : createTextNode(text((c as { value: { value: unknown } }).value.value)));
        else if (c.kind === 'element') insertNode(l.node, l.kids.get(i)!.node);
      });
      cs.forEach((c, i) => {
        if (c.kind === 'element') return exprs(l.kids.get(i)!);
        if (isStatic(c)) return;
        const value = dynamic(c, l.env);
        if (!multi) return insert(l.node, value);
        let marker: unknown = null;
        for (let j = i + 1; j < cs.length; j++) {
          if (isStatic(cs[j])) { marker = l.texts.get(j); break; }
          if (cs[j].kind === 'element') { marker = l.kids.get(j)!.node; break; }
        }
        insert(l.node, value, marker);
      });
    };
    const element = (v: Extract<View, { kind: 'element' }>, env: Env) => { const l = lower(v, env); declare(l); exprs(l); return l.node; };
    // A component prop the compiler gives a getter (Show's when, For's each) and that is a conditional or a logical
    // expression is rewritten by its transformCondition(…, inline) (compiler src/shared/condition.rs): the test of a
    // conditional with a dynamic branch, or the left of `&&` with both sides dynamic, is read through a memo created in
    // the getter (the renderer's `memo(() => test)()`; `!!test` unless the test is a comparison or `!`), and `||` walks
    // its left spine to such an `&&`. "Dynamic" is the compiler's: any call or member access in the TSX twin, so a
    // read of a signal, memo or optimistic source (`x()`), a get, a length and the array methods; not a literal, a local
    // or a store root.
    const dyn = (e: Expression): boolean => {
      switch (e.op) {
        case 'literal': case 'local': return false;
        // A store root (and a bound store) is a plain identifier in the TSX twin; any other read is a call.
        case 'read': return kinds.get(e.source) !== 'store' && kinds.get(e.source) !== 'store-binding';
        case 'eval': return true;
        case 'get': case 'length': case 'filter': case 'map': case 'findIndex': return true;
        case 'array': return e.items.some(dyn);
        case 'object': return e.fields.some(f => dyn(f.value));
        case 'not': return dyn(e.value);
        case 'cond': return dyn(e.test) || dyn(e.then) || dyn(e.else);
        default: return dyn(e.left) || dyn(e.right);
      }
    };
    const comparison = (e: Expression) => ['eq', 'ne', 'lt', 'le', 'gt', 'ge', 'not'].includes(e.op);
    const memoized = (f: () => unknown) => memo(f)();
    const condition = (e: Expression, env: Env): unknown => {
      if (e.op === 'cond') {
        if (!(dyn(e.then) || dyn(e.else)) || !dyn(e.test)) return evaluate(e, env);
        const c = memoized(() => comparison(e.test) ? evaluate(e.test, env) : truthy(evaluate(e.test, env)));
        const branch = (b: Expression) => b.op === 'cond' || b.op === 'and' || b.op === 'or' ? condition(b, env) : evaluate(b, env);
        return truthy(c) ? branch(e.then) : branch(e.else);
      }
      if (e.op === 'and') {
        if (!dyn(e.right) || !dyn(e.left)) return evaluate(e, env);
        if (comparison(e.left)) { const c = memoized(() => evaluate(e.left, env)); return truthy(c) ? evaluate(e.right, env) : c; }
        return memoized(() => truthy(evaluate(e.left, env))) ? evaluate(e.right, env) : evaluate(e.left, env);
      }
      if (e.op === 'or' && (e.left.op === 'and' || e.left.op === 'or')) { const l = condition(e.left, env); return truthy(l) ? l : evaluate(e.right, env); }
      return evaluate(e, env);
    };
    // A dynamic child: a text accessor, or a control-flow component with the props the compiler passes (getters; no
    // fallback prop when the plan has none; For's children a one-argument mapper of the row item itself).
    const dynamic = (v: View, env: Env): unknown => {
      if (v.kind === 'text') return () => text(evaluate(v.value, env));
      // docs/EVAL.md: the TSX twin's `{createEval(() => code, { … })}`, which the compiler inserts as `() => createEval(…)`.
      if (v.kind === 'eval') return () => evalView(createComponent, () => evaluate(v.code, env), (code: string) => {
        const inner = linked(v);
        const p = compile({ code, interface: v.interface, syntax: v.syntax, check: v.check });
        return planComponent(p, inner.api, { ...options, bindings: inner.bindings });
      });
      if (v.kind === 'show') return createComponent(Show, v.fallback.length ? {
        get when() { return condition(v.when, env); },
        get fallback() { return fragment(v.fallback, env); },
        get children() { return fragment(v.children, env); },
      } : {
        get when() { return condition(v.when, env); },
        get children() { return fragment(v.children, env); },
      });
      if (v.kind === 'for') {
        if (v.key !== 'identity') throw new Error('For keys rows by identity');
        return createComponent(For, {
          get each() { const xs = condition(v.each, env); if (!Array.isArray(xs)) throw new Error('For of a non-array'); return xs; },
          children: (item: unknown) => fragment(v.children, new Map(env).set(v.item, item)),
        });
      }
      throw new Error('unknown view kind ' + (v as { kind: string }).kind);
    };
    // The views of a component position (the markup, a Show branch, a For row): each element is its own template, a
    // Show or For its component; one view is itself, more are an array. Text there is lowered differently by the
    // compiler (a string, or a memo inside an array) and is refused.
    const fragment = (views: View[], env: Env): unknown => {
      const parts = views.map(v => {
        if (v.kind === 'element') return element(v, env);
        if (v.kind === 'text') throw new Error('text directly in a component position (the markup, a Show branch, a For row) is outside this consumer');
        if (v.kind === 'eval') throw new Error('an eval site directly in a component position is outside this consumer');
        return dynamic(v, env);
      });
      return parts.length === 1 ? parts[0] : parts;
    };
    return { render: () => fragment(plan.markup, new Map()), value: () => evaluate(plan.value!, new Map()) };
  }
}

/** docs/EVAL.md, "Semantics": `createEval(code, …)` renders as Solid's keyed Show over the code string: when the string
 *  changes, the evaluated subtree is disposed and the new code's component is created (`createComponent(Compiled, {})`).
 *  An empty string renders nothing. A refused compile throws its EvalRefused into the graph, where the nearest error
 *  boundary catches it. Shared by solid-plan.ts and the createEval runtime (eval/runtime.ts). */
export function evalView(createComponent: Renderer['createComponent'], code: () => unknown, build: (code: string) => (props: object) => unknown): unknown {
  return createComponent(Show as never, {
    get when() {
      const c = code();
      if (typeof c !== 'string') throw new Error('eval code is a string');
      return c;
    },
    keyed: true,
    children: (code: string) => createComponent(build(code), {}),
  });
}

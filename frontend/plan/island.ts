// The island level of the React frontend's fallback ladder (react/island.ts): a component the frontend could not lower
// to plan v2 runs as its own JS render function, with React's hooks shimmed over one Solid signal per island. Each
// state change bumps the signal, the whole island re-renders (as a component tree), its output is reconciled by key into
// the renderer's nodes, and effects run after that commit, children first, comparing deps as React does. Only the
// React a synchronous island needs is here: async transitions and useOptimistic are refused before an island is made.
import { createEffect, createSignal, untrack } from 'solid-js';
import type { Renderer } from './solid-plan.ts';

/** A plan v2 view that holds JS: the compiled module of one React component (react/island.ts). */
export type IslandView = { kind: 'island'; component: string; module: string; imports: { from: string; names: string[] }[]; reasons: string[] };
type Api = Record<string, (...args: unknown[]) => Promise<unknown>>;

type VNode = { type: unknown; props: Record<string, unknown>; key: string | null };
type Host = { tag: string; props: Record<string, unknown>; key: string | null; children: Out[] };
type Out = Host | string;
type Context = { $$context: true; value: unknown; Provider: unknown };
type Slot = { value?: unknown; deps?: unknown[]; cleanup?: (() => void) | void; effect?: () => (() => void) | void; dirty?: boolean };
type Instance = { slots: Slot[]; seen: boolean };

const FRAGMENT = Symbol('Fragment');
const sameDeps = (a: unknown[] | undefined, b: unknown[] | undefined) => !!a && !!b && a.length === b.length && a.every((x, i) => Object.is(x, b[i]));

/** Mounts an island: returns the accessor of its top-level nodes, for the renderer's insert. */
export type IslandRenderer = Pick<Renderer, 'createElement' | 'createTextNode' | 'insertNode'> & {
  setProp: (node: unknown, name: string, value: unknown, prev?: unknown) => void;
  removeNode: (parent: unknown, node: unknown) => void;
};

export function island(view: IslandView, api: Api, renderer: IslandRenderer): () => unknown[] {
  const { createElement, createTextNode, insertNode, setProp, removeNode } = renderer;
  const [tick, setTick] = createSignal(0, { equals: false, ownedWrite: true });
  let version = 0;
  const instances = new Map<string, Instance>();
  let current: { inst: Instance; index: number; path: string; again: boolean } | undefined;
  const contexts: { ctx: Context; value: unknown }[] = [];
  const effects: Slot[] = [];
  const schedule = () => setTick(++version);

  const slot = (): Slot => {
    if (!current) throw new Error('a hook outside a component render');
    const s = current.inst.slots[current.index] ??= {};
    current.index++;
    return s;
  };
  const dispatcher = (s: Slot, reduce: (prev: unknown, a: unknown) => unknown) => (s.value as [unknown, unknown])[1] ??= (a: unknown) => {
    const pair = s.value as [unknown, unknown];
    const next = reduce(pair[0], a);
    if (Object.is(next, pair[0])) return;
    pair[0] = next;
    if (current && current.inst === ownerOf(s)) current.again = true;
    else schedule();
  };
  const owners = new WeakMap<Slot, Instance>();
  const ownerOf = (s: Slot) => owners.get(s);
  const React = {
    Fragment: FRAGMENT,
    useState(init: unknown) { return React.useReducer((prev: unknown, a: unknown) => typeof a === 'function' ? (a as (p: unknown) => unknown)(prev) : a, init, (i: unknown) => typeof i === 'function' ? (i as () => unknown)() : i); },
    useReducer(reducer: (s: unknown, a: unknown) => unknown, arg: unknown, init?: (a: unknown) => unknown) {
      const s = slot();
      if (!s.value) { s.value = [init ? init(arg) : arg, undefined]; owners.set(s, current!.inst); dispatcher(s, (p, a) => reducer(p, a)); }
      const pair = s.value as [unknown, unknown];
      return [pair[0], pair[1]];
    },
    useRef(init: unknown) { const s = slot(); return (s.value ??= { current: init }); },
    useMemo(f: () => unknown, deps?: unknown[]) {
      const s = slot();
      if (!sameDeps(s.deps, deps) || !('value' in s)) { s.value = f(); s.deps = deps; }
      return s.value;
    },
    useCallback(f: unknown, deps?: unknown[]) { return React.useMemo(() => f, deps); },
    useEffect(f: () => (() => void) | void, deps?: unknown[]) {
      const s = slot();
      if (deps === undefined || !sameDeps(s.deps, deps)) { s.effect = f; s.deps = deps; s.dirty = true; effects.push(s); }
    },
    useLayoutEffect(f: () => (() => void) | void, deps?: unknown[]) { React.useEffect(f, deps); },
    useInsertionEffect(f: () => (() => void) | void, deps?: unknown[]) { React.useEffect(f, deps); },
    createContext(value: unknown): Context { const ctx = { $$context: true as const, value, Provider: undefined as unknown }; ctx.Provider = { $$provider: ctx }; return ctx; },
    useContext(ctx: Context) { slot(); for (let i = contexts.length - 1; i >= 0; i--) if (contexts[i].ctx === ctx) return contexts[i].value; return ctx.value; },
    useId() { const s = slot(); return (s.value ??= ':r' + current!.path.length + current!.index + ':'); },
    useDeferredValue(v: unknown) { slot(); return v; },
    startTransition(f: () => unknown) { if (f() instanceof Promise) throw new Error('an async transition in an island'); },
    useTransition() { slot(); return [false, React.startTransition]; },
    createElement(type: unknown, props: Record<string, unknown> | null, ...children: unknown[]): VNode {
      const { key, ...rest } = props ?? {};
      if (children.length) rest.children = children.length === 1 ? children[0] : children;
      return { type, props: rest, key: key === undefined ? null : String(key) };
    },
  };

  // Expands a React child into host output, rendering components (a component's hooks are its path's slots).
  const expand = (child: unknown, path: string, out: Out[]) => {
    if (child === null || child === undefined || typeof child === 'boolean') return;
    if (typeof child === 'string' || typeof child === 'number') { out.push(String(child)); return; }
    if (Array.isArray(child)) { child.forEach((c, i) => expand(c, path + '.' + ((c as VNode)?.key != null ? 'k' + (c as VNode).key : i), out)); return; }
    const v = child as VNode;
    if (v.type === FRAGMENT) return expand(v.props.children, path + ':f', out);
    if (typeof v.type === 'string') {
      const kids: Out[] = [];
      expand(v.props.children, path + '<' + v.type, kids);
      const { children: _, ...props } = v.props;
      out.push({ tag: v.type, props, key: v.key, children: kids });
      return;
    }
    const provided = (v.type as { $$provider?: Context })?.$$provider;
    if (provided) {
      contexts.push({ ctx: provided, value: v.props.value });
      try { expand(v.props.children, path + ':p', out); } finally { contexts.pop(); }
      return;
    }
    if (typeof v.type !== 'function') throw new Error('an island renders elements, fragments, providers and function components');
    const at = path + ':' + ((v.type as { name?: string }).name ?? 'c');
    const inst = instances.get(at) ?? { slots: [], seen: false };
    instances.set(at, inst);
    inst.seen = true;
    const outer = current, own = effects.length;
    let rendered: unknown;
    // React re-runs a component that sets its own state while rendering, before its children.
    for (let pass = 0; ; pass++) {
      if (pass > 25) throw new Error('too many re-renders');
      current = { inst, index: 0, path: at, again: false };
      try { rendered = (v.type as (p: unknown) => unknown)(v.props); } finally { const again = current.again; current = outer; if (!again) break; }
    }
    const mine = effects.splice(own);
    expand(rendered, at, out);
    effects.push(...mine);
  };

  type Mounted = { out: Out; node: unknown; kids: Mounted[] };
  const keyOf = (o: Out, i: number) => typeof o === 'string' ? '#t' + i : o.key !== null ? 'k' + o.key : '#' + o.tag + i;
  // Reconciles one list of children: an old node is reused when key and tag match, its props and children patched; the
  // kept and new nodes are then appended in order (insertNode moves a node that is already placed).
  const patch = (parent: unknown, old: Mounted[], next: Out[]): Mounted[] => {
    const byKey = new Map(old.map((m, i) => [keyOf(m.out, i), m]));
    const mounted = next.map((o, i): Mounted => {
      const prev = byKey.get(keyOf(o, i));
      if (prev && typeof o === 'string' && prev.out === o) { byKey.delete(keyOf(o, i)); return prev; }
      if (prev && typeof o !== 'string' && typeof prev.out !== 'string' && prev.out.tag === o.tag) {
        byKey.delete(keyOf(o, i));
        for (const k of Object.keys(prev.out.props)) if (!(k in o.props)) setProp(prev.node, k, undefined, prev.out.props[k]);
        for (const [k, val] of Object.entries(o.props)) if (prev.out.props[k] !== val) setProp(prev.node, k, val, prev.out.props[k]);
        return { out: o, node: prev.node, kids: patch(prev.node, prev.kids, o.children) };
      }
      if (typeof o === 'string') return { out: o, node: createTextNode(o), kids: [] };
      const node = createElement(o.tag, o.props);
      return { out: o, node, kids: patch(node, [], o.children) };
    });
    if (parent !== null) {
      for (const m of byKey.values()) removeNode(parent, m.node);
      for (const m of mounted) insertNode(parent, m.node);
    }
    return mounted;
  };

  const imported = new Map<string, Record<string, unknown>>([['react', React]]);
  for (const i of view.imports) if (i.from !== 'react') imported.set(i.from, Object.fromEntries(i.names.map(n => {
    if (typeof api[n] !== 'function') throw new Error('missing host ' + n);
    return [n, (...args: unknown[]) => api[n](...args)];
  })));
  const exports: { default?: unknown } = {};
  new Function('__import', '__exports', view.module)((from: string) => imported.get(from) ?? (() => { throw new Error('an island imports ' + from); })(), exports);
  if (typeof exports.default !== 'function') throw new Error('an island module exports its component as default');
  const root = React.createElement(exports.default, null);

  let top: Mounted[] = [];
  const [roots, setRoots] = createSignal<unknown[]>([], { equals: false, ownedWrite: true });
  const commit = () => {
    for (const inst of instances.values()) inst.seen = false;
    effects.length = 0;
    const out: Out[] = [];
    expand(root, '', out);
    for (const [at, inst] of instances) if (!inst.seen) { instances.delete(at); for (const s of inst.slots) if (typeof s.cleanup === 'function') s.cleanup(); }
    top = patch(null, top, out);
    setRoots(top.map(m => m.node));
    // Effects run after the commit, in the order their components finished rendering (children before parents).
    for (const s of effects.splice(0)) { if (typeof s.cleanup === 'function') s.cleanup(); s.cleanup = s.effect!(); s.dirty = false; }
  };
  untrack(commit);
  createEffect(() => tick(), (v: number) => { if (v > 0) commit(); });
  return () => roots();
}

// The recording host and scenario driver of the plan fuzz (plan/docs/PLAN-V2.md, "Plan fuzz"). One host serves every
// JS leg (native Solid, compiled RX, the plan built by solid-plan.ts): Solid 2's own @solidjs/universal createRenderer
// over a recording tree (FakeNode), with @solidjs/web's event delegation. It is a port of rust-solid's
// fuzz/plan-oracle.mjs host, whose log the Rust consumer (`plan-trace`) prints entry for entry; the one addition is
// createElement's static props, which Solid's universal compiler passes for event handlers: the host applies each
// through its own setProperty (logged as one, with no previous value), as the plan consumers' setProp does.
// Every host call, queries included, each request, each settled action and, after each step, the step, the tree and the
// frame are logged. Nothing is filtered or normalized. Load with `--conditions=browser` (Solid's production builds, the
// files the Rust port follows).
import * as S from 'solid-js';
import * as U from '@solidjs/universal';
import * as W from '@solidjs/web';

export type Scalar = string | number | boolean;
export type HostSig = { name: string; parameters: ('number' | 'string' | 'boolean')[]; returns: 'number' | 'string' | 'boolean'; async: true };
export type Target = { text: string; parent?: string; index: number };
export type ScenarioStep = ({ type: 'mount' } | { type: 'click'; element: number } | { type: 'click'; target: Target } |
  { type: 'resolve'; host: string; call: number; args?: Scalar[]; value: Scalar } |
  { type: 'reject'; host: string; call: number; args?: Scalar[]; error: string }) & { frame: string };
export type Scenario = { version: 2; name: string; fixture: string; host: HostSig[]; steps: ScenarioStep[] };
export type Trace = { result: { frames: string[] } | { error: string }; log: unknown[] };
/** What the recording driver may choose from after each step (the generator's chooser decides). */
export type Live = {
  clickables: { target: Target }[];
  pending: { host: string; call: number; args: Scalar[] }[];
};
/** A scenario step before its frame is observed. */
export type Choice = ScenarioStep extends infer T ? T extends unknown ? Omit<T, 'frame'> : never : never;
export type Chooser = (live: Live, index: number) => Choice | null;

export function createHost() {
  const log: unknown[] = [];
  const fnIds = new WeakMap<object, number>(); let fnN = 0;
  const fnId = (f: object) => { let k = fnIds.get(f); if (k === undefined) fnIds.set(f, k = fnN++); return k; };
  const nodes: FakeNode[] = [];
  class FakeNode {
    id: number; tag: string | undefined; text: unknown; children: FakeNode[] = []; parent: FakeNode | null = null;
    props = new Map<string, unknown>(); listeners: [string, (e: unknown) => void][] = [];
    constructor(tag?: string, text?: unknown) { this.id = nodes.length; nodes.push(this); this.tag = tag; this.text = text; }
    get parentNode() { return this.parent; }
    get disabled() { return this.props.get('disabled'); }
    addEventListener(name: string, fn: (e: unknown) => void) { log.push(['addEventListener', this.id, name, { fn: fnId(fn) }]); if (!this.listeners.some(([n, l]) => n === name && l === fn)) this.listeners.push([name, fn]); }
    removeEventListener(name: string, fn: (e: unknown) => void) { log.push(['removeEventListener', this.id, name, { fn: fnId(fn) }]); const i = this.listeners.findIndex(([n, l]) => n === name && l === fn); if (i >= 0) this.listeners.splice(i, 1); }
    contains(o: FakeNode | null) { for (let n = o; n; n = n.parent) if (n === this) return true; return false; }
  }
  class FakeEvent { type: string; cancelBubble = false; _t: FakeNode; _ct: FakeNode | null = null; constructor(type: string, target: FakeNode) { this.type = type; this._t = target; } get target() { return this._t; } get currentTarget() { return this._ct; } }
  const isNode = (n: unknown): n is FakeNode => n instanceof FakeNode;
  const need = (n: unknown): FakeNode => { if (!isNode(n)) throw new TypeError('not a host node: ' + String(n)); return n; };
  const enc = (v: unknown): unknown => {
    if (v === undefined || v === null) return null;
    if (typeof v === 'boolean' || typeof v === 'number' || typeof v === 'string') return v;
    if (typeof v === 'function') return { fn: fnId(v) };
    if (Array.isArray(v)) return v.map(enc);
    if (isNode(v)) return { node: v.id };
    throw new TypeError('logging a value outside the domain');
  };
  const root = new FakeNode('#root');
  const isEventProp = (p: string) => p.indexOf(':') < 0 && p.startsWith('on') && p.charCodeAt(2) > 64 && p.charCodeAt(2) < 91;
  const holders = new Map<string, object>();
  const holder = (node: FakeNode, name: string) => { const k = node.id + ' ' + name; if (!holders.has(k)) holders.set(k, {}); return holders.get(k)!; };
  const setProperty = (node: unknown, name: string, value: unknown, prev?: unknown) => {
    log.push(['setProperty', need(node).id, name, enc(value), enc(prev)]);
    if (isEventProp(name)) (W as any).assign(node, { [name]: value }, true, holder(node as FakeNode, name), true); else (node as FakeNode).props.set(name, value);
  };
  const R: any = (U as any).createRenderer({
    createElement(tag: string, staticProps?: Record<string, unknown>) {
      const n = new FakeNode(tag); log.push(['createElement', tag, n.id]);
      if (staticProps) for (const name of Object.keys(staticProps)) setProperty(n, name, staticProps[name], undefined);
      return n;
    },
    createTextNode(value: unknown) { if (typeof value !== 'string' && typeof value !== 'number') throw new TypeError('createTextNode of a non-text'); const n = new FakeNode(undefined, value); log.push(['createTextNode', value, n.id]); return n; },
    replaceText(node: unknown, value: unknown) { log.push(['replaceText', need(node).id, enc(value)]); if ((node as FakeNode).tag !== undefined) throw new TypeError('replaceText of an element'); (node as FakeNode).text = value; },
    isTextNode(node: unknown) { const r = need(node).tag === undefined; log.push(['isTextNode', (node as FakeNode).id, r]); return r; },
    setProperty,
    insertNode(parent: unknown, node: unknown, anchor?: unknown) {
      log.push(['insertNode', need(parent).id, need(node).id, anchor == null ? null : need(anchor).id]);
      const p = parent as FakeNode, n = node as FakeNode, a = anchor as FakeNode | null | undefined;
      if (a != null && a.parent !== p) throw new Error('NotFoundError');
      let ref = a ?? null; if (ref === n) ref = p.children[p.children.indexOf(n) + 1] ?? null;
      if (n.parent) { const c = n.parent.children; c.splice(c.indexOf(n), 1); }
      const at = ref ? p.children.indexOf(ref) : p.children.length; p.children.splice(at, 0, n); n.parent = p;
    },
    removeNode(parent: unknown, node: unknown) {
      log.push(['removeNode', need(parent).id, need(node).id]);
      const p = parent as FakeNode, n = node as FakeNode;
      if (n.parent !== p) throw new Error('NotFoundError');
      p.children.splice(p.children.indexOf(n), 1); n.parent = null;
    },
    getParentNode(node: unknown) { const r = need(node).parent; log.push(['getParentNode', (node as FakeNode).id, r ? r.id : null]); return r; },
    getFirstChild(node: unknown) { const r = need(node).children[0] ?? null; log.push(['getFirstChild', (node as FakeNode).id, r ? r.id : null]); return r; },
    getNextSibling(node: unknown) { need(node); const p = (node as FakeNode).parent, r = p ? p.children[p.children.indexOf(node as FakeNode) + 1] ?? null : null; log.push(['getNextSibling', (node as FakeNode).id, r ? r.id : null]); return r; },
  });
  (W as any).registerDelegatedRoot(root);
  const tree = (n: FakeNode): unknown => n.tag === undefined ? [n.id, enc(n.text)] : [n.id, n.tag, n.children.map(tree)];
  const frameOf = (n: FakeNode): string => n.tag === undefined ? String(n.text) : n.children.map(frameOf).join('');
  const dispatch = (target: FakeNode, type: string) => {
    const e = new FakeEvent(type, target), path: FakeNode[] = [];
    for (let n: FakeNode | null = target; n; n = n.parent) path.push(n);
    for (const n of path) { const ls = n.listeners.filter(([name]) => name === type).map(([, l]) => l); for (const l of ls) { e._ct = n; l.call(n, e); } if (e.cancelBubble) break; }
  };
  // Live clickables, depth-first: a delegated click handler on the node, or a native click listener (the root's
  // delegation listener does not count).
  const clickables = (n: FakeNode, parent?: FakeNode, out: { node: FakeNode; parent?: FakeNode }[] = []) => {
    if (n.tag === undefined) return out;
    if ((n as any)['_$$click'] || (n !== root && n.listeners.some(([t]) => t === 'click'))) out.push({ node: n, parent });
    for (const c of n.children) clickables(c, n, out);
    return out;
  };

  // ---- hosts: every call is a new pending request ----
  type Request = { host: string; number: number; args: Scalar[]; resolve: (v: Scalar) => void; reject: (e: Error) => void; pending: boolean };
  const requests: Request[] = [];
  const typeOk = (v: unknown, t: string) => typeof v === t && (t !== 'number' || Number.isInteger(v));
  const api = (sigs: HostSig[]) => Object.fromEntries(sigs.map(h => [h.name, (...args: Scalar[]) => {
    if (args.length !== h.parameters.length || args.some((a, i) => !typeOk(a, h.parameters[i]))) throw new Error(h.name + ' called with ' + JSON.stringify(args));
    const number = requests.filter(r => r.host === h.name).length + 1; log.push(['request', h.name, number, args.map(enc)]);
    return new Promise<Scalar>((resolve, reject) => requests.push({ host: h.name, number, args, resolve, reject, pending: true }));
  }]));

  // ---- settled actions: ['action', name, null | message], attached when the action is called ----
  const uncaught: string[] = [];
  const watchAction = (name: string, p: Promise<unknown>) => {
    p.then(() => { log.push(['action', name, null]); }, (e: unknown) => {
      const m = e instanceof Error ? e.message : String(e);
      log.push(['action', name, m]); uncaught.push('uncaught failure in action ' + name + ': ' + m);
    });
  };

  /** Runs a scenario (replay: every frame is compared) or records one (a chooser picks each step from the live tree and
   *  requests, and the frames are the ones observed). The mount step renders `component` into the root. */
  async function run(component: () => unknown, scenario: { host: HostSig[]; steps?: ScenarioStep[] }, chooser?: Chooser, maxSteps = 0): Promise<Trace & { steps?: ScenarioStep[] }> {
    const frames: string[] = []; let dispose: (() => void) | null = null;
    const recorded: ScenarioStep[] = [];
    // Solid reports an error that reached the root with no boundary as [REACTIVITY_HALTED] and the error; the step
    // fails with both.
    let halted: string | false = false; const error = console.error;
    console.error = (...a: unknown[]) => {
      if (String(a[0]).startsWith('[REACTIVITY_HALTED]'))
        halted = [String(a[0]).slice('[REACTIVITY_HALTED]'.length), ...a.slice(1).map(x => x instanceof Error ? x.name + ': ' + x.message : String(x))].map(x => x.trim()).filter(Boolean).join(' ');
      return error(...a);
    };
    const settle = async () => { for (let i = 0; i < 3; i++) { await new Promise(r => setImmediate(r)); S.flush(); } };
    const check = (fatal: () => string | null) => { const f = fatal(); if (f !== null) throw new Error(f); if (halted !== false) throw new Error('reactivity halted' + (halted ? ': ' + halted : '')); if (uncaught.length) throw new Error(uncaught[0]); };
    const live = (): Live => {
      const cs = clickables(root);
      return {
        clickables: cs.map(c => {
          const text = frameOf(c.node), parent = c.parent && c.parent !== root ? frameOf(c.parent) : undefined;
          const same = cs.filter(d => frameOf(d.node) === text && (parent === undefined || (d.parent && frameOf(d.parent) === parent)));
          return { target: { text, ...(parent === undefined ? {} : { parent }), index: same.indexOf(c) } };
        }),
        pending: requests.filter(r => r.pending).map(r => ({ host: r.host, call: r.number, args: r.args })),
      };
    };
    try {
      for (let index = 0; ; index++) {
        let step: Choice & { frame?: string };
        if (chooser) {
          if (index === 0) step = { type: 'mount' };
          else { const c = chooser(live(), index); if (!c) break; step = c; }
          if (index > maxSteps) throw new Error('the chooser did not stop');
        } else { if (index >= scenario.steps!.length) break; step = scenario.steps![index]; }
        if (step.type === 'mount') dispose = R.render(component, root);
        else if (step.type === 'click') {
          const cs = clickables(root);
          const target = 'element' in step ? cs[step.element]?.node
            : cs.filter(c => frameOf(c.node) === step.target.text && (step.target.parent === undefined || (c.parent && frameOf(c.parent) === step.target.parent)))[step.target.index]?.node;
          if (!target) throw new Error('step ' + index + ': no clickable ' + JSON.stringify('element' in step ? step.element : step.target));
          dispatch(target, 'click');
        } else {
          const r = requests.find(q => q.host === step.host && q.number === step.call);
          if (!r) throw new Error('step ' + index + ': ' + step.host + ' call #' + step.call + ' was not issued');
          if (!r.pending) throw new Error('step ' + index + ': ' + step.host + ' call #' + step.call + ' is already settled');
          if (step.args && JSON.stringify(r.args) !== JSON.stringify(step.args)) throw new Error('step ' + index + ': arguments');
          r.pending = false; if (step.type === 'resolve') r.resolve(step.value); else r.reject(new Error(step.error));
        }
        await settle();
        try { check(() => null); } catch (e) { throw new Error('step ' + index + ': ' + (e as Error).message); }
        const frame = frameOf(root);
        log.push(['step', index, step.type], ['tree', tree(root)], ['frame', frame]);
        if (!chooser && frame !== step.frame) throw new Error('step ' + index + ': expected ' + JSON.stringify(step.frame) + ', actual ' + JSON.stringify(frame));
        frames.push(frame);
        recorded.push({ ...step, frame } as ScenarioStep);
      }
      if (requests.some(r => r.pending)) throw new Error('scenario left host calls pending');
      dispose!();
      return { result: { frames }, log, steps: recorded };
    } catch (e) { return { result: { error: (e as Error).message }, log, steps: recorded }; }
    finally { console.error = error; }
  }
  /** An error the reactive graph threw where nothing caught it (the eval legs: a refused evaluation with no error
   *  boundary, docs/EVAL.md). It fails the step, as an uncaught action failure does. */
  const reportError = (e: unknown) => { uncaught.push('uncaught ' + (e instanceof Error ? e.name + ': ' + e.message : String(e))); };
  return { R, root, log, api, watchAction, reportError, run };
}
export type Host = ReturnType<typeof createHost>;

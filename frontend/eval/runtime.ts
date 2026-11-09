// The createEval runtime (docs/EVAL.md): `createEval(() => code, { bindings }, { options })` in Solid TSX. It compiles
// each code string with eval/compile.ts (frontend → pinned checker → plan v2 → types) and runs the plan with
// plan/solid-plan.ts on Solid's own primitives, never with upstream's RX interpreter. A markup eval is a renderable: a
// keyed boundary over the code string (solid-plan.ts evalView). A value eval is an accessor: a memo of the code's one
// expression over the bindings.
//
// The binding interface is the checker's: the ReactiveScript frontend derives it at the eval site and writes it into
// the call (eval/inject.ts); a host that compiles its TSX another way passes `interface` itself. Without one, createEval
// refuses. The runtime checks the bindings object against it: the same names, accessors for reads, functions for
// actions and hosts.
//
// The renderer is the application's: `bindEval({ renderer })` returns the createEval for it (the module
// `reactivescript-tsx/eval` is the one bound to the renderer the app compiles against).
import { createMemo } from 'solid-js';
import { evalView, planComponent, planValue, type Binding, type EvalCompile, type Renderer } from '../plan/solid-plan.ts';
import type { HostType, Plan } from '../plan/resolve-v2.ts';
import { compileEval, EvalRefused, type EvalRequest } from './compile.ts';
import { parseInterface, InterfaceError } from './interface.ts';
import * as testRenderer from '../tsx/test-renderer.ts';

export { EvalRefused } from './compile.ts';
export type EvalOptions = { syntax?: 'rx' | 'tsx'; check?: 'strict' | 'lenient'; type?: HostType; interface?: string; preserve?: boolean; place?: unknown };

const cache = new Map<string, Plan | EvalRefused>();
/** compileEval with its refusal as an EvalRefused, cached by request (compilation is deterministic). */
export const compileOrThrow: EvalCompile = (request: EvalRequest) => {
  const key = JSON.stringify([request.interface, request.syntax ?? 'rx', request.check ?? 'strict', request.type ?? null, request.code]);
  let hit = cache.get(key);
  if (!hit) {
    const r = compileEval(request);
    hit = r.ok ? r.plan : new EvalRefused(r.diagnostics);
    cache.set(key, hit);
  }
  if (hit instanceof EvalRefused) throw new EvalRefused(hit.diagnostics);
  return hit;
};

/** The runtime's refusals of a call itself (options, bindings) are EvalRefused too: they reach the same boundary. */
const refuse = (message: string): never => { throw new EvalRefused([{ code: 'INTERFACE', message }]); };

export function bindEval(env: { renderer: Renderer; onAction?: (name: string, run: Promise<unknown>) => void; compile?: EvalCompile }) {
  const compile = env.compile ?? compileOrThrow;
  return function createEval(code: () => unknown, bindings: Record<string, unknown>, options: EvalOptions = {}): unknown {
    if (typeof code !== 'function') refuse('createEval\'s code is an accessor: () => code');
    if (options.preserve) refuse('preserve (keeping the evaluated state across code changes) is deferred: docs/EVAL.md');
    if (options.place !== undefined) refuse('place (server placement) is deferred: docs/EVAL.md');
    if (typeof options.interface !== 'string') refuse('createEval needs its binding interface: compile the enclosing component with the ReactiveScript frontend (eval/inject.ts), or pass { interface }');
    const syntax = options.syntax ?? 'rx', check = options.check ?? 'strict';
    let decls;
    try { decls = parseInterface(options.interface!); } catch (e) { if (e instanceof InterfaceError) refuse(e.message); throw e; }
    const names = Object.keys(bindings ?? {});
    if (names.length !== decls.length || decls.some(d => !names.includes(d.name)))
      refuse('the bindings ' + JSON.stringify(names) + ' are not the interface\'s ' + JSON.stringify(decls.map(d => d.name)));
    const linked = new Map<string, Binding>(), api: Record<string, (...a: unknown[]) => Promise<unknown>> = {};
    for (const d of decls) {
      const v = bindings[d.name];
      if (d.kind === 'store') {
        if (typeof v !== 'object' || v === null) refuse('binding ' + d.name + ' is a store');
        linked.set(d.name, { kind: 'store', read: () => v });
      } else {
        if (typeof v !== 'function') refuse('binding ' + d.name + ' is ' + (d.kind === 'read' ? 'an accessor' : 'a function'));
        const f = v as (...a: unknown[]) => Promise<unknown>;
        if (d.kind === 'read') linked.set(d.name, { kind: 'read', read: f });
        else if (d.kind === 'action') linked.set(d.name, { kind: 'action', call: f });
        else api[d.name] = f;
      }
    }
    const request = (c: string) => ({ code: c, interface: options.interface!, syntax, check, ...(options.type ? { type: options.type } : {}) });
    const inner = { renderer: env.renderer, onAction: env.onAction, bindings: linked, compile };
    if (options.type) {
      const type = options.type;
      return createMemo(() => {
        const c = code();
        if (typeof c !== 'string') throw new Error('eval code is a string');
        const v = planValue(compile(request(c)), api, inner)();
        if (type === 'number' ? typeof v === 'number' && Number.isInteger(v) : typeof v === type) return v;
        throw new Error('eval value ' + String(v) + ' is not a ' + type);
      });
    }
    return evalView(env.renderer.createComponent, code, (c: string) => planComponent(compile(request(c)), api, inner));
  };
}

/** createEval on this package's default renderer (the reference string renderer, tsx/test-renderer.ts). An app on
 *  another renderer binds its own with bindEval; the eval legs alias this module to one bound to their recording host
 *  (eval/harness/eval-native.ts). */
export const createEval = bindEval({ renderer: testRenderer as unknown as Renderer });

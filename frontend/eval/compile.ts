// The eval compiler (docs/EVAL.md, "Evaluation"): code → frontend → pinned checker → plan v2 → typed against the
// binding interface. It never runs anything and never falls back: a refusal is a list of typed diagnostics.
//
// The code is placed in a synthetic module whose first line declares the bindings, so the frontend and the pinned
// checker resolve them like any declaration and nothing else is in scope:
//   rx:  import { h } from "./eval-hosts"; export default component Eval() { source count := 0; action claim(id: number) {}
//   tsx: import { … } from "solid-js"; import { h } from "./eval-hosts"; export default function Eval() { const [count, $evalSet0] = createSignal(0); …
// followed by the code from line 2 (a value eval: `$value = (` code `);`, TSX `const $value = createMemo(() => (` code
// `)); return <></>;`), and a closing line. The placeholders' values are never used: plan/resolve-v2.ts turns those
// declarations into the plan's `bindings` and refuses any write to them. Host bindings are imports with a synthetic
// declaration file. Diagnostics are reported on the code's own lines.
import { loadTsxModules } from '../tsx/modules.ts';
import { checkModules, CheckError, ParseError } from '../tsx/rx/compiler.ts';
import { TsxError } from '../tsx/lower.ts';
import { resolvePlanV2, type HostType, type Plan } from '../plan/resolve-v2.ts';
import { typePlan, type Type } from '../plan/types.ts';
import { bindingTypes, parseInterface, InterfaceError, type BindingDecl } from './interface.ts';
import { EvalSiteError } from './sites.ts';

export type EvalRequest = {
  code: string;
  /** The binding interface (eval/interface.ts), derived by the checker or written by the host. */
  interface: string;
  syntax?: 'rx' | 'tsx';
  check?: 'strict' | 'lenient';
  /** A value eval: the code is one expression of this type. Absent: the code is a component body (a view). */
  type?: HostType;
};
/** A typed diagnostic. `code` is one of: PARSE, TSX (outside the TSX subset, or its refusals), UNBOUND (a name that is
 *  not a binding or the code's own declaration: ambient scope), CHECK (another pinned-checker diagnostic), READ_ONLY
 *  (a write to a binding), ASYNC_CALLBACK (issue #20), PLAN (outside plan v2), TYPE (a type error), INTERFACE (a
 *  malformed interface or option), EVAL_SITE (a malformed eval site inside the code, or `eval` used otherwise). `line` is the code's own line, when one is known. */
export type Diagnostic = { code: string; message: string; line?: number; rule?: string };
export type Compiled = { ok: true; plan: Plan; warnings: Diagnostic[] } | { ok: false; diagnostics: Diagnostic[] };

/** The error a refused evaluation throws into the reactive graph, where the nearest error boundary catches it. */
export class EvalRefused extends Error {
  readonly code = 'EVAL_REFUSED';
  readonly diagnostics: Diagnostic[];
  constructor(diagnostics: Diagnostic[]) {
    super('eval refused: ' + diagnostics.map(d => d.code + (d.line !== undefined ? ' (line ' + d.line + ')' : '') + ': ' + d.message).join('; '));
    this.name = 'EvalRefused';
    this.diagnostics = diagnostics;
  }
}

const ISSUE_20 = 'https://github.com/ryansolid/reactivescript/issues/20';
const placeholder = (t: Type): string => {
  switch (t.k) {
    case 'number': return '0';
    case 'string': return '""';
    case 'boolean': return 'false';
    case 'never': return '0';
    case 'array': return t.item.k === 'never' ? '[]' : '[' + placeholder(t.item) + ']';
    case 'record': return '{ ' + t.fields.map(([k, v]) => k + ': ' + placeholder(v)).join(', ') + ' }';
  }
};
const MODULE = { rx: 'Eval.rx', tsx: 'Eval.tsx' } as const;
const HOSTS = 'eval-hosts.d.rx';

function source(req: Required<Pick<EvalRequest, 'syntax'>> & EvalRequest, ds: BindingDecl[]): Record<string, string> {
  const hosts = ds.filter(d => d.kind === 'host') as Extract<BindingDecl, { kind: 'host' }>[];
  const files: Record<string, string> = {};
  if (hosts.length) files[HOSTS] = hosts.map(h => 'export ' + (h.pure ? 'pure ' : '') + 'fn ' + h.name + '(' + h.params.map((p, i) => 'a' + i + ': ' + p).join(', ') + '): ' + h.returns).join('\n') + '\n';
  const hostImport = hosts.length ? 'import { ' + hosts.map(h => h.name).join(', ') + ' } from "./eval-hosts"; ' : '';
  // Interior newlines would shift the code's lines: the preamble is one line.
  if (req.code.includes('\r')) throw new InterfaceError('eval code uses \\n line breaks');
  let n = 0;
  if (req.syntax === 'rx') {
    const pre = ds.flatMap(d => d.kind === 'read' || d.kind === 'store' ? ['source ' + d.name + ' := ' + placeholder(d.type) + ';']
      : d.kind === 'action' ? ['action ' + d.name + '(' + d.params.map((p, i) => 'a' + i + ': ' + p).join(', ') + ') {}'] : []);
    const head = hostImport + 'export default component Eval() { ' + pre.join(' ');
    files[MODULE.rx] = req.type ? head + ' $value = (\n' + req.code + '\n);\n}\n' : head + '\n' + req.code + '\n}\n';
  } else {
    // A scalar read is a signal (its hidden setter makes a write a READ_ONLY refusal, not an unknown name); a structured
    // one a memo, as TSX has no structured signal (createSignal of an object is refused).
    const pre = ds.flatMap(d => d.kind === 'read' ? [d.type.k === 'array' || d.type.k === 'record'
      ? 'const ' + d.name + ' = createMemo(() => ' + placeholder(d.type) + ');'
      : 'const [' + d.name + ', $evalSet' + n++ + '] = createSignal(' + placeholder(d.type) + ');']
      : d.kind === 'store' ? ['const [' + d.name + ', $evalSet' + n++ + '] = createStore(' + placeholder(d.type) + ');']
      : d.kind === 'action' ? ['const ' + d.name + ' = action(function* (' + d.params.map((p, i) => 'a' + i + ': ' + p).join(', ') + ') {});'] : []);
    // Plan v2.1's async primitives too: evaluated code is compiled with the TSX async tier (below).
    const solid = 'import { action, affects, createMemo, createOptimistic, createSignal, createStore, Errored, For, isPending, latest, Loading, refresh, Show } from "solid-js"; ';
    files[MODULE.tsx] = solid + hostImport + 'export default function Eval() { ' + pre.join(' ') +
      (req.type ? ' const $value = createMemo(() => (\n' + req.code + '\n)); return <></>;\n}\n' : '\n' + req.code + '\n}\n');
  }
  return files;
}

/** The code's line for a line of the synthetic module (the code starts on line 2). */
const own = (line: number | undefined) => line === undefined || line < 2 ? undefined : line - 1;

function classify(e: unknown): Diagnostic[] {
  if (e instanceof CheckError) return e.diagnostics.map(d => ({ code: d.code === 'UNBOUND' ? 'UNBOUND' : 'CHECK', rule: d.rule, line: own(d.line), message: d.code + ': ' + d.msg }));
  if (e instanceof TsxError) {
    const async = e.message.includes(ISSUE_20);
    return [{ code: async ? 'ASYNC_CALLBACK' : 'TSX', line: own(e.line), message: e.message.replace(/^[^:]*:\d+:\d+: /, '') }];
  }
  if (e instanceof ParseError) return [{ code: 'PARSE', message: e.message }];
  if (e instanceof InterfaceError) return [{ code: 'INTERFACE', message: e.message }];
  if (e instanceof EvalSiteError) return [{ code: 'EVAL_SITE', message: e.message.replace(/^[^:]*:\d+: /, '') }];
  const m = e instanceof Error ? e.message : String(e);
  if (m.startsWith('[{')) {
    // resolvePlanV2 refuses checker diagnostics as their JSON.
    try { return (JSON.parse(m) as { code: string; rule: string; line: number; msg: string }[]).map(d => ({ code: d.code === 'UNBOUND' ? 'UNBOUND' : 'CHECK', rule: d.rule, line: own(d.line), message: d.code + ': ' + d.msg })); } catch { /* not diagnostics */ }
  }
  if (m.startsWith('writing the read-only binding')) return [{ code: 'READ_ONLY', message: m }];
  if (m === 'a plain handler never awaits')
    return [{ code: 'ASYNC_CALLBACK', message: 'an ordinary async callback (a handler that awaits but is not an inferred action, AC-1b) is refused for now (' + ISSUE_20 + '): declare an action, or make the handler guess or write so RX infers one' }];
  return [{ code: 'PLAN', message: m }];
}

/** Compiles one evaluation. Deterministic: the same request gives the same plan or the same diagnostics. */
export function compileEval(request: EvalRequest): Compiled {
  const req = { syntax: 'rx' as const, check: 'strict' as const, ...request };
  try {
    if (req.syntax !== 'rx' && req.syntax !== 'tsx') throw new InterfaceError('syntax is "rx" or "tsx" ("yield" is deferred)');
    if (req.check !== 'strict' && req.check !== 'lenient') throw new InterfaceError('check is "strict" or "lenient"');
    if (typeof req.code !== 'string') throw new InterfaceError('eval code is a string');
    const ds = parseInterface(req.interface);
    const files = source(req, ds);
    const entry = MODULE[req.syntax];
    // Evaluated code is compiled with plan v2.1's builder and the TSX async tier (PLAN-V2.md, "v2.1: async data"; EVAL.md,
    // "Async data"): code that uses none of their forms gets its v2 plan byte for byte.
    const set = loadTsxModules(entry, p => files[p], { async: true });
    if (set.diags.length) throw new CheckError(set.diags);
    if (set.order.length !== 1 || set.order[0] !== entry) throw new Error('evaluated code is one component body: it imports nothing');
    const program = set.programs.get(entry)!;
    // The code may not close the component and declare anything beside it.
    const others = program.decls.filter(d => d.k !== 'import' && !(d.k === 'component' && d.name === 'Eval'));
    const imports = program.decls.filter(d => d.k === 'import');
    if (others.length || imports.length > 1 || imports.some(d => d.k === 'import' && d.from !== './eval-hosts'))
      throw new Error('evaluated code is one component body: it declares nothing outside it and imports nothing');
    // A write or guess to a binding is READ_ONLY whatever else the checker would say of it (a guess of a placeholder
    // source is also OPTIMISTIC_NO_QUESTION); plan/resolve-v2.ts refuses any the walk misses, from CP-6's write facts.
    const readOnly = new Set(ds.filter(d => d.kind === 'read' || d.kind === 'store').map(d => d.name));
    const written: Diagnostic[] = [];
    const walk = (x: unknown, line?: number): void => {
      if (Array.isArray(x)) { for (const y of x) walk(y, line); return; }
      if (!x || typeof x !== 'object') return;
      const o = x as { k?: string; line?: number; target?: { name: string } };
      const at = typeof o.line === 'number' ? o.line : line;
      if ((o.k === 'write' || o.k === 'optimistic') && o.target && readOnly.has(o.target.name))
        written.push({ code: 'READ_ONLY', line: own(at), message: 'writing the read-only binding ' + o.target.name + ': evaluated code writes only through an action it is passed (docs/EVAL.md)' });
      for (const v of Object.values(x)) walk(v, at);
    };
    walk(program.decls);
    if (written.length) return { ok: false, diagnostics: written };
    const checked = checkModules(set);
    if (checked.diags.length) throw new CheckError(checked.diags);
    const plan = resolvePlanV2(set, { bindings: ds, async: true });
    if (req.type) {
      const memo = plan.memos.find(m => m.name === '$value');
      if (!memo || !('value' in memo) || plan.memos.length !== 1 || plan.sources.length || plan.actions.length || plan.markup.length)
        throw new Error('a value eval is one expression');
      plan.memos = [];
      plan.value = memo.value;
    }
    const component = program.decls.find(d => d.k === 'component');
    const actionTypes = new Map((component && component.k === 'component' ? component.decls : []).flatMap(d =>
      d.k === 'action' ? [[d.name, (d.ptypes ?? []).map(t => t === 'number' || t === 'string' || t === 'boolean' ? t as HostType : undefined)] as const] : []));
    const typed = typePlan(plan, actionTypes, bindingTypes(ds));
    const types: Diagnostic[] = typed.errors.map(message => ({ code: 'TYPE', message }));
    if (req.type) {
      const t = typed.names.get('$value');
      if (t && t.kind !== 'action' && t.type.k !== req.type) types.push({ code: 'TYPE', message: 'the value is a ' + t.type.k + ', not a ' + req.type + ' (the site declares ' + req.type + ')' });
      // The site's declared type is the enclosing program's contract: a mismatch is refused in either mode.
      if (types.some(d => d.message.startsWith('the value is'))) return { ok: false, diagnostics: types };
    }
    if (types.length && req.check === 'strict') return { ok: false, diagnostics: types };
    return { ok: true, plan, warnings: types };
  } catch (e) {
    return { ok: false, diagnostics: classify(e) };
  }
}

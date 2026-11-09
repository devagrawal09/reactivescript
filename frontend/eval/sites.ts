// Eval sites (docs/EVAL.md): `eval(code, { bindings }, { options })` in RX, `createEval(() => code, { bindings }, {
// options })` in TSX (tsx/lower.ts lowers it to the same RX call). The pinned upstream checker has no eval, and the
// upstream checkout is read-only, so the frontend adapts here, before checking: each site is recorded and its call is
// replaced by its code expression, so the checker sees (and CP-6 records) the boundary's only reactive read, the code.
// The bindings are references, not reads: the plan builder resolves each against the checker's symbols
// (plan/resolve-v2.ts). A site is either a markup child (`{eval(…)}`: a view) or the whole value of a typed equation
// (`label: string = eval(…)`, TSX `const label = createEval(…, { type: "string" })`: a value). Any other use of `eval`
// is refused here.
import type { Decl, Expr, Markup, Program } from '../tsx/rx/ast.ts';
import type { HostType } from '../plan/resolve-v2.ts';

export type EvalOptions = { syntax: 'rx' | 'tsx'; check: 'strict' | 'lenient'; type?: HostType; interface?: string };
export type EvalSite = {
  mode: 'view' | 'value';
  code: Expr;
  /** Inner name (what the code says) -> outer name (a source, memo, action or host import of the component). */
  bindings: { name: string; target: string }[];
  options: EvalOptions;
  line: number;
  /** TSX only: the source offset of the createEval call (eval/inject.ts). */
  at?: number;
  /** The interface plan/resolve-v2.ts derived for the site. */
  derived?: string;
};

export class EvalSiteError extends Error {}

const sites = new WeakMap<Program, Map<object, EvalSite>>();
/** The eval sites of a loaded program, keyed by the replaced Markup node (views) or eq Decl (values). */
export const evalSitesOf = (p: Program): Map<object, EvalSite> => sites.get(p) ?? new Map();

const isEval = (e: Expr | undefined): e is Extract<Expr, { k: 'call' }> => e?.k === 'call' && e.f.k === 'id' && e.f.name === 'eval';
const OPTIONS = new Set(['syntax', 'check', 'type', 'interface', 'preserve', 'place']);

function site(call: Extract<Expr, { k: 'call' }>, mode: 'view' | 'value', file: string, line: number, declared?: string): EvalSite {
  const where = file + ':' + line + ': ';
  const fail = (m: string): never => { throw new EvalSiteError(where + m); };
  if (call.args.length < 2 || call.args.length > 3) fail('eval takes (code, { bindings }) and optional { options }');
  const [code, bound, opts] = call.args;
  if (bound.k !== 'rec') return fail('eval\'s bindings are an object literal of names: { count, claim: onClaim }');
  const bindings: EvalSite['bindings'] = [];
  for (const f of bound.fields) {
    if (!('key' in f)) return fail('eval\'s bindings take no spreads: name each binding');
    if (f.v.k !== 'id') return fail('binding ' + f.key + ' is a name in scope (a source, memo, action or host function), not an expression');
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(f.key)) fail('binding names are identifiers without `$`: ' + f.key);
    if (bindings.some(b => b.name === f.key)) fail('binding ' + f.key + ' twice');
    bindings.push({ name: f.key, target: f.v.name });
  }
  const options: EvalOptions = { syntax: 'rx', check: 'strict' };
  if (opts) {
    if (opts.k !== 'rec') return fail('eval\'s options are an object literal');
    for (const f of opts.fields) {
      if (!('key' in f) || !OPTIONS.has(f.key)) return fail('eval options are syntax, check, type, interface, preserve and place');
      const v = f.v.k === 'lit' ? f.v.v : undefined;
      if (f.key === 'preserve') {
        if (v !== false) fail('preserve (keeping the evaluated state across code changes) is deferred: docs/EVAL.md');
      } else if (f.key === 'place') fail('place (server placement) is deferred: docs/EVAL.md');
      else if (f.key === 'syntax') { if (v !== 'rx' && v !== 'tsx') fail('syntax is "rx" or "tsx" ("yield" is deferred)'); options.syntax = v as 'rx' | 'tsx'; }
      else if (f.key === 'check') { if (v !== 'strict' && v !== 'lenient') fail('check is "strict" or "lenient"'); options.check = v as 'strict' | 'lenient'; }
      else if (f.key === 'type') { if (v !== 'number' && v !== 'string' && v !== 'boolean') fail('type is "number", "string" or "boolean"'); options.type = v as HostType; }
      else if (f.key === 'interface') { if (typeof v !== 'string') fail('interface is a string literal'); options.interface = v as string; }
    }
  }
  if (mode === 'view' && options.type) fail('a markup eval renders the code\'s view; type is for a value eval');
  if (mode === 'value') {
    if (declared !== undefined && !['number', 'string', 'boolean'].includes(declared)) fail('a value eval is typed number, string or boolean, not ' + declared);
    if (declared !== undefined && options.type !== undefined && declared !== options.type) fail('the equation\'s type ' + declared + ' and eval\'s type ' + options.type + ' differ');
    options.type ??= declared as HostType | undefined;
    if (!options.type) fail('a value eval declares its type: `x: number = eval(…)`, or { type: "number" }');
  }
  const at = (call as { evalAt?: number }).evalAt;
  return { mode, code, bindings, options, line, ...(at !== undefined ? { at } : {}) };
}

/** Records and replaces the eval sites of every component of a program (in place). Throws EvalSiteError on an eval
 *  anywhere else, and on a malformed site. */
export function extractEvalSites(program: Program, file: string): void {
  const found = new Map<object, EvalSite>();
  const markup = (ms: Markup[], fallback: number) => {
    for (const m of ms) {
      const line = m.line ?? fallback;
      if (m.k === 'read' && isEval(m.e)) {
        const s = site(m.e, 'view', file, line);
        m.e = s.code;
        found.set(m, s);
      } else if (m.k === 'el') markup(m.children, line);
      else if (m.k === 'mif') { markup(m.t, line); markup(m.f, line); }
      else if (m.k === 'mfor') markup(m.body, line);
      else if (m.k === 'loading' || m.k === 'errored' || m.k === 'portal') markup(m.body, line);
    }
  };
  for (const d of program.decls) {
    if (d.k !== 'component') continue;
    for (const x of d.decls) {
      if (x.k === 'eq' && isEval(x.e)) {
        const s = site(x.e, 'value', file, x.line, x.type);
        x.e = s.code;
        found.set(x, s);
      }
    }
    markup(d.view, d.line);
  }
  // Anything still naming eval is a use outside the two site forms.
  const scan = (x: unknown, line: number): void => {
    if (Array.isArray(x)) { for (const y of x) scan(y, line); return; }
    if (!x || typeof x !== 'object') return;
    const o = x as { k?: string; name?: string; line?: number };
    const at = typeof o.line === 'number' ? o.line : line;
    if (o.k === 'id' && o.name === 'eval')
      throw new EvalSiteError(file + ':' + at + ': eval(code, bindings) is a markup child or the whole value of a typed equation (docs/EVAL.md)');
    for (const v of Object.values(x)) scan(v, at);
  };
  scan(program.decls as Decl[], 1);
  if (found.size) sites.set(program, found);
}

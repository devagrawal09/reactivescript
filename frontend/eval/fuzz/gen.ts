// The eval fuzz generator (docs/EVAL.md, "Eval fuzz"), derived from the plan fuzz: each seed takes the plan fuzz's
// program (plan/fuzz/gen.ts `generate`) and splits it into an enclosing component and evaluated code. In `whole` mode
// the code is the whole component body. In `split` mode the code is some of the section's children (those whose
// handlers only call actions) and the declarations nothing else uses; the enclosing component keeps the rest of the
// markup (with the eval site where the code was) and the other declarations, and binds what the code uses of them:
// values and stores read-only, actions to call, hosts to await. The code is written in RX or TSX syntax. Four files
// come out:
//
//   App.rx      the enclosing component with `{eval(CODE, { … })}`;
//   App.tsx     its TSX twin with `{createEval(() => CODE, { … })}` (the same plan);
//   Static.tsx  the static twin: the code as a native component `Inner` in the enclosing component, rendered by the
//               keyed Show createEval is specified as;
//   api.d.rx    the hosts.
//
// Closed: nothing of the enclosing component reads, writes or calls a name of the code, and the code writes only its
// own sources (anything else only through bound actions). The scenario is the plan fuzz's chooser on the static twin.
import { rng } from '../../tsx/fuzz/gen.ts';
import { generate, jsValue, pe, ps, pv, setter, TS_TYPE, type Case, type Decl, type E, type Pr, type S, type V } from '../../plan/fuzz/gen.ts';

export type EvalCase = {
  seed: number; base: Case;
  mode: 'whole' | 'split'; syntax: 'rx' | 'tsx';
  /** The code is a signal a `reload` button empties and restores. */
  reload: boolean;
  /** The enclosing component's declarations (names), in declaration order. */
  outer: string[];
  /** The binding object: names of enclosing declarations and hosts the code uses. */
  bindings: string[];
  code: string;
  files: Record<string, string>;
};

const declName = (d: Decl) => d.name;
type Uses = { reads: Set<string>; writes: Set<string>; calls: Set<string>; hosts: Set<string> };
const empty = (): Uses => ({ reads: new Set(), writes: new Set(), calls: new Set(), hosts: new Set() });
function exprUses(e: E, u: Uses): void {
  switch (e.k) {
    case 'src': case 'store': u.reads.add(e.name); return;
    case 'get': exprUses(e.o, u); return;
    case 'len': exprUses(e.a, u); return;
    case 'filter': case 'map': case 'find': exprUses(e.a, u); exprUses(e.body, u); return;
    case 'bin': exprUses(e.l, u); exprUses(e.r, u); return;
    case 'not': exprUses(e.e, u); return;
    case 'cond': exprUses(e.c, u); exprUses(e.t, u); exprUses(e.f, u); return;
    case 'rec': for (const [, v] of e.fields) exprUses(v, u); return;
    default: return;
  }
}
function stepUses(s: S, u: Uses): void {
  if (s.k === 'set') { u.writes.add(s.name); exprUses(s.e, u); }
  else if (s.k === 'path') { u.writes.add(s.store); for (const p of s.path) if ('index' in p) exprUses(p.index, u); exprUses(s.e, u); }
  else if (s.k === 'guess') { u.writes.add(s.name); if (s.body) exprUses(s.body, u); if (s.value) exprUses(s.value, u); }
  else if (s.k === 'await') { u.hosts.add(s.host); s.args.forEach(a => exprUses(a, u)); }
  else if (s.k === 'try') { s.body.forEach(x => stepUses(x, u)); s.handler.forEach(x => stepUses(x, u)); }
  else if (s.k === 'call') { u.calls.add(s.action); s.args.forEach(a => exprUses(a, u)); }
}
function viewUses(v: V, u: Uses): void {
  if (v.k === 'el') { v.click?.forEach(s => stepUses(s, u)); v.kids.forEach(k => viewUses(k, u)); }
  else if (v.k === 'hole') exprUses(v.e, u);
  else if (v.k === 'show') { exprUses(v.c, u); v.then.forEach(k => viewUses(k, u)); v.else.forEach(k => viewUses(k, u)); }
  else if (v.k === 'for') { exprUses(v.each, u); v.body.forEach(k => viewUses(k, u)); }
}
function declUses(d: Decl): Uses {
  const u = empty();
  if (d.k === 'optimistic' || d.k === 'memo') exprUses(d.e, u);
  else if (d.k === 'action') d.body.forEach(s => stepUses(s, u));
  return u;
}

/** An RX string literal: a backslash escapes the next character, and line breaks are kept. */
export const rxString = (s: string) => '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';

function tsxDecl(d: Decl, c: Case, indent: string): string[] {
  const tsx: Pr = { tsx: true };
  if (d.k === 'signal') return [indent + 'const [' + d.name + ', ' + setter(d.name) + '] = createSignal(' + jsValue(d.v) + ');'];
  if (d.k === 'store') return [indent + 'const [' + d.name + ', ' + setter(d.name) + '] = createStore(' + jsValue(d.v) + ');'];
  if (d.k === 'optimistic') return [indent + 'const [' + d.name + ', ' + setter(d.name) + '] = createOptimistic(() => ' + pe(d.e, tsx) + ');'];
  if (d.k === 'memo') return [indent + 'const ' + d.name + ' = createMemo(() => ' + pe(d.e, tsx) + ');'];
  // A named generator: the native legs name an action by it (plan/fuzz/solid-native.ts).
  return [indent + 'const ' + d.name + ' = action(function* ' + d.name + '(' + d.params.map(([p, ty]) => p + ': ' + TS_TYPE[ty]).join(', ') + ') {', ...d.body.flatMap(s => ps(s, tsx, c.hosts, indent + '  ')), indent + '});'];
}
function rxDecl(d: Decl, c: Case, indent: string): string[] {
  const rx: Pr = { tsx: false };
  if (d.k === 'signal' || d.k === 'store') return [indent + 'source ' + d.name + ' := ' + jsValue(d.v) + ';'];
  if (d.k === 'optimistic') return [indent + 'source ' + d.name + ' = ' + pe(d.e, rx) + ';'];
  if (d.k === 'memo') return [indent + d.name + ' = ' + pe(d.e, rx) + ';'];
  return [indent + 'action ' + d.name + '(' + d.params.map(([p, ty]) => p + ': ' + TS_TYPE[ty]).join(', ') + ') {', ...d.body.flatMap(s => ps(s, rx, c.hosts, indent + '  ')), indent + '}'];
}
const primitives = (ds: Decl[], extra: string[] = []) => [...new Set([...ds.map(d => d.k === 'signal' ? 'createSignal' : d.k === 'store' ? 'createStore' : d.k === 'optimistic' ? 'createOptimistic' : d.k === 'memo' ? 'createMemo' : 'action'), ...extra])].sort();

/** Plain writes in a view's handlers (calls are allowed in a code child: the code calls bound actions). */
const writesIn = (v: V): boolean => { const u = empty(); viewUses(v, u); return u.writes.size > 0; };

export function generateEval(seed: number): EvalCase {
  const base = generate(seed);
  const r = rng(seed * 104729 + 3);
  const syntax: 'rx' | 'tsx' = r.chance(0.5) ? 'rx' : 'tsx';
  const mode: 'whole' | 'split' = r.chance(0.25) ? 'whole' : 'split';
  const decls = base.decls;
  const section = base.view;
  if (section.k !== 'el') throw new Error('the plan fuzz view is a section element');
  // The code's markup: every child (whole), or a random set of the section's children whose handlers only call
  // (split); the enclosing component keeps the rest, with the eval site's element where the first code child was.
  const kids = section.kids;
  let chosen = mode === 'whole' ? kids.map((_, i) => i) : kids.flatMap((k, i) => !writesIn(k) && r.chance(0.5) ? [i] : []);
  if (!chosen.length) { const eligible = kids.flatMap((k, i) => writesIn(k) ? [] : [i]); chosen = [eligible[r.int(eligible.length)]]; }
  // The outside family's one form (a `<q>` hole) is in the code, so the code is what is refused.
  const q = kids.findIndex(k => k.k === 'el' && k.tag === 'q');
  if (q >= 0 && !chosen.includes(q)) chosen = [...chosen, q].sort((a, b) => a - b);
  const codeKids = chosen.map(i => kids[i]), outerKids = kids.filter((_, i) => !chosen.includes(i));
  const at = chosen[0] - kids.slice(0, chosen[0]).filter((_, i) => chosen.includes(i)).length;
  const uses = new Map(decls.map(d => [declName(d), declUses(d)]));
  // The code's declarations: those nothing of the enclosing component uses. Start from all (whole: keep all), move a
  // random few out (split), then close: a declaration the enclosing component reads, writes or calls is the
  // enclosing component's, and so is an action of the code that writes one of its sources.
  const inner = new Set(decls.filter(() => mode === 'whole' || r.chance(0.7)).map(declName));
  const outerMarkup = empty();
  for (const k of outerKids) viewUses(k, outerMarkup);
  for (let changed = true; changed;) {
    changed = false;
    const outerUse = empty();
    for (const k of ['reads', 'writes', 'calls'] as const) for (const x of outerMarkup[k]) outerUse[k].add(x);
    for (const d of decls) if (!inner.has(declName(d))) { const u = uses.get(declName(d))!; for (const k of ['reads', 'writes', 'calls'] as const) for (const x of u[k]) outerUse[k].add(x); }
    for (const d of decls) {
      const n = declName(d);
      if (!inner.has(n)) continue;
      const u = uses.get(n)!;
      if (outerUse.reads.has(n) || outerUse.writes.has(n) || outerUse.calls.has(n) || [...u.writes].some(w => !inner.has(w))) { inner.delete(n); changed = true; }
    }
  }
  const outerDecls = decls.filter(d => !inner.has(declName(d))), innerDecls = decls.filter(d => inner.has(declName(d)));
  const innerUses = empty();
  for (const k of codeKids) viewUses(k, innerUses);
  for (const d of innerDecls) { const u = uses.get(declName(d))!; for (const k of ['reads', 'writes', 'calls', 'hosts'] as const) for (const x of u[k]) innerUses[k].add(x); }
  if ([...innerUses.writes].some(w => !inner.has(w))) throw new Error('eval fuzz: the code writes an enclosing name (generator bug)');
  // Bindings, in declaration order then host order: what the code reads or calls of the enclosing component, and the
  // hosts its own actions await.
  const bindings = [...outerDecls.map(declName).filter(n => innerUses.reads.has(n) || innerUses.calls.has(n)), ...base.hosts.map(h => h.name).filter(h => innerUses.hosts.has(h))];
  const tsx: Pr = { tsx: true }, rx: Pr = { tsx: false };
  const view = (vs: V[], c: Pr) => vs.map(k => pv(k, c, base.hosts)).join('');
  const code = syntax === 'rx'
    ? [...innerDecls.flatMap(d => rxDecl(d, base, '')), view(codeKids, rx)].join('\n')
    : [...innerDecls.flatMap(d => tsxDecl(d, base, '')), 'return (' + (codeKids.length === 1 ? view(codeKids, tsx) : '<>' + view(codeKids, tsx) + '</>') + ');'].join('\n');
  const opts = syntax === 'tsx' ? ', { syntax: "tsx" }' : '';
  // Half the programs hold the code in a signal and add a `reload` button that switches it to the empty string and
  // back: the evaluated subtree is disposed (pending requests and all) and created fresh, its own state reset.
  const reload = r.chance(0.5);
  const codeRx = reload ? 'evalCode' : rxString(code), codeTsx = reload ? 'evalCode()' : JSON.stringify(code);
  const reloadRx = reload ? ['  source evalCode := ' + rxString(code) + ';'] : [];
  const reloadTsx = reload ? ['  const [evalCode, setEvalCode] = createSignal(' + JSON.stringify(code) + ');'] : [];
  const reloadButton = (c: Pr) => !reload ? '' : c.tsx
    ? '<button onClick={() => setEvalCode(evalCode() === "" ? ' + JSON.stringify(code) + ' : "")}>reload</button>'
    : '<button onClick={() => { evalCode := evalCode == "" ? ' + rxString(code) + ' : "" }}>reload</button>';
  const bindingObject = '{ ' + bindings.join(', ') + ' }';
  const hostImport = base.hosts.length ? 'import { ' + base.hosts.map(h => h.name).join(', ') + ' } from "./api";' : '';
  const outerSection = (c: Pr, site: string) => '<section>' + view(outerKids.slice(0, at), c) + '<div>' + site + '</div>' + view(outerKids.slice(at), c) + reloadButton(c) + '</section>';
  const appRx = [...(hostImport ? [hostImport, ''] : []), 'export default component App() {', ...reloadRx, ...outerDecls.flatMap(d => rxDecl(d, base, '  ')), '',
    '  ' + outerSection(rx, '{eval(' + codeRx + ', ' + bindingObject + opts + ')}'), '}', ''].join('\n');
  const solidImport = (names: string[]) => names.length ? ['import { ' + names.join(', ') + ' } from "solid-js";'] : [];
  const has = (vs: V[], k: string) => JSON.stringify(vs).includes('"k":"' + k + '"');
  const appTsx = [...solidImport(primitives(outerDecls, [...(has(outerKids, 'for') ? ['For'] : []), ...(has(outerKids, 'show') ? ['Show'] : []), ...(reload ? ['createSignal'] : [])])),
    'import { createEval } from "reactivescript-tsx/eval";', ...(hostImport ? [hostImport] : []), '',
    'export default function App() {', ...reloadTsx, ...outerDecls.flatMap(d => tsxDecl(d, base, '  ')),
    '  return (' + outerSection(tsx, '{createEval(() => ' + codeTsx + ', ' + bindingObject + opts + ')}') + ');', '}', ''].join('\n');
  const staticTsx = [...solidImport(primitives(decls, ['Show', ...(has(kids, 'for') ? ['For'] : []), ...(reload ? ['createSignal'] : [])])), ...(hostImport ? [hostImport] : []), '',
    'function evalTwin(code: () => string, pick: (code: string) => any) {', '  return <Show when={code()} keyed>{(code: string) => pick(code)}</Show>;', '}', '',
    'export default function App() {', ...reloadTsx, ...outerDecls.flatMap(d => tsxDecl(d, base, '  ')),
    '  function Inner() {', ...innerDecls.flatMap(d => tsxDecl(d, base, '    ')),
    '    return (' + (codeKids.length === 1 ? view(codeKids, tsx) : '<>' + view(codeKids, tsx) + '</>') + ');', '  }',
    '  return (' + outerSection(tsx, '{evalTwin(() => ' + codeTsx + ', () => <Inner />)}') + ');', '}', ''].join('\n');
  const api = base.hosts.map(h => 'export fn ' + h.name + '(' + h.params.map((p, i) => 'a' + i + ': ' + TS_TYPE[p]).join(', ') + '): ' + TS_TYPE[h.returns]).join('\n') + '\n';
  return { seed, base, mode, syntax, reload, outer: outerDecls.map(declName), bindings, code, files: { 'App.rx': appRx, 'App.tsx': appTsx, 'Static.tsx': staticTsx, 'api.d.rx': api } };
}

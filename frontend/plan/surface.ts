// The upstream RX surface added between ReactiveScript fdbcad92 and e650b85 that the plan builders do not port
// (docs/PIN-MAIN-FRONTEND.md, "Refused"). Each form is refused by name, before a builder reads the program, so it is
// never lowered by accident onto a plan node with another meaning. The forms that are pure parse-level sugar (an
// `else if`, a destructuring declaration or `let` over a name or a path without defaults or rest) give the AST of
// their hand-written expansion and are not refused: plan/plan.test.ts checks their plans byte for byte.
//
// The guess forms (07 decision 21, upstream d3cab00: a guess on a writable signal or store, a guessed source also
// written plainly) need the checker's write facts and are refused in the builders (resolve-v2.ts, resolve-frames.ts).
import type { ModuleSet } from '../tsx/rx/compiler.ts';

/** A destructuring of a value that is not a name or a path binds it to a `$$n` equation first (upstream parse.ts
 *  parseDestructuringDecl, RG-4b). */
const TEMPORARY = /^\$\$\d+$/;

export function refuseNewSurface(set: ModuleSet, what: string): void {
  const fail = (form: string): never => { throw new Error(form + ' is outside ' + what); };
  const walk = (x: unknown): void => {
    if (Array.isArray(x)) { for (const y of x) walk(y); return; }
    if (!x || typeof x !== 'object') return;
    const o = x as Record<string, unknown>;
    // 07 §5 (RG-4b): an object rest, `{ a, ...rest } = e`, is Solid's omit(e, "a").
    if (o.k === 'omit') fail('an object rest (`{ a, ...rest } = e`, Solid\'s omit; RG-4b)');
    if ((o.k === 'eq' || o.k === 'let') && typeof o.name === 'string' && TEMPORARY.test(o.name))
      fail('a destructuring of a value that is not a name or a path (its `' + o.name + '` temporary; RG-4b)');
    // 07 §4: a spread attribute `{...e}` (attrs name "...").
    if (Array.isArray(o.attrs) && o.attrs.some(a => (a as { name?: string })?.name === '...')) fail('a spread attribute (`{...e}`, 07 §4)');
    for (const v of Object.values(o)) walk(v);
  };
  for (const file of set.order) walk(set.programs.get(file)?.decls);
  // MO-10: an imported .d.rx function with `ref` parameters or `instantiates` (a Solid library declared like .rx).
  for (const file of set.order)
    for (const imp of set.programs.get(file)?.decls ?? []) {
      if (imp.k !== 'import' || !imp.declared) continue;
      const decls = set.declarations?.get(imp.declared) ?? [];
      for (const n of imp.names) {
        const d = decls.find(d => d.name === n.name);
        if (d?.kind === 'fn' && (d.instantiates || d.refs?.some(Boolean)))
          fail('a .d.rx library declaration (`ref` parameters or `instantiates`, MO-10): ' + d.name);
      }
    }
}

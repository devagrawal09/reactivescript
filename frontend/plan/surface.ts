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

/** The fields each AST kind may carry at the pinned ReactiveScript (`ref/src/ast.ts` at e650b85), besides `k` and
 *  `line`. A kind or field missing here is newer upstream surface (error arms, `as`, computed keys, …): it is refused
 *  by name rather than read as a node it only resembles. Moving the pin means re-reading ast.ts into this table. */
const FIELDS: Record<string, string> = {
  // Expr
  lit: 'v', id: 'name', bin: 'op l r', un: 'op e', pre: 'name init', peek: 'e', await: 'e init stream', latest: 'e',
  pending: 'e', if: 'c t f', tpl: 'parts', member: 'o p opt', index: 'o i opt', call: 'f args', arr: 'items',
  rec: 'fields', draft: 'seed body', use: 'name', spread: 'e', omit: 'e keys', throw: 'e',
  catch: 'e name classes alt', stylemap: 'css', serverfn: 'params ptypes ret body',
  fn: 'params body stmts name decls tail ret exported',                          // Expr and Decl
  // Stmt
  write: 'target e', let: 'name e type', expr: 'e', optimistic: 'target e', refresh: 'name', affects: 'name',
  sif: 'c t f', return: 'e', try: 'body catchName catchClasses handler fin',
  action: 'body name params ptypes exported',                                    // Stmt and Decl
  // Decl
  source: 'name init question type exported key', eq: 'name e deferred key type exported',
  import: 'names from pure side fails resolved declared declaredErrors declaredPure declaredSide',
  error: 'name params ptypes msg exported', typedecl: 'name text exported', effect: 'inputs body',
  component: 'name props decls view propsType noProps exported isDefault',
  server: 'name params ptypes ret body exported', provide: 'name e', context: 'name type source dflt exported',
  // Markup
  el: 'tag attrs children', read: 'e', text: 's', style: 'css', mif: 'c t tDecls f fDecls', mfor: 'name xs decls body',
  loading: 'on fallback decls body', errored: 'fallback decls body errName classes', portal: 'to decls body',
};
/** Objects without a `k`: a record field, an attribute, a write target, an import name, a parameter. */
const SHAPES = ['key v', 'spread', 'name e', 'name path ctx', 'name alias', 'name ref type'];
const fits = (keys: string[], allowed: string) => keys.every(key => allowed.split(' ').includes(key));

export function refuseNewSurface(set: ModuleSet, what: string): void {
  const fail = (form: string): never => { throw new Error(form + ' is outside ' + what); };
  const walk = (x: unknown): void => {
    if (Array.isArray(x)) { for (const y of x) walk(y); return; }
    if (!x || typeof x !== 'object') return;
    const o = x as Record<string, unknown>;
    const keys = Object.keys(o).filter(key => o[key] !== undefined && key !== 'k' && key !== 'line');
    if (typeof o.k === 'string') {
      if (!(o.k in FIELDS)) fail('`' + o.k + '` (RX surface newer than the pinned ReactiveScript)');
      const extra = keys.filter(key => !FIELDS[o.k as string].split(' ').includes(key));
      if (extra.length) fail('`' + extra.join('`, `') + '` on `' + o.k + '` (RX surface newer than the pinned ReactiveScript)');
      if (o.k === 'import') { walk(o.names); return; }   // the loader's facts (declaredSide, …) are not syntax
    } else if (!('k' in o) && !SHAPES.some(shape => fits(keys, shape)))
      fail('a node with `' + keys.join('`, `') + '` (RX surface newer than the pinned ReactiveScript)');
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

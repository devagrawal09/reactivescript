// R-1 / 07 §3 ("`await` may appear anywhere in an expression; the compiler lifts each one to its own flight"): the awaits of an
// equation that are not its result, each with the conditions under which the equation reaches it (E-11: an arm not selected is
// not demanded, so its flight is not asked). The oracle and the compiler hoist each into its own async node, asked only while
// its guards hold; the equation reads that node where the `await` was.
import type { Expr, Markup } from "./ast.ts";

export type Guard = { e: Expr; neg?: boolean; nullish?: boolean };
export type Hoisted = { node: Extract<Expr, { k: "await" }>; guards: Guard[] };

/** `tail = false`: every await of `root` — a reader of a view, an effect's input or a provision, whose expression is not an
 *  equation's own memo, so even its result-position `await` is a flight of its own (07 §3). */
export function nonTailAwaits(root: Expr, tail = true): Hoisted[] {
  const out: Hoisted[] = [];
  const walk = (x: Expr, tail: boolean, g: Guard[]): void => {
    switch (x.k) {
      case "await": if (!tail) out.push({ node: x, guards: g }); walk(x.e, false, g); if (x.init) walk(x.init, false, g); return;
      case "if": walk(x.c, false, g); walk(x.t, tail, [...g, { e: x.c }]); walk(x.f, tail, [...g, { e: x.c, neg: true }]); return;
      case "bin":
        walk(x.l, false, g);
        if (x.op === "&&") walk(x.r, false, [...g, { e: x.l }]);
        else if (x.op === "||") walk(x.r, false, [...g, { e: x.l, neg: true }]);
        else if (x.op === "??") walk(x.r, false, [...g, { e: x.l, nullish: true }]);
        else walk(x.r, false, g);
        return;
      case "catch": walk(x.e, tail, g); walk(x.alt, false, g); return;
      case "fn": case "draft": return;                                  // a closure's body runs later; a draft's statements are its own
      default:
        for (const v of Object.values(x as object)) {
          if (Array.isArray(v)) v.forEach(y => { if (y && typeof y === "object") { if ("k" in y) walk(y as Expr, false, g); else if ("v" in y) walk((y as { v: Expr }).v, false, g); else if ("spread" in y) walk((y as { spread: Expr }).spread, false, g); } });
          else if (v && typeof v === "object" && "k" in (v as object)) walk(v as Expr, false, g);
        }
    }
  };
  walk(root, tail, []);
  return out;
}

/** 07 §3: the expressions a region's own view reads — readers, attributes (not handlers), `if` conditions, `for` collections,
 *  `loading on(…)` and fallbacks, `portal to(…)` — but not its sub-regions', which are hoisted where they are set up. Their
 *  awaits are hoisted with `nonTailAwaits(e, false)`. An `errored` fallback binds its error, so it stays out. */
export function viewReaders(ms: Markup[]): Expr[] {
  return ms.flatMap((m): Expr[] => {
    switch (m.k) {
      case "read": return [m.e];
      case "el": return [...m.attrs.filter(a => !/^on[A-Z:]/.test(a.name)).map(a => a.e), ...viewReaders(m.children)];
      case "mif": return [m.c];
      case "mfor": return [m.xs];
      case "loading": return [...(m.on ? [m.on] : []), ...viewReaders(m.fallback)];
      case "portal": return m.to ? [m.to] : [];
      default: return [];
    }
  });
}

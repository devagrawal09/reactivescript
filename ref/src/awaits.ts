// R-1 / 07 §3 ("`await` may appear anywhere in an expression; the compiler lifts each one to its own flight"): the awaits of an
// equation that are not its result, each with the conditions under which the equation reaches it (E-11: an arm not selected is
// not demanded, so its flight is not asked). The oracle and the compiler hoist each into its own async node, asked only while
// its guards hold; the equation reads that node where the `await` was.
import type { Expr } from "./ast.ts";

export type Guard = { e: Expr; neg?: boolean; nullish?: boolean };
export type Hoisted = { node: Extract<Expr, { k: "await" }>; guards: Guard[] };

export function nonTailAwaits(root: Expr): Hoisted[] {
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
  walk(root, true, []);
  return out;
}

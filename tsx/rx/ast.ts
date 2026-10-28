// The upstream AST types the lowering constructs. Ordinary expression/statement nodes are built inline by lower.ts;
// the forms whose upstream representation has moved recently (module entry, components, server functions, actions,
// imports, error classes) are constructed only through the helpers below so a representation change lands here.
import type { Decl, Expr, Markup, Program, Stmt, Param } from "#rx/src/ast.ts";
export type { Decl, Expr, Markup, Program, Stmt, Param };

/** 12 SF-1: one `server` declaration. The authored TSX distinction between serverFunction (a loader) and serverAction
 *  is frontend bookkeeping only; upstream infers whether the body is io and refuses io in reactive scope itself. */
export function serverDecl(name: string, params: string[], body: Stmt[], line: number): Decl {
  return { k: "server", name, params, body, line };
}

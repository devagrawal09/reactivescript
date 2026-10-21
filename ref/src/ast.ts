// Abstract syntax for the reference interpreter (spec/02-core.md §1).
// Operators are spelled as in JS; this is a spelling, not surface syntax.

export type Expr =
  | { k: "lit"; v: unknown }
  | { k: "id"; name: string }
  | { k: "bin"; op: string; l: Expr; r: Expr }
  | { k: "un"; op: string; e: Expr }
  | { k: "pre"; name: string; init?: Expr }
  | { k: "peek"; e: Expr }
  | { k: "if"; c: Expr; t: Expr; f: Expr }
  | { k: "member"; o: Expr; p: string }
  | { k: "index"; o: Expr; i: Expr }
  | { k: "call"; f: Expr; args: Expr[] }
  | { k: "arr"; items: Expr[] }
  | { k: "rec"; fields: { key: string; v: Expr }[] }
  | { k: "fn"; params: string[]; body: Expr };

export type Target = { name: string; path: (string | Expr)[] };

export type Stmt =
  | { k: "write"; target: Target; e: Expr }
  | { k: "let"; name: string; e: Expr }
  | { k: "expr"; e: Expr };

export type Decl =
  | { k: "source"; name: string; init: Expr; line: number }
  | { k: "eq"; name: string; e: Expr; line: number }
  | { k: "effect"; inputs: Expr[]; body: Stmt[]; line: number }
  | { k: "view"; m: Markup[]; line: number };

export type Markup =
  | { k: "el"; tag: string; attrs: { name: string; e: Expr }[]; children: Markup[] }
  | { k: "read"; e: Expr }
  | { k: "text"; s: string }
  | { k: "mif"; c: Expr; t: Markup[]; f: Markup[] }
  | { k: "mfor"; name: string; xs: Expr; decls: Decl[]; body: Markup[] };

export type Program = { decls: Decl[] };

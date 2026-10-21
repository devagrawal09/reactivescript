// Abstract syntax for the reference interpreter (spec/02-core.md §1).
// Operators are spelled as in JS; this is a spelling, not surface syntax.

export type Expr =
  | { k: "lit"; v: unknown }
  | { k: "id"; name: string }
  | { k: "bin"; op: string; l: Expr; r: Expr }
  | { k: "un"; op: string; e: Expr }
  | { k: "pre"; name: string; init?: Expr }
  | { k: "peek"; e: Expr }
  | { k: "await"; e: Expr; init?: Expr }                       // R-1, R-7
  | { k: "latest"; e: Expr }                                   // R-9 probe
  | { k: "pending"; e: Expr }                                  // R-9 probe (`pending? e`)
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

export type Param = { name: string; ref: boolean };            // E-9
export type Decl =
  | { k: "source"; name: string; init: Expr; line: number }
  | { k: "eq"; name: string; e: Expr; line: number }
  | { k: "effect"; inputs: Expr[]; body: Stmt[]; line: number }
  | { k: "fn"; name: string; params: Param[]; decls: Decl[]; tail: Expr; line: number }       // body: decls then a value
  | { k: "component"; name: string; props: string; decls: Decl[]; view: Markup[]; line: number }; // body: decls then a view

export type Markup =
  | { k: "el"; tag: string; attrs: { name: string; e: Expr }[]; children: Markup[] }
  | { k: "read"; e: Expr }
  | { k: "text"; s: string }
  | { k: "mif"; c: Expr; t: Markup[]; tDecls: Decl[]; f: Markup[]; fDecls: Decl[] }
  | { k: "mfor"; name: string; xs: Expr; decls: Decl[]; body: Markup[] }
  | { k: "loading"; on?: Expr; fallback: Markup[]; decls: Decl[]; body: Markup[] }    // H-5/H-6
  | { k: "errored"; fallback: Markup[]; decls: Decl[]; body: Markup[] };               // H-12

export type Program = { decls: Decl[]; view: Markup[] };   // a reactive block: declarations, then its view

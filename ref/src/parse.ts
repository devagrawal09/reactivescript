// Hand-rolled scanner/parser for the abstract syntax (spec/02-core.md §1).
import type { Decl, Expr, Markup, Program, Stmt, Target } from "./ast.ts";

export class ParseError extends Error {}

class Cursor {
  i = 0;
  src: string;
  constructor(src: string) { this.src = src; }
  get line() { return this.src.slice(0, this.i).split("\n").length; }
  eof() { return this.i >= this.src.length; }
  peek(n = 0) { return this.src[this.i + n] ?? ""; }
  ws(newlines = true) {
    for (;;) {
      const c = this.peek();
      if (c === " " || c === "\t" || c === "\r" || (newlines && c === "\n")) this.i++;
      else if (c === "/" && this.peek(1) === "/") { while (!this.eof() && this.peek() !== "\n") this.i++; }
      else break;
    }
  }
  startsWith(s: string) { return this.src.startsWith(s, this.i); }
  eat(s: string) { if (this.startsWith(s)) { this.i += s.length; return true; } return false; }
  expect(s: string) { if (!this.eat(s)) this.fail(`expected '${s}'`); }
  fail(msg: string): never { throw new ParseError(`line ${this.line}: ${msg} near '${this.src.slice(this.i, this.i + 20)}'`); }
  ident(): string | null {
    const m = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(this.src.slice(this.i));
    if (!m) return null;
    this.i += m[0].length;
    return m[0];
  }
  peekIdent(): string | null {
    const m = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(this.src.slice(this.i));
    return m ? m[0] : null;
  }
  keyword(k: string) {
    const save = this.i;
    if (this.ident() === k && !/[A-Za-z0-9_$]/.test(this.peek())) return true;
    this.i = save; return false;
  }
}

const KEYWORDS = new Set(["source", "effect", "view", "if", "then", "else", "pre", "peek", "fn", "let", "for", "in", "true", "false", "undefined", "null"]);

export function parseProgram(src: string): Program {
  const c = new Cursor(src);
  const decls: Decl[] = [];
  c.ws();
  while (!c.eof()) {
    decls.push(parseDecl(c));
    c.ws();
    c.eat(";");
    c.ws();
  }
  return { decls };
}

function parseDecl(c: Cursor): Decl {
  c.ws();
  const line = c.line;
  if (c.keyword("source")) {
    c.ws(); const name = c.ident() ?? c.fail("source name"); c.ws(); c.expect("="); c.ws();
    return { k: "source", name, init: parseExpr(c), line };
  }
  if (c.keyword("effect")) {
    c.ws(); c.expect("("); c.ws();
    const inputs: Expr[] = [];
    while (!c.startsWith(")")) { inputs.push(parseExpr(c)); c.ws(); if (!c.eat(",")) break; c.ws(); }
    c.expect(")"); c.ws();
    return { k: "effect", inputs, body: parseBlock(c), line };
  }
  if (c.keyword("view")) { c.ws(); return { k: "view", m: parseMarkup(c, null), line }; }
  const save = c.i;
  const name = c.ident();
  c.ws(false);
  if (name && !KEYWORDS.has(name) && c.peek() === "=" && c.peek(1) !== "=" && c.peek(1) !== ">") {
    c.i++; c.ws();
    return { k: "eq", name, e: parseExpr(c), line };
  }
  c.i = save;
  if (c.peekIdent() && /^[A-Za-z_$][A-Za-z0-9_$.\[\]]*\s*:=/.test(c.src.slice(c.i)))
    c.fail("W-2: write in reactive scope (no statement position)");
  c.fail("declaration");
}

export function parseBlock(c: Cursor): Stmt[] {
  c.ws(); c.expect("{"); c.ws();
  const out: Stmt[] = [];
  while (!c.startsWith("}")) { out.push(parseStmt(c)); c.ws(); c.eat(";"); c.ws(); }
  c.expect("}");
  return out;
}

export function parseStmts(src: string): Stmt[] {
  const c = new Cursor(src);
  const out: Stmt[] = [];
  c.ws();
  while (!c.eof()) { out.push(parseStmt(c)); c.ws(); c.eat(";"); c.ws(); }
  return out;
}

function parseStmt(c: Cursor): Stmt {
  c.ws();
  if (c.keyword("let")) { c.ws(); const name = c.ident() ?? c.fail("let name"); c.ws(); c.expect("="); c.ws(); return { k: "let", name, e: parseExpr(c) }; }
  // write?  target := expr
  const save = c.i;
  const name = c.ident();
  if (name && !KEYWORDS.has(name)) {
    const path: Target["path"] = [];
    for (;;) {
      if (c.eat(".")) path.push(c.ident() ?? c.fail("member"));
      else if (c.eat("[")) { c.ws(); path.push(parseExpr(c)); c.ws(); c.expect("]"); }
      else break;
    }
    c.ws(false);
    if (c.eat(":=")) { c.ws(); return { k: "write", target: { name, path }, e: parseExpr(c) }; }
  }
  c.i = save;
  return { k: "expr", e: parseExpr(c) };
}

// ---- expressions ----
export function parseExpr(c: Cursor): Expr {
  c.ws();
  if (c.keyword("if")) {
    c.ws(); const cond = parseExpr(c); c.ws();
    if (!c.keyword("then")) c.fail("then"); c.ws(); const t = parseExpr(c); c.ws();
    if (!c.keyword("else")) c.fail("else"); c.ws(); const f = parseExpr(c);
    return { k: "if", c: cond, t, f };
  }
  if (c.keyword("fn")) {
    c.ws(); c.expect("("); c.ws(); const params: string[] = [];
    while (!c.startsWith(")")) { params.push(c.ident() ?? c.fail("param")); c.ws(); if (!c.eat(",")) break; c.ws(); }
    c.expect(")"); c.ws(); c.expect("=>"); c.ws();
    return { k: "fn", params, body: parseExpr(c) };
  }
  return parseBin(c, 0);
}

const LEVELS: string[][] = [["||"], ["&&"], ["==", "!="], ["<=", ">=", "<", ">"], ["+", "-"], ["*", "/", "%"]];
function parseBin(c: Cursor, lvl: number): Expr {
  if (lvl >= LEVELS.length) return parseUnary(c);
  let l = parseBin(c, lvl + 1);
  for (;;) {
    c.ws(false);
    const op = LEVELS[lvl].find(o => c.startsWith(o) && !(o === "-" && c.peek(1) === ">"));
    if (!op) return l;
    c.i += op.length; c.ws();
    l = { k: "bin", op, l, r: parseBin(c, lvl + 1) };
  }
}
function parseUnary(c: Cursor): Expr {
  c.ws();
  if (c.eat("!")) return { k: "un", op: "!", e: parseUnary(c) };
  if (c.peek() === "-" && c.peek(1) !== ">") { c.i++; return { k: "un", op: "-", e: parseUnary(c) }; }
  if (c.keyword("pre")) {
    c.ws(); const name = c.ident() ?? c.fail("pre name"); c.ws(false);
    if (c.eat("->")) { c.ws(); return { k: "pre", name, init: parseUnary(c) }; }
    return { k: "pre", name };
  }
  if (c.keyword("peek")) { c.ws(); return { k: "peek", e: parseUnary(c) }; }
  return parsePostfix(c);
}
function parsePostfix(c: Cursor): Expr {
  let e = parsePrimary(c);
  for (;;) {
    if (c.eat(".")) e = { k: "member", o: e, p: c.ident() ?? c.fail("member") };
    else if (c.peek() === "[") { c.i++; c.ws(); const i = parseExpr(c); c.ws(); c.expect("]"); e = { k: "index", o: e, i }; }
    else if (c.peek() === "(") {
      c.i++; c.ws(); const args: Expr[] = [];
      while (!c.startsWith(")")) { args.push(parseExpr(c)); c.ws(); if (!c.eat(",")) break; c.ws(); }
      c.expect(")"); e = { k: "call", f: e, args };
    } else return e;
  }
}
function parsePrimary(c: Cursor): Expr {
  c.ws();
  const ch = c.peek();
  if (ch === '"' || ch === "'") {
    c.i++; let s = "";
    while (!c.eof() && c.peek() !== ch) { if (c.peek() === "\\") { c.i++; } s += c.peek(); c.i++; }
    c.expect(ch); return { k: "lit", v: s };
  }
  const num = /^\d+(\.\d+)?/.exec(c.src.slice(c.i));
  if (num) { c.i += num[0].length; return { k: "lit", v: Number(num[0]) }; }
  if (c.eat("(")) { c.ws(); const e = parseExpr(c); c.ws(); c.expect(")"); return e; }
  if (c.eat("[")) {
    c.ws(); const items: Expr[] = [];
    while (!c.startsWith("]")) { items.push(parseExpr(c)); c.ws(); if (!c.eat(",")) break; c.ws(); }
    c.expect("]"); return { k: "arr", items };
  }
  if (c.eat("{")) {
    c.ws(); const fields: { key: string; v: Expr }[] = [];
    while (!c.startsWith("}")) {
      const key = c.ident() ?? c.fail("field"); c.ws();
      if (c.eat(":")) { c.ws(); fields.push({ key, v: parseExpr(c) }); } else fields.push({ key, v: { k: "id", name: key } });
      c.ws(); if (!c.eat(",")) break; c.ws();
    }
    c.expect("}"); return { k: "rec", fields };
  }
  if (c.keyword("true")) return { k: "lit", v: true };
  if (c.keyword("false")) return { k: "lit", v: false };
  if (c.keyword("undefined")) return { k: "lit", v: undefined };
  if (c.keyword("null")) return { k: "lit", v: null };
  const id = c.ident();
  if (id) return { k: "id", name: id };
  c.fail("expression");
}

// ---- markup ----
// Markup continues until `closeTag` is seen (or end of input for top level).
function parseMarkup(c: Cursor, closeTag: string | null): Markup[] {
  const out: Markup[] = [];
  const inElement = closeTag !== null && closeTag !== "}";
  for (;;) {
    if (inElement) {
      // inside an element, whitespace between nodes is text (collapsed to one space)
      let s = ""; while (!c.eof() && " \t\r\n".includes(c.peek())) { s += c.peek(); c.i++; }
      if (s && !c.startsWith(`</${closeTag}>`)) out.push({ k: "text", s: " " });
    } else c.ws();
    if (c.eof()) { if (closeTag) c.fail(`expected </${closeTag}>`); return out; }
    if (closeTag && c.startsWith(`</${closeTag}>`)) { c.i += closeTag.length + 3; return out; }
    if (closeTag === "}" && c.startsWith("}")) { c.i++; return out; }
    if (c.startsWith("<")) { out.push(parseElement(c)); continue; }
    if (c.startsWith("{")) { c.i++; c.ws(); const e = parseExpr(c); c.ws(); c.expect("}"); out.push({ k: "read", e }); continue; }
    if (c.keyword("if")) {
      c.ws(); const cond = parseExpr(c); c.ws(); c.expect("{");
      const t = parseBlockBody(c); c.ws();
      let f: { decls: Decl[]; body: Markup[] } = { decls: [], body: [] };
      if (c.keyword("else")) { c.ws(); c.expect("{"); f = parseBlockBody(c); }
      out.push({ k: "mif", c: cond, t: t.body, tDecls: t.decls, f: f.body, fDecls: f.decls }); continue;
    }
    if (c.keyword("for")) {
      c.ws(); const name = c.ident() ?? c.fail("for name"); c.ws();
      if (!c.keyword("in")) c.fail("in"); c.ws(); const xs = parseExpr(c); c.ws(); c.expect("{");
      const { decls, body } = parseBlockBody(c);
      out.push({ k: "mfor", name, xs, decls, body }); continue;
    }
    if (closeTag === null && (c.startsWith("source ") || c.startsWith("effect") || c.startsWith("view "))) return out;
    // text up to < { } or newline
    let s = "";
    while (!c.eof() && !"<{}\n".includes(c.peek())) { s += c.peek(); c.i++; }
    if (s.trim() === "" && closeTag === null && c.peek() === "\n") { c.i++; if (looksLikeDecl(c)) return out; continue; }
    out.push({ k: "text", s });
  }
}
/** A reactive block body: declarations, then markup, up to the closing `}` (03: any block is decls then view). */
function parseBlockBody(c: Cursor): { decls: Decl[]; body: Markup[] } {
  const decls: Decl[] = [];
  for (;;) {
    c.ws();
    if (!looksLikeDecl(c)) break;
    decls.push(parseDecl(c)); c.ws(); c.eat(";");
  }
  return { decls, body: parseMarkup(c, "}") };
}
function looksLikeDecl(c: Cursor) {
  const save = c.i; c.ws();
  const r = c.startsWith("source ") || c.startsWith("effect") || c.startsWith("view ") ||
    (() => { const id = c.ident(); c.ws(false); const ok = !!id && !KEYWORDS.has(id) && c.peek() === "=" && c.peek(1) !== "="; return ok; })();
  c.i = save; return r;
}
function parseElement(c: Cursor): Markup {
  c.expect("<");
  const tag = c.ident() ?? c.fail("tag");
  const attrs: { name: string; e: Expr }[] = [];
  for (;;) {
    c.ws();
    if (c.eat("/>")) return { k: "el", tag, attrs, children: [] };
    if (c.eat(">")) break;
    const name = c.ident() ?? c.fail("attr"); c.ws(); c.expect("="); c.ws();
    if (c.eat("{")) { c.ws(); attrs.push({ name, e: parseExpr(c) }); c.ws(); c.expect("}"); }
    else attrs.push({ name, e: parsePrimary(c) });
  }
  const children = parseMarkup(c, tag);
  return { k: "el", tag, attrs, children };
}

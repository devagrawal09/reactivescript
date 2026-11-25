import { decodeHTMLStrict } from "entities";

// The resolved model (spec/11 CP-6, issue #1): what the checker resolved, as facts a lowering or another analysis consumes
// instead of recognising source spellings. Compile-time only. Not a stable format: it is the vocabulary of facts the Rust
// crate's model is diffed against (ref/crate.ts), not an IR anyone else depends on yet.
//
//   regions       the lexical regions (03): the program, each component, each branch, row, boundary and instantiating fn
//   symbols       every name a declaration binds, except constants (`let`, parameters, row bindings): sources, equations,
//                 props, fns, actions, components, imports, error classes, contexts, server fns
//   computations  where reads happen: an equation's memo, a source's question or seed, a reader of a view, a prop's
//                 argument, an effect's two halves, a handler, an action body, a server fn body, a provision
//
// A read is of a reactive symbol (a source, an equation, props, a context through `use`) and carries its mode:
//   tracked   reactive scope (SC-1): the computation depends on it
//   snapshot  imperative scope (SC-2), `peek` (E-5), a source's seed (E-4), a value parameter's argument (E-10)
//   pre       `pre x` (C-2): the previous instant's value
// and `probe: "latest" | "pending"` under `latest` / `pending?` (R-9, R-12). A write is `x := e` (W-1), `guess`
// (AC-3), `refresh` (AC-4) or `affects` (AC-5); `use p := e` writes the context's provided source (RG-7c). A call names a
// fn, an action, a server fn or a JS import called by name. An action's computation lists its own catches (`catches`).

import type { Decl, Markup, Program } from "./ast.ts";

export type ReadMode = "tracked" | "snapshot" | "pre";
export type Read = { sym: number; mode: ReadMode; field?: string; probe?: "latest" | "pending" };
export type Write = { sym: number; op: "write" | "optimistic" | "refresh" | "affects"; path?: true; field?: string };
export type RegionKind = "program" | "component" | "imported" | "fn" | "then" | "else" | "for" | "loading" | "portal" | "errored" | "children";
export type CompKind = "memo" | "deferred" | "keyed" | "question" | "seed" | "reader" | "prop" | "handler" | "effect" | "apply" | "action" | "server" | "fn" | "provide" | "default";
export type OutlinePart = ({ text: string; attr?: string } | { site: number } | { region: number } | { br: true }) & { line?: number };
export type ModelRegion = { id: number; kind: RegionKind; parent?: number; name?: string; outline: OutlinePart[]; shadowed?: number; deadTyped?: true };
/** MO-11f: a JS import's declaration — its effective `.d.rx` line, the file it is from (the written `.d.rx`, or the TS module it
 *  was generated from), and where its facts came from: `written`, `brand` (with the brands) or `default`. */
export type SymDecl = { line: string; from: string; origin: "written" | "brand" | "default"; brands: string[] };
export type ModelSymbol = { id: number; name: string; kind: string; region: number; line: number; question?: boolean; io?: true; from?: string; key?: string; decl?: SymDecl };
/** An action's own catch (R-f-6): a `try … catch` or an `await … catch` in its body, in source order. `classes`: the error
 *  classes it handles, null for a catch-all. No line: a statement has none in the AST (the map finds it in the source). */
export type ActionCatch = { classes: string[] | null };
export type Computation = { id: number; kind: CompKind; region: number; line: number; name?: string; at?: string; in?: number; reads: Read[]; writes: Write[]; calls: number[]; catches?: ActionCatch[] };
export type Model = { file: string; regions: ModelRegion[]; symbols: ModelSymbol[]; computations: Computation[] };

const OUTLINE_LIMIT = 400;
const BLOCKS = new Set("address article aside blockquote dd details dialog div dl dt fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 header hgroup hr li main menu nav ol p pre section summary table tbody td th thead tfoot tr ul".split(" "));
const HUMAN_ATTRS = new Set(["placeholder", "title", "alt", "aria-label", "value"]);
export const outlineBlock = (tag: string) => BLOCKS.has(tag);
export const outlineHidden = (tag: string) => tag === "style" || tag === "script";
const outlineText = (text: string) => decodeHTMLStrict(text).replace(/[ \t\n\r\f\u00a0]+/g, " ");

const READ_KINDS = new Set(["source", "eq", "props", "context"]);
const CALL_KINDS = new Set(["fn", "action", "server", "import"]);
type SymLike = { kind: string; name: string; region: { id: number }; line: number; question?: boolean; io?: boolean; imported?: string; key?: string; decl?: SymDecl };

/** A module's key part: its POSIX path relative to `root` (the project root), or the path as the loader has it. */
export function moduleKey(path: string, root?: string): string {
  const p = path.replace(/\\/g, "/");
  if (!root) return p;
  const r = root.replace(/\\/g, "/").replace(/\/+$/, "") + "/";
  return p.startsWith(r) ? p.slice(r.length) : p;
}
/** A declaration's stable identity, `<module>|<scope>|<name>[#n]` (dev builds name its Solid nodes `rx:` + key): the
 *  scope is the enclosing component's name ("" at module level); `#n` marks the n+1th declaration of the same
 *  scope and name in the module, in source order. Sources, equations and actions get one (a wrapped server fn
 *  too, though it binds no node and the model gives it none). */
export function declKeys(p: Program, module: string): Map<Decl, string> {
  const found: { d: Decl; at: string; line: number }[] = [];
  const decls = (ds: Decl[], scope: string) => {
    for (const d of ds) {
      if (d.k === "source" || d.k === "eq" || d.k === "action") found.push({ d, at: `${scope}|${d.name}`, line: d.line });
      else if (d.k === "fn") decls(d.decls, scope);
      else if (d.k === "component") { decls(d.decls, d.name); markup(d.view, d.name); }
    }
  };
  const markup = (ms: Markup[], scope: string) => {
    for (const m of ms) switch (m.k) {
      case "el": markup(m.children, scope); break;
      case "mif": decls(m.tDecls, scope); markup(m.t, scope); decls(m.fDecls, scope); markup(m.f, scope); break;
      case "mfor": decls(m.decls, scope); markup(m.body, scope); break;
      case "loading": case "errored": markup(m.fallback, scope); decls(m.decls, scope); markup(m.body, scope); break;
      case "portal": decls(m.decls, scope); markup(m.body, scope); break;
    }
  };
  decls(p.decls, ""); markup(p.view, "");
  found.sort((a, b) => a.line - b.line);
  const seen = new Map<string, number>(); const keys = new Map<Decl, string>();
  for (const f of found) { const n = seen.get(f.at) ?? 0; seen.set(f.at, n + 1); keys.set(f.d, `${module}|${f.at}${n ? `#${n}` : ""}`); }
  return keys;
}

/** Filled by the checker during its walk (check.ts): symbols as they are bound, computations as the walk enters them. */
export class ModelBuilder {
  regions: ModelRegion[] = [];
  private syms: SymLike[] = [];
  private ids = new Map<SymLike, number>();
  computations: Computation[] = [];
  private cur: Computation | null = null;
  snap = 0;                                                             // inside `peek`, a seed, an E-10 argument
  probe: "latest" | "pending" | undefined;

  private outlines = new Map<number, OutlinePart[]>();
  private clipped = new Set<number>();
  hideOutline = 0;
  /** R-f-4: a typed `errored` region whose children an inner catch-all wraps. `by` is that catch-all's region. */
  shadow(id: number, by: number) { const r = this.regions.find(x => x.id === id); if (r) { r.deadTyped = true; r.shadowed = by; } }
  region(id: number, kind: RegionKind, parent: { id: number } | null, name?: string) {
    const outline: OutlinePart[] = [];
    this.outlines.set(id, outline);
    this.regions.push({ id, kind, ...(parent ? { parent: parent.id } : {}), ...(name !== undefined ? { name } : {}), outline });
  }
  outline(id: number, part: OutlinePart) {
    const out = this.outlines.get(id)!;
    if (this.hideOutline || this.clipped.has(id)) return;
    let prev = out.at(-1);
    if ("br" in part) {
      if (prev && "text" in prev && !prev.attr) {
        prev.text = prev.text.replace(/ $/, "");
        if (!prev.text) { out.pop(); prev = out.at(-1); }
      }
      if (!prev || "br" in prev) return;
    } else if ("text" in part && !part.attr) {
      let text = outlineText(part.text);
      if (!prev || "br" in prev) text = text.replace(/^ /, "");
      if (!text) return;
      if (prev && "text" in prev && !prev.attr) {
        prev.text += prev.text.endsWith(" ") ? text.replace(/^ /, "") : text;
        return;
      }
      part = { text };
    }
    if (out.length >= OUTLINE_LIMIT && !("br" in part)) {
      out.length = OUTLINE_LIMIT;
      this.clipped.add(id);
      out.push({ text: "…" });
    } else out.push(part);
  }
  viewAttr(id: number, attr: string, literal: unknown, line: number): boolean {
    if (typeof literal !== "string" && typeof literal !== "number") return false;
    if (HUMAN_ATTRS.has(attr)) {
      const text = outlineText(String(literal)).replace(/^ | $/g, "");
      if (text) this.outline(id, { attr, text, line });
    }
    return true;
  }
  sym(s: SymLike) { if (s.kind === "value" || this.ids.has(s)) return; this.ids.set(s, this.syms.length); this.syms.push(s); }
  within(kind: CompKind, region: { id: number }, line: number, info: { name?: string; at?: string }, f: () => void) {
    const c: Computation = { id: this.computations.length, kind, region: region.id, line, ...(info.name !== undefined ? { name: info.name } : {}), ...(info.at !== undefined ? { at: info.at } : {}), ...(this.cur ? { in: this.cur.id } : {}), reads: [], writes: [], calls: [] };
    this.computations.push(c);
    const save = this.cur, snap = this.snap, probe = this.probe; this.cur = c; this.snap = 0; this.probe = undefined;
    try { f(); } finally { this.cur = save; this.snap = snap; this.probe = probe; }
  }
  read(s: SymLike, imperative: boolean, pre = false, field?: string) {
    const id = this.ids.get(s); if (!this.cur || id === undefined || !READ_KINDS.has(s.kind)) return;
    const r: Read = { sym: id, mode: pre ? "pre" : imperative || this.snap > 0 ? "snapshot" : "tracked", ...(field !== undefined ? { field } : {}), ...(this.probe ? { probe: this.probe } : {}) };
    if (!this.cur.reads.some(x => x.sym === r.sym && x.mode === r.mode && x.field === r.field && x.probe === r.probe)) this.cur.reads.push(r);
  }
  write(s: SymLike | undefined, op: Write["op"], path = false, field?: string) {
    const id = s && this.ids.get(s); if (!this.cur || id === undefined) return;
    if (!this.cur.writes.some(x => x.sym === id && x.op === op && !!x.path === path && x.field === field))
      this.cur.writes.push({ sym: id, op, ...(path ? { path: true as const } : {}), ...(field ? { field } : {}) });
  }
  /** An action's own catch: recorded on the action's computation, only there (present when non-empty). */
  catch(classes: string[] | undefined) { const c = this.cur; if (c?.kind === "action") (c.catches ??= []).push({ classes: classes ? [...classes] : null }); }
  call(s: SymLike | undefined) { const id = s && this.ids.get(s); if (!this.cur || id === undefined || !CALL_KINDS.has(s!.kind) || this.cur.calls.includes(id)) return; this.cur.calls.push(id); }
  build(file: string): Model {
    return { file, regions: this.regions.map(r => {
      const outline = r.outline.slice();
      while (outline.length) {
        const last = outline.at(-1)!;
        if ("br" in last) { outline.pop(); continue; }
        if ("text" in last && !last.attr && last.text.endsWith(" ")) {
          if (last.text === " ") { outline.pop(); continue; }
          outline[outline.length - 1] = { ...last, text: last.text.slice(0, -1) };
        }
        break;
      }
      return { ...r, outline };
    }),
      symbols: this.syms.map((s, id) => ({ id, name: s.name, kind: s.kind, region: s.region.id, line: s.line, ...(s.kind === "source" ? { question: !!s.question } : {}), ...(s.io ? { io: true as const } : {}), ...(s.imported ? { from: s.imported } : {}), ...(s.key ? { key: s.key } : {}), ...(s.decl ? { decl: s.decl } : {}) })),
      computations: this.computations };
  }
}

// TY: the type layer. A checked `.rx` program is projected to TSX that TypeScript checks — as TSRX's
// `projectTsrxForTypecheck` does for `.tsrx` — and TypeScript's diagnostics are reported on `.rx` lines. Types stay
// TypeScript's (07 §2); the projection only says what each form is, as a value, to TypeScript:
//   a source or an equation is a `const` of its value's type (reads are values, 02 V-1); a write is `__.set(target, v)`,
//   which checks `v` against the target; an equation's `await` is `__.await(e)`, its answer's type, and an equation is `__.eq(e)`, never a promise (R-1); a view is JSX over
//   Solid's JSX types, so a component's props and what a reader may insert are checked where they are written.
// The projection is for checking only: it is never run, and its order is the dependency order (E-7).
import type { Decl, Expr, Markup, Program, Stmt, Target } from "../src/ast.ts";
import { transform } from "@solidjs/compiler";
import type { ModuleSet } from "../src/modules.ts";
import type { JsDecl } from "../src/parse.ts";
import type { ModSig } from "../src/check.ts";

const ROW_WORDS = /^((?:io|pending|lane|fails\([^)]*\))\s+)+/;
const BUILTINS = new Set(["len", "str", "map", "filter", "sum", "fail", "fetch", "every", "log", "until", "onSettled", "onFlush"]);
const VOID_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
const isHandler = (a: string) => /^on[A-Z:]/.test(a);
const J = (v: unknown) => v === undefined ? "undefined" : JSON.stringify(v);
/** A written type, without its row words (`pending T` → `T`, 04 CN-4a) or a context's `source` (RG-7c). */
const typeText = (t?: string) => t?.replace(ROW_WORDS, "").replace(/^source\s+/, "").trim() || undefined;
const ann = (t?: string) => { const x = typeText(t); return x ? `: ${x}` : ""; };

/** The helpers every projection imports (`__`), and the prelude's names (`len`, `map`, …). */
export const PRELUDE = `// ReactiveScript's forms, as TypeScript sees them (types/project.ts)
import type { JSX } from "@solidjs/web/jsx-runtime";
export declare function await_<T>(v: T): Awaited<T>;
export declare function awaitS<T>(v: T): T extends AsyncIterable<infer U> ? U : Awaited<T>;
/** R-1: Solid's memo consumes a promise or a stream its function returns, so an equation's value is never one — \`await\` says
 *  where it enters (\`any\`: not known here; Solid still consumes it). */
type Async<T> = 0 extends (1 & T) ? false : true extends (T extends PromiseLike<any> | AsyncIterable<any> ? true : false) ? true : false;
export declare function eq<T>(v: T, ok: Async<T> extends true ? "MISSING_AWAIT: an equation's value is a promise or a stream, which Solid consumes; write await e (or await* e for a stream)" : true): T;
export declare function first<T, I>(v: T, init: I): T | I;
export declare function pre<T>(init?: T): T;
export declare function pending(v: unknown): boolean;
/** RG-4b: an object rest, \`{ a, ...rest } = e\` (Solid's \`omit\`). */
export declare function omit<T, K extends string>(v: T, ...keys: K[]): Omit<T, K>;
export declare function caught<T, R>(v: T, alt: (e: any) => R): T | R;
export declare function raise(e: unknown): never;
/** W-1/W-6: a write checks its value (or its function of the slot) against the target — whose type alone decides it. */
export declare function set<T>(target: T): (v: T | ((p: T) => T)) => void;
/** A source's type when none is written: its initializer's, widened — a source is written later (\`""\` is a string,
 *  \`null\` and \`[]\` say nothing yet). With a written type, \`src<T>\` is that type, not what the initializer narrows it to. */
export type Widen<T> = 0 extends (1 & T) ? any : [T] extends [null | undefined] ? any : [T] extends [never[]] ? any[] : [T] extends [string] ? string : [T] extends [number] ? number : [T] extends [boolean] ? boolean : T;
export declare function src<T>(v: T): Widen<T>;
export declare function typed<T>(v: T): T;
type ElemOf<X> = 0 extends (1 & X) ? any : X extends Iterable<infer U> ? U : X extends ArrayLike<infer U> ? U : any;
export declare function each<X>(xs: X, f: (x: ElemOf<X>) => JSX.Element): JSX.Element;
/** 12 SF-6a: what crosses the wire — data. \`Bad<T>\` is true where a function or an instance of a class is in it (\`any\`: not
 *  known here; the run-time check stands). A server fn's parameters and result must not be. */
type Bad<T> = 0 extends (1 & T) ? false : T extends string | number | boolean | bigint | null | undefined ? false : T extends Function ? true
  : T extends readonly (infer U)[] ? Bad<U> : T extends object ? (Object extends T ? false : true extends { [K in keyof T]-?: Bad<T[K]> }[keyof T] ? true : false) : true;
export declare function wire<A extends unknown[], R>(f: (...a: A) => Promise<R>, ok: true extends Bad<R> ? "WIRE_VALUE: its result is not data (a function, or an instance of a class, does not cross)" : true extends Bad<A[number]> ? "WIRE_VALUE: a parameter is not data" : true): void;
/** 07 §6: a view (\`props.children: View\`); R-f-10: the class a panic is. */
export type View = JSX.Element;
export type Panic = Error;
/** CP-4a: an entry's default export, a function of the app (\`createApp\`'s, either build) giving the view \`app.mount\` takes. */
export type Main = (app: object) => () => View;
export interface Ctx<T> { readonly __ctx: T }
export declare function ctx<T>(d?: T): Ctx<T>;
export declare function use<T>(c: Ctx<T>): T;
export declare function provide<T>(c: Ctx<T>, v: NoInfer<T>): void;
export declare function effect(f: () => void | (() => void)): void;
export declare function draft<T>(seed: T, f: (d: T) => void): T;
export declare function len(x: unknown): number;
export declare function until<T>(p: () => T): Promise<Exclude<T, false | 0 | "" | null | undefined>>;   // AC-6: Solid's until — the first truthy value
export declare function onSettled(f: () => void): void;                   // EF-7: imperative scope only, so no cleanup return
export declare function onFlush(f: () => void): void;                     // EF-8
export declare function str(x: unknown): string;
export declare function map<X, U>(xs: X, f: (x: ElemOf<X>, i: number) => U): U[];
export declare function filter<X>(xs: X, f: (x: ElemOf<X>) => unknown): ElemOf<X>[];
export declare function every<X>(xs: X, f: (x: ElemOf<X>) => unknown): boolean;
export declare function sum(xs: readonly number[]): number;
export declare function fail(msg: string): never;
export declare function fetch(key: string): Promise<any>;
export declare function log(...a: unknown[]): void;
`;

/** One projected file: its TSX, and for each of its lines the `.rx` line it came from. */
export type Projected = { path: string; code: string; lines: number[]; rx: string };

class W {
  out: string[] = []; lines: number[] = []; private last = 1;
  /** A statement or a markup item carries no line of its own (0): it is on its declaration's. */
  emit(text: string, line: number) { if (line) this.last = line; for (const l of text.split("\n")) { this.out.push(l); this.lines.push(line || this.last); } }
}

/** The file a module projects to: `main.rx` → `main.rx.tsx`, so `import … from "./lib.rx"` resolves to the projection. */
export const projectedPath = (rx: string) => `${rx}.tsx`;

export function projectModules(set: ModuleSet): Projected[] {
  const out: Projected[] = [];
  const jsStubs = new Map<string, Set<string>>();          // a JS module with no declaration file: every name it is asked for is `any`
  for (const path of set.order) {
    const p = set.programs.get(path)!;
    const w = new W();
    new Proj(w, set, path, jsStubs).module(p);
    out.push({ path: projectedPath(path), code: w.out.join("\n"), lines: w.lines, rx: path });
  }
  for (const [rx, sig] of set.signatures ?? []) out.push({ path: `${rx}.d.ts`, code: signatureStub(sig), lines: [], rx: rx.replace(/\.rx$/, ".d.rx") });   // TY-4c
  for (const [dts, decls] of set.declarations ?? []) out.push({ path: dts.replace(/\.d\.rx$/, ".d.ts"), code: declarationModule(dts, decls, set), lines: [], rx: dts });
  for (const [mod, names] of jsStubs) out.push({ path: mod, code: [...names].map(n => n === "default" ? "declare const __d: any; export default __d;" : `export declare const ${n}: any;`).join("\n"), lines: [], rx: mod });
  return out;
}

/** TY-4c: an `.rx` module read by its signature (MO-9) is typed by the \`.d.ts\` TypeScript emits from its projection (TY-1c);
 *  ref/ ships none, so its exports are \`any\` here. */
function signatureStub(sig: ModSig): string {
  return [...sig.exports].map(([n, x]) => x.kind === "type" ? `export type ${n} = any;` : x.kind === "comp" ? `export declare function ${n}(props: any): any;` : `export declare const ${n}: any;`).join("\n");
}
/** The namespace a `.d.rx` is declared as. Same spelling as `compiler/src/project.rs` `ns_name`. */
const nsName = (path: string) => "__D_" + path.replace(/[^A-Za-z0-9_]/g, "_");
/** A module-level alias of an imported type, so a declare namespace can name it without importing the sibling `.ts`. */
const bridgeName = (path: string, name: string) => "__T_" + path.replace(/[^A-Za-z0-9_]/g, "_") + "_" + name;
/** A path from `fromFile`'s directory to `toFile`, for an `import type` of an `.rx` projection. */
function relModule(fromFile: string, toFile: string): string {
  const from = fromFile.split("/").slice(0, -1);
  const to = toFile.split("/");
  let i = 0;
  while (i < from.length && i + 1 < to.length && from[i] === to[i]) i++;
  const rel = "../".repeat(from.length - i) + to.slice(i).join("/");
  return rel.startsWith(".") ? rel : "./" + rel;
}
/** MO-8: a `.d.rx` as TypeScript's `.d.ts` for the same JS module. An import is a local alias of its bridge (MO-8e). */
function declarationFile(decls: JsDecl[]): string {
  return decls.map(d => {
    if (d.kind === "import") return d.names.map(n => `type ${n.alias} = ${d.target ? bridgeName(d.target, n.name) : "any"};`).join("\n");
    if (d.kind === "type") return `${d.exported ? "export " : ""}${d.text ?? `type ${d.name} = any`}`;
    if (d.kind === "error") return `export declare class ${d.name}$ extends Error {}\nexport declare const ${d.name}: (message?: string) => ${d.name}$;\nexport type ${d.name} = ${d.name}$;`;
    const ps = d.params.map((n, i) => `${n}${d.ptypes?.[i] ? `: ${d.ptypes[i]}` : ""}`).join(", ");
    return `export declare function ${d.name}${d.generics ?? ""}(${ps}): ${d.ret ?? "any"};`;
  }).join("\n") + "\n";
}
function nsBlock(dts: string, decls: JsDecl[]): string {
  const body = declarationFile(decls).trimEnd().replace(/export declare /g, "export ").split("\n").map(l => `  ${l}`).join("\n");
  return `declare namespace ${nsName(dts)} {\n${body}\n}`;
}
/** Dependency namespaces and the bridges this file's type imports name. `seen` holds `.d.rx` paths already emitted. */
function declPreamble(decls: JsDecl[], set: ModuleSet, fromFile: string, seen: Set<string>, bridged: Set<string>): string {
  let out = "";
  for (const d of decls) {
    if (d.kind !== "import" || !d.target) continue;
    if (!d.rx) out += depText(d.target, set, fromFile, seen, bridged);
    for (const n of d.names) {
      const b = bridgeName(d.target, n.name);
      if (bridged.has(b)) continue;
      bridged.add(b);
      out += d.rx ? `import type { ${n.name} as ${b} } from ${JSON.stringify(relModule(fromFile, d.target))};\n` : `type ${b} = ${nsName(d.target)}.${n.name};\n`;
    }
  }
  return out;
}
function depText(target: string, set: ModuleSet, fromFile: string, seen: Set<string>, bridged: Set<string>): string {
  if (seen.has(target)) return "";
  seen.add(target);
  const decls = set.declarations?.get(target);
  if (!decls) return "";
  return declPreamble(decls, set, fromFile, seen, bridged) + nsBlock(target, decls) + "\n";
}
/** The standalone `.d.ts`: a file with no type import is `declarationFile`, unchanged. */
function declarationModule(dts: string, decls: JsDecl[], set: ModuleSet): string {
  if (!decls.some(d => d.kind === "import")) return declarationFile(decls);
  const seen = new Set([dts]);
  return declPreamble(decls, set, dts, seen, new Set()) + declarationFile(decls);
}

class Proj {
  w: W; set: ModuleSet; path: string; jsStubs: Map<string, Set<string>>;
  private used = new Set<string>();                         // prelude names the module reads
  private declared = new Set<string>();                     // names the module declares (they shadow the prelude)
  private slots = new Set<string>();                        // sources and equations: a write checks this type, not a branch's narrowing (TY-2)
  private snap = new Set<string>();                         // a handler read is a fresh snapshot of this name's type (TY-2)
  private rename: Map<string, string> | null = null;       // inside a handler, a snap name reads as its snapshot binding
  private ambients = new Set<string>();                    // a JS module's `.d.rx`, emitted once as the types the import is checked against (TY-4b)
  private bridged = new Set<string>();                     // MO-8e: a type bridge already emitted in this projection
  constructor(w: W, set: ModuleSet, path: string, jsStubs: Map<string, Set<string>>) { this.w = w; this.set = set; this.path = path; this.jsStubs = jsStubs; }

  module(p: Program) {
    const body = new W(); const saved = this.w; this.w = body;
    this.decls(p.decls, "", true);
    if (p.view.length) { this.w.emit(`export const __view = (`, p.view[0].line ?? 1); this.markup(p.view, "  "); this.w.emit(`);`, p.view[p.view.length - 1].line ?? 1); }
    const main = p.decls.find(d => d.k === "component" && d.isDefault);
    if (main) this.w.emit(`declare const __main: __.Main; export default __main;`, main.line);   // CP-4a: what JS imports from an entry
    this.w = saved;
    const prelude = [...this.used].filter(n => !this.declared.has(n));
    const types = ["View", "Panic"].filter(n => !this.declared.has(n));
    this.w.emit(`import * as __ from "${this.rel("__prelude.ts")}"; import type { ${types.join(", ")} } from "${this.rel("__prelude.ts")}";${prelude.length ? ` import { ${prelude.join(", ")} } from "${this.rel("__prelude.ts")}";` : ""}`, 0);
    this.w.out.push(...body.out); this.w.lines.push(...body.lines);
  }
  /** A path relative to this module's directory, for the prelude (at the root of the program). */
  private rel(f: string) { const depth = this.path.split("/").length - 1 - (this.set.entry.split("/").length - 1); return depth > 0 ? "../".repeat(depth) + f : "./" + f; }

  // ---- declarations, in dependency order (functions are hoisted; values are not) ----
  decls(ds: Decl[], ind: string, top = false) {
    const ex = (d: Decl) => top && (d as { exported?: boolean }).exported ? "export " : "";
    for (const d of ds) if ("name" in d) this.declared.add(d.name);
    for (const d of ds) if (d.k === "source" || d.k === "eq") { this.slots.add(d.name); this.snap.add(d.name); }   // before actions, whose writes name them
    for (const d of ds) {
      if (d.k === "import") this.importDecl(d, ind);
      if (d.k === "typedecl") this.w.emit(`${ind}${ex(d)}${d.text ?? `type ${d.name} = any;`}`, d.line);
      if (d.k === "error") {
        const fields = d.params.map((n, i) => `declare ${n}: ${d.ptypes?.[i] ?? "any"};`).join(" ");
        const ps = d.params.map((n, i) => `${n}${d.ptypes?.[i] ? `: ${d.ptypes[i]}` : ""}`).join(", ");
        this.w.emit(`${ind}${ex(d)}class ${d.name}$ extends Error { ${fields} }\n${ind}${ex(d)}const ${d.name} = (${ps}): ${d.name}$ => ${d.msg ? `{ void (${this.expr(d.msg, false)}); return new ${d.name}$(); }` : `new ${d.name}$()`};\n${ind}${ex(d)}type ${d.name} = ${d.name}$;`, d.line);
      }
      if (d.k === "context") this.w.emit(`${ind}${ex(d)}const ${d.name} = __.ctx<${typeText(d.type) ?? "any"}>(${d.dflt ? this.expr(d.dflt, false) : ""});`, d.line);
    }
    for (const d of ds) {
      if (d.k === "fn") {
        const ps = d.params.map(p => `${p.name}${ann(p.type)}`).join(", ");
        if (!d.decls.length) { this.w.emit(`${ind}${ex(d)}function ${d.name}(${ps})${ann(d.ret)} { return ${this.expr(d.tail, false)}; }`, d.line); continue; }
        this.w.emit(`${ind}${ex(d)}function ${d.name}(${ps})${ann(d.ret)} {`, d.line); this.decls(d.decls, ind + "  "); this.w.emit(`${ind}  return ${this.expr(d.tail, false)};\n${ind}}`, d.line);
      }
      if (d.k === "component") {
        this.w.emit(`${ind}${ex(d)}function ${d.name}(${d.props}${d.propsType ? `: ${d.propsType}` : ": any"}) {`, d.line);
        this.decls(d.decls, ind + "  ");
        this.w.emit(`${ind}  return (`, d.line); this.markup(d.view.length ? d.view : [], ind + "    "); this.w.emit(`${ind}  );\n${ind}}`, d.line);
      }
      if (d.k === "action" || d.k === "server") {
        const ps = d.params.map((n, i) => `${n}${d.ptypes?.[i] ? `: ${d.ptypes[i]}` : ""}`).join(", ");
        this.w.emit(`${ind}${ex(d)}async function ${d.name}(${ps})${d.k === "server" && d.ret ? `: Promise<${d.ret}>` : ""} {`, d.line); this.stmts(d.body, ind + "  "); this.w.emit(`${ind}}`, d.line);
        if (d.k === "server") this.w.emit(`${ind}__.wire(${d.name}, true);`, d.line);   // SF-6a, statically where the types are known
      }
    }
    for (const d of this.order(ds)) {
      if (d.k === "source") { this.w.emit(`${ind}${ex(d)}const ${d.name}${ann(d.type)} = ${typeText(d.type) ? `__.typed<${typeText(d.type)}>(${this.expr(d.init, false)})` : `__.src(${this.expr(d.init, false)})`};`, d.line); this.w.emit(`${ind}type __W_${d.name} = typeof ${d.name};`, d.line); }
      if (d.k === "eq") { this.w.emit(`${ind}${ex(d)}const ${d.name}${ann(d.type)} = __.eq(${this.expr(d.e, false, d.name)}, true);`, d.line); this.w.emit(`${ind}type __W_${d.name} = typeof ${d.name};`, d.line); }   // R-1: no promise without `await`
      if (d.k === "provide") this.w.emit(`${ind}__.provide(${d.name}, ${this.expr(d.e, false)});`, d.line);
    }
    for (const d of ds) if (d.k === "effect") {
      this.w.emit(`${ind}__.effect(() => {`, d.line);
      d.inputs.forEach((e, i) => this.w.emit(`${ind}  const $${i} = ${this.expr(e, false)};`, d.line));
      this.stmts(d.body, ind + "  "); this.w.emit(`${ind}});`, d.line);
    }
  }
  private importDecl(d: Extract<Decl, { k: "import" }>, ind: string) {
    const names = d.names.map(n => n.name === "default" ? null : n.name === n.alias ? n.name : `${n.name} as ${n.alias}`).filter(Boolean);
    const dflt = d.names.find(n => n.name === "default")?.alias;
    const isPrelude = (n: string) => d.from === "./prelude" && BUILTINS.has(n);
    for (const n of d.names) if (isPrelude(n.name)) this.declared.delete(n.alias); else this.declared.add(n.alias);
    const prelude = d.names.filter(n => isPrelude(n.name));
    if (prelude.length) { for (const n of prelude) this.used.add(n.name); }
    const rest = d.names.filter(n => !isPrelude(n.name)); if (!rest.length) return;
    let from = d.from;
    if (!d.resolved && !d.declared) {                                                        // a JS module with no declaration: `any`
      const key = this.modPath(d.from) + ".ts"; let s = this.jsStubs.get(key); if (!s) this.jsStubs.set(key, (s = new Set())); for (const n of rest) s.add(n.name); from = d.from;
    }
    void names; void dflt;
    const decls = d.declared ? this.set.declarations?.get(d.declared) : undefined;
    if (decls) { this.declaredImport(d, rest, decls, ind); return; }   // TY-4b: the `.d.rx` is the type, even where a `.ts` sits beside it
    const parts = rest.filter(n => n.name !== "default").map(n => n.name === n.alias ? n.name : `${n.name} as ${n.alias}`);
    const def = rest.find(n => n.name === "default")?.alias;
    this.w.emit(`${ind}import ${def ? def + (parts.length ? ", " : "") : ""}${parts.length ? `{ ${parts.join(", ")} }` : ""} from "${from}";`, d.line);
    for (const n of rest) if (!this.isTypeImport(d, n.name)) this.snapAlias(n.alias, ind, d.line);
  }
  /** A type export binds no value (MO-6c); `typeof` it is not a snapshot. */
  private isTypeImport(d: Extract<Decl, { k: "import" }>, name: string): boolean {
    if (!d.resolved) return false;
    if (this.set.programs.get(d.resolved)?.decls.some(x => x.k === "typedecl" && x.name === name)) return true;
    return this.set.signatures?.get(d.resolved)?.exports.get(name)?.kind === "type";
  }
  /** Snap names a handler reads, not counting its parameters, its locals, or a nested arrow (that one snapshots itself). Sorted, so both projections agree. */
  private handlerSnaps(fn: Extract<Expr, { k: "fn" }>): string[] {
    const bound = new Set(fn.params);
    const out = new Set<string>();
    const expr = (e: Expr) => {
      if (!e?.k) return;
      if (e.k === "fn" || e.k === "serverfn" || e.k === "draft") return;
      if (e.k === "id") { if (this.snap.has(e.name) && !bound.has(e.name)) out.add(e.name); return; }
      for (const v of Object.values(e)) {
        if (Array.isArray(v)) { for (const x of v) if (x && typeof x === "object") { if ("k" in x) expr(x as Expr); else if ("v" in x) expr((x as { v: Expr }).v); else if ("spread" in x) expr((x as { spread: Expr }).spread); } }
        else if (v && typeof v === "object" && "k" in v) expr(v as Expr);
      }
    };
    const stmts = (ss: Stmt[]) => {
      for (const s of ss) {
        if (s.k === "let") { expr(s.e); bound.add(s.name); continue; }
        if (s.k === "write" || s.k === "optimistic") { for (const p of s.target.path) if (typeof p !== "string") expr(p); expr(s.e); continue; }
        if (s.k === "sif") { expr(s.c); stmts(s.t); stmts(s.f); continue; }
        if (s.k === "try") { stmts(s.body); if (s.handler) stmts(s.handler); if (s.fin) stmts(s.fin); continue; }
        if (s.k === "action") { stmts(s.body); continue; }
        if (s.k === "throw" || s.k === "expr") expr(s.k === "throw" ? s.e : s.e);
        if (s.k === "return" && s.e) expr(s.e);
      }
    };
    if (fn.stmts) stmts(fn.stmts); else expr(fn.body);
    return [...out].sort();
  }
  /** A handler's read of this name is a snapshot of its type, not a branch's narrowing (TY-2). */
  private snapAlias(alias: string, ind: string, line: number) {
    this.snap.add(alias);
    this.w.emit(`${ind}type __W_${alias} = typeof ${alias};`, line);
  }
  /** TY-4b: check the import against its `.d.rx`, not whatever TypeScript would resolve the JS module to. */
  private declaredImport(d: Extract<Decl, { k: "import" }>, rest: { name: string; alias: string }[], decls: JsDecl[], ind: string) {
    const ns = nsName(d.declared!);   // a declare namespace, not a module: nothing for TypeScript to resolve beside the `.ts`
    const first = !this.ambients.has(d.declared!);
    if (first) this.ambients.add(d.declared!);
    if (first) {
      const pre = decls.some(x => x.kind === "import") ? declPreamble(decls, this.set, this.path, this.ambients, this.bridged) : "";
      const body = declarationFile(decls).trimEnd().replace(/export declare /g, "export ").split("\n").map(l => `  ${l}`).join("\n");
      const block = `${ind}declare namespace ${ns} {\n${body}\n${ind}}`;
      this.w.emit(pre ? pre.replace(/\n$/, "") + "\n" + block : block, d.line);
    }
    const of = (n: string) => decls.find(x => x.kind !== "import" && x.name === n);
    const values = rest.filter(n => of(n.name)?.kind !== "type");
    if (values.length) {
      const parts = values.filter(n => n.name !== "default").map(n => `${n.name} as __js_${n.alias}`);
      const def = values.find(n => n.name === "default");
      this.w.emit(`${ind}import ${def ? `__js_${def.alias}` + (parts.length ? ", " : "") : ""}${parts.length ? `{ ${parts.join(", ")} }` : ""} from ${J(d.from)};`, d.line);
    }
    for (const n of rest) {
      const x = of(n.name);
      if (!x || x.kind === "type") this.w.emit(`${ind}type ${n.alias} = ${ns}.${n.name};`, d.line);
      else { this.w.emit(`${ind}const ${n.alias} = __js_${n.alias} as typeof ${ns}.${n.name};`, d.line); this.snapAlias(n.alias, ind, d.line); }
      if (x?.kind === "error") this.w.emit(`${ind}type ${n.alias} = ${ns}.${n.name};`, d.line);
    }
  }
  /** A JS import's module, from the program's root (where the stubs are written). */
  private modPath(from: string) { const base = this.path.split("/").slice(0, -1); const parts = [...base]; for (const seg of from.split("/")) { if (seg === "." || !seg) continue; if (seg === "..") parts.pop(); else parts.push(seg); } return parts.join("/"); }
  /** E-7: values in dependency order (C-1 makes it a DAG; a `pre` reads the previous instant, so it is no edge). */
  private order(ds: Decl[]): Decl[] {
    const vals = ds.filter(d => d.k === "source" || d.k === "eq" || d.k === "provide");
    const byName = new Map(vals.filter(d => d.k !== "provide").map(d => [(d as { name: string }).name, d]));
    const done = new Set<Decl>(); const busy = new Set<Decl>(); const out: Decl[] = [];
    const visit = (d: Decl) => {
      if (done.has(d) || busy.has(d)) return; busy.add(d);
      const e = d.k === "eq" ? d.e : d.k === "source" ? d.init : (d as { e: Expr }).e;
      for (const n of freeIds(e)) { const t = byName.get(n); if (t && t !== d) visit(t); }
      busy.delete(d); done.add(d); out.push(d);
    };
    vals.forEach(visit); return out;
  }

  // ---- imperative scope ----
  stmts(ss: Stmt[], ind: string) {
    for (const s of ss) {
      const e = (x: Expr) => this.expr(x, true);
      switch (s.k) {
        case "let": this.w.emit(`${ind}let ${s.name}${ann(s.type)} = ${e(s.e)};`, 0); break;
        case "expr": this.w.emit(`${ind}${e(s.e)};`, 0); break;
        case "return": this.w.emit(`${ind}return${s.e ? " " + e(s.e) : ""};`, 0); break;
        case "throw": this.w.emit(`${ind}throw ${e(s.e)};`, 0); break;
        case "write": case "optimistic": this.write(s.target, e(s.e), ind); break;
        case "refresh": case "affects": this.w.emit(`${ind}void ${s.name};`, 0); break;
        case "action": this.w.emit(`${ind}void (async () => {`, 0); this.stmts(s.body, ind + "  "); this.w.emit(`${ind}})();`, 0); break;
        case "sif": this.w.emit(`${ind}if (${e(s.c)}) {`, 0); this.stmts(s.t, ind + "  "); this.w.emit(`${ind}} else {`, 0); this.stmts(s.f, ind + "  "); this.w.emit(`${ind}}`, 0); break;
        case "try": {
          this.w.emit(`${ind}try {`, 0); this.stmts(s.body, ind + "  ");
          if (s.handler) { this.w.emit(`${ind}} catch (__e) {${s.catchName ? ` const ${s.catchName} = __e as ${s.catchClasses ? s.catchClasses.join(" | ") : "Error"};` : ""}`, 0); this.stmts(s.handler, ind + "  "); }
          if (s.fin) { this.w.emit(`${ind}} finally {`, 0); this.stmts(s.fin, ind + "  "); }
          this.w.emit(`${ind}}`, 0); break;
        }
      }
    }
  }
  /** TY-2: a write is checked against the slot's type, not the type a branch has narrowed the read to. */
  private write(t: Target, v: string, ind: string) {
    if (!t.ctx && this.slots.has(t.name)) {
      let path = "";
      for (const p of t.path) path += typeof p === "string" ? `.${p}` : `[${this.expr(p, true)}]`;
      const base = t.path.length ? `(${t.name} as NonNullable<__W_${t.name}>)` : `(${t.name} as __W_${t.name})`;
      this.w.emit(`${ind}__.set(${base}${path})(${v});`, 0);
      return;
    }
    this.w.emit(`${ind}__.set(${this.target(t)})(${v});`, 0);
  }
  private target(t: Target): string {
    let s = t.ctx ? `__.use(${t.name})` : t.name;
    for (const p of t.path) s += typeof p === "string" ? `.${p}` : `[${this.expr(p, true)}]`;
    return s;
  }

  // ---- expressions: `imp` imperative scope (a real `await`); `self` the equation being defined (its own `pre`) ----
  expr(e: Expr, imp: boolean, self?: string): string {
    const go = (x: Expr) => this.expr(x, imp, self);
    switch (e.k) {
      case "lit": return J(e.v);
      case "id": if (BUILTINS.has(e.name) && !this.declared.has(e.name)) this.used.add(e.name); return this.rename?.get(e.name) ?? e.name;
      case "pre": return e.name === self ? (e.init ? `__.pre(${go(e.init)})` : `__.pre<any>()`) : `__.pre<typeof ${e.name}>(${e.init ? go(e.init) : ""})`;
      case "peek": case "latest": return go(e.e);
      case "pending": return `__.pending(${go(e.e)})`;
      case "await": {
        if (imp) return `(await ${go(e.e)})`;
        const v = e.stream ? `__.awaitS(${go(e.e)})` : `__.await_(${go(e.e)})`;
        return e.init ? `__.first(${v}, ${go(e.init)})` : v;
      }
      case "if": return `(${go(e.c)} ? ${go(e.t)} : ${go(e.f)})`;
      case "throw": return `__.raise(${go(e.e)})`;
      case "catch": return `__.caught(${go(e.e)}, (${e.name ?? "__e"}: ${e.classes ? e.classes.join(" | ") : "Error"}) => ${go(e.alt)})`;
      case "tpl": return "`" + e.parts.map(p => typeof p === "string" ? p.replace(/[`\\]|\$\{|[\x00-\x1f]/g, m => m.charCodeAt(0) < 32 ? "\\x" + m.charCodeAt(0).toString(16).padStart(2, "0") : "\\" + m) : "${" + go(p) + "}").join("") + "`";
      case "member": return `${go(e.o)}${e.opt ? "?." : "."}${e.p}`;
      case "index": return `${go(e.o)}${e.opt ? "?.[" : "["}${go(e.i)}]`;
      case "stylemap": { const r = transform(`export const __s = <style>${e.css}</style>;`, { filename: "class-map.tsrx", generate: "dom" }) as { code: string }; const m = /export const __s = (\{[\s\S]*?\});/.exec(r.code); return `(${m ? m[1].replace(/\n\s*/g, " ").replace(/: "[^"]*"/g, ': "" as string') : "{}"} as const)`; }   // 07 CSS-5: TSRX's class map, as its typecheck projection writes it
      case "call": return `${go(e.f)}(${e.args.map(go).join(", ")})`;
      case "arr": return `[${e.items.map(go).join(", ")}]`;
      case "as": return `(${go(e.e)} as ${e.ty})`;
      case "rec": return `({ ${e.fields.map(f => "spread" in f ? `...${go(f.spread)}` : `${"computed" in f ? `[${go(f.computed)}]` : J(f.key)}: ${go(f.v)}`).join(", ")} })`;
      case "spread": return `...${go(e.e)}`;
      case "omit": return `__.omit(${[go(e.e), ...e.keys.map(k => J(k))].join(", ")})`;
      case "fn": {
        const ps = e.params.join(", ");
        const names = imp ? this.handlerSnaps(e) : [];   // TY-2: a handler's reads are snapshots, so a view branch does not narrow them
        const saved = this.rename;
        if (names.length) { this.rename = new Map(saved); for (const n of names) this.rename.set(n, `__s_${n}`); }
        let inner: string; let async = false;
        if (!e.stmts) inner = this.expr(e.body, imp, self);
        else { async = hasAwait(e.stmts); const w = new W(); const sw = this.w; this.w = w; this.stmts(e.stmts, "  "); this.w = sw; inner = w.out.join("\n"); }
        this.rename = saved;
        if (!names.length) return e.stmts ? `(${async ? "async " : ""}(${ps}) => {\n${inner}\n})` : `((${ps}) => ${inner})`;
        const params = names.map(n => `__s_${n}: __W_${n}`).join(", ");
        const args = names.join(", ");
        return e.stmts ? `((${ps}) => ((${params}) => {\n${inner}\n})(${args}))` : `((${ps}) => ((${params}) => ${inner})(${args}))`;
      }
      case "serverfn": {                                                                       // SF-1d: an async function, its wire checked (TY-5a)
        const ps = e.params.map((n, i) => `${n}${e.ptypes?.[i] ? `: ${e.ptypes[i]}` : ""}`).join(", ");
        const w = new W(); const saved = this.w; this.w = w; this.stmts(e.body, "  "); this.w = saved;
        return `((__f) => (__.wire(__f, true), __f))(async (${ps})${e.ret ? `: Promise<${e.ret}>` : ""} => {\n${w.out.join("\n")}\n})`;
      }
      case "draft": { const w = new W(); const saved = this.w; this.w = w; this.stmts(e.body, "  "); this.w = saved; return `__.draft(${go(e.seed)}, (d) => {\n${w.out.join("\n")}\n})`; }
      case "use": return `__.use(${e.name})`;
      case "bin": return `(${go(e.l)} ${e.op === "==" ? "===" : e.op === "!=" ? "!==" : e.op} ${go(e.r)})`;
      case "un": return `(${e.op}${go(e.e)})`;
    }
  }

  // ---- views: JSX over Solid's JSX types ----
  markup(ms: Markup[], ind: string) {
    if (!ms.length) { this.w.emit(`${ind}null`, 0); return; }
    this.w.emit(`${ind}<>`, ms[0].line ?? 0);
    for (const m of ms) this.child(m, ind + "  ");
    this.w.emit(`${ind}</>`, ms[ms.length - 1].line ?? 0);
  }
  private region(decls: Decl[], view: Markup[], ind: string, line: number) {
    if (!decls.length) { this.markup(view, ind); return; }
    this.w.emit(`${ind}(() => {`, line); this.decls(decls, ind + "  "); this.w.emit(`${ind}  return (`, line); this.markup(view, ind + "    "); this.w.emit(`${ind}  );\n${ind}})()`, line);
  }
  private child(m: Markup, ind: string) {
    const line = m.line ?? 0;
    switch (m.k) {
      case "text": this.w.emit(`${ind}{${J(m.s)}}`, line); return;
      case "style": return;
      case "read": this.w.emit(`${ind}{${this.expr(m.e, false)}}`, line); return;
      case "el": {
        if (m.tag === "") { this.w.emit(`${ind}<>`, line); for (const c of m.children) this.child(c, ind + "  "); this.w.emit(`${ind}</>`, line); return; }
        const attrs = m.attrs.map(a => a.name === "..." ? ` {...${this.expr(a.e, false)}}` : a.e.k === "lit" && a.e.v === true ? ` ${a.name}` : ` ${a.name}={${this.expr(a.e, isHandler(a.name))}}`).join("");
        if (!m.children.length) { this.w.emit(`${ind}<${m.tag}${attrs} />`, line); return; }
        this.w.emit(`${ind}<${m.tag}${attrs}>`, line); for (const c of m.children) this.child(c, ind + "  "); this.w.emit(`${ind}</${m.tag}>`, line);
        void VOID_TAGS; return;
      }
      case "mif": {
        this.w.emit(`${ind}{${this.expr(m.c, false)} ? (`, line); this.region(m.tDecls, m.t, ind + "  ", line);
        this.w.emit(`${ind}) : (`, line); this.region(m.fDecls, m.f, ind + "  ", line); this.w.emit(`${ind})}`, line); return;
      }
      case "mfor": {
        this.w.emit(`${ind}{__.each(${this.expr(m.xs, false)}, (${m.name}) => (`, line); this.region(m.decls, m.body, ind + "  ", line); this.w.emit(`${ind}))}`, line); return;
      }
      case "loading": {
        if (m.on) this.w.emit(`${ind}{void ${this.expr(m.on, false)}}`, line);
        this.w.emit(`${ind}{(`, line); this.markup(m.fallback, ind + "  "); this.w.emit(`${ind})}{(`, line); this.region(m.decls, m.body, ind + "  ", line); this.w.emit(`${ind})}`, line); return;
      }
      case "portal": {
        if (m.to) this.w.emit(`${ind}{void ${this.expr(m.to, false)}}`, line);
        this.w.emit(`${ind}{(`, line); this.region(m.decls, m.body, ind + "  ", line); this.w.emit(`${ind})}`, line); return;
      }
      case "errored": {
        this.w.emit(`${ind}{((${m.errName ?? "__err"}: ${m.classes ? m.classes.join(" | ") : "Error"}) => (`, line); this.markup(m.fallback, ind + "  "); this.w.emit(`${ind}))(null!)}{(`, line);
        this.region(m.decls, m.body, ind + "  ", line); this.w.emit(`${ind})}`, line); return;
      }
    }
  }
}

function hasAwait(x: unknown): boolean { return JSON.stringify(x).includes('"k":"await"'); }
function freeIds(e: unknown, out = new Set<string>()): Set<string> {
  if (!e || typeof e !== "object") return out;
  if (Array.isArray(e)) { e.forEach(x => freeIds(x, out)); return out; }
  const o = e as Record<string, unknown>;
  if (o.k === "id") out.add(o.name as string);
  if (o.k === "pre") return out;                        // the previous instant's value: no ordering edge
  for (const [k, v] of Object.entries(o)) if (k !== "k") freeIds(v, out);
  return out;
}

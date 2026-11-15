// React components as a fourth ReactiveScript frontend, spike. A .react.tsx module (one default function component, React
// 19 hooks, imported hosts) is checked by React Compiler 1.0.0 and lowered onto the pinned RX AST, where the plan
// builders take it like any other frontend. Unlike TSX and yield, this is a translation of meaning, not of syntax: a
// React component reruns on every render and its handlers close over that render's values, while RX keeps live
// sources. A form is accepted only where the two read the same; every other form is a typed refusal (REFUSALS below).
// React Compiler supplies the rules of React (its CompileError events become REACT_COMPILER refusals) and the
// reactivity of each body value (a value it can't place is REACT_UNDECIDED). Nothing here is part of codemod.
import { parseSync, transformSync } from "@babel/core";
import ReactCompiler from "babel-plugin-react-compiler";
import SyntaxTypeScript from "@babel/plugin-syntax-typescript";
import type { Decl, Expr, Markup, Program, Stmt } from "../tsx/rx/ast.ts";
import { entryView } from "../tsx/rx/ast.ts";
import { joinPath, parseDeclarations, parseProgram, type JsDecl, type ModuleSet } from "../tsx/rx/compiler.ts";
import { resolvePlanV2, type Plan } from "../plan/resolve-v2.ts";
import { islandFor, islandPlan, type Island } from "./island.ts";

type N = any;

/** Each refusal names a React meaning RX would not reproduce, or a form this spike does not lower. */
export const REFUSALS = {
  REACT_COMPILER: "React Compiler rejected the component (rules of React): its reason is kept",
  REACT_NOT_COMPONENT: "React Compiler does not see a component here",
  REACT_UNDECIDED: "React Compiler's analysis does not place this value, so its render-time meaning is unknown",
  REACT_EFFECT: "effects run after commit in React; plan v2 has no effects",
  REACT_HOOK: "a hook with no RX meaning in this frontend (refs, context, reducers, library and custom hooks)",
  REACT_SET_STATE_IN_RENDER: "a setter called while rendering re-renders until it settles; RX has no render to repeat",
  REACT_STALE_READ: "after an await, a React handler still reads the render it was created in; RX reads the live value",
  REACT_URGENT_WRITE: "a setter after an await outside startTransition commits at once in React; Solid holds it with the action",
  REACT_OPTIMISTIC_BASE_WRITE: "a state under a useOptimistic value is written outside an async transition while one may be pending: React commits it at once and rebases the optimistic updates onto it; Solid holds it with the pending action",
  REACT_HELD_PLAIN_WRITE: "a plain handler writes a state an action writes, while an action can be pending: React commits the plain write at once, Solid holds it with the actions",
  REACT_OPTIMISTIC_OUTSIDE_ACTION: "useOptimistic's setter only means something inside an async transition",
  REACT_FALSY_RENDER: "`a && <X/>` renders a falsy non-boolean `a` (0, \"\") in React; RX renders nothing",
  REACT_LAZY_STATE: "useState(fn) and computed initial state are not lowered",
  REACT_PROPS: "the entry component takes no props in plan v2",
  REACT_SYNTAX: "a form outside this frontend's subset",
} as const;
export type RefusalCode = keyof typeof REFUSALS;

/** The fallback ladder (README): each part of an accepted program is lowered at one level, the way React Compiler
 *  logs a bailout instead of rejecting. precise: as before. snapshot: a React read of an older value (a stale read after
 *  an await, a read after the handler's own write, a write held by an inline action) lowered exactly, as data.
 *  coarse: a value React Compiler doesn't place, lowered as one derived value. island: a component run React's way on
 *  the JS host (a marked plan node). `replaces` is the refusal the part would have been; `by` says whether React
 *  Compiler's facts decided it or the frontend's own rule did (React Compiler doesn't model handlers or async). */
export type Level = "snapshot" | "coarse" | "island";
export type LevelEntry = { level: Level; replaces: RefusalCode | "STALE_OWN_READ" | "HELD_WRITE"; line: number; detail: string; by: "rc" | "frontend" };
const ladder = new WeakMap<Program, LevelEntry[]>();
/** The level entries of a lowered program (empty: every part is precise). */
export const levelsOf = (program: Program): LevelEntry[] => ladder.get(program) ?? [];
const islands = new WeakMap<ModuleSet, Island>();
/** The island an entry the frontend refused became (react/island.ts), if any. */
export const islandOf = (set: ModuleSet): Island | undefined => islands.get(set);
/** Every level a module set's programs and island use. */
export const ladderOf = (set: ModuleSet): LevelEntry[] => {
  const i = islands.get(set);
  return i ? [{ level: "island", replaces: i.view.reasons[0] as RefusalCode, line: i.line, detail: "runs as JS with the hook shim", by: "frontend" }]
    : [...set.programs.values()].flatMap(levelsOf);
};
/** The plan of a React entry: an island's, or plan v2 from the lowered program (checker lints the ladder settles accepted). */
export const reactPlan = (set: ModuleSet, opts: { async?: boolean } = {}): Plan => {
  const i = islands.get(set);
  return i ? islandPlan(i) : resolvePlanV2(set, { ...opts, accept: checkerAccepts(set) });
};
/** Checker diagnostics a lowered program's levels vouch for: STALE_OWN_READ, when a plain handler reads a state after
 *  writing it. React reads the render's value there, which is what RX gives such a read (W-4), so the read is meant. */
export const checkerAccepts = (set: ModuleSet): string[] =>
  [...set.programs.values()].some(p => levelsOf(p).some(l => l.replaces === "STALE_OWN_READ" && l.detail.startsWith("plain handler"))) ? ["STALE_OWN_READ"] : [];

export class ReactRefusal extends Error {
  code: RefusalCode; line: number;
  constructor(code: RefusalCode, filename: string, line: number, detail: string) {
    super(filename + ":" + line + ": " + code + ": " + detail);
    this.code = code; this.line = line;
  }
}

// ------------------------------------------------------------------------------------------- React Compiler facts

export type CompilerFacts = {
  status: "compiled" | "error" | "skipped";
  errors: { reason: string; line: number }[];
  /** Named body values (StoreLocal and destructured names) of the component, with React Compiler's reactive flag. */
  values: Map<string, { reactive: boolean }>;
};

/** Runs React Compiler 1.0.0 over `source` and reads its final ReactiveFunction (logger.debugLogIRs), as the
 *  react-to-solid compiler prototype does. Only the IR's shape is read; nothing parses compiled output. */
export function compilerFacts(source: string, filename: string): CompilerFacts {
  const events: N[] = [];
  let reactive: N;
  transformSync(source, {
    filename, babelrc: false, configFile: false, sourceType: "module", code: false,
    plugins: [[SyntaxTypeScript, { isTSX: true }], [ReactCompiler, {
      panicThreshold: "none", target: "19",
      logger: { logEvent: (_: string, e: N) => events.push(e), debugLogIRs: (v: N) => { if (v.kind === "reactive") reactive = v.value; } },
    }]],
  });
  const errors = events.filter(e => e.kind === "CompileError" || e.kind === "PipelineError").map(e => {
    const d = e.detail ?? {}, o = d.options ?? d;
    const loc = o.loc ?? o.details?.[0]?.loc ?? e.fnLoc;
    return { reason: [o.reason, o.description].filter(Boolean).join(": ") || String(e.data ?? e.kind), line: loc?.start?.line ?? 0 };
  });
  const values = new Map<string, { reactive: boolean }>();
  const note = (place: N) => { const name = place?.identifier?.name?.value; if (name) values.set(name, { reactive: values.get(name)?.reactive || !!place.reactive }); };
  const pattern = (p: N) => {
    if (p.kind === "ArrayPattern") for (const it of p.items) it.kind === "Identifier" ? note(it) : it.kind === "Spread" && note(it.place);
    else if (p.kind === "ObjectPattern") for (const q of p.properties) note(q.place);
  };
  const block = (stmts: N[]): void => {
    for (const s of stmts) {
      if (s.kind === "instruction") {
        const v = s.instruction.value;
        if (v.kind === "StoreLocal" || v.kind === "DeclareLocal") note(v.lvalue.place);
        if (v.kind === "Destructure") pattern(v.lvalue.pattern);
      } else if (s.kind === "scope" || s.kind === "pruned-scope") block(s.instructions);
    }
  };
  if (reactive) block(reactive.body);
  const status = errors.length ? "error" : events.some(e => e.kind === "CompileSuccess") ? "compiled" : "skipped";
  return { status, errors, values };
}

// ------------------------------------------------------------------------------------------- lowering

/** Solid's JSX text rule (as yield/lower.ts), which equals Babel's for the texts React gets. */
const WHITESPACE = /[\u0009-\u000d \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]/;
const jsxText = (raw: string): string => {
  let s = raw.replace(/\r/g, "");
  if (s.includes("\n"))
    s = s.split("\n").map((line, i) => (i ? line.replace(new RegExp("^" + WHITESPACE.source + "+"), "") : line))
      .filter(line => [...line].some(c => !WHITESPACE.test(c))).join(" ");
  return s.replace(new RegExp(WHITESPACE.source + "+", "g"), " ");
};
const OPS: Record<string, string> = { "===": "==", "!==": "!=", "+": "+", "<": "<", ">": ">", "<=": "<=", ">=": ">=", "&&": "&&", "||": "||" };
const BUILTIN: Record<string, string> = { filter: "filter", map: "map", findIndex: "indexOf" };
/** Whether every use of ref `name` is `name.current` inside a function (a handler), never in the view's attributes. */
function plainRefOnly(body: N, name: string): boolean {
  let ok = true;
  const visit = (n: N, inFn: boolean, parent?: N) => {
    if (!ok || !n || typeof n !== "object") return;
    if (Array.isArray(n)) return n.forEach((c) => visit(c, inFn, parent));
    if (n.type === "Identifier" && n.name === name && !(parent?.type === "VariableDeclarator" && parent.id === n)) {
      if (!(inFn && parent?.type === "MemberExpression" && parent.object === n && !parent.computed && parent.property.name === "current")) ok = false;
    }
    const fn = inFn || /Function/.test(n.type ?? "");
    for (const k of Object.keys(n)) if (k !== "loc") visit(n[k], fn, n);
  };
  visit(body, false);
  return ok;
}
/** Whether a function nested in `n` assigns or updates `name`. */
function assignedInClosure(n: N, name: string, inside = false): boolean {
  if (!n || typeof n !== "object") return false;
  if (Array.isArray(n)) return n.some((c) => assignedInClosure(c, name, inside));
  const nested = inside || /Function/.test(n.type ?? "");
  if (inside && (n.type === "AssignmentExpression" && n.left?.type === "Identifier" && n.left.name === name || n.type === "UpdateExpression" && n.argument?.name === name)) return true;
  return Object.keys(n).some((k) => k !== "loc" && assignedInClosure(n[k], name, nested));
}
/** Whether a render statement calls a state setter anywhere inside it (not inside a nested function). */
function callsSetter(n: N, scope: Map<string, { k: string }>): boolean {
  if (!n || typeof n !== "object") return false;
  if (Array.isArray(n)) return n.some((c) => callsSetter(c, scope));
  if (/Function/.test(n.type ?? "")) return false;
  if (n.type === "CallExpression" && n.callee?.type === "Identifier" && scope.get(n.callee.name)?.k === "setter") return true;
  return Object.keys(n).some((k) => k !== "loc" && callsSetter(n[k], scope));
}
const HOOKS_REFUSED: Record<string, RefusalCode> = { useEffect: "REACT_EFFECT", useLayoutEffect: "REACT_EFFECT", useInsertionEffect: "REACT_EFFECT" };

/** What a component-scope name is. */
type B =
  | { k: "state" } | { k: "optimistic" } | { k: "derived" }
  | { k: "setter"; target: string; optimistic: boolean }
  | { k: "action"; params: string[]; snaps: string[] }
  | { k: "handler"; fn: N }
  | { k: "host" }
  | { k: "updated"; e: Expr }        // an updater's parameter: the state's pending value in this handler
  | { k: "local" }           // a handler local, parameter or lambda parameter
  | { k: "let" }             // a render `let`, folded until it is read (coarse level)
  | { k: "ref" };            // a useRef only plain handlers touch: a signal the view never reads
type Scope = Map<string, B>;
/** One handler or action body being lowered (shared by its branches): each state's pending value (React hands an
 *  updater the value as the handler's earlier writes left it), states whose pending value a branch made unknown, states
 *  written so far, and in an action the snapshot parameters its reads became. */
type H = { pending: Map<string, Expr>; uncertain: Set<string>; written: Set<string>; snap?: Map<string, string>; held: Set<string>; awaits: boolean };
const newH = (snap: boolean): H => ({ pending: new Map(), uncertain: new Set(), written: new Set(), snap: snap ? new Map() : undefined, held: new Set(), awaits: false });
/** Where a handler statement runs: inside an async transition (an action), after an await, inside startTransition. */
type At = { action: boolean; awaited: boolean; transition: boolean; h?: H };

export function lowerReact(source: string, filename = "main.react.tsx"): Program {
  const ast = parseSync(source, { filename, babelrc: false, configFile: false, sourceType: "module", plugins: [[SyntaxTypeScript, { isTSX: true }]] }) as N;
  const refuse = (code: RefusalCode, n: N, detail: string = REFUSALS[code]): never => { throw new ReactRefusal(code, filename, n?.loc?.start?.line ?? 0, detail); };
  const line = (n: N) => n?.loc?.start?.line;
  const strip = (n: N): N => (n?.type === "ParenthesizedExpression" || n?.type === "TSAsExpression" || n?.type === "TSNonNullExpression" ? strip(n.expression) : n);
  const callee = (n: N): string | undefined => (n?.type === "CallExpression" && n.callee.type === "Identifier" ? n.callee.name : undefined);

  // ---- React Compiler first: the rules of React, and which names it places
  const facts = compilerFacts(source, filename);
  if (facts.status === "error") {
    const e = facts.errors[0];
    const setState = /setState|set state/i.test(e.reason);
    throw new ReactRefusal(setState ? "REACT_SET_STATE_IN_RENDER" : "REACT_COMPILER", filename, e.line, e.reason);
  }
  if (facts.status === "skipped") refuse("REACT_NOT_COMPONENT", ast.program);

  const levels: LevelEntry[] = [];
  const level = (l: Level, replaces: LevelEntry["replaces"], n: N, detail: string, by: LevelEntry["by"] = "frontend") => levels.push({ level: l, replaces, line: line(n) ?? 0, detail, by });
  /** Scalar types of body values, for snapshot parameters (plan v2 actions take scalars). */
  const types = new Map<string, "number" | "string" | "boolean">();
  const decls: Decl[] = [];
  const reactImports = new Set<string>();
  const module: Scope = new Map();
  for (const s of ast.program.body) {
    if (s.type !== "ImportDeclaration") continue;
    if (s.source.value === "react") { for (const sp of s.specifiers) reactImports.add(sp.imported?.name ?? sp.local.name); continue; }
    const names = s.specifiers.map((sp: N) => sp.type === "ImportSpecifier" && sp.imported.name === sp.local.name
      ? { name: sp.local.name, alias: sp.local.name } : refuse("REACT_SYNTAX", sp, "hosts are imported by name"));
    for (const n of names) module.set(n.name, { k: "host" });
    decls.push({ k: "import", names, from: s.source.value, pure: false, line: line(s) } as Decl);
  }
  // A module context, `const C = createContext(value)`: with no provider above the entry component, useContext(C) is
  // that value.
  const contexts = new Map<string, N>();
  for (const s of ast.program.body) {
    const d = s.type === "VariableDeclaration" && s.kind === "const" && s.declarations.length === 1 ? s.declarations[0] : undefined;
    if (d?.id.type === "Identifier" && callee(strip(d.init)) === "createContext" && reactImports.has("createContext") && strip(d.init).arguments.length === 1) contexts.set(d.id.name, strip(d.init).arguments[0]);
  }
  const exported = ast.program.body.filter((s: N) => s.type !== "ImportDeclaration" && !(s.type === "VariableDeclaration" && contexts.has(s.declarations[0]?.id?.name)));
  const def = exported.length === 1 && exported[0].type === "ExportDefaultDeclaration" ? exported[0].declaration : undefined;
  if (def?.type !== "FunctionDeclaration" || !def.id || def.async || def.generator) refuse("REACT_SYNTAX", exported[0] ?? ast.program, "one `export default function Name() { … }` and imports");
  if (def.params.length) refuse("REACT_PROPS", def.params[0]);
  const name = def.id.name;

  // The shape of each object state, from its seed, and the fields any list in the view is keyed by.
  type Shape = { kind: "scalar" } | { kind: "object"; fields: Map<string, Shape> } | { kind: "array"; item: Shape };
  const shapeOf = (n: N): Shape => {
    const e = strip(n);
    if (e.type === "ObjectExpression") return { kind: "object", fields: new Map(e.properties.filter((p: N) => p.type === "ObjectProperty" && p.key.type === "Identifier").map((p: N) => [p.key.name, shapeOf(p.value)])) };
    if (e.type === "ArrayExpression") return { kind: "array", item: e.elements.length ? shapeOf(e.elements[0]) : { kind: "scalar" } };
    return { kind: "scalar" };
  };
  const shapes = new Map<string, Shape>();
  /** Names whose value is a boolean: React renders a boolean child as nothing. */
  const bools = new Set<string>();
  /** States a useOptimistic value is derived from. */
  const optimisticBases = new Set<string>();
  const keys = new Set<string>();
  const findKeys = (x: N): void => {
    if (!x || typeof x !== "object") return;
    if (x.type === "JSXAttribute" && x.name?.name === "key") { const v = x.value?.expression; const c = v && v.type === "MemberExpression" && !v.computed ? v.property.name : undefined; if (c) keys.add(c); }
    for (const [k, y] of Object.entries(x)) if (k !== "loc") Array.isArray(y) ? y.forEach(findKeys) : findKeys(y);
  };

  // ---------------------------------------------------------------- expressions
  /** A reactive-scope expression (a derived value, a view hole, a seed). In a handler, `at` says whether it runs
   *  after an await, where reading a render value is a stale read. */
  const expr = (raw: N, scope: Scope, at?: At): Expr => {
    const n = strip(raw);
    switch (n.type) {
      case "StringLiteral": case "NumericLiteral": case "BooleanLiteral": return { k: "lit", v: n.value };
      case "NullLiteral": return refuse("REACT_SYNTAX", n, "null is not in the plan's scalars");
      case "Identifier": {
        if (n.name === "undefined") return { k: "lit", v: undefined };
        const b = scope.get(n.name);
        if (!b) return refuse("REACT_SYNTAX", n, "unknown name " + n.name);
        if (b.k === "let") return readLet(n);
        if ((b.k === "state" || b.k === "optimistic" || b.k === "derived") && at?.h) {
          const h = at.h, own = h.written.has(n.name);
          // Snapshot: in an action, a read after an await or after the action's own write is React's render value. It
          // becomes a parameter of the action, passed the value when the click starts it.
          if (h.snap && (at.awaited || own)) {
            if (!types.has(n.name)) refuse("REACT_STALE_READ", n, REFUSALS.REACT_STALE_READ + " (" + n.name + ": no scalar type to snapshot it as)");
            if (!h.snap.has(n.name)) { let p = n.name + "Then"; while (scope.has(p)) p += "_"; h.snap.set(n.name, p); level("snapshot", at.awaited ? "REACT_STALE_READ" : "STALE_OWN_READ", n, "action reads the render's " + n.name); }
            return { k: "id", name: h.snap.get(n.name)! };
          }
          if (at.awaited) refuse("REACT_STALE_READ", n, REFUSALS.REACT_STALE_READ + " (" + n.name + ")");
          if (own && b.k === "state") level("snapshot", "STALE_OWN_READ", n, "plain handler reads the render's " + n.name + " after writing it (RX W-4 gives the same value)");
        }
        if (b.k === "setter" || b.k === "action" || b.k === "handler") refuse("REACT_SYNTAX", n, n.name + " is called, not read");
        if (b.k === "updated") return b.e;
        return { k: "id", name: n.name };
      }
      case "MemberExpression": {
        if (n.optional) refuse("REACT_SYNTAX", n, "optional chaining");
        if (n.object.type === "Identifier" && scope.get(n.object.name)?.k === "ref") {
          if (!at?.h || at.action) refuse("REACT_HOOK", n, "a ref read outside a plain handler");
          const pending = at!.h!.pending.get(n.object.name);
          if (pending) level("snapshot", "STALE_OWN_READ", n, "plain handler reads ref " + n.object.name + " as its earlier write left it");
          return pending ?? { k: "id", name: n.object.name };
        }
        const o = expr(n.object, scope, at);
        if (n.computed) return { k: "index", o, i: expr(n.property, scope, at) };
        return { k: "member", o, p: n.property.name };
      }
      case "BinaryExpression": case "LogicalExpression":
        if (!OPS[n.operator]) refuse("REACT_SYNTAX", n, "operator " + n.operator);
        return { k: "bin", op: OPS[n.operator], l: expr(n.left, scope, at), r: expr(n.right, scope, at) };
      case "UnaryExpression":
        if (n.operator !== "!") refuse("REACT_SYNTAX", n, "operator " + n.operator);
        return { k: "un", op: "!", e: expr(n.argument, scope, at) };
      case "ConditionalExpression":
        return { k: "if", c: expr(n.test, scope, at), t: expr(n.consequent, scope, at), f: expr(n.alternate, scope, at) };
      case "ArrayExpression":
        return { k: "arr", items: n.elements.map((e: N) => (e && e.type !== "SpreadElement" ? expr(e, scope, at) : refuse("REACT_SYNTAX", e ?? n, "array holes and spreads"))) };
      case "ObjectExpression":
        return { k: "rec", fields: n.properties.map((p: N) => (p.type === "ObjectProperty" && !p.computed && p.key.type === "Identifier"
          ? { key: p.key.name, v: expr(p.value, scope, at) } : refuse("REACT_SYNTAX", p, p.type === "SpreadElement" ? "object spread (write the fields out)" : "object literals take plain named properties"))) };
      case "CallExpression": {
        const c = n.callee;
        if (c.type === "MemberExpression" && !c.computed && BUILTIN[c.property.name] && n.arguments.length === 1)
          return { k: "call", f: { k: "id", name: BUILTIN[c.property.name] }, args: [expr(c.object, scope, at), lambda(n.arguments[0], scope, at)] };
        if (c.type === "Identifier" && /^use[A-Z]?/.test(c.name)) refuse("REACT_HOOK", n, "a hook inside an expression: " + c.name);
        if (c.type === "Identifier" && scope.get(c.name)?.k === "setter") refuse("REACT_SET_STATE_IN_RENDER", n);
        return refuse("REACT_SYNTAX", n, "only array builtins (filter, map, findIndex) are called in expressions here");
      }
      case "ArrowFunctionExpression": case "FunctionExpression":
        return refuse("REACT_SYNTAX", n, "functions are values only as array-builtin callbacks");
      case "TemplateLiteral": return refuse("REACT_SYNTAX", n, "template literals");
      case "JSXElement": case "JSXFragment": return refuse("REACT_SYNTAX", n, "JSX outside the returned view");
      default: return refuse("REACT_SYNTAX", n, "unsupported expression " + n.type);
    }
  };
  const lambda = (n: N, scope: Scope, at?: At): Expr => {
    if (n?.type !== "ArrowFunctionExpression" || n.async || n.params.length !== 1 || n.params[0].type !== "Identifier" || n.body.type === "BlockStatement")
      return refuse("REACT_SYNTAX", n, "an array builtin takes one (item) => expression callback");
    const inner: Scope = new Map(scope); inner.set(n.params[0].name, { k: "local" });
    // a callback's own parameter is not a render value, but anything else it reads still is
    return { k: "fn", params: [n.params[0].name], body: expr(n.body, inner, at) };
  };

  // ---------------------------------------------------------------- handlers
  const body = (n: N): N[] => (n.type === "BlockStatement" ? n.body : [{ type: "ExpressionStatement", expression: n, loc: n.loc }]);
  /** `startTransition(async () => { … })`: the async callback, or undefined. */
  const asyncTransition = (n: N): N | undefined => {
    const e = strip(n);
    if (callee(e) !== "startTransition" || e.arguments.length !== 1) return undefined;
    const f = e.arguments[0];
    return (f.type === "ArrowFunctionExpression" || f.type === "FunctionExpression") && f.async && !f.params.length ? f : undefined;
  };
  /** A call of an action that snapshots render values passes them: the caller's reads, as the click sees them. */
  const snapArgs = (snaps: string[], n: N, scope: Scope, at: At): Expr[] =>
    snaps.map(name => expr({ type: "Identifier", name, loc: n.loc }, scope, at));
  /** Lowers branches each from the pending values before them; a state a branch wrote has an unknown pending value
   *  after it (an updater of it is then refused). */
  const branches = <T,>(at: At, ...run: (() => T)[]): T[] => {
    const h = at.h;
    if (!h) return run.map(f => f());
    const before = new Map(h.pending), out: T[] = [], changed = new Set<string>();
    for (const f of run) {
      h.pending = new Map(before);
      out.push(f());
      for (const [k, v] of h.pending) if (before.get(k) !== v) changed.add(k);
    }
    h.pending = before;
    for (const k of changed) { h.pending.delete(k); h.uncertain.add(k); }
    return out;
  };
  const statements = (ss: N[], scope: Scope, at: At): Stmt[] => {
    const out: Stmt[] = [];
    for (const s of ss) out.push(...statement(s, scope, at));
    return out;
  };
  const statement = (s: N, scope: Scope, at: At): Stmt[] => {
    if (s.type === "ExpressionStatement") {
      const e = strip(s.expression);
      const assigned = e.type === "AssignmentExpression" ? e.left : e.type === "UpdateExpression" ? e.argument : undefined;
      const ref = assigned?.type === "MemberExpression" && !assigned.computed && assigned.property.name === "current" && assigned.object.type === "Identifier" && scope.get(assigned.object.name)?.k === "ref" ? assigned.object.name : undefined;
      if (ref) {
        if (!at.h || at.action) refuse("REACT_HOOK", e, "a ref written outside a plain handler");
        const now = at.h.pending.get(ref) ?? { k: "id", name: ref } as Expr;
        if (at.h.pending.has(ref)) level("snapshot", "STALE_OWN_READ", e, "plain handler: ref " + ref + " write composed onto the earlier write");
        const OPS_: Record<string, string> = { "+=": "+", "++": "+" };
        const op = e.type === "UpdateExpression" ? OPS_[e.operator] : e.operator === "=" ? undefined : OPS_[e.operator] ?? refuse("REACT_SYNTAX", e, "operator " + e.operator);
        const value: Expr = op ? { k: "bin", op, l: now, r: e.type === "UpdateExpression" ? { k: "lit", v: 1 } : expr(e.right, scope, at) } as Expr : expr(e.right, scope, at);
        at.h.pending.set(ref, value);
        return [{ k: "write", target: { name: ref, path: [], ctx: false }, e: value } as Stmt];
      }
      if (e.type === "AwaitExpression") { at.awaited = true; at.transition = false; if (at.h) at.h.awaits = true; return [{ k: "expr", e: { k: "await", e: hostCall(e.argument, scope, at) } }]; }
      if (e.type !== "CallExpression") return refuse("REACT_SYNTAX", s, "a handler statement calls a setter, an action, a host or startTransition");
      const c = callee(e);
      if (c === "startTransition") {
        const f = e.arguments[0];
        if (asyncTransition(e)) return refuse("REACT_SYNTAX", e, "an async transition is the whole handler or a named action, not one statement among others");
        if (f?.type !== "ArrowFunctionExpression" && f?.type !== "FunctionExpression" || f.params.length || f.async) return refuse("REACT_SYNTAX", e, "startTransition takes a callback");
        return statements(body(f.body), scope, { ...at, transition: true });
      }
      const b = c ? scope.get(c) : undefined;
      if (b?.k === "setter") return write(e, b, scope, at);
      if (b?.k === "action") {
        if (e.arguments.length !== b.params.length) refuse("REACT_SYNTAX", e, "an action takes its declared arguments");
        return [{ k: "expr", e: { k: "call", f: { k: "id", name: c! }, args: [...e.arguments.map((a: N) => expr(a, scope, at)), ...snapArgs(b.snaps, e, scope, at)] } }];
      }
      if (b?.k === "handler") {
        if (e.arguments.length || b.fn.params.length) refuse("REACT_SYNTAX", e, "a local handler is called with no arguments here");
        return handlerBody(b.fn, scope, at);
      }
      if (b?.k === "host") return [{ k: "expr", e: { k: "call", f: { k: "id", name: c! }, args: e.arguments.map((a: N) => expr(a, scope, at)) } }];
      return refuse("REACT_SYNTAX", s, "a handler statement calls a setter, an action, a host or startTransition");
    }
    if (s.type === "VariableDeclaration" && s.kind === "const" && s.declarations.length === 1 && s.declarations[0].id.type === "Identifier") {
      const d = s.declarations[0], init = strip(d.init);
      const e = init.type === "AwaitExpression" ? (at.awaited = true, at.transition = false, at.h && (at.h.awaits = true), { k: "await", e: hostCall(init.argument, scope, at) } as Expr) : expr(init, scope, at);
      scope.set(d.id.name, { k: "local" });
      return [{ k: "let", name: d.id.name, e }];
    }
    if (s.type === "TryStatement") {
      if (s.finalizer) refuse("REACT_SYNTAX", s, "finally");
      const tryAt = { ...at };
      // the catch may run after the try's await, so it reads as late as the try's end
      const catchAt = { ...at };
      const inner: Scope = new Map(scope);
      if (s.handler?.param) { if (s.handler.param.type !== "Identifier") refuse("REACT_SYNTAX", s.handler.param, "catch binds one name"); }
      const [tryBody, handler] = branches(at,
        () => statements(s.block.body, new Map(scope), tryAt),
        () => { catchAt.awaited = tryAt.awaited; catchAt.transition = tryAt.transition; return s.handler ? statements(s.handler.body.body, inner, catchAt) : []; });
      at.awaited = at.awaited || tryAt.awaited || catchAt.awaited;
      at.transition = tryAt.transition && catchAt.transition;
      return [{ k: "try", body: tryBody, catchName: s.handler?.param?.name ?? "error", handler }];
    }
    if (s.type === "IfStatement") {
      const tAt = { ...at }, fAt = { ...at };
      const c = expr(s.test, scope, at);
      const [t, f] = branches(at, () => statements(body(s.consequent), new Map(scope), tAt), () => s.alternate ? statements(body(s.alternate), new Map(scope), fAt) : []);
      const st: Stmt = { k: "sif", c, t, f };
      at.awaited = at.awaited || tAt.awaited || fAt.awaited;
      at.transition = tAt.transition && fAt.transition;
      return [st];
    }
    if (s.type === "ReturnStatement" && !s.argument) return [{ k: "return" }];
    return refuse("REACT_SYNTAX", s, "statement " + s.type + " in a handler");
  };
  const hostCall = (n: N, scope: Scope, at: At): Expr => {
    const e = strip(n), c = callee(e);
    if (!c || scope.get(c)?.k !== "host") return refuse("REACT_SYNTAX", n, "await takes a call of an imported host");
    if (!at.action) refuse("REACT_SYNTAX", n, "an await outside startTransition(async …) is an ordinary async callback; React keeps no pending state for it");
    return { k: "call", f: { k: "id", name: c }, args: e.arguments.map((a: N) => expr(a, scope, at)) };
  };
  const write = (call: N, b: Extract<B, { k: "setter" }>, scope: Scope, at: At): Stmt[] => {
    if (call.arguments.length !== 1) refuse("REACT_SYNTAX", call, "a setter takes one value or updater");
    if (b.optimistic && !at.action) refuse("REACT_OPTIMISTIC_OUTSIDE_ACTION", call);
    if (!b.optimistic && !at.action && optimisticBases.has(b.target)) refuse("REACT_OPTIMISTIC_BASE_WRITE", call, REFUSALS.REACT_OPTIMISTIC_BASE_WRITE + " (" + b.target + ")");
    if (at.action && at.awaited && !at.transition && !b.optimistic) refuse("REACT_URGENT_WRITE", call);
    const arg = strip(call.arguments[0]);
    const h = at.h;
    const whole = (e: Expr): Stmt[] => {
      if (h && !b.optimistic) { h.pending.set(b.target, e); h.uncertain.delete(b.target); }
      return [{ k: b.optimistic ? "optimistic" : "write", target: { name: b.target, path: [], ctx: false }, e } as Stmt];
    };
    if (h && !b.optimistic && at.action && !at.awaited) h.held.add(b.target);
    if (!b.optimistic) { const m = at.action ? actionWrites : plainWrites; if (!m.has(b.target)) m.set(b.target, call); }
    const wrote = <T,>(x: T): T => { if (h && !b.optimistic) h.written.add(b.target); return x; };
    // A structured state (an object seed) is a store in RX, and plan v2 writes a store by path only. React writes it by
    // copying: setX((prev) => ({ ...prev, list: prev.list.map((r) => r.id === id ? { ...r, f: v } : r) })). That copy is
    // lowered to the path writes it amounts to.
    if (!b.optimistic && shapes.get(b.target)?.kind === "object") {
      if (arg.type !== "ArrowFunctionExpression" || arg.params.length !== 1 || arg.params[0].type !== "Identifier" || arg.body.type === "BlockStatement")
        return refuse("REACT_SYNTAX", arg, "an object state is updated by copying: setX((prev) => ({ ...prev, field: value }))");
      if (h) { h.pending.delete(b.target); h.uncertain.add(b.target); }
      return wrote(copyWrites(strip(arg.body), arg.params[0].name, shapes.get(b.target)!, [], { k: "id", name: b.target }, b.target, scope, at, new Set([arg.params[0].name])));
    }
    if (arg.type === "ArrowFunctionExpression") {
      if (arg.async || arg.params.length !== 1 || arg.params[0].type !== "Identifier" || arg.body.type === "BlockStatement") refuse("REACT_SYNTAX", arg, "an updater is (prev) => expression");
      const inner: Scope = new Map(scope);
      // An optimistic updater stays a function. A plain one reads the state it writes, as `x := f(x)`: plan v2 has no
      // functional plain writes, and React hands the updater the pending value, which the checker's stale-own-read
      // rule keeps equal to the state as it stands (a second write to x in the same handler is refused).
      if (b.optimistic) { inner.set(arg.params[0].name, { k: "local" }); return whole({ k: "fn", params: [arg.params[0].name], body: expr(arg.body, inner, at) }); }
      // React hands the updater the pending value: the state as this handler's earlier writes left it.
      if (h?.uncertain.has(b.target)) refuse("REACT_SYNTAX", arg, "an updater of " + b.target + " after a branch that may have written it");
      const pending = h?.pending.get(b.target);
      if (pending) level("snapshot", "STALE_OWN_READ", arg, (at.action ? "action" : "plain handler") + ": updater of " + b.target + " composed onto the earlier write");
      inner.set(arg.params[0].name, { k: "updated", e: pending ?? { k: "id", name: b.target } });
      return wrote(whole(expr(arg.body, inner, at)));
    }
    return wrote(whole(expr(arg, scope, at)));
  };
  /** Text of a member chain (prev, prev.list, r), or undefined. */
  const chain = (n: N): string | undefined => {
    const e = strip(n);
    if (e.type === "Identifier") return e.name;
    if (e.type === "MemberExpression" && !e.computed && !e.optional) { const o = chain(e.object); return o === undefined ? undefined : o + "." + e.property.name; }
    return undefined;
  };
  /** `node` is the new value of the part of the state that `base` (a member chain over prev or a row parameter) names,
   *  at RX `path` of `target`; `current` is the RX expression for that part as it stands. Returns the path writes the
   *  copy amounts to. `copies` are the names a value may not read: React hands them the pending state, and a path write
   *  would read the store as it stands, so a value that reads them is not lowered. */
  const copyWrites = (node: N, base: string, shape: Shape, path: (string | Expr)[], current: Expr, target: string, scope: Scope, at: At, copies: Set<string>): Stmt[] => {
    if (chain(node) === base) return [];
    const value = (v: N): Expr => {
      const reads = (x: N): boolean => !!x && typeof x === "object" && (x.type === "Identifier" && copies.has(x.name) || Object.entries(x).some(([k, y]) => k !== "loc" && (Array.isArray(y) ? y.some(reads) : reads(y))));
      if (reads(v)) refuse("REACT_SYNTAX", v, "a copied field's new value reads the previous state; only fixed values and handler locals are lowered");
      return expr(v, scope, at);
    };
    if (node.type === "ObjectExpression") {
      if (shape.kind !== "object") return refuse("REACT_SYNTAX", node, "an object copy of a non-object");
      const spread = node.properties.filter((p: N) => p.type === "SpreadElement");
      if (spread.length > 1 || spread.length && (node.properties[0].type !== "SpreadElement" || chain(spread[0].argument) !== base))
        refuse("REACT_SYNTAX", node, "a copy spreads the value it copies first: { ..." + base + ", field: value }");
      const named = node.properties.filter((p: N) => p.type !== "SpreadElement");
      for (const p of named) if (p.type !== "ObjectProperty" || p.computed || p.key.type !== "Identifier" || !shape.fields.has(p.key.name))
        refuse("REACT_SYNTAX", p, "a copy sets fields its state already has (adding or computing keys is not lowered)");
      if (!spread.length) for (const f of shape.fields.keys()) if (!named.some((p: N) => p.key.name === f))
        refuse("REACT_SYNTAX", node, "a copy without ...spread drops field " + f + "; spread the value it copies");
      const out: Stmt[] = [];
      for (const p of named) {
        const f = p.key.name, sub = shape.fields.get(f)!, v = strip(p.value), at2: Expr = { k: "member", o: current, p: f };
        if (chain(v) === base + "." + f) continue;
        if (v.type === "ObjectExpression" || v.type === "CallExpression" && sub.kind === "array") out.push(...copyWrites(v, base + "." + f, sub, [...path, f], at2, target, scope, at, copies));
        else out.push({ k: "write", target: { name: target, path: [...path, f], ctx: false }, e: value(v) });
      }
      return out;
    }
    const c = node.type === "CallExpression" ? node.callee : undefined;
    if (c?.type === "MemberExpression" && !c.computed && c.property.name === "map" && chain(c.object) === base && shape.kind === "array") {
      // xs.map((r) => r.k === e ? copy-of-r : r): React changes every row that matches; the path write changes the
      // first. They agree when k is unique, which React already requires of a row key (the list's key={r.k}).
      const f = node.arguments[0], r = f?.params?.[0]?.name, b = f && strip(f.body);
      const test = b?.type === "ConditionalExpression" ? strip(b.test) : undefined;
      const side = test?.type === "BinaryExpression" && test.operator === "===" ? [test.left, test.right].findIndex((x: N) => chain(x)?.startsWith(r + ".") && chain(x)!.split(".").length === 2) : -1;
      if (f?.type !== "ArrowFunctionExpression" || f.params.length !== 1 || !r || side < 0 || chain(b.alternate) !== r)
        return refuse("REACT_SYNTAX", node, "a row copy is xs.map((r) => (r.key === value ? { ...r, field: value } : r))");
      const key = chain(side ? test.right : test.left)!.split(".")[1];
      if (!keys.has(key)) refuse("REACT_SYNTAX", test, "the row is matched by " + key + ", which no list in the view uses as its key; React only guarantees keys are unique");
      const probe = side ? test.left : test.right;
      const index: Expr = { k: "call", f: { k: "id", name: "indexOf" }, args: [current, { k: "fn", params: [r], body: { k: "bin", op: "==", l: { k: "member", o: { k: "id", name: r }, p: key }, r: value(probe) } }] };
      return copyWrites(strip(b.consequent), r, shape.item, [...path, index], { k: "index", o: current, i: index }, target, scope, at, new Set([...copies, r]));
    }
    return refuse("REACT_SYNTAX", node, "an object state is updated by copying: { ...prev, field: value } or xs.map((r) => r.key === v ? { ...r, field: value } : r)");
  };
  /** A handler arrow's statements. An async transition body becomes an action body. */
  const handlerBody = (fn: N, scope: Scope, at: At): Stmt[] => {
    const inner: Scope = new Map(scope);
    for (const p of fn.params) inner.set(p.name, { k: "local" });
    const t = fn.body.type !== "BlockStatement" || fn.body.body.length === 1 ? asyncTransition(fn.body.type === "BlockStatement" ? fn.body.body[0].expression : fn.body) : undefined;
    if (t) {
      if (at.action) refuse("REACT_SYNTAX", fn, "a transition inside an action (nested actions are not verified)");
      const h = newH(true);
      const stmts = statements(body(t.body), inner, { action: true, awaited: false, transition: true, h });
      const held = h.held.size > 0 && h.awaits;
      if (held) holds.push({ targets: h.held, n: t });
      if (h.awaits) awaiting ??= t;
      if (!held && !h.snap!.size) return stmts;
      // Snapshot: an inline action that holds a write (React holds every update of an async transition until it ends)
      // or reads render values late is hoisted into a declared action, which RX holds as a whole; each late read is a
      // parameter, passed the value as the click sees it.
      let name = "clickAction" + hoisted++;
      while (scope.has(name)) name += "_";
      if (held) level("snapshot", "HELD_WRITE", t, "inline action hoisted into a declared action " + name);
      const snaps = [...h.snap!.keys()];
      cdecls.push({ k: "action", name, params: snaps.map(x => h.snap!.get(x)!), ptypes: snaps.map(x => types.get(x)!), body: stmts, line: line(t) } as Decl);
      return [{ k: "expr", e: { k: "call", f: { k: "id", name }, args: snapArgs(snaps, t, scope, at) } }];
    }
    if (fn.async) refuse("REACT_SYNTAX", fn, "an async handler outside startTransition is an ordinary async callback; React keeps no pending state for it");
    return statements(body(fn.body), inner, at.h ? { ...at } : { ...at, h: newH(false) });
  };
  const handlerAttr = (v: N, scope: Scope): Expr => {
    const f = strip(v);
    if (f.type === "Identifier") {
      const b = scope.get(f.name);
      if (b?.k === "handler") return { k: "fn", params: [], body: { k: "lit", v: undefined }, stmts: handlerBody(b.fn, scope, { action: false, awaited: false, transition: false }) };
      if (b?.k === "action" && !b.params.length) return { k: "fn", params: [], body: { k: "lit", v: undefined }, stmts: [{ k: "expr", e: { k: "call", f: { k: "id", name: f.name }, args: snapArgs(b.snaps, f, scope, { action: false, awaited: false, transition: false, h: newH(false) }) } }] };
      return refuse("REACT_SYNTAX", f, "onClick takes a handler");
    }
    if ((f.type !== "ArrowFunctionExpression" && f.type !== "FunctionExpression") || f.params.length) return refuse("REACT_SYNTAX", f, "onClick takes () => { … } (the DOM event is not lowered)");
    return { k: "fn", params: [], body: { k: "lit", v: undefined }, stmts: handlerBody(f, scope, { action: false, awaited: false, transition: false }) };
  };

  // ---------------------------------------------------------------- view
  const isBool = (n: N, scope: Scope): boolean => {
    const e = strip(n);
    if (e.type === "BooleanLiteral" || e.type === "Identifier" && bools.has(e.name)) return true;
    if (e.type === "UnaryExpression" && e.operator === "!") return true;
    if (e.type === "BinaryExpression" && ["===", "!==", "<", ">", "<=", ">="].includes(e.operator)) return true;
    if (e.type === "LogicalExpression" && e.operator !== "??") return isBool(e.left, scope) && isBool(e.right, scope);
    return false;
  };
  const display = (raw: N, scope: Scope): Markup[] => {
    const e = strip(raw);
    if (e.type === "ConditionalExpression")
      return [{ k: "mif", c: expr(e.test, scope), t: display(e.consequent, scope), tDecls: [], f: display(e.alternate, scope), fDecls: [], line: line(e) } as Markup];
    if (e.type === "LogicalExpression" && e.operator === "&&" && (e.right.type === "JSXElement" || e.right.type === "JSXFragment" || strip(e.right).type === "CallExpression")) {
      if (!isBool(e.left, scope)) refuse("REACT_FALSY_RENDER", e.left);
      return [{ k: "mif", c: expr(e.left, scope), t: display(e.right, scope), tDecls: [], f: [], fDecls: [], line: line(e) } as Markup];
    }
    if (e.type === "JSXElement" || e.type === "JSXFragment") return markup(e, scope);
    if (e.type === "NullLiteral" || isBool(e, scope)) return [];
    if (e.type === "CallExpression" && e.callee.type === "MemberExpression" && !e.callee.computed && e.callee.property.name === "map") {
      const f = e.arguments[0];
      if (e.arguments.length !== 1 || f?.type !== "ArrowFunctionExpression" || f.params.length !== 1 || f.params[0].type !== "Identifier")
        return refuse("REACT_SYNTAX", e, "a list is xs.map((item) => <row key={…}>…</row>) (the index is not lowered)");
      const row = strip(f.body.type === "BlockStatement" ? (f.body.body.length === 1 && f.body.body[0].type === "ReturnStatement" ? f.body.body[0].argument : refuse("REACT_SYNTAX", f.body, "a row returns its JSX only")) : f.body);
      if (row.type !== "JSXElement") refuse("REACT_SYNTAX", row, "a row is one element");
      if (!row.openingElement.attributes.some((a: N) => a.type === "JSXAttribute" && a.name.name === "key")) refuse("REACT_SYNTAX", row, "a row has a key");
      const inner: Scope = new Map(scope); inner.set(f.params[0].name, { k: "local" });
      return [{ k: "mfor", name: f.params[0].name, xs: expr(e.callee.object, scope), decls: [], body: markup(row, inner), line: line(e) } as Markup];
    }
    return [{ k: "read", e: { k: "bin", op: "+", l: { k: "lit", v: "" }, r: expr(e, scope) }, line: line(e) } as Markup];
  };
  const markup = (raw: N, scope: Scope): Markup[] => {
    const n = strip(raw);
    if (n.type === "JSXFragment") return n.children.flatMap((c: N) => markup(c, scope));
    if (n.type === "JSXText") { const s = jsxText(n.value); return s ? [{ k: "text", s, line: line(n) } as Markup] : []; }
    if (n.type === "JSXExpressionContainer") return n.expression.type === "JSXEmptyExpression" ? [] : display(n.expression, scope);
    if (n.type !== "JSXElement") return refuse("REACT_SYNTAX", n, "a view is JSX");
    const open = n.openingElement;
    if (open.name.type !== "JSXIdentifier" || /^[A-Z]/.test(open.name.name)) return refuse("REACT_SYNTAX", open, "only host elements (child components are not lowered yet)");
    const attrs: { name: string; e: Expr }[] = [];
    for (const a of open.attributes) {
      if (a.type !== "JSXAttribute") refuse("REACT_SYNTAX", a, "spread props");
      if (a.name.name === "key") continue;
      if (a.name.name !== "onClick" || a.value?.type !== "JSXExpressionContainer") refuse("REACT_SYNTAX", a, "only onClick (and a row's key) are lowered");
      attrs.push({ name: "onClick", e: handlerAttr(a.value.expression, scope) });
    }
    return [{ k: "el", tag: open.name.name, attrs, children: n.children.flatMap((c: N) => markup(c, scope)), line: line(n) } as Markup];
  };

  // ---------------------------------------------------------------- component body
  const scope: Scope = new Map(module);
  const cdecls: Decl[] = [];
  let view: Markup[] | undefined;
  let hoisted = 0;
  /** States an action writes before an await (held until it ends), and states plain and action handlers write. React
   *  commits a plain write at once over a pending transition's update. Solid holds a state a pending action wrote, plain
   *  writes to it included, until the action ends, and actions that hold a state they both write are merged, so one
   *  action's late write can wait on another. So when an action holds a write, or awaits (it can overlap another, or
   *  itself clicked again, and its late writes wait with it), no state an action writes may also be written by a plain
   *  handler. */
  const holds: { targets: Set<string>; n: N }[] = [];
  let awaiting: N | undefined;
  const plainWrites = new Map<string, N>(), actionWrites = new Map<string, N>();
  /** A scalar type of an expression, where it is plain from literals and typed names. */
  const typeOf = (raw: N): "number" | "string" | "boolean" | undefined => {
    const e = strip(raw);
    if (e.type === "NumericLiteral") return "number";
    if (e.type === "StringLiteral") return "string";
    if (e.type === "BooleanLiteral" || isBool(e, scope)) return "boolean";
    if (e.type === "Identifier") return types.get(e.name);
    if (e.type === "BinaryExpression" && e.operator === "+") { const l = typeOf(e.left), r = typeOf(e.right); return l === "string" || r === "string" ? (l && r ? "string" : undefined) : l === "number" && r === "number" ? "number" : undefined; }
    if (e.type === "ConditionalExpression") { const t = typeOf(e.consequent); return t && t === typeOf(e.alternate) ? t : undefined; }
    return undefined;
  };
  /** Whether the component reads `name` anywhere but where it is declared. */
  const referenced = (name: string): boolean => {
    let count = 0;
    const visit = (x: N, parentKey?: string): void => {
      if (!x || typeof x !== "object") return;
      if (Array.isArray(x)) return x.forEach(y => visit(y, parentKey));
      if (x.type === "Identifier" && x.name === name && parentKey !== "property" && parentKey !== "key") count++;
      for (const [k, y] of Object.entries(x)) if (k !== "loc" && k !== "typeAnnotation") visit(y, k);
    };
    visit(def.body);
    return count > 1;
  };
  /** React Compiler places every value it keeps. One it drops is unread (an unused state or const): nothing can depend
   *  on it, so it is kept as written (coarse, by React Compiler's fact). Any other unplaced value is refused. */
  const placed = (id: N): void => {
    if (facts.values.has(id.name)) return;
    if (referenced(id.name)) refuse("REACT_UNDECIDED", id, REFUSALS.REACT_UNDECIDED + " (" + id.name + ")");
    level("coarse", "REACT_UNDECIDED", id, id.name + " is never read; React Compiler drops it", "rc");
  };

  // Coarse: a render `let` and its reassignments are folded into one value, `if` by `if` (a conditional), and become a
  // derived value where the component first reads it; a reassignment after that read is refused. React Compiler must
  // place the let (it then keeps it as a plain render local: nothing mutates or captures it).
  const lets = new Map<string, { e: Expr; line: number; types: Set<string | undefined> }>();
  let folding = 0;
  const readLet = (n: N): Expr => {
    const l = lets.get(n.name)!;
    if (folding) return l.e;
    lets.delete(n.name);
    cdecls.push({ k: "eq", name: n.name, e: l.e, line: l.line } as Decl);
    scope.set(n.name, { k: "derived" });
    if (l.types.size === 1 && [...l.types][0]) types.set(n.name, [...l.types][0] as "number");
    level("coarse", "REACT_UNDECIDED", n, "render let " + n.name + " folded into one derived value", facts.values.has(n.name) ? "rc" : "frontend");
    return { k: "id", name: n.name };
  };
  /** A render statement that only reassigns lets: `x = e`, or an `if` of such statements. */
  const fold = (st: N): void => {
    if (st.type === "BlockStatement") return st.body.forEach(fold);
    if (st.type === "ExpressionStatement" && st.expression.type === "AssignmentExpression" && st.expression.operator === "=" && st.expression.left.type === "Identifier") {
      const x = st.expression.left.name;
      if (scope.get(x)?.k !== "let" || !lets.has(x)) refuse("REACT_UNDECIDED", st, "a render assignment to " + x + " after it was read, or to a name that is not a render let");
      folding++;
      try { lets.get(x)!.e = expr(st.expression.right, scope); lets.get(x)!.types.add(typeOf(st.expression.right)); } finally { folding--; }
      return;
    }
    if (st.type === "IfStatement") {
      folding++;
      const c = (() => { try { return expr(st.test, scope); } finally { folding--; } })();
      const before = new Map([...lets].map(([k, v]) => [k, v.e]));
      fold(st.consequent);
      const after = new Map([...lets].map(([k, v]) => [k, v.e]));
      for (const [k, e] of before) lets.get(k)!.e = e;
      if (st.alternate) fold(st.alternate);
      for (const [k, l] of lets) if (after.get(k) !== before.get(k) || l.e !== before.get(k)) l.e = { k: "if", c, t: after.get(k)!, f: l.e } as Expr;
      return;
    }
    refuse("REACT_UNDECIDED", st, "a render statement other than a let reassignment or an if of them (" + st.type + ")");
  };
  /** A seed computed from the render (useState(a + 1), useState(() => e)): React uses its first render's value, which
   *  is the expression over the other states' seeds. Folded to that, it is coarse. */
  const firstValues = new Map<string, Expr>();
  const firstRender = (e: Expr): Expr => {
    const walk = (x: any, bound: Set<string>): any => {
      if (!x || typeof x !== "object") return x;
      if (Array.isArray(x)) return x.map(y => walk(y, bound));
      if (x.k === "id" && !bound.has(x.name) && firstValues.has(x.name)) return firstValues.get(x.name);
      if (x.k === "id" && !bound.has(x.name) && scope.has(x.name) && !module.has(x.name)) refuse("REACT_LAZY_STATE", undefined, "an initial state reads " + x.name + ", which has no first-render value here");
      const inner = x.k === "fn" ? new Set([...bound, ...x.params]) : bound;
      return Object.fromEntries(Object.entries(x).map(([k, y]) => [k, walk(y, inner)]));
    };
    return walk(e, new Set());
  };
  findKeys(def.body);
  for (const s of def.body.body) {
    if (view) refuse("REACT_SYNTAX", s, "the view is the last statement");
    if (s.type === "ReturnStatement") { view = s.argument ? markup(s.argument, scope) : []; continue; }
    if (s.type === "ExpressionStatement" && s.expression.type === "AssignmentExpression" && lets.size) { fold(s); continue; }
    if (s.type === "ExpressionStatement") {
      const c = callee(strip(s.expression));
      if (c && HOOKS_REFUSED[c]) refuse(HOOKS_REFUSED[c], s);
      if (c && /^use/.test(c)) refuse("REACT_HOOK", s, "hook " + c);
      if (c && scope.get(c)?.k === "setter") refuse("REACT_SET_STATE_IN_RENDER", s);
      refuse("REACT_SYNTAX", s, "a statement during render");
    }
    if (s.type !== "VariableDeclaration" && callsSetter(s, scope)) refuse("REACT_SET_STATE_IN_RENDER", s);
    if (s.type === "IfStatement" && lets.size) { fold(s); continue; }
    if (s.type !== "VariableDeclaration" || s.declarations.length !== 1) refuse("REACT_SYNTAX", s, s.type === "VariableDeclaration" ? "one declaration per statement" : "statement " + s.type + " during render");
    if (s.kind === "let") {
      const d = s.declarations[0];
      if (d.id.type !== "Identifier" || !d.init || callee(strip(d.init))?.startsWith("use")) refuse("REACT_UNDECIDED", s, "a render let is one name with a plain initial value");
      // React Compiler keeps a let a closure reads as a context variable, which it does not place; a closure that only
      // reads it sees the render's final value, so the frontend still folds it (and says it did).
      if (!facts.values.has(d.id.name) && assignedInClosure(def.body, d.id.name)) refuse("REACT_UNDECIDED", d.id, REFUSALS.REACT_UNDECIDED + " (" + d.id.name + ")");
      folding++;
      try { lets.set(d.id.name, { e: expr(d.init, scope), line: line(s), types: new Set([typeOf(d.init)]) }); } finally { folding--; }
      scope.set(d.id.name, { k: "let" });
      continue;
    }
    if (s.kind !== "const") refuse("REACT_UNDECIDED", s, "only const and let values are placed");
    const d = s.declarations[0], init = strip(d.init);
    const hook = callee(init);
    if (hook === "useState" || hook === "useOptimistic") {
      if (!reactImports.has(hook)) refuse("REACT_HOOK", init, hook + " is React's only when imported from react");
      if (d.id.type !== "ArrayPattern" || d.id.elements.length !== 2 || d.id.elements.some((x: N) => x?.type !== "Identifier"))
        refuse("REACT_SYNTAX", d.id, "const [value, setValue] = " + hook + "(…)");
      const [v, set] = d.id.elements;
      placed(v);
      if (hook === "useState") {
        let a = init.arguments[0];
        if (init.arguments.length !== 1) refuse("REACT_SYNTAX", init, "useState takes one initial value");
        let seed: Expr;
        if (a.type === "ArrowFunctionExpression" || a.type === "FunctionExpression") {
          // useState(() => e): React calls it once, on the first render. A pure expression (calls other than the
          // array builtins are refused by expr) is that value.
          const ret = a.body.type !== "BlockStatement" ? a.body : a.body.body.length === 1 && a.body.body[0].type === "ReturnStatement" ? a.body.body[0].argument : undefined;
          if (a.params.length || a.async || !ret) refuse("REACT_LAZY_STATE", init);
          a = ret;
          seed = firstRender(expr(a, scope));
          level("coarse", "REACT_LAZY_STATE", init, "lazy initial state of " + v.name + " is its first call's value");
        } else {
          let reads = false;
          try { seed = expr(a, module); } catch (e) { if (!(e instanceof ReactRefusal)) throw e; reads = true; seed = firstRender(expr(a, scope)); }
          if (reads) level("coarse", "REACT_LAZY_STATE", init, "initial state of " + v.name + " computed from the first render");
        }
        firstValues.set(v.name, seed!);
        cdecls.push({ k: "source", name: v.name, init: seed!, line: line(s) } as Decl);
        shapes.set(v.name, shapeOf(a));
        const ty = typeOf(a); if (ty) types.set(v.name, ty);
        if (strip(a).type === "BooleanLiteral") bools.add(v.name);
        scope.set(v.name, { k: "state" });
        scope.set(set.name, { k: "setter", target: v.name, optimistic: false });
      } else {
        if (init.arguments.length !== 1) refuse("REACT_SYNTAX", init, "useOptimistic's reducer is not lowered: pass updaters to its setter");
        const guess = expr(init.arguments[0], scope);
        try { firstValues.set(v.name, firstRender(guess)); } catch (e) { if (!(e instanceof ReactRefusal)) throw e; }
        cdecls.push({ k: "source", name: v.name, init: guess, question: true, line: line(s) } as Decl);
        if (isBool(init.arguments[0], scope)) bools.add(v.name);
        const ty = typeOf(init.arguments[0]); if (ty) types.set(v.name, ty);
        const bases = (x: N): void => { if (!x || typeof x !== "object") return; if (Array.isArray(x)) return x.forEach(bases);
          if (x.type === "Identifier" && scope.get(x.name)?.k === "state") optimisticBases.add(x.name);
          for (const [k, y] of Object.entries(x)) if (k !== "loc") bases(y); };
        bases(init.arguments[0]);
        scope.set(v.name, { k: "optimistic" });
        scope.set(set.name, { k: "setter", target: v.name, optimistic: true });
      }
      continue;
    }
    if (hook && HOOKS_REFUSED[hook]) refuse(HOOKS_REFUSED[hook], init);
    // A ref: React Compiler refuses a component that reads or writes .current while rendering, so once it accepts one,
    // the ref lives in handlers only. There it is a cell whose writes are seen at once (unlike state): a signal the
    // view never reads, each read taking the handler's pending value. Refs passed to elements or used in actions are
    // refused here (the island level may take them).
    if (hook === "useRef" && reactImports.has("useRef") && d.id.type === "Identifier" && init.arguments.length <= 1) {
      const a = init.arguments[0];
      let seed: Expr | undefined;
      try { seed = a ? expr(a, module) : undefined; } catch (e) { if (!(e instanceof ReactRefusal)) throw e; }
      if (seed && plainRefOnly(def.body, d.id.name)) {
        cdecls.push({ k: "source", name: d.id.name, init: seed, line: line(s) } as Decl);
        const ty = typeOf(a); if (ty) types.set(d.id.name, ty);
        scope.set(d.id.name, { k: "ref" });
        level("coarse", "REACT_HOOK", init, "ref " + d.id.name + " is a signal plain handlers write and read; React Compiler shows the render never touches it", "rc");
        continue;
      }
    }
    if (hook === "useContext" && reactImports.has("useContext") && d.id.type === "Identifier" && init.arguments[0]?.type === "Identifier" && contexts.has(init.arguments[0].name)) {
      const a = contexts.get(init.arguments[0].name);
      cdecls.push({ k: "eq", name: d.id.name, e: expr(a, module), line: line(s) } as Decl);
      firstValues.set(d.id.name, expr(a, module));
      const ty = typeOf(a); if (ty) types.set(d.id.name, ty);
      if (strip(a).type === "BooleanLiteral") bools.add(d.id.name);
      scope.set(d.id.name, { k: "derived" });
      level("coarse", "REACT_HOOK", init, "useContext(" + init.arguments[0].name + ") with no provider is the context's default", "frontend");
      continue;
    }
    if (hook && /^use/.test(hook)) refuse("REACT_HOOK", init, "hook " + hook);
    if (d.id.type !== "Identifier") refuse("REACT_SYNTAX", d.id, "a body value is bound to one name");
    placed(d.id);
    if (init.type === "ArrowFunctionExpression" || init.type === "FunctionExpression") {
      const t = init.body.type !== "BlockStatement" ? asyncTransition(init.body) : init.body.body.length === 1 && init.body.body[0].type === "ExpressionStatement" ? asyncTransition(init.body.body[0].expression) : undefined;
      if (t) {
        const params = init.params.map((p: N) => p.type === "Identifier" ? p : refuse("REACT_SYNTAX", p, "action parameters are names"));
        const ptypes = params.map((p: N) => {
          const t = p.typeAnnotation?.typeAnnotation?.type;
          return t === "TSNumberKeyword" ? "number" : t === "TSStringKeyword" ? "string" : t === "TSBooleanKeyword" ? "boolean" : refuse("REACT_SYNTAX", p, "action parameters need a scalar type");
        });
        const inner: Scope = new Map(scope);
        for (const p of params) inner.set(p.name, { k: "local" });
        const binding = { k: "action" as const, params: params.map((p: N) => p.name), snaps: [] as string[] };
        scope.set(d.id.name, binding);
        const h = newH(true);
        const actionBody = statements(body(t.body), inner, { action: true, awaited: false, transition: true, h });
        binding.snaps = [...h.snap!.keys()];
        if (h.held.size && h.awaits) holds.push({ targets: h.held, n: s });
        if (h.awaits) awaiting ??= s;
        cdecls.push({ k: "action", name: d.id.name, params: [...params.map((p: N) => p.name), ...binding.snaps.map(x => h.snap!.get(x)!)], ptypes: [...ptypes, ...binding.snaps.map(x => types.get(x)!)], body: actionBody, line: line(s) } as Decl);
      } else scope.set(d.id.name, { k: "handler", fn: init });
      continue;
    }
    if (!facts.values.has(d.id.name)) continue;
    const value = expr(init, scope);
    try { firstValues.set(d.id.name, firstRender(value)); } catch (e) { if (!(e instanceof ReactRefusal)) throw e; }
    cdecls.push({ k: "eq", name: d.id.name, e: value, line: line(s) } as Decl);
    if (isBool(init, scope)) bools.add(d.id.name);
    const ty = typeOf(init); if (ty) types.set(d.id.name, ty);
    scope.set(d.id.name, { k: "derived" });
  }
  if (!view) refuse("REACT_SYNTAX", def, "the component returns its view");
  const holder = holds[0]?.n ?? awaiting;
  if (holder) for (const x of actionWrites.keys()) if (plainWrites.has(x))
    refuse("REACT_HELD_PLAIN_WRITE", plainWrites.get(x), "a plain handler writes " + x + ", which an action also writes while an action can be pending (line " + line(holder) + "): React commits the plain write at once, Solid holds it with the actions");
  decls.push({ k: "component", name, props: "props", decls: cdecls, view, line: line(def), exported: true, isDefault: true } as Decl);
  const program: Program = { decls, view: entryView(name, line(def)) };
  ladder.set(program, levels);
  return program;
}

/** The entry module and its imports, as loadYieldModules: `.react.tsx` modules are lowered here, `.rx` parsed, and
 *  JS hosts take their declaration file (`api.d.rx`) beside them. */
export function loadReactModules(entry: string, read: (path: string) => string | undefined): ModuleSet {
  entry = joinPath("", entry);
  const programs = new Map<string, Program>();
  const order: string[] = [];
  const diags: ModuleSet["diags"] = [];
  const declarations = new Map<string, JsDecl[]>();
  const visit = (path: string): void => {
    if (programs.has(path)) return;
    const source = read(path);
    if (source === undefined) { diags.push({ code: "MODULE_NOT_FOUND", rule: "MO-6", file: path, line: 1, msg: "no module " + path }); return; }
    let program: Program;
    try { program = path.endsWith(".rx") ? parseProgram(source) : lowerReact(source, path); }
    catch (e) {
      const island = path === entry && e instanceof ReactRefusal ? islandFor(source, path, e, read, from => joinPath(path, from.replace(/\.(m?js|ts)$/, "") + ".d.rx")) : undefined;
      if (!island) throw e;
      islandHere = island;
      return;
    }
    for (const d of program.decls) {
      if (d.k !== "import") continue;
      if (/\.(rx|tsx)$/.test(d.from)) { d.resolved = joinPath(path, d.from); visit(d.resolved); continue; }
      const key = joinPath(path, d.from.replace(/\.(m?js|ts)$/, "") + ".d.rx");
      const text = read(key);
      if (text === undefined) continue;
      if (!declarations.has(key)) declarations.set(key, parseDeclarations(text));
      const ds = declarations.get(key)!;
      d.declared = key;
      d.declaredErrors = ds.filter(x => x.kind === "error").map(x => x.name);
      d.declaredPure = ds.filter(x => x.kind === "fn" && x.pure).map(x => x.name);
      d.declaredSide = Object.fromEntries(ds.flatMap(x => (x.kind === "fn" && x.side ? [[x.name, x.side]] : [])));
    }
    programs.set(path, program);
    order.push(path);
  };
  let islandHere: Island | undefined;
  visit(entry);
  const set = { entry, programs, order, diags, declarations };
  if (islandHere) islands.set(set, islandHere);
  return set;
}

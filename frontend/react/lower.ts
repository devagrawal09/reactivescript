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
  REACT_OPTIMISTIC_OUTSIDE_ACTION: "useOptimistic's setter only means something inside an async transition",
  REACT_FALSY_RENDER: "`a && <X/>` renders a falsy non-boolean `a` (0, \"\") in React; RX renders nothing",
  REACT_LAZY_STATE: "useState(fn) and computed initial state are not lowered",
  REACT_PROPS: "the entry component takes no props in plan v2",
  REACT_SYNTAX: "a form outside this frontend's subset",
} as const;
export type RefusalCode = keyof typeof REFUSALS;

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
  | { k: "action"; params: string[] }
  | { k: "handler"; fn: N }
  | { k: "host" }
  | { k: "updated"; target: string }
  | { k: "local" };          // a handler local, parameter or lambda parameter
type Scope = Map<string, B>;
/** Where a handler statement runs: inside an async transition (an action), after an await, inside startTransition. */
type At = { action: boolean; awaited: boolean; transition: boolean };

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
  const exported = ast.program.body.filter((s: N) => s.type !== "ImportDeclaration");
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
        if ((b.k === "state" || b.k === "optimistic" || b.k === "derived") && at?.awaited) refuse("REACT_STALE_READ", n, REFUSALS.REACT_STALE_READ + " (" + n.name + ")");
        if (b.k === "setter" || b.k === "action" || b.k === "handler") refuse("REACT_SYNTAX", n, n.name + " is called, not read");
        if (b.k === "updated") return { k: "id", name: b.target };
        return { k: "id", name: n.name };
      }
      case "MemberExpression": {
        if (n.optional) refuse("REACT_SYNTAX", n, "optional chaining");
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
  const statements = (ss: N[], scope: Scope, at: At): Stmt[] => {
    const out: Stmt[] = [];
    for (const s of ss) out.push(...statement(s, scope, at));
    return out;
  };
  const statement = (s: N, scope: Scope, at: At): Stmt[] => {
    if (s.type === "ExpressionStatement") {
      const e = strip(s.expression);
      if (e.type === "AwaitExpression") { at.awaited = true; at.transition = false; return [{ k: "expr", e: { k: "await", e: hostCall(e.argument, scope, at) } }]; }
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
        return [{ k: "expr", e: { k: "call", f: { k: "id", name: c! }, args: e.arguments.map((a: N) => expr(a, scope, at)) } }];
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
      const e = init.type === "AwaitExpression" ? (at.awaited = true, at.transition = false, { k: "await", e: hostCall(init.argument, scope, at) } as Expr) : expr(init, scope, at);
      scope.set(d.id.name, { k: "local" });
      return [{ k: "let", name: d.id.name, e }];
    }
    if (s.type === "TryStatement") {
      if (s.finalizer) refuse("REACT_SYNTAX", s, "finally");
      const tryAt = { ...at };
      const tryBody = statements(s.block.body, new Map(scope), tryAt);
      // the catch may run after the try's await, so it reads as late as the try's end
      const catchAt = { ...at, awaited: tryAt.awaited, transition: tryAt.transition };
      const inner: Scope = new Map(scope);
      if (s.handler?.param) { if (s.handler.param.type !== "Identifier") refuse("REACT_SYNTAX", s.handler.param, "catch binds one name"); }
      const handler = s.handler ? statements(s.handler.body.body, inner, catchAt) : [];
      at.awaited = at.awaited || tryAt.awaited || catchAt.awaited;
      at.transition = tryAt.transition && catchAt.transition;
      return [{ k: "try", body: tryBody, catchName: s.handler?.param?.name ?? "error", handler }];
    }
    if (s.type === "IfStatement") {
      const tAt = { ...at }, fAt = { ...at };
      const st: Stmt = { k: "sif", c: expr(s.test, scope, at), t: statements(body(s.consequent), new Map(scope), tAt), f: s.alternate ? statements(body(s.alternate), new Map(scope), fAt) : [] };
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
    const whole = (e: Expr): Stmt[] => [{ k: b.optimistic ? "optimistic" : "write", target: { name: b.target, path: [], ctx: false }, e } as Stmt];
    // A structured state (an object seed) is a store in RX, and plan v2 writes a store by path only. React writes it by
    // copying: setX((prev) => ({ ...prev, list: prev.list.map((r) => r.id === id ? { ...r, f: v } : r) })). That copy is
    // lowered to the path writes it amounts to.
    if (!b.optimistic && shapes.get(b.target)?.kind === "object") {
      if (arg.type !== "ArrowFunctionExpression" || arg.params.length !== 1 || arg.params[0].type !== "Identifier" || arg.body.type === "BlockStatement")
        return refuse("REACT_SYNTAX", arg, "an object state is updated by copying: setX((prev) => ({ ...prev, field: value }))");
      return copyWrites(strip(arg.body), arg.params[0].name, shapes.get(b.target)!, [], { k: "id", name: b.target }, b.target, scope, at, new Set([arg.params[0].name]));
    }
    if (arg.type === "ArrowFunctionExpression") {
      if (arg.async || arg.params.length !== 1 || arg.params[0].type !== "Identifier" || arg.body.type === "BlockStatement") refuse("REACT_SYNTAX", arg, "an updater is (prev) => expression");
      const inner: Scope = new Map(scope);
      // An optimistic updater stays a function. A plain one reads the state it writes, as `x := f(x)`: plan v2 has no
      // functional plain writes, and React hands the updater the pending value, which the checker's stale-own-read
      // rule keeps equal to the state as it stands (a second write to x in the same handler is refused).
      if (b.optimistic) { inner.set(arg.params[0].name, { k: "local" }); return whole({ k: "fn", params: [arg.params[0].name], body: expr(arg.body, inner, at) }); }
      inner.set(arg.params[0].name, { k: "updated", target: b.target });
      return whole(expr(arg.body, inner, at));
    }
    return whole(expr(arg, scope, at));
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
      return statements(body(t.body), inner, { action: true, awaited: false, transition: true });
    }
    if (fn.async) refuse("REACT_SYNTAX", fn, "an async handler outside startTransition is an ordinary async callback; React keeps no pending state for it");
    return statements(body(fn.body), inner, { ...at });
  };
  const handlerAttr = (v: N, scope: Scope): Expr => {
    const f = strip(v);
    if (f.type === "Identifier") {
      const b = scope.get(f.name);
      if (b?.k === "handler") return { k: "fn", params: [], body: { k: "lit", v: undefined }, stmts: handlerBody(b.fn, scope, { action: false, awaited: false, transition: false }) };
      if (b?.k === "action" && !b.params.length) return { k: "fn", params: [], body: { k: "lit", v: undefined }, stmts: [{ k: "expr", e: { k: "call", f: { k: "id", name: f.name }, args: [] } }] };
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
  const placed = (id: N) => { if (!facts.values.has(id.name)) refuse("REACT_UNDECIDED", id, REFUSALS.REACT_UNDECIDED + " (" + id.name + ")"); };
  findKeys(def.body);
  for (const s of def.body.body) {
    if (view) refuse("REACT_SYNTAX", s, "the view is the last statement");
    if (s.type === "ReturnStatement") { view = s.argument ? markup(s.argument, scope) : []; continue; }
    if (s.type === "ExpressionStatement") {
      const c = callee(strip(s.expression));
      if (c && HOOKS_REFUSED[c]) refuse(HOOKS_REFUSED[c], s);
      if (c && /^use/.test(c)) refuse("REACT_HOOK", s, "hook " + c);
      if (c && scope.get(c)?.k === "setter") refuse("REACT_SET_STATE_IN_RENDER", s);
      refuse("REACT_SYNTAX", s, "a statement during render");
    }
    if (s.type !== "VariableDeclaration" && callsSetter(s, scope)) refuse("REACT_SET_STATE_IN_RENDER", s);
    if (s.type !== "VariableDeclaration" || s.declarations.length !== 1) refuse("REACT_SYNTAX", s, s.type === "VariableDeclaration" ? "one declaration per statement" : "statement " + s.type + " during render");
    if (s.kind !== "const") refuse("REACT_UNDECIDED", s, "a `let` in render is reassigned during render; only const values are placed");
    const d = s.declarations[0], init = strip(d.init);
    const hook = callee(init);
    if (hook === "useState" || hook === "useOptimistic") {
      if (!reactImports.has(hook)) refuse("REACT_HOOK", init, hook + " is React's only when imported from react");
      if (d.id.type !== "ArrayPattern" || d.id.elements.length !== 2 || d.id.elements.some((x: N) => x?.type !== "Identifier"))
        refuse("REACT_SYNTAX", d.id, "const [value, setValue] = " + hook + "(…)");
      const [v, set] = d.id.elements;
      placed(v);
      if (hook === "useState") {
        const a = init.arguments[0];
        if (init.arguments.length !== 1 || a.type === "ArrowFunctionExpression" || a.type === "FunctionExpression") refuse("REACT_LAZY_STATE", init);
        cdecls.push({ k: "source", name: v.name, init: expr(a, module), line: line(s) } as Decl);
        shapes.set(v.name, shapeOf(a));
        if (strip(a).type === "BooleanLiteral") bools.add(v.name);
        scope.set(v.name, { k: "state" });
        scope.set(set.name, { k: "setter", target: v.name, optimistic: false });
      } else {
        if (init.arguments.length !== 1) refuse("REACT_SYNTAX", init, "useOptimistic's reducer is not lowered: pass updaters to its setter");
        cdecls.push({ k: "source", name: v.name, init: expr(init.arguments[0], scope), question: true, line: line(s) } as Decl);
        if (isBool(init.arguments[0], scope)) bools.add(v.name);
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
        scope.set(d.id.name, { k: "action", params: params.map((p: N) => p.name) });
        const actionBody = statements(body(t.body), inner, { action: true, awaited: false, transition: true });
        cdecls.push({ k: "action", name: d.id.name, params: params.map((p: N) => p.name), ptypes, body: actionBody, line: line(s) } as Decl);
      } else scope.set(d.id.name, { k: "handler", fn: init });
      continue;
    }
    cdecls.push({ k: "eq", name: d.id.name, e: expr(init, scope), line: line(s) } as Decl);
    if (isBool(init, scope)) bools.add(d.id.name);
    scope.set(d.id.name, { k: "derived" });
  }
  if (!view) refuse("REACT_SYNTAX", def, "the component returns its view");
  decls.push({ k: "component", name, props: "props", decls: cdecls, view, line: line(def), exported: true, isDefault: true } as Decl);
  return { decls, view: entryView(name, line(def)) };
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
    const program = path.endsWith(".rx") ? parseProgram(source) : lowerReact(source, path);
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
  visit(entry);
  return { entry, programs, order, diags, declarations };
}

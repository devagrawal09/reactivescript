// solid-yield's explicit generator dialect as a third ReactiveScript frontend (spike). A yield module is translated
// into the Solid 2 TSX that solid-yield itself maps it to ($signal is createSignal, $memo createMemo, $event an action,
// $optimistic createOptimistic, $store createStore, view holes reads, For/Show Solid's own), and that TSX is lowered by
// the existing TSX frontend onto the pinned RX AST. Only a small subset is accepted; every other form is refused here
// with its own diagnostic, located in the yield source. See docs/YIELD.md.
// Explicit Node entry, as tsx/lower.ts: the browser condition the Solid tests use would select Oxc's WASM build.
import { parseSync } from "oxc-parser/src-js/index";
import { loadTsxModules } from "../tsx/modules.ts";
import { lowerTsx, TsxError } from "../tsx/lower.ts";
import type { ModuleSet } from "../tsx/rx/compiler.ts";

type N = any;
export class YieldError extends Error {
  filename: string; line: number; column: number; start: number; end: number;
  constructor(filename: string, source: string, at: { start: number; end: number }, message: string) {
    const before = source.slice(0, at.start);
    const line = before.split("\n").length, column = at.start - before.lastIndexOf("\n");
    super(filename + ":" + line + ":" + column + ": " + message);
    this.filename = filename; this.line = line; this.column = column; this.start = at.start; this.end = at.end;
  }
}

/** A piece of generated TSX: verbatim pieces map offset for offset, generated ones to their construct's start. */
type Piece = { text: string; src: number; verbatim: boolean };
class Out {
  pieces: Piece[] = [];
  gen(text: string, src: number) { this.pieces.push({ text, src, verbatim: false }); return this; }
  copy(source: string, start: number, end: number) { if (end > start) this.pieces.push({ text: source.slice(start, end), src: start, verbatim: true }); return this; }
  add(o: Out) { this.pieces.push(...o.pieces); return this; }
  get text() { return this.pieces.map(p => p.text).join(""); }
  /** The yield offset an offset of the generated text came from. */
  origin(offset: number): number {
    let at = 0;
    for (const p of this.pieces) {
      if (offset < at + p.text.length) return p.verbatim ? p.src + (offset - at) : p.src;
      at += p.text.length;
    }
    return this.pieces.at(-1)?.src ?? 0;
  }
}

const SUBSET = new Set(["component", "view", "$signal", "$memo", "$event", "$optimistic", "$store", "attempt", "For", "Show"]);
const TYPES = new Set(["Props", "Source", "Handler"]);
const LATER: Record<string, string> = {
  $effect: "effects are not in the yield subset yet",
  $cleanup: "cleanups are not in the yield subset yet",
  $optimisticStore: "$optimisticStore is Solid's createOptimisticStore, which the RX frontends do not lower",
  $projection: "projections are not in the yield subset yet",
  createContext: "contexts are not in the yield subset yet",
  Loading: "Loading needs async sources, which the yield subset does not lower",
  Errored: "Errored and typed failures are not in the yield subset yet",
  Switch: "Switch/Match are not in the yield subset yet", Match: "Switch/Match are not in the yield subset yet",
  Repeat: "Repeat is not in the yield subset yet", lazy: "lazy components are not in the yield subset",
  refresh: "refresh needs a question source, which the yield subset does not lower",
  raise: "raise and typed failures are not in the yield subset yet", Failure: "typed failures are not in the yield subset yet",
  until: "until is not in the yield subset", foreign: "foreign hand-offs are not in the yield subset",
};

type Kind = { k: "accessor" } | { k: "path" } | { k: "setter" } | { k: "event"; params: { name: string; type: string }[] };
type Scope = Map<string, Kind | { k: "local"; out: Out }>;

export function yieldToTsx(source: string, filename = "main.tsx"): { tsx: string; out: Out } {
  const parsed = parseSync(filename, source, { sourceType: "module", lang: "tsx" });
  const fail = (n: { start: number; end: number }, message: string): never => { throw new YieldError(filename, source, n, message); };
  if (parsed.errors.length) {
    const e = parsed.errors[0] as N;
    fail({ start: e.labels?.[0]?.start ?? 0, end: e.labels?.[0]?.end ?? 0 }, e.message);
  }
  const program = parsed.program as N;
  const aliases = new Map<string, N>();
  const solid = new Set<string>();
  const out = new Out();
  const text = (n: N) => source.slice(n.start, n.end);

  // ---------------------------------------------------------------- types
  const type = (t: N): string => {
    if (t.type === "TSTypeReference" && t.typeName.type === "Identifier") {
      const name = t.typeName.name, args = t.typeArguments?.params ?? [];
      if (name === "Source") return type(args[0]);
      if (name === "Handler") {
        const tuple = args[0];
        if (tuple?.type !== "TSTupleType") fail(t, "Handler takes a tuple of argument types, Handler<[T]>");
        return "(" + tuple.elementTypes.map((e: N, i: number) => "arg" + i + ": " + type(e)).join(", ") + ") => void";
      }
      if (aliases.has(name)) return type(aliases.get(name));
      if (TYPES.has(name)) fail(t, "Props<…> is only the component's parameter type");
    }
    if (t.type === "TSTypeLiteral")
      return "{ " + t.members.map((m: N) => {
        if (m.type !== "TSPropertySignature" || m.key.type !== "Identifier" || m.optional || !m.typeAnnotation)
          return fail(m, "Props members must be required named properties with a type");
        return m.key.name + ": " + type(m.typeAnnotation.typeAnnotation);
      }).join("; ") + " }";
    return text(t);
  };

  // ---------------------------------------------------------------- reads and expressions
  const isYield = (n: N) => n?.type === "YieldExpression" && n.delegate;
  const read = (n: N, scope: Scope): Out => {
    // yield* x: an accessor is called, a store / props / row path is read as a path.
    const arg = n.argument;
    let root = arg;
    while (root.type === "MemberExpression" && !root.computed) root = root.object;
    if (root.type !== "Identifier") return fail(n, "yield* reads a source, a store path, a prop or a row: unsupported operand");
    const kind = scope.get(root.name);
    if (!kind) return fail(n, "yield* of an unknown source: " + root.name);
    if (kind.k === "accessor" && root === arg) return new Out().copy(source, arg.start, arg.end).gen("()", arg.end);
    if (kind.k === "path") return new Out().copy(source, arg.start, arg.end);
    if (kind.k === "local") return kind.out;
    return fail(n, kind.k === "event" ? "an event is bound in a view or called with yield* evt(…) in an event, not read"
      : "a setter is delegated to in an event, yield* set(v), not read");
  };
  /** Copy an expression, replacing every yield* read in it. */
  const expr = (n: N, scope: Scope): Out => {
    const o = new Out();
    let at = n.start;
    const visit = (x: N) => {
      if (!x || typeof x !== "object") return;
      if (Array.isArray(x)) { x.forEach(visit); return; }
      if (typeof x.type !== "string") return;
      if (x.type === "YieldExpression") {
        if (!x.delegate) fail(x, "a plain yield is not a yield-dialect read; use yield*");
        o.copy(source, at, x.start).add(read(x, scope)); at = x.end; return;
      }
      if (x.type === "Identifier" && scope.get(x.name)?.k === "local" && x !== n.__skip) {
        o.copy(source, at, x.start).add((scope.get(x.name) as { out: Out }).out); at = x.end; return;
      }
      if (["FunctionExpression", "ArrowFunctionExpression"].includes(x.type) && (x.generator || x.async))
        fail(x, "nested routines are not in the yield subset here");
      if (x.type === "JSXElement" || x.type === "JSXFragment") fail(x, "JSX belongs to a view");
      for (const [k, v] of Object.entries(x)) if (k !== "start" && k !== "end" && k !== "type") visit(v);
    };
    visit(n);
    return o.copy(source, at, n.end);
  };

  // ---------------------------------------------------------------- setup
  const callee = (n: N): string | undefined => n?.type === "CallExpression" && n.callee.type === "Identifier" ? n.callee.name : undefined;
  const routine = (n: N, what: string): N => {
    if (n?.type !== "FunctionExpression" || !n.generator) fail(n ?? program, what + " takes a function* routine");
    if (n.async) fail(n, "routines are function*, never async (solid-yield refuses async routines too)");
    return n;
  };
  /** A memo body: const locals bound to reads, then one return; the locals are substituted into the return. */
  const memoBody = (fn: N, scope: Scope): Out => {
    const inner: Scope = new Map(scope);
    const body = fn.body.body;
    for (const s of body.slice(0, -1)) {
      if (s.type !== "VariableDeclaration" || s.kind !== "const" || s.declarations.length !== 1 || s.declarations[0].id.type !== "Identifier" || !isYield(s.declarations[0].init))
        fail(s, "a memo body binds reads (const x = yield* source) and returns one expression");
      inner.set(s.declarations[0].id.name, { k: "local", out: read(s.declarations[0].init, scope) });
    }
    const ret = body.at(-1);
    if (ret?.type !== "ReturnStatement" || !ret.argument) fail(fn, "a memo body ends with one return");
    if (body.some((s: N) => s.type === "VariableDeclaration" && s.declarations[0].init?.argument && callee(s.declarations[0].init.argument) === "attempt"))
      fail(fn, "async memos (attempt in $memo) are not in the yield subset");
    return expr(ret.argument, inner);
  };
  const eventStatements = (ss: N[], scope: Scope): Out => {
    const o = new Out();
    for (let i = 0; i < ss.length; i++) {
      const s = ss[i];
      if (s.type === "ExpressionStatement" && isYield(s.expression)) {
        const call = s.expression.argument;
        if (call.type !== "CallExpression") fail(s, "an event statement delegates to a write or an event call: yield* set(v) or yield* evt(x)");
        const name = call.callee.type === "Identifier" ? call.callee.name : undefined;
        const kind = name ? scope.get(name) : undefined;
        const handlerProp = call.callee.type === "MemberExpression" && call.callee.object.type === "Identifier" && call.callee.object.name === "props";
        if (!(kind?.k === "setter" || kind?.k === "event" || handlerProp)) fail(call, "only a setter, a local $event or a Handler prop is called from an event");
        o.add(expr(call, scope)).gen(";", s.end);
        continue;
      }
      if (s.type === "ExpressionStatement" && s.expression.type === "CallExpression" && scope.get(callee(s.expression) ?? "")?.k === "setter")
        fail(s, "a setter returns a receipt: the write happens only at yield* set(v) (solid-yield's UNYIELDED_WRITE); a bare call writes nothing there, so it is refused rather than lowered as a write");
      if (s.type === "VariableDeclaration" && s.declarations.length === 1 && isYield(s.declarations[0].init) && callee(s.declarations[0].init.argument) === "attempt") {
        // const r: T | undefined = yield* attempt(() => call(…), function* () { absorbing handler });
        // if (r !== undefined) { … }   ⇒   try { const r: T = yield call(…); … } catch (error) { handler }
        const d = s.declarations[0], att = d.init.argument, [thunk, handler] = att.arguments;
        if (d.id.type !== "Identifier" || !d.id.typeAnnotation) fail(d, "annotate the attempt's result, const r: T | undefined = yield* attempt(…); a consumed JS result needs a type");
        const ann = d.id.typeAnnotation.typeAnnotation;
        if (ann.type !== "TSUnionType" || ann.types.length !== 2 || ann.types[1].type !== "TSUndefinedKeyword")
          fail(ann, "the attempt's result is T | undefined: undefined is the absorbed failure");
        if (thunk?.type !== "ArrowFunctionExpression" || thunk.body.type !== "CallExpression" || thunk.params.length) fail(thunk ?? att, "attempt(() => call(…), …) takes a thunk that makes one call");
        if (handler?.type !== "FunctionExpression" || !handler.generator || handler.params.length)
          fail(handler ?? att, "only an absorbing handler, function* () { … }, is in the yield subset: typed failures are not");
        const next = ss[i + 1];
        const guarded = next?.type === "IfStatement" && !next.alternate && next.test.type === "BinaryExpression" && next.test.operator === "!==" &&
          next.test.left.type === "Identifier" && next.test.left.name === d.id.name && next.test.right.type === "Identifier" && next.test.right.name === "undefined";
        if (!guarded || i + 2 !== ss.length)
          fail(s, "after the attempt, the event continues only inside if (" + d.id.name + " !== undefined) { … }, as its last statement");
        const success: N[] = next.consequent.type === "BlockStatement" ? next.consequent.body : [next.consequent];
        const inner: Scope = new Map(scope);
        inner.set(d.id.name, { k: "path" });
        o.gen("try { const " + d.id.name + ": " + text(ann.types[0]) + " = yield ", s.start).add(expr(thunk.body, scope)).gen("; ", s.start)
          .add(eventStatements(success, inner)).gen(" } catch (error) { ", handler.start).add(eventStatements(handler.body.body, scope)).gen(" }", handler.end);
        i++;
        continue;
      }
      if (s.type === "TryStatement") fail(s, "try/catch is not a yield routine form (solid-yield's no-try-catch); use attempt");
      if (s.type === "ThrowStatement") fail(s, "throw is not a yield routine form (solid-yield's UNTYPED_THROW)");
      fail(s, "this statement form is not in the yield event subset");
    }
    return o;
  };

  // ---------------------------------------------------------------- views
  const child = (n: N, scope: Scope): Out => {
    // a lazy view, function* () { return <…/>; }, or a fragment returned from it, as JSX children
    const fn = routine(n, "a lazy view");
    const ret = fn.body.body.length === 1 ? fn.body.body[0] : undefined;
    if (ret?.type !== "ReturnStatement" || !ret.argument) fail(fn, "a lazy view has no body: function* () { return <…/>; }");
    return jsx(ret.argument, scope, true);
  };
  const props = (n: N): Map<string, N> => {
    if (n?.type !== "ObjectExpression") fail(n ?? program, "a call takes an object of props");
    const m = new Map<string, N>();
    for (const p of n.properties) {
      if (p.type !== "Property" || p.computed || p.key.type !== "Identifier" || p.method || p.kind !== "init") fail(p, "props are plain named properties");
      m.set(p.key.name, p.value);
    }
    return m;
  };
  const source_ = (v: N, scope: Scope): Out => {
    // a prop or control input: a source or path (read where it is used), a hole function* () { return e; }, or a value
    if (v.type === "FunctionExpression" && v.generator) {
      const body = v.body.body;
      if (body.length !== 1 || body[0].type !== "ReturnStatement") fail(v, "a hole is function* () { return e; }");
      return expr(body[0].argument, scope);
    }
    if (isYield(v)) fail(v, "a yield* in a call's arguments reads in the caller and re-creates the child (solid-yield's no-read-in-prop)");
    if (v.type === "Identifier" && scope.has(v.name)) {
      const kind = scope.get(v.name)!;
      if (kind.k === "accessor") return new Out().copy(source, v.start, v.end).gen("()", v.end);
      if (kind.k === "path" || kind.k === "local") return expr(v, scope);
    }
    return expr(v, scope);
  };
  const hole = (n: N, scope: Scope): Out => {
    const arg = n.argument;
    const name = callee(arg);
    if (name && LATER[name]) fail(arg, LATER[name]);
    if (name === "Show") {
      const p = props(arg.arguments[0]);
      for (const k of p.keys()) if (!["when", "fallback", "children"].includes(k)) fail(p.get(k), "Show takes when, fallback and children here");
      if (!p.has("when") || !p.has("children")) fail(arg, "Show needs when and children");
      const fb = p.get("fallback");
      const o = new Out().gen("<Show when={", arg.start).add(source_(p.get("when"), scope)).gen("}", arg.start);
      if (fb) {
        o.gen(" fallback={", fb.start);
        if (fb.type === "StringLiteral" || (fb.type === "Literal" && typeof fb.value === "string")) o.copy(source, fb.start, fb.end);
        else o.gen("<>", fb.start).add(child(fb, scope)).gen("</>", fb.end);
        o.gen("}", fb.end);
      }
      const ch = p.get("children");
      if (ch.params?.length) fail(ch, "Show's row form (a child taking the value) is not in the yield subset");
      return o.gen(">", ch.start).add(child(ch, scope)).gen("</Show>", arg.end);
    }
    if (name === "For") {
      const p = props(arg.arguments[0]);
      for (const k of p.keys()) if (!["each", "children"].includes(k)) fail(p.get(k), "For takes each and children here");
      const ch = routine(p.get("children"), "For's row");
      if (ch.params.length !== 1 || ch.params[0].type !== "Identifier") fail(ch, "a For row takes its item: function* (item) { … } (the index is not in the subset)");
      const ret = ch.body.body.length === 1 ? ch.body.body[0] : undefined;
      if (ret?.type !== "ReturnStatement" || callee(ret.argument) !== "view") fail(ch, "a row returns its view, with no row-owned state in the yield subset");
      const inner: Scope = new Map(scope); inner.set(ch.params[0].name, { k: "path" });
      const view = routine(ret.argument.arguments[0], "view");
      const vret = view.body.body.length === 1 ? view.body.body[0] : undefined;
      if (vret?.type !== "ReturnStatement") fail(view, "a view has no body: return <…/>");
      return new Out().gen("<For each={", arg.start).add(source_(p.get("each"), scope)).gen("}>{(" + ch.params[0].name + ") => ", ch.start)
        .add(jsx(vret.argument, inner, false)).gen("}</For>", arg.end);
    }
    if (name && components.has(name)) {
      const p = arg.arguments.length ? props(arg.arguments[0]) : new Map();
      const o = new Out().gen("<" + name, arg.start);
      for (const [k, v] of p) {
        if (k === "children") fail(v, "children of yield components are not in the subset");
        const ev = v.type === "Identifier" ? scope.get(v.name) : undefined;
        if (ev?.k === "event") {
          o.gen(" " + k + "={(" + ev.params.map(q => q.name + ": " + q.type).join(", ") + ") => " + v.name + "(" + ev.params.map(q => q.name).join(", ") + ")}", v.start);
          continue;
        }
        o.gen(" " + k + "={", v.start).add(source_(v, scope)).gen("}", v.end);
      }
      return o.gen(" />", arg.end);
    }
    if (name && /^[A-Z]/.test(name)) fail(arg, "unknown component or flow control: " + name);
    return new Out().gen("{", n.start).add(expr(n, scope)).gen("}", n.end);
  };
  const jsx = (n: N, scope: Scope, unwrap: boolean): Out => {
    if (n.type === "ParenthesizedExpression") return jsx(n.expression, scope, unwrap);
    if (n.type === "JSXFragment" && unwrap) {
      const kids = n.children.filter((c: N) => !(c.type === "JSXText" && !c.value.trim()));
      if (kids.length === 1 && kids[0].type === "JSXExpressionContainer" && isYield(kids[0].expression)) return hole(kids[0].expression, scope);
    }
    if (n.type !== "JSXElement" && n.type !== "JSXFragment") fail(n, "a view returns JSX");
    const o = new Out();
    let at = n.start;
    const visit = (x: N) => {
      if (!x || typeof x !== "object") return;
      if (Array.isArray(x)) { x.forEach(visit); return; }
      if (typeof x.type !== "string") return;
      if (x.type === "JSXOpeningElement" && x.name.type === "JSXIdentifier" && /^[A-Z]/.test(x.name.name))
        fail(x, "a yield component is called in a hole, {yield* " + x.name.name + "({ … })}, never tagged (solid-yield's no-component-tag)");
      if (x.type === "JSXSpreadAttribute") fail(x, "spread props are not in the yield subset");
      if (x.type === "JSXAttribute" && x.value?.type === "JSXExpressionContainer" && isYield(x.value.expression) && x.name.type === "JSXIdentifier" && /^on[A-Z]/.test(x.name.name)) {
        // onClick={yield* evt}: bind the event, un-called
        const target = x.value.expression.argument;
        const kind = target.type === "Identifier" ? scope.get(target.name) : undefined;
        if (kind?.k !== "event") fail(target, "an event prop binds a local $event: onClick={yield* evt}");
        if ((kind as { params: unknown[] }).params.length) fail(target, "a bound event receives the DOM event; events with parameters are only called from events in the yield subset");
        o.copy(source, at, x.value.start).gen("{() => " + target.name + "()}", x.value.start); at = x.value.end; return;
      }
      if (x.type === "JSXExpressionContainer" && x.expression.type !== "JSXEmptyExpression") {
        const e = x.expression;
        const yields = isYield(e) && (callee(e.argument) !== undefined && /^[A-Z]/.test(callee(e.argument)!));
        o.copy(source, at, x.start);
        if (yields) o.add(hole(e, scope)); else o.gen("{", x.start).add(expr(e, scope)).gen("}", x.end);
        at = x.end; return;
      }
      for (const [k, v] of Object.entries(x)) if (k !== "start" && k !== "end" && k !== "type") visit(v);
    };
    visit(n.type === "JSXElement" ? [n.openingElement, n.children, n.closingElement] : n.children);
    return o.copy(source, at, n.end);
  };

  // ---------------------------------------------------------------- components
  const components = new Map<string, N>();
  const componentOf = (init: N): N | undefined => (callee(init) === "component" ? init.arguments[0] : undefined);
  for (const s of program.body) {
    const decl = s.type === "ExportNamedDeclaration" ? s.declaration : s.type === "ExportDefaultDeclaration" ? null : s;
    if (s.type === "ExportDefaultDeclaration" && componentOf(s.declaration)) {
      const fn = componentOf(s.declaration);
      if (fn?.id) components.set(fn.id.name, fn);
    }
    if (decl?.type === "VariableDeclaration")
      for (const d of decl.declarations) { const fn = componentOf(d.init); if (fn && d.id.type === "Identifier") components.set(d.id.name, fn); }
    if (decl?.type === "TSTypeAliasDeclaration") aliases.set(decl.id.name, decl.typeAnnotation);
  }
  const component = (fn: N, name: string, exported: string): Out => {
    routine(fn, "component");
    if (fn.id?.name !== name) fail(fn, "a component's routine is named after it: component(function* " + name + "(…) { … })");
    if (fn.params.length > 1) fail(fn.params[1], "a component takes one props parameter");
    const scope: Scope = new Map();
    let params = "";
    if (fn.params.length) {
      const p = fn.params[0];
      if (p.type !== "Identifier" || p.name !== "props" || !p.typeAnnotation) fail(p, "the props parameter is props: Props<{ … }>");
      const t = p.typeAnnotation.typeAnnotation;
      if (t.type !== "TSTypeReference" || t.typeName.name !== "Props") fail(t, "the props parameter's type is Props<{ … }>");
      params = "props: " + type(t.typeArguments.params[0]);
      scope.set("props", { k: "path" });
    }
    const o = new Out().gen(exported + "function " + name + "(" + params + ") {\n", fn.start);
    const body = fn.body.body;
    for (const s of body.slice(0, -1)) {
      if (s.type !== "VariableDeclaration" || s.kind !== "const" || s.declarations.length !== 1) fail(s, "a setup only creates: const … = yield* $signal(…), $memo(…), $event(…), …");
      const d = s.declarations[0];
      const init = isYield(d.init) ? d.init.argument : d.init;
      const what = callee(init);
      if (what && LATER[what]) fail(init, LATER[what]);
      if (what === "$event") {
        if (isYield(d.init)) fail(d.init, "an $event is created without yield*: const evt = $event(function* (…) { … })");
        if (d.id.type !== "Identifier") fail(d.id, "an $event is bound to a name");
        const ev = routine(init.arguments[0], "$event");
        const params = ev.params.map((q: N) => {
          if (q.type !== "Identifier" || !q.typeAnnotation) fail(q, "event parameters need explicit types");
          return { name: q.name, type: text(q.typeAnnotation.typeAnnotation) };
        });
        scope.set(d.id.name, { k: "event", params });
        o.gen("  const " + d.id.name + " = action(function* (" + params.map((q: { name: string; type: string }) => q.name + ": " + q.type).join(", ") + ") {\n    ", s.start)
          .add(eventStatements(ev.body.body, scope)).gen("\n  });\n", s.end);
        solid.add("action");
        continue;
      }
      if (!isYield(d.init)) fail(d.init ?? d, "a setup creates with yield*: const … = yield* $signal(…)");
      if (!what) fail(d.init, "a setup never reads (solid-yield's READ_IN_SETUP): read in a hole, a $memo or an $event");
      if (what === "$signal" || what === "$optimistic" || what === "$store") {
        if (d.id.type !== "ArrayPattern" || d.id.elements.length !== 2 || d.id.elements.some((e: N) => e?.type !== "Identifier"))
          fail(d.id, "bind the source and its setter: const [x, setX] = yield* " + what + "(…)");
        if (init.arguments.length !== 1) fail(init, what + " takes one initial value here (options are not in the subset)");
        const v = init.arguments[0];
        if (v.type === "FunctionExpression" || v.type === "ArrowFunctionExpression") fail(v, what + " with a derived body is not in the yield subset");
        const [get, set] = d.id.elements.map((e: N) => e.name);
        scope.set(get, what === "$store" ? { k: "path" } : { k: "accessor" });
        scope.set(set, { k: "setter" });
        const solidName = what === "$signal" ? "createSignal" : what === "$optimistic" ? "createOptimistic" : "createStore";
        solid.add(solidName);
        o.gen("  const [" + get + ", " + set + "] = " + solidName + "(", s.start).add(expr(v, scope)).gen(");\n", s.end);
        continue;
      }
      if (what === "$memo") {
        if (d.id.type !== "Identifier" || init.arguments.length !== 1) fail(d, "const m = yield* $memo(function* () { … }) (options are not in the subset)");
        const body = memoBody(routine(init.arguments[0], "$memo"), scope);
        scope.set(d.id.name, { k: "accessor" });
        solid.add("createMemo");
        o.gen("  const " + d.id.name + " = createMemo(() => ", s.start).add(body).gen(");\n", s.end);
        continue;
      }
      fail(init, "not a setup operation in the yield subset: " + what);
    }
    const ret = body.at(-1);
    if (ret?.type !== "ReturnStatement" || callee(ret.argument) !== "view") fail(ret ?? fn, "a setup returns its view: return view(function* () { return <…/>; })");
    const view = routine(ret.argument.arguments[0], "view");
    const vret = view.body.body.length === 1 ? view.body.body[0] : undefined;
    if (vret?.type !== "ReturnStatement" || !vret.argument)
      fail(view, "a view has no body: return <…/>; no if, no early return, no local computation (solid-yield's READ_IN_VIEW)");
    return o.gen("  return ", ret.start).add(jsx(vret.argument, scope, false)).gen(";\n}\n", ret.end);
  };

  // ---------------------------------------------------------------- module
  const body = new Out();
  for (const s of program.body) {
    if (s.type === "ImportDeclaration") {
      if (s.source.value === "solid-yield") {
        if (s.importKind === "type") continue;
        for (const spec of s.specifiers) {
          const name = spec.imported?.name ?? spec.local.name;
          if (spec.importKind === "type") continue;
          if (LATER[name]) fail(spec, LATER[name]);
          if (!SUBSET.has(name)) fail(spec, "not in the yield subset: " + name);
          if (spec.local.name !== name) fail(spec, "aliased solid-yield imports are not in the subset");
        }
        continue;
      }
      body.copy(source, s.start, s.end).gen("\n", s.end);
      continue;
    }
    if (s.type === "TSTypeAliasDeclaration") continue;
    if (s.type === "ExportDefaultDeclaration") {
      const fn = componentOf(s.declaration);
      if (!fn?.id) fail(s, "export default component(function* Name() { … })");
      body.add(component(fn, fn.id.name, "export default "));
      continue;
    }
    const decl = s.type === "ExportNamedDeclaration" ? s.declaration : s;
    if (decl?.type === "VariableDeclaration" && decl.declarations.length === 1 && componentOf(decl.declarations[0].init)) {
      const d = decl.declarations[0];
      body.add(component(componentOf(d.init), d.id.name, s.type === "ExportNamedDeclaration" ? "export " : ""));
      continue;
    }
    fail(s, "module statements are imports, type aliases and components in the yield subset");
  }
  out.gen("import { " + [...solid, "Show", "For"].filter(n => n !== "Show" && n !== "For" || body.text.includes("<" + n + " ")).join(", ") + ' } from "solid-js";\n', 0).add(body);
  return { tsx: out.text, out };
}

/** Translate, then lower with the TSX frontend; its diagnostics are relocated to the yield source. */
export function lowerYield(source: string, filename = "main.tsx", options?: Parameters<typeof lowerTsx>[2]) {
  const { tsx, out } = yieldToTsx(source, filename);
  try { return lowerTsx(tsx, filename, options); } catch (e) { throw relocate(e, source, filename, out); }
}

/** A yield entry module as a checked RX module set (other modules, e.g. ./api's .d.rx, load as before). */
export function loadYieldModules(entry: string, read: (path: string) => string | undefined): ModuleSet {
  const text = read(entry);
  if (text === undefined) throw new Error("no yield module " + entry);
  const { tsx, out } = yieldToTsx(text, entry);
  try { return loadTsxModules(entry, path => (path === entry ? tsx : read(path))); } catch (e) { throw relocate(e, text, entry, out); }
}

function relocate(e: unknown, source: string, filename: string, out: Out): unknown {
  if (!(e instanceof TsxError)) return e;
  const start = out.origin(e.start);
  return new YieldError(filename, source, { start, end: Math.max(start, out.origin(e.end)) }, "(through the TSX frontend) " + e.message.replace(/^.*?:\d+:\d+: /, ""));
}

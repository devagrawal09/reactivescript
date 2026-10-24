// The code generator: a checked Program → an ES module over solid-js 2.0 (and ./rt.ts for the lowering helpers).
// Lexical scopes become JS scopes: every region is a JS function, every declaration a `const`. Names are mangled
// (`v$x` the value or accessor, `w$x` a source's writer, `p$x` a companion `pre` memo). The decisions are the
// oracle's (ref/oracle/lower.ts); this file only makes them at compile time.
import type { Decl, Expr, Markup, Program, Stmt } from "../src/ast.ts";

export class CompileError extends Error { name = "CompileError"; }
type FnDecl = Extract<Decl, { k: "fn" }>;
type Kind = "acc" | "src" | "val" | "fn" | "ifn" | "act" | "comp";
type Bind = { kind: Kind; js: string; w?: string; fn?: FnDecl; prev?: string };

class Env {
  vars = new Map<string, Bind>(); parent: Env | null;
  constructor(parent: Env | null) { this.parent = parent; }
  lookup(n: string): Bind | undefined { return this.vars.get(n) ?? this.parent?.lookup(n); }
  /** The declaring frame of `n` (for companion `pre` memos). */
  frame(n: string): Env | undefined { return this.vars.has(n) ? this : this.parent?.frame(n); }
}
type Ctx = { imp: boolean; gen?: boolean; async?: boolean; tail?: boolean; self?: string; effect?: boolean; dyn?: boolean };

const BUILTINS = new Set(["len", "str", "map", "filter", "sum", "fail", "fetch", "every"]);
const isHandler = (a: string) => /^on[A-Z:]/.test(a);
const J = (v: unknown) => v === undefined ? "undefined" : JSON.stringify(v);
const mg = (n: string) => `v$${n}`;

// ---------------------------------------------------------------- usage analysis (the oracle's walkers, at compile time)
type Usage = { optimistic: Set<string>; paths: Set<string>; prevOf: Set<string> };
function usage(p: Program, extra: Stmt[][] = []): Usage {
  const u: Usage = { optimistic: new Set(), paths: new Set(), prevOf: new Set() };
  const seen = new WeakSet<object>();
  const walk = (x: unknown, selfName?: string): void => {
    if (!x || typeof x !== "object" || seen.has(x as object)) return; seen.add(x as object);
    if (Array.isArray(x)) { x.forEach(y => walk(y, selfName)); return; }
    const o = x as Record<string, any>;
    if (o.k === "optimistic") u.optimistic.add(o.target.name);
    if ((o.k === "write" || o.k === "optimistic") && o.target.path.length) u.paths.add(o.target.name);
    if (o.k === "pending" && (o.e.k === "member" || o.e.k === "index")) { let y = o.e; while (y.k === "member" || y.k === "index") y = y.o; if (y.k === "id") u.paths.add(y.name); }
    if (o.k === "pre" && o.name !== selfName) u.prevOf.add(o.name);
    const nextSelf = (o.k === "eq" || o.k === "source") ? o.name : selfName;
    for (const v of Object.values(o)) walk(v, nextSelf);
  };
  walk(p); walk(extra);
  return u;
}
/** Free names of an expression, for ordering declarations (JS consts have a temporal dead zone; memos compute eagerly). */
function deps(e: unknown, self: string, out = new Set<string>()): Set<string> {
  if (!e || typeof e !== "object") return out;
  if (Array.isArray(e)) { e.forEach(x => deps(x, self, out)); return out; }
  const o = e as Record<string, any>;
  if (o.k === "id") out.add(o.name);
  if (o.k === "pre" && o.name !== self) out.add(o.name);
  if (o.k === "write" || o.k === "optimistic") out.add(o.target.name);
  for (const [k, v] of Object.entries(o)) if (k !== "k") deps(v, self, out);
  return out;
}

// ---------------------------------------------------------------- the module
export function compile(p: Program, opts: { extraStmts?: Stmt[][] } = {}): string {
  const g = new Gen(usage(p, opts.extraStmts));
  const root = new Env(null);
  const body = g.block(p.decls, p.view, root, 2);
  return `// compiled by ReactiveScript ref/compile — do not edit
export default function main(__rt) {
  const __B = __rt.B;
  return () => {
${body}
  };
}
`;
}
/** Handler rows and resolve values in scenarios: statements over names looked up at run time (rt.lookup). */
export function compileDynamic(stmts: Stmt[]): string { const g = new Gen(usage({ decls: [], view: [] }, [stmts])); const env = new Env(null); return g.stmts(stmts, env, { imp: true, dyn: true }, 0); }
export function compileDynamicExpr(e: Expr): string { const g = new Gen(usage({ decls: [], view: [] })); return g.expr(e, new Env(null), { imp: true, dyn: true }); }

class Gen {
  u: Usage;
  constructor(u: Usage) { this.u = u; }

  // ---- blocks: a region's declarations, then its view ----
  block(decls: Decl[], view: Markup[], env: Env, ind: number): string {
    const pad = " ".repeat(ind * 2);
    const out: string[] = [`${pad}const __o = __rt.owner();`];
    // names first: hoisted functions and components; every other declaration is a const
    for (const d of decls) {
      if (d.k === "import") for (const { name, alias } of d.names) env.vars.set(alias, { kind: "val", js: mg(alias) });
      if (d.k === "fn") env.vars.set(d.name, { kind: d.params.some(p => p.ref) || d.decls.length ? "ifn" : "fn", js: mg(d.name), fn: d });
      if (d.k === "component") env.vars.set(d.name, { kind: "comp", js: mg(d.name) });
      if (d.k === "action") env.vars.set(d.name, { kind: "act", js: mg(d.name) });
      if (d.k === "error") env.vars.set(d.name, { kind: "val", js: mg(d.name) });
      if (d.k === "source") env.vars.set(d.name, { kind: "src", js: mg(d.name), w: `w$${d.name}`, prev: this.u.prevOf.has(d.name) ? `p$${d.name}` : undefined });
      if (d.k === "eq") env.vars.set(d.name, { kind: d.e.k === "call" && d.e.f.k === "id" && env.lookup(d.e.f.name)?.kind === "ifn" ? "acc" : "acc", js: mg(d.name), prev: this.u.prevOf.has(d.name) ? `p$${d.name}` : undefined });
    }
    for (const d of decls) if (d.k === "import") for (const { name, alias } of d.names) {
      const v = name === "log" ? "__B.log" : BUILTINS.has(name) ? `__B.${name}` : d.from.endsWith("/api") ? `__rt.api(${J(name)})` : null;
      if (!v) throw new CompileError(`${name} from "${d.from}" is not in the scenario prelude`);
      out.push(`${pad}const ${mg(alias)} = ${v};`);
    }
    for (const d of decls) if (d.k === "error") { const inner = this.params(env, d.params); out.push(`${pad}const ${mg(d.name)} = __rt.errorClass(${J(d.name)}, ${J(d.params)}, (${d.params.map(mg).join(", ")}) => ${d.msg ? this.expr(d.msg, inner, { imp: false }) : J(d.name)});   // R-f-1`); }
    for (const d of decls) if (d.k === "fn") out.push(this.fn(d, env, ind));
    for (const d of decls) if (d.k === "component") out.push(this.component(d, env, ind));
    for (const d of decls) if (d.k === "action") out.push(`${pad}const ${mg(d.name)} = __rt.action(function* (${d.params.map(mg).join(", ")}) {\n${this.stmts(d.body, this.params(env, d.params), { imp: true, gen: true }, ind + 1)}\n${pad}});\n${pad}__rt.reg(${J(d.name)}, { value: ${mg(d.name)} });`);
    // values in dependency order (E-7: equations are unordered in the source; C-1 makes this a DAG)
    const vals = decls.filter(d => d.k === "source" || d.k === "eq" || d.k === "provide");
    const key = (d: Decl) => d.k === "provide" ? `provide:${d.name}` : (d as { name: string }).name;
    const local = new Set(vals.filter(d => d.k !== "provide").map(d => (d as { name: string }).name));
    const done = new Set<string>(); const order: Decl[] = []; const busy = new Set<string>();
    const visit = (d: Decl) => {
      const k = key(d); if (done.has(k) || busy.has(k)) return; busy.add(k);
      const self = d.k === "provide" ? "" : (d as { name: string }).name;
      for (const n of deps(d.k === "eq" ? d.e : d.k === "source" ? d.init : d.e, self)) if (local.has(n) && n !== self) { const t = vals.find(x => x.k !== "provide" && (x as { name: string }).name === n); if (t) visit(t); }
      busy.delete(k); done.add(k); order.push(d);
    };
    vals.forEach(visit);
    for (const d of order) out.push(this.value(d, env, ind));
    for (const d of decls) if (d.k === "effect") {
      const inner = new Env(env);
      out.push(`${pad}__rt.effect(${d.inputs.length}, () => [${d.inputs.map(i => this.expr(i, env, { imp: false })).join(", ")}], ($p) => __rt.untrack(() => {\n${this.stmts(d.body, inner, { imp: true, effect: true }, ind + 1, true)}\n${pad}}));   // SC-2: the apply reads σ, untracked`);
    }
    out.push(`${pad}return ${this.markup(view, env, ind)};`);
    return out.join("\n");
  }
  private params(env: Env, ps: string[]) { const e = new Env(env); for (const p of ps) e.vars.set(p, { kind: "val", js: mg(p) }); return e; }

  private value(d: Decl, env: Env, ind: number): string {
    const pad = " ".repeat(ind * 2);
    if (d.k === "provide") {
      const b = d.e.k === "id" ? env.lookup(d.e.name) : undefined;
      const entry = b?.kind === "src" ? `{ get: ${b.js}, w: ${b.w} }` : `{ get: __rt.memo(null, () => ${this.expr(d.e, env, { imp: false })}) }`;
      return `${pad}__rt.provide(${J(d.name)}, ${entry});`;
    }
    const b = env.vars.get((d as { name: string }).name)!;
    const prev = b.prev ? `\n${pad}const ${b.prev} = __rt.prevOf(${b.js});` : "";
    if (d.k === "source") {
      if (!d.question) return `${pad}const [${b.js}, ${b.w}] = __rt.source(${J(d.name)}, __rt.untrack(() => ${this.expr(d.init, env, { imp: false })}));\n${pad}__rt.reg(${J(d.name)}, { get: ${b.js}, w: ${b.w} });${prev}`;
      const lv = this.loadingValue(d.init, env);
      const mode = `{ optimistic: ${this.u.optimistic.has(d.name)}, structured: ${this.u.paths.has(d.name)} }`;
      return `${pad}const [${b.js}, ${b.w}] = __rt.qsource(${J(d.name)}, (__prev) => ${this.expr(d.init, env, { imp: false, tail: true, self: d.name })}, ${lv}, ${mode});\n${pad}__rt.reg(${J(d.name)}, { get: ${b.js}, w: ${b.w} });${prev}`;
    }
    if (d.k !== "eq") throw new CompileError("unreachable");
    const reg = `\n${pad}__rt.reg(${J(d.name)}, { get: ${b.js} });${prev}`;
    if (d.e.k === "draft") {                                                                   // ST-3
      const seed = d.e.seed; if (seed.k !== "pre" || seed.name !== d.name || !seed.init) throw new CompileError("a draft's seed must be `pre self -> seed`");
      const inner = new Env(env); inner.vars.set("d", { kind: "val", js: "v$d" });
      return `${pad}const ${b.js} = __rt.draft(__rt.untrack(() => ${this.expr(seed.init, env, { imp: false })}), (v$d) => {\n${this.draftBody(d.e.body, inner, ind + 1)}\n${pad}});${reg}`;
    }
    if (d.e.k === "call" && d.e.f.k === "id" && env.lookup(d.e.f.name)?.kind === "ifn") return `${pad}const ${b.js} = ${this.instantiate(d.e, env)};${reg}`;   // RG-6
    if (d.key) return `${pad}const ${b.js} = __rt.keyed(${J(d.name)}, ${J(d.key)}, () => ${this.expr(d.e, env, { imp: false, tail: true })});${reg}`;
    if (d.e.k === "catch" && !d.deferred) {                                                    // R-f-4 over a tail await: the flight is an inner memo, read through a boundary
      const c = d.e; const inner = new Env(env); if (c.name) inner.vars.set(c.name, { kind: "val", js: mg(c.name) });
      return `${pad}const i$${d.name} = __rt.memo(${J(d.name)}, (__prev) => ${this.expr(c.e, env, { imp: false, tail: true, self: d.name })}, ${this.loadingValue(c.e, env)});\n${pad}const ${b.js} = __rt.catchAcc(() => i$${d.name}(), (__e) => __rt.isA(__e, ${this.classes(c.classes, env)}), (${c.name ? mg(c.name) : "__e"}) => ${this.expr(c.alt, inner, { imp: false })});${reg}`;
    }
    const fn = d.deferred ? "deferred" : "memo";
    return `${pad}const ${b.js} = __rt.${fn}(${J(d.name)}, (__prev) => ${this.expr(d.e, env, { imp: false, tail: true, self: d.name })}, ${this.loadingValue(d.e, env)});${reg}`;
  }
  private loadingValue(e: Expr, env: Env): string {                                            // R-7: the first paint of an `await … -> v`
    let init: Expr | undefined;
    const walk = (x: unknown): void => { if (init || !x || typeof x !== "object") return; if (Array.isArray(x)) { x.forEach(walk); return; } const o = x as Record<string, any>; if (o.k === "fn") return; if (o.k === "await" && o.init) { init = o.init; return; } Object.values(o).forEach(walk); };
    walk(e);
    return init ? `__rt.lv(() => ${this.expr(init, env, { imp: false })})` : "undefined";
  }
  private draftBody(ss: Stmt[], env: Env, ind: number): string {
    const pad = " ".repeat(ind * 2);
    return ss.map(s => {
      if (s.k === "let") { env.vars.set(s.name, { kind: "val", js: mg(s.name) }); return `${pad}const ${mg(s.name)} = ${this.expr(s.e, env, { imp: false })};`; }
      if (s.k === "expr") return `${pad}${this.expr(s.e, env, { imp: false })};`;
      if (s.k === "write") { const path = s.target.path.map(p => typeof p === "string" ? J(p) : this.expr(p, env, { imp: false })); const last = path.pop()!; return `${pad}{ let __t = v$d; ${path.map(k => `__t = (__t[${k}] ??= {});`).join(" ")} __t[${last}] = ${this.expr(s.e, env, { imp: false })}; }`; }
      throw new CompileError(`${s.k} in a draft block`);
    }).join("\n");
  }
  private fn(d: FnDecl, env: Env, ind: number): string {
    const pad = " ".repeat(ind * 2);
    const inner = new Env(env);
    for (const p of d.params) inner.vars.set(p.name, { kind: p.ref ? "acc" : "val", js: mg(p.name) });
    if (!d.params.some(p => p.ref) && !d.decls.length) return `${pad}function ${mg(d.name)}(${d.params.map(p => mg(p.name)).join(", ")}) { return ${this.expr(d.tail, inner, { imp: false })}; }`;
    // an instantiating fn (RG-6): called once, returns the accessor of its tail
    const body = this.block(d.decls, [], inner, ind + 1).split("\n").filter(l => !/^\s*return \[\];$/.test(l)).join("\n");
    const tb = d.tail.k === "id" ? inner.lookup(d.tail.name) : undefined;
    const tail = tb && (tb.kind === "acc" || tb.kind === "src") ? tb.js : `__rt.memo(null, () => ${this.expr(d.tail, inner, { imp: false })})`;
    return `${pad}function ${mg(d.name)}(${d.params.map(p => mg(p.name)).join(", ")}) {\n${body}\n${pad}  return ${tail};\n${pad}}`;
  }
  private instantiate(call: Extract<Expr, { k: "call" }>, env: Env): string {
    const f = env.lookup((call.f as { name: string }).name)!.fn!;
    const args = f.params.map((p, i) => {
      const a = call.args[i]; if (!a) return "undefined";
      if (p.ref) { if (a.k === "id") { const b = env.lookup(a.name); if (b && (b.kind === "acc" || b.kind === "src")) return b.js; } return `__rt.memo(null, () => ${this.expr(a, env, { imp: false })})`; }
      return `__rt.untrack(() => ${this.expr(a, env, { imp: false })})`;
    });
    return `${mg(f.name)}(${args.join(", ")})`;
  }
  private component(d: Extract<Decl, { k: "component" }>, env: Env, ind: number): string {
    const pad = " ".repeat(ind * 2);
    const inner = new Env(env); inner.vars.set(d.props, { kind: "val", js: mg(d.props) });
    return `${pad}function ${mg(d.name)}(${mg(d.props)}) {\n${this.block(d.decls, d.view, inner, ind + 1)}\n${pad}}`;
  }

  // ---- expressions ----
  expr(e: Expr, env: Env, ctx: Ctx): string {
    const sub: Ctx = { ...ctx, tail: false };
    const go = (x: Expr) => this.expr(x, env, sub);
    switch (e.k) {
      case "lit": return J(e.v);
      case "id": return this.ref(e.name, env, ctx);
      case "pre": {
        const init = e.init ? this.expr(e.init, env, sub) : "undefined";
        if (ctx.self === e.name) return `__rt.orInit(__prev, () => ${init})`;            // the equation's own: the memo's previous value
        const b = env.lookup(e.name); if (!b?.prev) throw new CompileError(`pre ${e.name}: no companion memo`);
        return `__rt.orInit(${b.prev}(), () => ${init})`;
      }
      case "peek": return `__rt.untrack(() => ${go(e.e)})`;
      case "await": {
        if (ctx.imp) return ctx.gen ? `(yield __rt.aw(${go(e.e)}))` : ctx.async ? `(await __rt.aw(${go(e.e)}))` : go(e.e);
        if (!ctx.tail) throw new CompileError("`await` outside an equation's result position is not lowered yet");
        return go(e.e);                                                                         // the memo returns the flight (R-1)
      }
      case "latest": return `__rt.latest(() => ${go(e.e)})`;
      case "pending": return `__rt.isPending(() => ${go(e.e)})`;
      case "if": return `(${go(e.c)} ? ${this.expr(e.t, env, ctx)} : ${this.expr(e.f, env, ctx)})`;
      case "throw": return `__rt.raise(${go(e.e)})`;                                          // R-f-3
      case "catch": {                                                                           // R-f-4: over a sync value, or the tail await's promise/stream
        if (ctx.imp && this.hasAwait(e.e)) throw new CompileError("`await … catch` in imperative scope is not lowered yet: use try/catch");
        const inner = new Env(env); if (e.name) inner.vars.set(e.name, { kind: "val", js: mg(e.name) });
        return `__rt.${ctx.imp ? "tryCatch" : "caughtRead"}(() => ${this.expr(e.e, env, sub)}, (__e) => __rt.isA(__e, ${this.classes(e.classes, env)}), (${e.name ? mg(e.name) : "__e"}) => ${this.expr(e.alt, inner, sub)})`;
      }
      case "tpl": return `(${e.parts.map(p => typeof p === "string" ? J(p) : `__rt.fmt(${go(p)})`).join(" + ") || '""'})`;
      case "member": return `${go(e.o)}?.${e.p}`;
      case "index": return `${go(e.o)}?.[${go(e.i)}]`;
      case "call": {
        if (e.f.k === "member") return `${go(e.f.o)}?.${e.f.p}(${e.args.map(go).join(", ")})`;
        return `${go(e.f)}(${e.args.map(go).join(", ")})`;
      }
      case "arr": return `[${e.items.map(i => i.k === "spread" ? `...${go(i.e)}` : go(i)).join(", ")}]`;
      case "rec": return `({ ${e.fields.map(f => "spread" in f ? `...${go(f.spread)}` : `${J(f.key)}: ${go(f.v)}`).join(", ")} })`;
      case "fn": {
        const inner = this.params(env, e.params); const ps = e.params.map(mg).join(", ");
        if (e.stmts) { const async = this.hasAwait(e.stmts); return `${async ? "async " : ""}(${ps}) => {\n${this.stmts(e.stmts, inner, { imp: true, async, dyn: ctx.dyn, effect: ctx.effect }, 0)}\n}`; }
        return `(${ps}) => ${this.expr(e.body, inner, { imp: ctx.imp, dyn: ctx.dyn, effect: ctx.effect })}`;
      }
      case "use": return `__rt.useGet(${J(e.name)}, __o)`;
      case "bin": {
        if (e.op === "==") return `__rt.eq(${go(e.l)}, ${go(e.r)})`;
        if (e.op === "!=") return `!__rt.eq(${go(e.l)}, ${go(e.r)})`;
        return `(${go(e.l)} ${e.op} ${go(e.r)})`;
      }
      case "un": return `(${e.op}${go(e.e)})`;
      case "draft": throw new CompileError("a draft is an equation's whole expression");
      case "spread": throw new CompileError("spread outside an array literal");
    }
  }
  private ref(name: string, env: Env, ctx: Ctx): string {
    if (ctx.effect && /^\$\d+$/.test(name)) return `$p[${name.slice(1)}]`;
    const b = env.lookup(name);
    if (!b) {
      if (BUILTINS.has(name)) return `__B.${name}`;
      if (ctx.dyn) return name === "log" ? "__B.log" : `__rt.dget(${J(name)})`;
      if (name === "log" && ctx.imp) return "__B.log";
      throw new CompileError(`unbound ${name}`);
    }
    if (b.kind === "acc" || b.kind === "src") return ctx.imp ? `__rt.snap(${b.js})` : `${b.js}()`;
    if (b.kind === "comp") throw new CompileError(`component ${name} used as a value`);
    return b.js;
  }
  /** R-f-4: error class names → a JS array of their values; `undefined`: every failure. */
  private classes(names: string[] | undefined, env: Env): string { return names ? `[${names.map(n => n === "Error" ? "Error" : this.ref(n, env, { imp: false })).join(", ")}]` : "undefined"; }
  private hasAwait(ss: unknown): boolean { const s = JSON.stringify(ss); return s.includes('"k":"await"'); }

  // ---- imperative scope ----
  stmts(ss: Stmt[], env0: Env, ctx: Ctx, ind: number, returnLast = false): string {
    const env = new Env(env0); const pad = " ".repeat(ind * 2);
    const out: string[] = [];
    ss.forEach((s, i) => {
      const e = (x: Expr) => this.expr(x, env, { ...ctx, tail: false });
      switch (s.k) {
        case "let": out.push(`${pad}let ${mg(s.name)} = ${e(s.e)};`); env.vars.set(s.name, { kind: "val", js: mg(s.name) }); break;
        case "expr": out.push(`${pad}${returnLast && i === ss.length - 1 ? "return " : ""}${e(s.e)};`); break;
        case "return": out.push(`${pad}return${s.e ? " " + e(s.e) : ""};`); break;
        case "throw": out.push(`${pad}throw ${e(s.e)};`); break;
        case "write": case "optimistic": {
          const keys = `[${s.target.path.map(p => typeof p === "string" ? J(p) : e(p)).join(", ")}]`;
          const v = e(s.e);
          if (ctx.dyn && !s.target.ctx && !env.lookup(s.target.name)) { out.push(`${pad}__rt.dset(${J(s.target.name)}, ${keys}, ${v}, ${s.k === "optimistic"});`); break; }
          let w: string;
          if (s.target.ctx) w = `__rt.use(${J(s.target.name)}, __o).w`;
          else { const b = env.lookup(s.target.name); if (!b?.w) throw new CompileError(`W-1: ${s.target.name} is not a source`); w = b.w; }
          out.push(`${pad}${s.k === "optimistic" ? `${w}.guess(${v})` : s.target.path.length ? `${w}.path(${keys}, ${v})` : `${w}.set(${v})`};`);
          break;
        }
        case "refresh": { const b = env.lookup(s.name); out.push(`${pad}__rt.refresh(${J(s.name)}, ${b ? b.js : `__rt.lookup(${J(s.name)}).get`});`); break; }
        case "affects": { const b = env.lookup(s.name); out.push(`${pad}__rt.affects(${b ? b.js : `__rt.lookup(${J(s.name)}).get`});`); break; }
        case "action": out.push(`${pad}__rt.action(function* () {\n${this.stmts(s.body, env, { imp: true, gen: true, dyn: ctx.dyn }, ind + 1)}\n${pad}})();`); break;
        case "sif": out.push(`${pad}if (${e(s.c)}) {\n${this.stmts(s.t, env, ctx, ind + 1)}\n${pad}} else {\n${this.stmts(s.f, env, ctx, ind + 1)}\n${pad}}`); break;
        case "try": {
          let t = `${pad}try {\n${this.stmts(s.body, env, ctx, ind + 1)}\n${pad}}`;
          if (s.handler) { const h = new Env(env); if (s.catchName) h.vars.set(s.catchName, { kind: "val", js: mg(s.catchName) }); const v = s.catchName ? mg(s.catchName) : "__e"; t += ` catch (${v}) {\n${s.catchClasses ? `${pad}  if (!__rt.isA(${v}, ${this.classes(s.catchClasses, env)})) throw ${v};   // R-f-6: a typed catch rethrows other classes\n` : ""}${this.stmts(s.handler, h, ctx, ind + 1)}\n${pad}}`; }
          if (s.fin) t += ` finally {\n${this.stmts(s.fin, env, ctx, ind + 1)}\n${pad}}`;
          out.push(t); break;
        }
      }
    });
    return out.join("\n");
  }

  // ---- views ----
  markup(ms: Markup[], env: Env, ind: number): string { return `[${ms.map(m => this.node(m, env, ind)).join(", ")}]`; }
  private regionFn(decls: Decl[], view: Markup[], env: Env, ind: number, param = "", bind?: (e: Env) => string): string {
    const pad = " ".repeat(ind * 2);
    const inner = new Env(env); const pre = bind ? bind(inner) : "";
    return `(${param}) => {\n${pre}${this.block(decls, view, inner, ind + 1)}\n${pad}}`;
  }
  private node(m: Markup, env: Env, ind: number): string {
    const re: Ctx = { imp: false };
    const pad = " ".repeat((ind + 1) * 2);
    switch (m.k) {
      case "text": return `__rt.text(${J(m.s)})`;
      case "read": return `__rt.read(() => ${this.expr(m.e, env, re)})`;
      case "el": {
        if (m.tag === "") return this.markup(m.children, env, ind);
        if (/^[A-Z]/.test(m.tag)) {
          const b = env.lookup(m.tag); if (b?.kind !== "comp") throw new CompileError(`unknown component ${m.tag}`);
          const props = m.attrs.map(a => `get ${J(a.name)}() { return ${this.expr(a.e, env, { imp: isHandler(a.name) })}; }`);
          props.push(`get children() { return ${this.markup(m.children, env, ind + 1)}; }`);
          return `__rt.comp(${b.js}, { ${props.join(", ")} })`;
        }
        const attrs = m.attrs.map(a => `[${J(a.name)}, () => ${this.expr(a.e, env, { imp: isHandler(a.name) })}, ${isHandler(a.name)}]`);
        return `__rt.el(${J(m.tag)}, [${attrs.join(", ")}], () => ${this.markup(m.children, env, ind + 1)})`;
      }
      case "mif": {
        const narrowed = m.c.k === "id" ? env.lookup(m.c.name) : undefined;
        const t = this.regionFn(m.tDecls, m.t, env, ind + 1, "__item", e => { if (m.c.k === "id" && narrowed && (narrowed.kind === "acc" || narrowed.kind === "src")) { e.vars.set(m.c.name, { kind: "acc", js: `n$${m.c.name}`, w: narrowed.w }); return `${pad}  const n$${m.c.name} = __item;\n`; } return ""; });
        const f = this.regionFn(m.fDecls, m.f, env, ind + 1);
        return `__rt.when(() => ${this.expr(m.c, env, re)},\n${pad}${t},\n${pad}${f})`;
      }
      case "mfor": {
        const body = this.regionFn(m.decls, m.body, env, ind + 1, mg(m.name), e => { e.vars.set(m.name, { kind: "val", js: mg(m.name) }); return ""; });
        return `__rt.each(() => ${this.expr(m.xs, env, re)},\n${pad}${body})`;
      }
      case "loading": {
        const on = m.on ? `() => ${this.expr(m.on, env, re)}` : "null";
        return `__rt.loading(${on}, () => ${this.markup(m.fallback, env, ind + 1)},\n${pad}${this.regionFn(m.decls, m.body, env, ind + 1)})`;
      }
      case "errored": {
        const fbEnv = new Env(env); if (m.errName) fbEnv.vars.set(m.errName, { kind: "acc", js: mg(m.errName) });
        return `__rt.errored((${m.errName ? mg(m.errName) : "__err"}) => ${this.markup(m.fallback, fbEnv, ind + 1)},\n${pad}${this.regionFn(m.decls, m.body, env, ind + 1)}, ${this.classes(m.classes, env)})`;
      }
    }
  }
}

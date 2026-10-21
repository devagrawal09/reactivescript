// Reference runtime for spec/02-core.md §4 and spec/03-regions.md.
// Pull-based settle with push invalidation; per-path dependencies (phase-1 store model).
import type { Decl, Expr, Markup, Program, Stmt } from "./ast.ts";

export class RuleError extends Error { rule: string; constructor(rule: string, msg: string) { super(`${rule}: ${msg}`); this.rule = rule; } }

type Path = string; // used only by diffPaths (E-6 per-path equality)
const join = (p: Path, k: string | number) => (p === "" ? String(k) : `${p}.${k}`);
type Target = Node | object;   // a node's own value (key "") or an object's property (ST-2: per object identity, per key)

export class ErrVal { err: unknown; constructor(err: unknown) { this.err = err; } }
const isErr = (v: unknown): v is ErrVal => v instanceof ErrVal;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

/** Leaf paths at which `a` and `b` differ (E-6 per path). Root differs → "" if not objects. */
function diffPaths(a: unknown, b: unknown, path: Path, out: Set<Path>) {
  if (Object.is(a, b)) return;
  if (isObj(a) && isObj(b) && Array.isArray(a) === Array.isArray(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) diffPaths(a[k], b[k], join(path, k), out);
    if (Array.isArray(a) && Array.isArray(b) && a.length !== b.length) out.add(join(path, "length"));
    return;
  }
  out.add(path);
}

// ---------------------------------------------------------------- nodes
type Kind = "source" | "eq" | "reader";
export class Node {
  static seq = 0;
  id = Node.seq++;
  value: unknown = undefined; hasValue = false;
  prev: unknown = undefined; hasPrev = false;        // frame-indexed (P-6)
  state: "clean" | "check" | "dirty" = "dirty";
  changed = false;                                    // this instant (root value changed)
  demanded = false; evaluated = false;
  deps = new Map<Target, Set<string>>();
  preDeps = new Set<Node>(); preSubs = new Set<Node>();   // delayed inputs (C-2)
  kind: Kind; name: string; region: Region; compute?: (rt: Runtime) => unknown;
  constructor(kind: Kind, name: string, region: Region, compute?: (rt: Runtime) => unknown) { this.kind = kind; this.name = name; this.region = region; this.compute = compute; }
}

export class Region {
  nodes = new Set<Node>(); effects: EffectRec[] = []; children = new Set<Region>();
  scope = new Map<string, Node | { constant: unknown }>();
  alive = true;
  parent: Region | null; rt: Runtime;
  constructor(parent: Region | null, rt: Runtime) { this.parent = parent; this.rt = rt; parent?.children.add(this); }
  lookup(name: string): Node | { constant: unknown } | undefined { return this.scope.get(name) ?? this.parent?.lookup(name); }
  dispose() {
    if (!this.alive) return; this.alive = false;
    for (const c of [...this.children]) c.dispose();
    for (const e of this.effects) { if (e.cleanup) this.rt.pendingCleanups.push(e.cleanup); e.cleanup = undefined; e.alive = false; }
    for (const n of this.nodes) { this.rt.unsubscribe(n); for (const d of n.preDeps) d.preSubs.delete(n); }
    this.parent?.children.delete(this);
  }
}

type EffectRec = { computes: Node[]; body: Stmt[]; region: Region; ran: boolean; alive: boolean; cleanup?: () => void };

type Write = { node: Node; path: (string | number)[]; value: unknown };

// ---------------------------------------------------------------- runtime
export class Runtime {
  root: Region;
  effects: EffectRec[] = [];           // creation order (EF-6: ref uses it; spec does not)
  views: ViewInst[] = [];
  pendingWrites: Write[] = [];
  pendingCleanups: (() => void)[] = [];   // region disposals during settle run in observe (O-2, EF-5)
  subs = new Map<Target, Map<string, Set<Node>>>();
  log: string[] = [];
  instant = -1;
  // evaluation context
  private tracking: Node | null = null;
  private demandMode = true;

  program: Program;
  constructor(program: Program) {
    this.program = program;
    this.root = new Region(null, this);
    staticChecks(program);
    this.declare(program.decls, this.root);
    this.views.push(this.instantiate(program.view, this.root));
  }

  // ---- declarations (E-1, E-4, E-7, EF-1, V) ----
  declare(decls: Decl[], region: Region) {
    // E-7: equations are a system — bind all names first, then sources' initializers in order.
    for (const d of decls) {
      if (d.k === "eq") region.scope.set(d.name, this.mkNode("eq", d.name, region, rt => rt.evalExpr(d.e, region)));
      if (d.k === "source") region.scope.set(d.name, this.mkNode("source", d.name, region));
    }
    for (const d of decls) {
      if (d.k === "source") {
        const n = region.scope.get(d.name) as Node;
        n.value = this.snapshot(d.init, region); n.hasValue = true; n.state = "clean";   // E-4
        n.changed = true;
      } else if (d.k === "effect") {
        const computes = d.inputs.map((e, i) => this.mkNode("eq", `effect#${i}`, region, rt => rt.evalExpr(e, region)));
        const rec: EffectRec = { computes, body: d.body, region, ran: false, alive: true };
        region.effects.push(rec); this.effects.push(rec);
      }
    }
  }
  mkNode(kind: Kind, name: string, region: Region, compute?: (rt: Runtime) => unknown) {
    const n = new Node(kind, name, region, compute); region.nodes.add(n); return n;
  }

  // ---- instants (§4) ----
  /** Run one instant with the given writes; then chain instants for effect writes. Returns frames. */
  step(writes: Write[]): { frame: string; effects: string[] }[] {
    const out: { frame: string; effects: string[] }[] = [];
    let w = writes;
    do {
      this.instant++;
      out.push(this.runInstant(w));
      w = this.pendingWrites; this.pendingWrites = [];
    } while (w.length);
    return out;
  }

  private runInstant(writes: Write[]) {
    // Phase 1 — write (W-3, W-4): apply to sources; notify (target, key) subscribers; E-6 per path.
    for (const n of this.allNodes()) { n.changed = false; n.demanded = false; n.evaluated = false; }
    for (const w of writes) {
      if (w.path.length === 0) {
        const d = new Set<Path>(); diffPaths(w.node.value, w.value, "", d);
        if (d.size === 0) continue;                                   // E-6: equal → keep old identity
        w.node.value = w.value; w.node.changed = true; w.node.evaluated = true;
        this.notify(w.node, "");
      } else {
        let o = w.node.value as Record<string, unknown>;
        const keys = w.path.map(String); const last = keys.pop()!;
        for (const k of keys) { if (!isObj(o[k])) { o[k] = /^\d+$/.test(k) ? [] : {}; this.notify(o, k); } o = o[k] as Record<string, unknown>; }
        const d = new Set<Path>(); diffPaths(o[last], w.value, "", d);
        if (d.size === 0) continue;
        o[last] = w.value; this.notify(o, last);
        if (Array.isArray(o)) this.notify(o, "length");
      }
    }
    if (this.instant === 0) for (const n of this.allNodes()) if (n.kind === "source") { n.changed = true; n.evaluated = true; }

    // Phase 2 — settle (E-3): demand readers (render) and effect computes.
    const frame = this.views.map(v => this.render(v)).join("");
    for (const e of this.effects) if (e.alive) for (const c of e.computes) this.pull(c);

    // Phase 3 — observe: frame fixed; pre bookkeeping (P-6, E-8); run effects (EF-2..EF-6).
    const preChanged: Node[] = [];
    for (const n of this.allNodes()) {
      const inFrame = n.kind === "source" || n.demanded;
      const newPrev = inFrame ? n.value : undefined;
      if (n.hasPrev !== inFrame || !Object.is(n.prev, newPrev)) preChanged.push(n);
      n.prev = newPrev; n.hasPrev = inFrame;
      if (!inFrame) { n.hasValue = false; n.value = undefined; }   // E-8; state untouched
    }
    // C-2: pre is a delayed input — a change in x's frame value invalidates pre-readers for the next instant.
    for (const x of preChanged) for (const s of x.preSubs) this.markDirty(s);
    const effects: string[] = [];
    const logBefore = this.log.length;
    for (const c of this.pendingCleanups) c(); this.pendingCleanups = [];
    for (const e of [...this.effects]) {
      if (!e.alive) continue;
      const fire = !e.ran || e.computes.some(c => c.changed);
      if (!fire) continue;
      e.cleanup?.(); e.cleanup = undefined; e.ran = true;
      const env = new Map<string, unknown>(); e.computes.forEach((c, i) => env.set(`$${i}`, c.value));
      const r = this.runStmts(e.body, e.region, env, e.computes.map(c => c.value));
      if (typeof r === "function") e.cleanup = r as () => void;
    }
    this.effects = this.effects.filter(e => e.alive);
    return { frame, effects: this.log.slice(logBefore) };
  }

  private markDirty(m: Node, st: "dirty" | "check" = "dirty") {
    const rank = { clean: 0, check: 1, dirty: 2 } as const;
    if (rank[m.state] >= rank[st]) return;
    m.state = st;
    for (const s of this.subs.get(m)?.get("") ?? []) this.markDirty(s, "check");
  }
  private notify(t: Target, key: string) { for (const s of this.subs.get(t)?.get(key) ?? []) this.markDirty(s); }
  unsubscribe(n: Node) { for (const [t, ks] of n.deps) for (const k of ks) this.subs.get(t)?.get(k)?.delete(n); n.deps.clear(); }
  private subscribe(n: Node) { for (const [t, ks] of n.deps) for (const k of ks) { let m = this.subs.get(t); if (!m) this.subs.set(t, (m = new Map())); let st = m.get(k); if (!st) m.set(k, (st = new Set())); st.add(n); } }

  // ---- pull (E-3, E-6, E-8) ----
  pull(n: Node): unknown {
    if (n.kind === "source") return n.value;
    if (!this.demandMode) return this.transient(n);
    n.demanded = true;
    if (n.evaluated) return n.value;
    let recompute = !n.hasValue || n.state === "dirty";
    if (!recompute) {
      // Demand propagates through cut nodes: a node in the frame keeps its inputs in the frame (E-3, E-8, P-6).
      for (const d of n.deps.keys()) if (d instanceof Node) { this.pull(d); if (n.state === "check" && d.changed) { recompute = true; break; } }
      if (!recompute && n.state === "check") recompute = true;      // an object-key notification marked us
    }
    if (recompute) {
      this.unsubscribe(n);
      for (const d of n.preDeps) d.preSubs.delete(n);
      n.preDeps.clear();
      const prevTracking = this.tracking; this.tracking = n;
      let v: unknown;
      try { v = n.compute!(this); } catch (e) { v = new ErrVal(e); }
      this.tracking = prevTracking;
      this.subscribe(n);
      const ch = new Set<Path>();
      if (!n.hasValue) ch.add(""); else diffPaths(n.value, v, "", ch);
      if (ch.size > 0) { n.value = v; n.changed = true; }   // E-6: equal → keep old identity, no change
      n.hasValue = true;
    }
    n.state = "clean"; n.evaluated = true;
    return n.value;
  }
  /** peek/imperative read of an undemanded equation: evaluate from scratch without joining the frame (E-5). */
  private transient(n: Node): unknown {
    if (n.evaluated) return n.value;
    const prevTracking = this.tracking; this.tracking = null;
    let v: unknown; try { v = n.compute!(this); } catch (e) { v = new ErrVal(e); }
    this.tracking = prevTracking; return v;
  }
  private track(t: Target, key: string) {
    if (!this.tracking || !this.demandMode) return;
    let s = this.tracking.deps.get(t); if (!s) this.tracking.deps.set(t, (s = new Set())); s.add(key);
  }
  private snapshot(e: Expr, region: Region) {
    const dm = this.demandMode, tr = this.tracking; this.demandMode = false; this.tracking = null;
    try { return this.evalExpr(e, region); } finally { this.demandMode = dm; this.tracking = tr; }
  }

  // ---- expressions ----
  evalExpr(e: Expr, region: Region, env?: Map<string, unknown>): unknown { return this.ev(e, region, env); }
  private ev(e: Expr, region: Region, env?: Map<string, unknown>): unknown {
    switch (e.k) {
      case "lit": return e.v;
      case "id": {
        if (env?.has(e.name)) return env.get(e.name);
        const b = region.lookup(e.name);
        if (!b) { if (e.name in BUILTINS) return BUILTINS[e.name]; throw new RuleError("SCOPE", `unbound ${e.name}`); }
        if ("constant" in b) return b.constant;
        this.track(b, ""); return this.pull(b);
      }
      case "member": { const v = this.ev(e.o, region, env); if (isErr(v)) return v; if (!isObj(v)) return undefined; this.track(v, e.p); return v[e.p]; }
      case "index": { const i = this.evalExpr(e.i, region, env); if (isErr(i)) return i; const v = this.ev(e.o, region, env); if (isErr(v)) return v; if (!isObj(v)) return undefined; this.track(v, String(i)); return v[String(i)]; }
      case "pre": {
        const b = region.lookup(e.name);
        if (!b || "constant" in b) throw new RuleError("C-2", `pre of non-reactive ${e.name}`);
        if (this.tracking && this.demandMode) { this.tracking.preDeps.add(b); b.preSubs.add(this.tracking); }
        if (b.hasPrev) return b.prev;                                  // C-2
        return e.init ? this.evalExpr(e.init, region, env) : undefined; // C-2a
      }
      case "peek": { const dm = this.demandMode, tr = this.tracking; this.demandMode = false; this.tracking = null; try { return this.evalExpr(e.e, region, env); } finally { this.demandMode = dm; this.tracking = tr; } }
      case "if": { const c = this.evalExpr(e.c, region, env); if (isErr(c)) return c; return this.evalExpr(c ? e.t : e.f, region, env); } // E-11
      case "un": { const v = this.evalExpr(e.e, region, env); if (isErr(v)) return v; return e.op === "!" ? !v : -(v as number); }
      case "bin": {
        const l = this.evalExpr(e.l, region, env); if (isErr(l)) return l;
        if (e.op === "&&") return l ? this.evalExpr(e.r, region, env) : l;
        if (e.op === "||") return l ? l : this.evalExpr(e.r, region, env);
        const r = this.evalExpr(e.r, region, env); if (isErr(r)) return r;
        return BIN[e.op](l, r);
      }
      case "arr": return e.items.map(i => this.evalExpr(i, region, env));
      case "rec": { const o: Record<string, unknown> = {}; for (const f of e.fields) o[f.key] = this.evalExpr(f.v, region, env); return o; }
      case "fn": {
        const imperative = !this.demandMode;                           // SC-3
        return (...args: unknown[]) => {
          const en = new Map(env); e.params.forEach((p, i) => en.set(p, args[i]));
          if (!imperative) return this.evalExpr(e.body, region, en);
          const dm = this.demandMode, tr = this.tracking; this.demandMode = false; this.tracking = null;
          try { return this.evalExpr(e.body, region, en); } finally { this.demandMode = dm; this.tracking = tr; }
        };
      }
      case "call": {
        const f = this.evalExpr(e.f, region, env); if (isErr(f)) return f;
        const args = e.args.map(a => this.evalExpr(a, region, env)); const bad = args.find(isErr); if (bad) return bad;
        if (typeof f !== "function") throw new RuleError("TYPE", "call of non-function");
        if ((f as { io?: boolean }).io && this.demandMode) throw new RuleError("IO-2", "io function called in reactive scope");
        return (f as (...a: unknown[]) => unknown)(...args);
      }
    }
  }

  // ---- imperative scope (SC-2): snapshots, writes queued to the next instant (W-3/W-4) ----
  runStmts(stmts: Stmt[], region: Region, env: Map<string, unknown>, params: unknown[] = []): unknown {
    const dm = this.demandMode, tr = this.tracking; this.demandMode = false; this.tracking = null;
    params.forEach((p, i) => env.set(`$${i}`, p));
    const io = { log: Object.assign((...a: unknown[]) => { this.log.push(`log(${a.map(fmt).join(", ")})`); }, { io: true }) };
    const envIo = new Map([...env, ...Object.entries(io)]);
    let result: unknown;
    try {
      for (const s of stmts) {
        if (s.k === "let") envIo.set(s.name, this.evalExpr(s.e, region, envIo));
        else if (s.k === "expr") result = this.evalExpr(s.e, region, envIo);
        else {
          const b = region.lookup(s.target.name);
          if (!b || "constant" in b || b.kind !== "source") throw new RuleError("W-1", `write to non-source ${s.target.name}`);
          const path = s.target.path.map(p => typeof p === "string" ? p : String(this.evalExpr(p, region, envIo)));
          this.pendingWrites.push({ node: b, path, value: this.evalExpr(s.e, region, envIo) });
        }
      }
    } finally { this.demandMode = dm; this.tracking = tr; }
    return result;
  }
  handler(stmts: Stmt[]) {
    // Scenario handlers resolve names through every live region, innermost first (a handler declared in that region).
    const all: Region[] = []; const walk = (r: Region) => { for (const c of r.children) walk(c); all.push(r); }; walk(this.root);
    const scope = new Map<string, Node | { constant: unknown }>();
    for (const r of all) for (const [k, v] of r.scope) if (!scope.has(k)) scope.set(k, v);
    const virt = new Region(null, this); virt.scope = scope;
    this.runStmts(stmts, virt, new Map()); const w = this.pendingWrites; this.pendingWrites = []; return this.step(w);
  }

  // ---- views (V-1..V-3, RG-1, RG-2) ----
  instantiate(m: Markup[], region: Region): ViewInst {
    return { region, items: m.map(x => this.inst1(x, region)) };
  }
  private inst1(m: Markup, region: Region): VItem {
    switch (m.k) {
      case "text": return { k: "text", s: m.s };
      case "read": return { k: "read", node: this.mkNode("reader", "reader", region, rt => rt.evalExpr(m.e, region)) };
      case "el": return { k: "el", tag: m.tag, attrs: m.attrs.map(a => ({ name: a.name, node: this.mkNode("reader", a.name, region, rt => rt.evalExpr(a.e, region)) })), children: m.children.map(c => this.inst1(c, region)) };
      case "mif": return { k: "mif", m, cond: this.mkNode("reader", "if", region, rt => Boolean(rt.evalExpr(m.c, region))), region, branch: null, inst: null };
      case "mfor": return { k: "mfor", m, xs: this.mkNode("reader", "for", region, rt => rt.evalExpr(m.xs, region)), region, rows: [] };
    }
  }
  render(v: ViewInst): string { return v.items.map(i => this.renderItem(i)).join(""); }
  private renderItem(i: VItem): string {
    switch (i.k) {
      case "text": return i.s;
      case "read": return fmt(this.pull(i.node));
      case "el": { for (const a of i.attrs) this.pull(a.node); return i.children.map(c => this.renderItem(c)).join(""); }
      case "mif": {
        const c = this.pull(i.cond); const want = isErr(c) ? "f" : c ? "t" : "f";
        if (i.branch !== want) {                                   // RG-1a dispose and recreate
          i.inst?.region.dispose(); i.branch = want;
          const r = new Region(i.region, this);
          if (want === "t" && i.m.c.k === "id") { const b = i.region.lookup(i.m.c.name); if (b) r.scope.set(i.m.c.name, b); } // RG-1c
          this.declare(want === "t" ? i.m.tDecls : i.m.fDecls, r);
          i.inst = this.instantiate(want === "t" ? i.m.t : i.m.f, r);
        }
        return this.render(i.inst!);
      }
      case "mfor": {
        const xs = this.pull(i.xs); const arr = Array.isArray(xs) ? xs : [];
        const pool = new Map<unknown, Row[]>();                    // RG-2a identity, duplicates in order
        for (const r of i.rows) { const l = pool.get(r.elem) ?? []; l.push(r); pool.set(r.elem, l); }
        const rows: Row[] = [];
        arr.forEach((elem, idx) => {
          const reuse = pool.get(elem)?.shift();
          if (reuse) { rows.push(reuse); return; }
          const r = new Region(i.region, this); r.scope.set(i.m.name, { constant: elem });  // RG-2b
          this.declare(i.m.decls, r);                                                       // RG-2c
          rows.push({ elem, region: r, inst: this.instantiate(i.m.body, r) });
        });
        for (const l of pool.values()) for (const r of l) r.region.dispose();
        i.rows = rows;
        return rows.map(r => this.render(r.inst)).join("");
      }
    }
  }
  private allNodes(): Node[] { const out: Node[] = []; const walk = (r: Region) => { out.push(...r.nodes); for (const c of r.children) walk(c); }; walk(this.root); return out; }
}

type ViewInst = { region: Region; items: VItem[] };
type Row = { elem: unknown; region: Region; inst: ViewInst };
type VItem =
  | { k: "text"; s: string } | { k: "read"; node: Node }
  | { k: "el"; tag: string; attrs: { name: string; node: Node }[]; children: VItem[] }
  | { k: "mif"; m: Extract<Markup, { k: "mif" }>; cond: Node; region: Region; branch: "t" | "f" | null; inst: ViewInst | null }
  | { k: "mfor"; m: Extract<Markup, { k: "mfor" }>; xs: Node; region: Region; rows: Row[] };

export const fmt = (v: unknown): string => isErr(v) ? "#error" : v === undefined ? "undefined" : typeof v === "string" ? v : JSON.stringify(v);
const BIN: Record<string, (a: any, b: any) => unknown> = {
  "+": (a, b) => a + b, "-": (a, b) => a - b, "*": (a, b) => a * b, "/": (a, b) => a / b, "%": (a, b) => a % b,
  "==": (a, b) => a === b, "!=": (a, b) => a !== b, "<": (a, b) => a < b, ">": (a, b) => a > b, "<=": (a, b) => a <= b, ">=": (a, b) => a >= b,
};
const BUILTINS: Record<string, unknown> = {
  len: (x: unknown) => (Array.isArray(x) || typeof x === "string") ? x.length : isObj(x) ? Object.keys(x).length : 0,
  str: (x: unknown) => fmt(x),
  map: (xs: unknown[], f: (x: unknown, i: number) => unknown) => xs.map(f),
  filter: (xs: unknown[], f: (x: unknown) => unknown) => xs.filter(f),
  sum: (xs: number[]) => xs.reduce((a, b) => a + b, 0),
  fail: (msg: string) => { throw new Error(msg); },
};

// ---------------------------------------------------------------- static checks (C-1, W-1 shape)
function staticChecks(p: Program) {
  const eqs = new Map<string, Expr>(); const names = new Set<string>();
  for (const d of p.decls) { if (d.k === "eq") { if (names.has(d.name)) throw new RuleError("E-7", `duplicate ${d.name}`); eqs.set(d.name, d.e); names.add(d.name); } if (d.k === "source") { if (names.has(d.name)) throw new RuleError("E-7", `duplicate ${d.name}`); names.add(d.name); } }
  const free = (e: Expr, out: Set<string>) => {
    switch (e.k) {
      case "id": out.add(e.name); break;
      case "pre": case "peek": case "lit": break;                     // C-2, E-5: not inputs
      case "bin": free(e.l, out); free(e.r, out); break;
      case "un": free(e.e, out); break;
      case "if": free(e.c, out); free(e.t, out); free(e.f, out); break;  // conservative (E-11 is dynamic)
      case "member": free(e.o, out); break;
      case "index": free(e.o, out); free(e.i, out); break;
      case "call": free(e.f, out); e.args.forEach(a => free(a, out)); break;
      case "arr": e.items.forEach(a => free(a, out)); break;
      case "rec": e.fields.forEach(f => free(f.v, out)); break;
      case "fn": { const o = new Set<string>(); free(e.body, o); for (const n of o) if (!e.params.includes(n)) out.add(n); break; }
    }
  };
  const color = new Map<string, 1 | 2>();
  const visit = (n: string, stack: string[]) => {
    if (color.get(n) === 2) return; if (color.get(n) === 1) throw new RuleError("C-1", `instantaneous cycle: ${[...stack, n].join(" → ")}`);
    color.set(n, 1); const f = new Set<string>(); free(eqs.get(n)!, f);
    for (const m of f) if (eqs.has(m)) visit(m, [...stack, n]);
    color.set(n, 2);
  };
  for (const n of eqs.keys()) visit(n, []);
  // W-1 shape: writes in effect bodies must target sources
  for (const d of p.decls) if (d.k === "effect") for (const s of d.body) if (s.k === "write" && !p.decls.some(x => x.k === "source" && x.name === s.target.name)) throw new RuleError("W-1", `write to non-source ${s.target.name}`);
}

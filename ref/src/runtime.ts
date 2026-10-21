// Reference runtime: spec/02-core §4 (instants), 03 (regions), 04 (rows), 05 (holds: two versions of state).
// Pull-based settle with push invalidation; dependencies per (object identity, key) — ST-2.
import type { Decl, Expr, Markup, Program, Stmt } from "./ast.ts";
type FnDecl = Extract<Decl, { k: "fn" }>; type CompDecl = Extract<Decl, { k: "component" }>;

export class RuleError extends Error { rule: string; constructor(rule: string, msg: string) { super(`${rule}: ${msg}`); this.rule = rule; } }
export class ErrVal { err: unknown; constructor(err: unknown) { this.err = err; } }
export class PendingVal { }                              // R-2: absence flows like a value
export const PENDING = new PendingVal();
export class Flight { key: string; state: "pending" | "resolved" | "rejected" = "pending"; value: unknown; constructor(key: string) { this.key = key; } }
export class ViewValue { region: Region; items: VItem[]; constructor(region: Region, items: VItem[]) { this.region = region; this.items = items; } }

type Path = string;
const join = (p: Path, k: string | number) => (p === "" ? String(k) : `${p}.${k}`);
type Target = Node | object;
const isErr = (v: unknown): v is ErrVal => v instanceof ErrVal;
const isAbsent = (v: unknown) => v instanceof ErrVal || v instanceof PendingVal;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !(v instanceof ErrVal) && !(v instanceof PendingVal) && !(v instanceof Flight) && !(v instanceof ViewValue);

/** Leaf paths at which `a` and `b` differ (E-6 per path). */
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
  value: unknown = undefined; hasValue = false;        // in-flight (σ′)
  committed: unknown = undefined; hasCommitted = false; // committed (σ)
  changedSinceCommit = false;
  prev: unknown = undefined; hasPrev = false;           // frame-indexed (P-6), set at commit
  state: "clean" | "check" | "dirty" = "dirty";
  changed = false; demanded = false; evaluated = false; // this instant
  deps = new Map<Target, Set<string>>();
  preDeps = new Set<Node>(); preSubs = new Set<Node>();
  lane = false;                                        // R-10: read a probe during last compute
  flight: Flight | null = null; answered = false; firstPaint = false;   // R-1, R-7
  kind: Kind; name: string; region: Region; compute?: (rt: Runtime) => unknown;
  constructor(kind: Kind, name: string, region: Region, compute?: (rt: Runtime) => unknown) { this.kind = kind; this.name = name; this.region = region; this.compute = compute; }
}

type Binding = Node | { constant: unknown } | { fn: FnDecl } | { comp: CompDecl };
export class Region {
  nodes = new Set<Node>(); effects: EffectRec[] = []; children = new Set<Region>();
  scope = new Map<string, Binding>();
  alive = true;
  parent: Region | null; rt: Runtime; boundary: BoundaryItem | null;
  constructor(parent: Region | null, rt: Runtime, boundary: BoundaryItem | null = parent?.boundary ?? null) { this.parent = parent; this.rt = rt; this.boundary = boundary; parent?.children.add(this); }
  lookup(name: string): Binding | undefined { return this.scope.get(name) ?? this.parent?.lookup(name); }
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

// view instances: structure has a committed and an in-flight version (H-2, H-8)
type ViewInst = { region: Region; items: VItem[] };
type Row = { elem: unknown; region: Region; inst: ViewInst };
type ReaderItem = { k: "read"; node: Node; shown: string | null };
type BoundaryItem = { k: "loading" | "errored"; m: Extract<Markup, { k: "loading" | "errored" }>; region: Region; parent: BoundaryItem | null; armed: boolean; onNode: Node | null; fallback: ViewInst; content: ViewInst; showingFallback: boolean; committedFallback: boolean; caught: Node[]; stillWaiting: boolean };
type VItem =
  | { k: "text"; s: string } | ReaderItem | { k: "comp"; inst: ViewInst }
  | { k: "el"; tag: string; attrs: { name: string; node: Node }[]; children: VItem[] }
  | { k: "mif"; m: Extract<Markup, { k: "mif" }>; cond: Node; region: Region; committed: { branch: string; inst: ViewInst } | null; inflight: { branch: string; inst: ViewInst } | null }
  | { k: "mfor"; m: Extract<Markup, { k: "mfor" }>; xs: Node; region: Region; committedRows: Row[]; inflightRows: Row[] }
  | BoundaryItem;

function nearest(b: BoundaryItem | null, kind: "loading" | "errored"): BoundaryItem | null { for (let x = b; x; x = x.parent) if (x.k === kind) return x; return null; }

// ---------------------------------------------------------------- runtime
export class Runtime {
  root: Region;
  effects: EffectRec[] = [];
  view!: ViewInst;
  pendingWrites: Write[] = [];
  pendingCleanups: (() => void)[] = [];
  subs = new Map<Target, Map<string, Set<Node>>>();
  flights = new Map<string, Flight>();
  log: string[] = [];
  diagnostics: string[] = [];
  instant = -1;
  holdOpen = false;                                    // H-2: an instant that could not commit
  committedOnce = false;
  private tracking: Node | null = null;
  private demandMode = true;
  program: Program;

  constructor(program: Program) {
    this.program = program;
    this.root = new Region(null, this, null);
    staticChecks(program);
    this.declare(program.decls, this.root);
    this.view = this.instantiate(program.view, this.root);
  }

  // ---- declarations (E-1, E-4, E-7, EF-1) ----
  declare(decls: Decl[], region: Region) {
    for (const d of decls) { if (d.k === "fn") region.scope.set(d.name, { fn: d }); if (d.k === "component") region.scope.set(d.name, { comp: d }); }
    for (const d of decls) {                                           // E-7: equations are a system
      if (d.k === "eq" && !this.instantiates(d.e, region)) region.scope.set(d.name, this.mkNode("eq", d.name, region, rt => rt.evalExpr(d.e, region)));
      if (d.k === "source") region.scope.set(d.name, this.mkNode("source", d.name, region));
    }
    for (const d of decls) {
      if (d.k === "eq" && this.instantiates(d.e, region)) region.scope.set(d.name, this.instantiateFn(d.e as Extract<Expr, { k: "call" }>, region));
      else if (d.k === "source") {
        const n = region.scope.get(d.name) as Node;
        n.value = this.snapshot(d.init, region); n.hasValue = true; n.state = "clean"; n.changed = true; n.changedSinceCommit = true;   // E-4
      } else if (d.k === "effect") {
        const computes = d.inputs.map((e, i) => this.mkNode("eq", `effect#${i}`, region, rt => rt.evalExpr(e, region)));
        const rec: EffectRec = { computes, body: d.body, region, ran: false, alive: true };
        region.effects.push(rec); this.effects.push(rec);
      }
    }
  }
  private fnOf(e: Expr, region: Region): FnDecl | null { if (e.k !== "call" || e.f.k !== "id") return null; const b = region.lookup(e.f.name); return b && "fn" in b ? b.fn : null; }
  private isInstantiating(f: FnDecl) { return f.params.some(p => p.ref) || f.decls.length > 0; }
  private instantiates(e: Expr, region: Region) { const f = this.fnOf(e, region); return !!f && this.isInstantiating(f); }
  private instantiateFn(call: Extract<Expr, { k: "call" }>, region: Region): Node {   // E-9 / RG-6
    const f = this.fnOf(call, region)!;
    const r = new Region(region, this);
    f.params.forEach((p, i) => {
      const arg = call.args[i];
      if (p.ref) { const b = arg?.k === "id" ? region.lookup(arg.name) : undefined; r.scope.set(p.name, b instanceof Node ? b : this.mkNode("eq", `${f.name}.${p.name}`, region, rt => arg ? rt.evalExpr(arg, region) : undefined)); }
      else {
        if (arg && isReactive(arg, region)) this.diagnostics.push(`SNAPSHOT_ARGUMENT: ${f.name}(…): argument for value parameter ${p.name} is reactive and is snapshotted; declare the parameter ref`);
        r.scope.set(p.name, { constant: arg ? this.snapshot(arg, region) : undefined });
      }
    });
    this.declare(f.decls, r);
    const tb = f.tail.k === "id" ? r.lookup(f.tail.name) : undefined;
    if (tb instanceof Node) return tb;
    return this.mkNode("eq", `${f.name}()`, r, rt => rt.evalExpr(f.tail, r));
  }
  mkNode(kind: Kind, name: string, region: Region, compute?: (rt: Runtime) => unknown) { const n = new Node(kind, name, region, compute); region.nodes.add(n); return n; }

  // ---- instants (02 §4, 05 H-2/H-3) ----
  step(writes: Write[]): { frame: string; effects: string[] }[] {
    const out: { frame: string; effects: string[] }[] = [];
    let w = writes;
    do { this.instant++; out.push(this.runInstant(w)); w = this.pendingWrites; this.pendingWrites = []; } while (w.length);
    return out;
  }
  /** Land an async answer (a change, V-6) and run the instant it opens. */
  land(target: string, value: unknown, reject = false) {
    let f: Flight | undefined;
    if (/^".*"$/.test(target)) f = this.flights.get(target.slice(1, -1));
    else { const n = this.findNode(target); f = n?.flight ?? undefined; if (!n) throw new Error(`no node ${target}`); if (!f) throw new Error(`${target} has no flight`); }
    if (!f) throw new Error(`no flight ${target}`);
    f.state = reject ? "rejected" : "resolved"; f.value = reject ? new Error(String(value)) : value;
    for (const n of this.allNodes()) if (n.flight === f) this.markDirty(n);
    return this.step([]);
  }

  private runInstant(writes: Write[]) {
    // Phase 1 — write (W-3, W-4, H-3): into σ′; notify subscribers; E-6 per path.
    for (const n of this.allNodes()) { n.changed = false; n.demanded = false; n.evaluated = false; }
    for (const w of writes) {
      if (w.path.length === 0) {
        const d = new Set<Path>(); diffPaths(w.node.value, w.value, "", d);
        if (d.size === 0) continue;
        w.node.value = w.value; w.node.changed = true; w.node.changedSinceCommit = true; w.node.evaluated = true; this.notify(w.node, "");
      } else {
        let o = w.node.value as Record<string, unknown>;
        const keys = w.path.map(String); const last = keys.pop()!;
        for (const k of keys) { if (!isObj(o[k])) { o[k] = /^\d+$/.test(k) ? [] : {}; this.notify(o, k); } o = o[k] as Record<string, unknown>; }
        const d = new Set<Path>(); diffPaths(o[last], w.value, "", d);
        if (d.size === 0) continue;
        o[last] = w.value; w.node.changedSinceCommit = true; this.notify(o, last);
        if (Array.isArray(o)) this.notify(o, "length");
      }
    }
    if (this.instant === 0) for (const n of this.allNodes()) if (n.kind === "source") { n.changed = true; n.evaluated = true; }

    // Phase 2 — settle (E-3) against σ′: readers of the in-flight structure, effect computes, boundaries (H-5/H-6).
    const holding: Node[] = [];
    this.settle(this.view, holding, null);
    for (const e of this.effects) if (e.alive) for (const c of e.computes) { this.pull(c); if (c.changed) c.changedSinceCommit = true; }

    // Hold decision (H-2, H-4).
    if (holding.length > 0) {
      if (!this.committedOnce) for (const h of holding) if (!h.region.boundary) this.diagnostics.push(`ASYNC_OUTSIDE_LOADING_BOUNDARY: ${h.name} is pending at mount with no loading boundary; the mount is held`);
      this.holdOpen = true;
      // H-7: lane readers show σ′ beside the held screen (unless their own lane is pending).
      this.patchLanes(this.view);
      return { frame: this.committedOnce ? this.renderCommitted(this.view) : "", effects: [] };
    }

    // Phase 3 — commit (σ := σ′) and observe: structure swap, pre bookkeeping (P-6, E-8), effects (EF-2..EF-6).
    // Verdicts are final at commit (H-9): decide effect firing, close the hold, then re-settle lane readers.
    const fire = new Set<EffectRec>();
    for (const e of this.effects) if (e.alive && (!e.ran || e.computes.some(c => c.changedSinceCommit))) fire.add(e);
    this.holdOpen = false;
    for (const n of this.allNodes()) { n.changedSinceCommit = false; if (n.lane) { n.evaluated = false; n.state = "dirty"; } }
    this.settle(this.view, [], null);
    this.commit(this.view);
    this.committedOnce = true;
    const frame = this.renderCommitted(this.view);
    const preChanged: Node[] = [];
    for (const n of this.allNodes()) {
      const inFrame = n.kind === "source" || n.demanded;
      const newPrev = inFrame ? n.value : undefined;
      if (n.hasPrev !== inFrame || !Object.is(n.prev, newPrev)) preChanged.push(n);
      n.prev = newPrev; n.hasPrev = inFrame;
      if (n.hasValue) { n.committed = n.value; n.hasCommitted = true; }
      if (!inFrame) { n.hasValue = false; n.value = undefined; n.hasCommitted = false; }   // E-8
    }
    for (const x of preChanged) for (const s of x.preSubs) this.markDirty(s);   // C-2 delayed input
    const logBefore = this.log.length;
    for (const c of this.pendingCleanups) c(); this.pendingCleanups = [];
    for (const e of [...this.effects]) {
      if (!e.alive) continue;
      if (!fire.has(e) || e.computes.some(c => isAbsent(c.value))) continue;   // R-2: pending compute → no apply
      e.cleanup?.(); e.cleanup = undefined; e.ran = true;
      const r = this.runStmts(e.body, e.region, new Map(), e.computes.map(c => c.value));
      if (typeof r === "function") e.cleanup = r as () => void;
    }
    this.effects = this.effects.filter(e => e.alive);
    return { frame, effects: this.log.slice(logBefore) };
  }

  // ---- settle / commit / render over the two structure versions ----
  private settle(v: ViewInst, holding: Node[], boundary: BoundaryItem | null) { for (const i of v.items) this.settleItem(i, holding, boundary); }
  private settleItem(i: VItem, holding: Node[], boundary: BoundaryItem | null) {
    switch (i.k) {
      case "text": return;
      case "comp": return this.settle(i.inst, holding, boundary);
      case "read": {
        const v = this.pull(i.node);
        if (v instanceof ViewValue) return this.settle(v, holding, boundary);
        if (v instanceof ErrVal) { const eb = nearest(boundary, "errored"); if (eb) eb.caught.push(i.node); return; }       // H-12
        if (v instanceof PendingVal && !i.node.lane) {
          const eb = nearest(boundary, "errored"); if (eb && eb.showingFallback) { eb.stillWaiting = true; return; }     // H-4/H-12: pending is not an answer
          const lb = nearest(boundary, "loading");
          if (lb && lb.armed) lb.caught.push(i.node); else holding.push(i.node);                                           // H-5 / H-6
        }
        return;
      }
      case "el": { for (const a of i.attrs) this.pull(a.node); for (const c of i.children) this.settleItem(c, holding, boundary); return; }
      case "mif": {
        const c = this.pull(i.cond); const want = c instanceof PendingVal ? (i.inflight?.branch ?? null) : (isErr(c) ? "f" : c ? "t" : "f");
        if (want === null) { holding.push(i.cond); return; }
        if (i.inflight?.branch !== want) {
          if (i.inflight && i.inflight !== i.committed) i.inflight.inst.region.dispose();   // an uncommitted branch is replaced
          const existing = i.committed?.branch === want ? i.committed : null;
          if (existing) i.inflight = existing;
          else {
            const r = new Region(i.region, this);
            if (want === "t" && i.m.c.k === "id") { const b = i.region.lookup(i.m.c.name); if (b) r.scope.set(i.m.c.name, b); }   // RG-1c
            this.declare(want === "t" ? i.m.tDecls : i.m.fDecls, r);
            i.inflight = { branch: want, inst: this.instantiate(want === "t" ? i.m.t : i.m.f, r) };
          }
        }
        this.settle(i.inflight!.inst, holding, boundary);
        return;
      }
      case "mfor": {
        const xs = this.pull(i.xs);
        if (xs instanceof PendingVal) { holding.push(i.xs); return; }
        const arr = Array.isArray(xs) ? xs : [];
        const pool = new Map<unknown, Row[]>();
        for (const r of new Set([...i.committedRows, ...i.inflightRows])) { const l = pool.get(r.elem) ?? []; l.push(r); pool.set(r.elem, l); }
        const rows: Row[] = [];
        for (const elem of arr) {
          const reuse = pool.get(elem)?.shift();
          if (reuse) { rows.push(reuse); continue; }
          const r = new Region(i.region, this); r.scope.set(i.m.name, { constant: elem });   // RG-2b
          this.declare(i.m.decls, r);                                                        // RG-2c
          rows.push({ elem, region: r, inst: this.instantiate(i.m.body, r) });
        }
        for (const l of pool.values()) for (const r of l) if (!i.committedRows.includes(r)) r.region.dispose();   // uncommitted rows dropped now
        i.inflightRows = rows;
        for (const r of rows) this.settle(r.inst, holding, boundary);
        return;
      }
      case "loading": {
        if (i.onNode) { this.pull(i.onNode); if (i.onNode.changed && !i.armed) i.armed = true; }   // H-6: a change to what `on` reads re-arms
        i.caught = [];
        this.settle(i.content, holding, i);
        if (i.armed) { i.showingFallback = i.caught.length > 0; if (!i.showingFallback) i.armed = false; }   // H-5: catch; disarm when ready
        if (i.showingFallback) this.settle(i.fallback, holding, boundary);
        return;
      }
      case "errored": {
        i.caught = []; i.stillWaiting = false;
        this.settle(i.content, holding, i);
        i.showingFallback = i.caught.length > 0 || (i.showingFallback && i.stillWaiting);   // H-12: fallback until a new *answer* (D-39)
        if (i.showingFallback) this.settle(i.fallback, holding, boundary);
        return;
      }
    }
  }
  private commit(v: ViewInst) { for (const i of v.items) this.commitItem(i); }
  private commitItem(i: VItem) {
    switch (i.k) {
      case "text": return;
      case "comp": return this.commit(i.inst);
      case "read": { const val = i.node.value; if (val instanceof ViewValue) { this.commit(val); i.shown = null; } else if (val instanceof PendingVal) { i.shown = i.shown ?? ""; } else i.shown = fmt(val); return; }
      case "el": { for (const c of i.children) this.commitItem(c); return; }
      case "mif": { if (i.inflight !== i.committed) { i.committed?.inst.region.dispose(); i.committed = i.inflight; } if (i.committed) this.commit(i.committed.inst); return; }
      case "mfor": { for (const r of i.committedRows) if (!i.inflightRows.includes(r)) r.region.dispose(); i.committedRows = i.inflightRows; for (const r of i.committedRows) this.commit(r.inst); return; }
      case "loading": case "errored": { i.committedFallback = i.showingFallback; this.commit(i.content); this.commit(i.fallback); return; }
    }
  }
  private renderCommitted(v: ViewInst): string { return v.items.map(i => this.renderItem(i)).join(""); }
  private renderItem(i: VItem): string {
    switch (i.k) {
      case "text": return i.s;
      case "comp": return this.renderCommitted(i.inst);
      case "read": { const val = i.node.value; if (val instanceof ViewValue) return this.renderCommitted(val); return i.shown ?? ""; }
      case "el": return i.children.map(c => this.renderItem(c)).join("");
      case "mif": return i.committed ? this.renderCommitted(i.committed.inst) : "";
      case "mfor": return i.committedRows.map(r => this.renderCommitted(r.inst)).join("");
      case "loading": case "errored": return i.committedFallback ? this.renderCommitted(i.fallback) : this.renderCommitted(i.content);
    }
  }
  /** H-7: during a hold, lane readers in the committed structure show σ′ unless their own lane is pending. */
  private patchLanes(v: ViewInst) { for (const i of v.items) this.patchItem(i); }
  private patchItem(i: VItem) {
    switch (i.k) {
      case "read": { if (i.node.lane && !(i.node.value instanceof PendingVal)) i.shown = fmt(i.node.value); return; }
      case "el": { for (const c of i.children) this.patchItem(c); return; }
      case "comp": return this.patchLanes(i.inst);
      case "mif": { if (i.committed) this.patchLanes(i.committed.inst); return; }
      case "mfor": { for (const r of i.committedRows) this.patchLanes(r.inst); return; }
      case "loading": case "errored": { this.patchLanes(i.content); return; }
      case "text": return;
    }
  }

  // ---- invalidation / pull (E-3, E-6, E-8) ----
  private notify(t: Target, key: string) { for (const s of this.subs.get(t)?.get(key) ?? []) this.markDirty(s); }
  unsubscribe(n: Node) { for (const [t, ks] of n.deps) for (const k of ks) this.subs.get(t)?.get(k)?.delete(n); n.deps.clear(); }
  private subscribe(n: Node) { for (const [t, ks] of n.deps) for (const k of ks) { let m = this.subs.get(t); if (!m) this.subs.set(t, (m = new Map())); let st = m.get(k); if (!st) m.set(k, (st = new Set())); st.add(n); } }
  private markDirty(m: Node, st: "dirty" | "check" = "dirty") {
    const rank = { clean: 0, check: 1, dirty: 2 } as const;
    if (rank[m.state] >= rank[st]) return;
    m.state = st;
    for (const s of this.subs.get(m)?.get("") ?? []) this.markDirty(s, "check");
  }
  pull(n: Node): unknown {
    if (n.kind === "source") return this.demandMode ? n.value : (n.hasCommitted ? n.committed : n.value);   // H-10: snapshots see σ
    if (!this.demandMode) return this.transient(n);
    n.demanded = true;
    if (n.evaluated) return n.value;
    let recompute = !n.hasValue || n.state === "dirty";
    if (!recompute) {
      for (const d of n.deps.keys()) if (d instanceof Node) { this.pull(d); if (n.state === "check" && d.changed) { recompute = true; break; } }
      if (!recompute && n.state === "check") recompute = true;
    }
    if (recompute) {
      this.unsubscribe(n); for (const d of n.preDeps) d.preSubs.delete(n); n.preDeps.clear();
      const prevTracking = this.tracking; this.tracking = n; n.lane = false; n.flight = null;
      let v: unknown;
      try { v = n.compute!(this); } catch (e) { if (e instanceof RuleError) throw e; v = new ErrVal(e); }
      this.tracking = prevTracking;
      this.subscribe(n);
      const ch = new Set<Path>();
      if (!n.hasValue) ch.add(""); else diffPaths(n.value, v, "", ch);
      if (ch.size > 0) { n.value = v; n.changed = true; n.changedSinceCommit = true; }
      n.hasValue = true;
      if (!isAbsent(v)) n.answered = true;
    }
    n.state = "clean"; n.evaluated = true;
    return n.value;
  }
  private transient(n: Node): unknown {                                // imperative reads see σ (H-10)
    if (n.hasCommitted) return n.committed;
    const prevTracking = this.tracking; this.tracking = null;
    let v: unknown; try { v = n.compute!(this); } catch (e) { if (e instanceof RuleError) throw e; v = new ErrVal(e); }
    this.tracking = prevTracking; return v;
  }
  private track(t: Target, key: string) { if (!this.tracking || !this.demandMode) return; let s = this.tracking.deps.get(t); if (!s) this.tracking.deps.set(t, (s = new Set())); s.add(key); }
  private snapshot(e: Expr, region: Region) { const dm = this.demandMode, tr = this.tracking; this.demandMode = false; this.tracking = null; try { return this.evalExpr(e, region); } finally { this.demandMode = dm; this.tracking = tr; } }
  private untracked<T>(f: () => T): T { const dm = this.demandMode, tr = this.tracking; this.demandMode = false; this.tracking = null; try { return f(); } finally { this.demandMode = dm; this.tracking = tr; } }

  // ---- expressions ----
  evalExpr(e: Expr, region: Region, env?: Map<string, unknown>): unknown { return this.ev(e, region, env); }
  private nodeOf(e: Expr, region: Region, env?: Map<string, unknown>): Node | null {
    if (e.k === "id") { if (env?.has(e.name)) return null; const b = region.lookup(e.name); return b instanceof Node ? b : null; }
    if (e.k === "member" || e.k === "index") return this.nodeOf(e.o, region, env);
    return null;
  }
  private ev(e: Expr, region: Region, env?: Map<string, unknown>): unknown {
    switch (e.k) {
      case "lit": return e.v;
      case "id": {
        if (env?.has(e.name)) return env.get(e.name);
        const b = region.lookup(e.name);
        if (!b) { if (e.name in BUILTINS) return BUILTINS[e.name]; throw new RuleError("SCOPE", `unbound ${e.name}`); }
        if ("constant" in b) return b.constant;
        if ("fn" in b) {
          if (this.isInstantiating(b.fn)) throw new RuleError("E-9", `instantiating fn ${b.fn.name} must be bound: x = ${b.fn.name}(…)`);
          const f = b.fn;
          return (...args: unknown[]) => { const en = new Map(env); f.params.forEach((p, i) => en.set(p.name, args[i])); return this.evalExpr(f.tail, region, en); };
        }
        if ("comp" in b) throw new RuleError("RG-4a", `component ${b.comp.name} applied outside a view`);
        this.track(b, ""); const v = this.pull(b);
        if (b.lane && this.tracking && this.demandMode) this.tracking.lane = true;   // R-10: lane flows through equations
        return v;
      }
      case "member": { const v = this.ev(e.o, region, env); if (isAbsent(v)) return v; if (!isObj(v)) return undefined; this.track(v, e.p); return v[e.p]; }
      case "index": { const i = this.ev(e.i, region, env); if (isAbsent(i)) return i; const v = this.ev(e.o, region, env); if (isAbsent(v)) return v; if (!isObj(v)) return undefined; this.track(v, String(i)); return v[String(i)]; }
      case "pre": {
        const b = region.lookup(e.name);
        if (!b || !(b instanceof Node)) throw new RuleError("C-2", `pre of non-reactive ${e.name}`);
        if (this.tracking && this.demandMode) { this.tracking.preDeps.add(b); b.preSubs.add(this.tracking); }
        if (b.hasPrev) return b.prev;
        return e.init ? this.ev(e.init, region, env) : undefined;
      }
      case "peek": return this.untracked(() => this.ev(e.e, region, env));
      case "await": {                                                  // R-1, R-6, R-7
        const v = this.ev(e.e, region, env); if (isAbsent(v)) return v;
        if (!(v instanceof Flight)) return v;                          // a value: same instant, no tick
        const n = this.tracking; if (n) n.flight = v;
        if (v.state === "resolved") { if (n) n.firstPaint = false; return v.value; }
        if (v.state === "rejected") { if (n) n.firstPaint = false; return new ErrVal(v.value); }
        if (e.init && n && !n.answered) { n.firstPaint = true; return this.ev(e.init, region, env); }
        return PENDING;
      }
      case "latest": {                                                 // R-9 probe: reads σ′
        if (this.tracking) this.tracking.lane = true;
        return this.ev(e.e, region, env);
      }
      case "pending": {                                                // R-9 / H-9 verdict
        if (this.tracking) this.tracking.lane = true;
        const n = this.nodeOf(e.e, region, env);
        if (!n) return false;
        this.track(n, ""); if (n.kind !== "source") this.pull(n);     // a probe is a (lane) dependency
        if (n.firstPaint) return false;                                // R-7
        if (!n.hasCommitted && !n.answered) return this.demandMode ? PENDING : false;   // first load: no verdict (R-9 / D-24)
        return n.value instanceof PendingVal || (this.holdOpen && n.changedSinceCommit);
      }
      case "if": { const c = this.ev(e.c, region, env); if (isAbsent(c)) return c; return this.ev(c ? e.t : e.f, region, env); }
      case "un": { const v = this.ev(e.e, region, env); if (isAbsent(v)) return v; return e.op === "!" ? !v : -(v as number); }
      case "bin": {
        const l = this.ev(e.l, region, env); if (isAbsent(l)) return l;
        if (e.op === "&&") return l ? this.ev(e.r, region, env) : l;
        if (e.op === "||") return l ? l : this.ev(e.r, region, env);
        const r = this.ev(e.r, region, env); if (isAbsent(r)) return r;
        return BIN[e.op](l, r);
      }
      case "arr": { const items = e.items.map(i => this.ev(i, region, env)); const bad = items.find(isAbsent); return bad ?? items; }
      case "rec": { const o: Record<string, unknown> = {}; for (const f of e.fields) { const v = this.ev(f.v, region, env); if (isAbsent(v)) return v; o[f.key] = v; } return o; }
      case "fn": {
        const imperative = !this.demandMode;                           // SC-3
        return (...args: unknown[]) => {
          const en = new Map(env); e.params.forEach((p, i) => en.set(p, args[i]));
          if (!imperative) return this.ev(e.body, region, en);
          return this.untracked(() => this.ev(e.body, region, en));
        };
      }
      case "call": {
        const f = this.ev(e.f, region, env); if (isAbsent(f)) return f;
        const args = e.args.map(a => this.ev(a, region, env)); const bad = args.find(isAbsent); if (bad) return bad;
        if (typeof f !== "function") throw new RuleError("TYPE", "call of non-function");
        if ((f as { io?: boolean }).io && this.demandMode) throw new RuleError("IO-2", "io function called in reactive scope");
        if (f === BUILTINS.fetch) return this.flight(String(args[0]));
        return (f as (...a: unknown[]) => unknown)(...args);
      }
    }
  }
  flight(key: string) { let f = this.flights.get(key); if (!f) this.flights.set(key, (f = new Flight(key))); return f; }

  // ---- imperative scope (SC-2) ----
  runStmts(stmts: Stmt[], region: Region, env: Map<string, unknown>, params: unknown[] = []): unknown {
    return this.untracked(() => {
      params.forEach((p, i) => env.set(`$${i}`, p));
      const envIo = new Map([...env, ["log", Object.assign((...a: unknown[]) => { this.log.push(`log(${a.map(fmt).join(", ")})`); }, { io: true })]]);
      let result: unknown;
      for (const s of stmts) {
        if (s.k === "let") envIo.set(s.name, this.ev(s.e, region, envIo));
        else if (s.k === "expr") result = this.ev(s.e, region, envIo);
        else {
          const b = region.lookup(s.target.name);
          if (!b || !(b instanceof Node) || b.kind !== "source") throw new RuleError("W-1", `write to non-source ${s.target.name}`);
          const path = s.target.path.map(p => typeof p === "string" ? p : String(this.ev(p, region, envIo)));
          this.pendingWrites.push({ node: b, path, value: this.ev(s.e, region, envIo) });
        }
      }
      return result;
    });
  }
  private virtualScope(): Region {
    const all: Region[] = []; const walk = (r: Region) => { for (const c of r.children) walk(c); all.push(r); }; walk(this.root);
    const scope = new Map<string, Binding>();
    for (const r of all) for (const [k, v] of r.scope) if (!scope.has(k)) scope.set(k, v);
    const virt = new Region(null, this, null); virt.scope = scope; return virt;
  }
  handler(stmts: Stmt[]) { this.runStmts(stmts, this.virtualScope(), new Map()); const w = this.pendingWrites; this.pendingWrites = []; return this.step(w); }
  findNode(name: string): Node | null { const b = this.virtualScope().lookup(name); return b instanceof Node ? b : null; }

  // ---- view instantiation (V, RG-1, RG-2, RG-4, H-5) ----
  instantiate(m: Markup[], region: Region): ViewInst { return { region, items: m.map(x => this.inst1(x, region)) }; }
  private inst1(m: Markup, region: Region): VItem {
    switch (m.k) {
      case "text": return { k: "text", s: m.s };
      case "read": return { k: "read", node: this.mkNode("reader", "reader", region, rt => rt.evalExpr(m.e, region)), shown: null };
      case "el": {
        if (/^[A-Z]/.test(m.tag)) {
          const b = region.lookup(m.tag);
          if (!b || !("comp" in b)) throw new RuleError("SCOPE", `unknown component ${m.tag}`);
          const comp = b.comp; const r = new Region(region, this);
          const props: Record<string, unknown> = {};
          for (const a of m.attrs) { const node = this.mkNode("eq", `${m.tag}.${a.name}`, region, rt => rt.evalExpr(a.e, region)); Object.defineProperty(props, a.name, { enumerable: true, get: () => { this.track(node, ""); return this.pull(node); } }); }
          const children = new ViewValue(region, m.children.map(c => this.inst1(c, region)));
          Object.defineProperty(props, "children", { enumerable: true, get: () => children });
          r.scope.set(comp.props, { constant: props });
          this.declare(comp.decls, r);
          return { k: "comp", inst: { region: r, items: comp.view.map(c => this.inst1(c, r)) } };
        }
        return { k: "el", tag: m.tag, attrs: m.attrs.map(a => ({ name: a.name, node: this.mkNode("reader", a.name, region, rt => rt.evalExpr(a.e, region)) })), children: m.children.map(c => this.inst1(c, region)) };
      }
      case "mif": return { k: "mif", m, cond: this.mkNode("reader", "if", region, rt => { const c = rt.evalExpr(m.c, region); return isAbsent(c) ? c : Boolean(c); }), region, committed: null, inflight: null };
      case "mfor": return { k: "mfor", m, xs: this.mkNode("reader", "for", region, rt => rt.evalExpr(m.xs, region)), region, committedRows: [], inflightRows: [] };
      case "loading": case "errored": {
        const item: BoundaryItem = { k: m.k, m, region, parent: region.boundary, armed: true, onNode: null, fallback: null!, content: null!, showingFallback: false, committedFallback: false, caught: [], stillWaiting: false };
        if (m.k === "loading" && m.on) item.onNode = this.mkNode("reader", "on", region, rt => rt.evalExpr(m.on!, region));
        const cr = new Region(region, this, item); this.declare(m.decls, cr);
        item.content = this.instantiate(m.body, cr);
        item.fallback = this.instantiate(m.fallback, new Region(region, this, region.boundary));
        return item;
      }
    }
  }
  private allNodes(): Node[] { const out: Node[] = []; const walk = (r: Region) => { out.push(...r.nodes); for (const c of r.children) walk(c); }; walk(this.root); return out; }
}

export const fmt = (v: unknown): string => v instanceof ErrVal ? "#error" : v instanceof PendingVal ? "#pending" : v === undefined ? "undefined" : typeof v === "string" ? v : JSON.stringify(v);
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
  fetch: (key: string) => key,   // intercepted in `call`: returns the Flight for `key`
};

function isReactive(e: Expr, region: Region): boolean { const names = new Set<string>(); freeVars(e, names); for (const n of names) if (region.lookup(n) instanceof Node) return true; return false; }
function freeVars(e: Expr, out: Set<string>) {
  switch (e.k) {
    case "id": out.add(e.name); break;
    case "pre": case "peek": case "lit": break;
    case "await": freeVars(e.e, out); if (e.init) freeVars(e.init, out); break;
    case "latest": case "pending": freeVars(e.e, out); break;
    case "bin": freeVars(e.l, out); freeVars(e.r, out); break;
    case "un": freeVars(e.e, out); break;
    case "if": freeVars(e.c, out); freeVars(e.t, out); freeVars(e.f, out); break;
    case "member": freeVars(e.o, out); break;
    case "index": freeVars(e.o, out); freeVars(e.i, out); break;
    case "call": freeVars(e.f, out); e.args.forEach(a => freeVars(a, out)); break;
    case "arr": e.items.forEach(a => freeVars(a, out)); break;
    case "rec": e.fields.forEach(f => freeVars(f.v, out)); break;
    case "fn": { const o = new Set<string>(); freeVars(e.body, o); for (const n of o) if (!e.params.includes(n)) out.add(n); break; }
  }
}

// ---------------------------------------------------------------- static checks (C-1, E-7, W-1 shape)
function staticChecks(p: Program) {
  const eqs = new Map<string, Expr>(); const names = new Set<string>();
  for (const d of p.decls) {
    if (d.k === "eq") { if (names.has(d.name)) throw new RuleError("E-7", `duplicate ${d.name}`); eqs.set(d.name, d.e); names.add(d.name); }
    if (d.k === "source") { if (names.has(d.name)) throw new RuleError("E-7", `duplicate ${d.name}`); names.add(d.name); }
  }
  const color = new Map<string, 1 | 2>();
  const visit = (n: string, stack: string[]) => {
    if (color.get(n) === 2) return; if (color.get(n) === 1) throw new RuleError("C-1", `instantaneous cycle: ${[...stack, n].join(" → ")}`);
    color.set(n, 1); const f = new Set<string>(); freeVars(eqs.get(n)!, f);
    for (const m of f) if (eqs.has(m)) visit(m, [...stack, n]);
    color.set(n, 2);
  };
  for (const n of eqs.keys()) visit(n, []);
  for (const d of p.decls) if (d.k === "effect") for (const s of d.body) if (s.k === "write" && !p.decls.some(x => x.k === "source" && x.name === s.target.name)) throw new RuleError("W-1", `write to non-source ${s.target.name}`);
}

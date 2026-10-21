# 02 — Core: the synchronous calculus

**Status: DRAFT.** The fragment with no async, no holds, no structured values,
no regions beyond "a program is one region." It is the part that rests on
proven ground (Lustre's equations and `pre`; Adapton's demand-driven
consistency) and it must be closed — rules fixed, `ref/` passing
`scenarios/S-core-*` — before `05-holds.md` opens.

Everything later in the spec is an extension of this document. Nothing later
may contradict a rule here; a case that seems to need that is a proposed change
to this file, raised as a scenario.

---

## 1. Abstract syntax

Concrete syntax is `07-surface.md`, decided last. All examples in `spec/` and
`scenarios/` use this form.

```
Program   ::= Decl*

Decl      ::= source x = Expr                 -- V-1; initializer is a snapshot (E-4)
            | x = Expr                        -- V-2, equation
            | effect (Expr*) Block            -- V-3; compute exprs ‖ apply block
            | view Markup                     -- V-5; reader positions inside

Expr      ::= lit | x | op(Expr*) | f(Expr*)  -- pure
            | pre x | pre x -> Expr            -- previous frame's value of x; with initial (C-2, C-2a)
            | peek Expr                       -- snapshot read (V-11)
            | if Expr then Expr else Expr
            | Expr . field | Expr [ Expr ]    -- projections (full treatment: 06-stores)
            | fn (x*) => Expr                 -- pure function value
            | { Decl* ; Expr }                -- reactive block: local declarations, then value

Markup    ::= <tag attr={Expr}*> (Markup | {Expr})* </tag>
            | if Expr { Markup } else { Markup }
            | for x in Expr { Decl* ; Markup }   -- keyed form: 06-stores

Block     ::= Stmt*                            -- imperative scope (SC-2)
Stmt      ::= x := Expr                        -- write to a source
            | let y = Expr | y := Expr         -- imperative locals
            | Expr                             -- call for effect
            | if Expr Block else Block | while Expr Block
            | fn-decl, return, …               -- ordinary JS statements
```

Function application `f(e…)` covers both language functions and FFI imports;
`04-rows.md` separates them. In core, every function is pure.

## 2. Scopes (summary of 01-scopes)

- **SC-1 Reactive scope.** Program top level, equation initializers, reactive
  blocks, compute expressions of effects, and views. Contains declarations and
  expressions only. Has no statement position.
- **SC-2 Imperative scope.** Apply blocks and event handlers. Ordinary JS
  statements. Writes are legal only here. Every read of a reactive value here
  is a snapshot of the committed state; no `peek` is needed or allowed.
- **SC-3 Lexical inheritance.** A closure created in a scope is in that scope.
  A `fn` value created in reactive scope is a pure function; a closure created
  in an apply block or handler is imperative and may write.
- **SC-4 Handler positions.** An event attribute in a view (`on*={…}`) takes an
  imperative function. An arrow literal written there is imperative scope
  regardless of the enclosing view; a named function there must be `io` or
  pure. The event is the function's parameter.

---

## 3. Static rules

### E — Equations

- **E-1 (Equation rule).** In reactive scope, `x = e` declares `x` as the
  equation `e` over its free reactive variables. `x` has no statement position
  and is never a write target.
- **E-2 (Lifting).** Every expression in reactive scope denotes an equation. A
  constant is an equation with no inputs. `op(e₁…eₙ)` and `f(e₁…eₙ)` for pure
  `f` are equations whose inputs are the union of their arguments' inputs.
- **E-3 (Demand).** An equation's body is evaluated only when a reader, an
  effect's compute half, or another demanded equation reaches it in the current
  instant. Unreached equations have no observable cost or effect.
- **E-4 (Initializer snapshot).** The initializer of `source x = e` is a
  snapshot: it is evaluated once, in the instant the declaration is reached,
  and `e`'s inputs do not become inputs of `x`. This is the only implicit
  snapshot in reactive scope; every other snapshot is `peek`.
- **E-5 (peek).** `peek e`, in reactive scope only, evaluates `e` against the
  committed state and contributes no inputs to the enclosing equation. It has
  no meaning in imperative scope, where every read is already a snapshot
  (SC-2). `peek e` of an equation nothing demands evaluates it from scratch
  (P-3) without making it part of the frame: it stays undemanded for E-8/P-6.
  (Solid: `untrack` on a lazy memo.)
- **E-6 (Equality cuts).** An equation whose re-evaluation yields a value equal
  to its previous value has not changed: it is not part of the instant's cone
  from that point on, its dependents are not re-evaluated through it, and
  effects over it do not run. Equality for atomic values is `Object.is`.
  Equality for structured values is per path (06-stores); there is no
  per-equation override. "Notify even if unchanged" is not a thing an
  equation can ask for — a re-ask is quiet (V-9, H-9).
- **E-7 (Equations are a system).** Within a reactive block the order of
  equation declarations is irrelevant; an equation may be used before the line
  that declares it. Only sources (their initializers, E-4) and effects (EF)
  keep declaration order. Each name is declared once. C-1 rejects cycles.
- **E-8 (Undemanded equations retain nothing).** An equation not demanded in
  an instant has no value in that frame: no cached value for E-6 and no `pre`
  (P-6). When next demanded it is evaluated from scratch and counts as changed.
  Its *region* (03) is unaffected; this is about state, not lifetime.
- **E-9 (Parameters: value or ref).** A `fn` parameter is a *value* parameter
  by default; `ref x` declares a *ref* parameter, which denotes an equation
  inside the body. A call with only value parameters is **lifted** (E-2): it
  is an equation over its arguments' inputs and re-evaluates with them. A call
  to a function with any `ref` parameter, or whose body declares a source,
  effect, or region, is an **instantiation** (03 RG-6): it happens once at the
  call site. In an instantiation, value arguments are snapshots (E-4) and ref
  arguments are passed as equations.
- **E-11 (Lazy conditional).** In `if c then a else b` as an expression, only
  the selected arm is demanded; the equation's inputs are `c`'s plus the
  selected arm's, and change as `c` changes. The unselected arm is neither
  evaluated nor an input.
- **E-12 (Errors are values).** An equation whose evaluation throws has an
  *error value* in the frame. An equation or reader reaching an errored input
  is errored. There is no `try`/`catch` in reactive scope; the `errored`
  boundary (03 RG-5, 05) is where an error becomes fallback content. (Solid
  F-12.) An error in an apply block is imperative and ordinary.
- **E-10 (Nodes need a region).** A function whose body declares a source,
  effect, or region and reads a value parameter from inside that declaration
  is rejected: the parameter must be `ref`. (This is the lost-reactivity bug
  as a compile error: a lifted call has no region to own the node.)

### W — Writes

- **W-1 (Write position).** `x := e` is legal only in imperative scope (SC-2)
  and only when `x` is a source (V-1). An equation, a `peek`, a function
  parameter, or an imperative local written with `:=` is a plain local, not a
  source.
- **W-2 (No writes in reactive scope).** Reactive scope has no statement
  position; a write there is a parse error, not a semantic one.
- **W-3 (Instant).** All writes performed by one imperative run — one handler
  invocation, one apply block, one resumed continuation — form one instant
  (V-6). There is no API to split or merge instants from inside a run.
- **W-4 (Visibility).** A write is not visible to any read, in any scope, until
  its instant commits. Within the run that wrote it, `x` still reads the
  committed value. (Restates Solid F-10 for the synchronous case.)
- **W-5 (Writer scope).** A source may be written only by imperative code in
  its declaring region or a region nested in it, or by a handler that was
  handed the source explicitly. Exported sources export a reader; the writer is
  exported only when declared so. (Full rule: 03-regions O-4.)

### IO — Effectful functions

- **IO-1 (Rows, reserved).** A `fn` is pure unless its row says `io`. A
  function is `io` if its body writes a source, performs an external effect,
  or calls an `io` function. The row is inferred; the annotation `! io` exists
  for declarations and for display.
- **IO-2 (Call position).** An `io` function may be called only in imperative
  scope. Calling one in reactive scope is rejected (the write rule, W-1,
  cannot be bypassed through a call).
- **IO-3 (FFI).** An imported function has no row and is assumed pure
  value→value. A declaration may mark an import `io`. This assumption is the
  trust boundary; it is not checked.

(The other rows — `pending`, `lane` — and inference: 04-rows.)

### C — Causality

- **C-1 (No instantaneous cycle).** The input relation over equations, taken
  within one instant, must be acyclic. A program with a cycle `x → … → x` not
  broken by `pre` is rejected.
- **C-2 (pre).** `pre x` denotes the value `x` had in the frame of the
  previous committed instant — not at its previous *evaluation*. If `x` was not
  demanded in that instant (E-3), `pre x` is `undefined`. Before instant 0 it is
  `undefined`. `pre x` is a **delayed input**: it contributes no instantaneous
  dependency (so it is how a cycle is broken, C-1), but when `x`'s frame value
  changes in instant `n`, an equation reading `pre x` is invalidated for
  instant `n+1`. An equal write still opens an instant (W-3), so delayed
  inputs surface on the next write of any kind, not only writes that reach
  `x`. (Found by `ref/`: S-core-1 instant 2.)
- **C-2a (Initial value).** `pre x -> e` is `pre x` where that is defined and
  `e` otherwise. `pre x` has type `T | undefined`; `pre x -> e` with `e : T`
  has type `T`. This is the only way to discharge the `undefined`; there is no
  implicit default. (Solid's `(prev = v) => …` default parameter is this form
  attached to the operator instead of to the consumer's signature.)
- **C-3 (Effects are not inputs).** An apply block writing a source that its own
  compute half reads is legal (its write opens the *next* instant, W-3) but is
  a static diagnostic (`D`: `EFFECT_WRITES_OWN_SOURCE`), since it is a cycle
  across instants.

### EF — Effects

- **EF-1 (Split).** `effect (e₁…eₙ) B`: each `eᵢ` is an equation (E-2); `B` is
  imperative scope and receives the values of `e₁…eₙ` by position. `B` may not
  read any reactive variable except through its parameters or `peek`.
- **EF-2 (When).** `B` runs in an instant iff at least one `eᵢ` changed value in
  that instant, or it is the instant in which the effect was declared. It runs
  after every equation the instant reaches has settled (§4).
- **EF-3 (Once, completely).** `B` runs at most once per instant and is never
  interrupted by that instant's settling; its writes begin a new instant.
- **EF-4 (No inputs).** `effect () B` runs once, in the instant the effect is
  declared, after settle — the mount hook.
- **EF-5 (Cleanup).** `B` may return a function; it runs before the next run of
  `B` and when the effect's region ends.
- **EF-6 (Order is unspecified).** The order in which apply blocks run within
  one instant's observe phase is not specified. A program whose behavior
  depends on it is incorrect. (`ref/` uses declaration order; scenarios must
  not rely on it.)

### V — Views

- **V-1 (Readers).** Each `{e}` and `attr={e}` in a view is one reader (V-4 in
  vocabulary) with equation `e`: `{a + b}` is a single reader with inputs
  `{a, b}`, not two. Holds and equality cuts are per reader.
- **V-2 (Conditional).** `if c { M₁ } else { M₂ }` in a view: `c` is an
  equation; the branch markup is a region (03-regions) that exists only while
  `c` selects it; switching ends one region and begins the other.
- **V-3 (Repetition).** `for x in e { … }`: `e` is an equation over a
  collection; each element gets its own region with `x` bound as an equation
  projecting that element. Keying and identity: 06-stores.

---

## 4. Dynamic semantics: an instant

State is a map `σ` from sources to committed values, plus for every equation
and `pre` its last evaluated value. The program starts with `σ₀` from
initializers (E-4), evaluated in declaration order, then settles and commits
instant 0, running effects per EF-2/EF-4.

An instant proceeds in three phases and no phase overlaps another:

1. **Write.** An imperative run executes. Each `x := v` is recorded; `σ` is
   unchanged (W-4). The run ends.
2. **Settle.** Let `Δ` be the set of written sources. The instant's **cone** is
   every equation and reader reachable from `Δ` through the input relation.
   Every demanded equation in the cone (E-3: demanded by a reader or an
   effect's compute half) is re-evaluated against `σ' = σ[Δ ↦ v]`, in a
   topological order of the input relation (C-1 guarantees one exists). An
   equation whose re-evaluation yields an equal value is cut (E-6): its
   dependents are not in the cone through it.
3. **Observe.** `σ := σ'`. The frame (V-17) is the value at every reader
   position. Then every effect whose compute half changed (EF-2) runs its apply
   block in declaration order; writes they make are recorded for the next
   instant, which begins when this phase ends.

### Properties (to be checked by `ref/` against scenarios, then proved)

- **P-1 Glitch-freedom.** No reader, apply block, or `peek` ever observes a
  state in which an equation disagrees with its inputs. (Follows from phases
  not overlapping and topological settle.)
- **P-2 Determinism.** Given `σ` and the multiset of writes of an instant, the
  resulting `σ'` and frame are unique, independent of evaluation order within
  the topological constraints.
- **P-3 Consistency with from-scratch.** The value of every equation after an
  instant equals what it would be if every equation were re-evaluated from
  `σ'` with no memoization. (Adapton's correctness criterion.)
- **P-4 Minimality.** Only equations in the cone are evaluated; equations whose
  value did not change cut propagation (E-6).
- **P-6 pre is frame-indexed.** For every equation `x` and instant `n > 0`,
  `pre x` in instant `n` equals the value of `x` in frame `n-1` if `x` was
  demanded there, else `undefined`. This differs from "last evaluation" when
  `x` goes undemanded for an instant; see S-core-1 instant 4.
- **P-5 Write isolation.** Within an imperative run, no read observes that run's
  own writes (W-4), and two runs never interleave within one instant (W-3).

---

## 5. What core excludes (and where it goes)

| Excluded                                | Document       | Why not here                                              |
| --------------------------------------- | -------------- | --------------------------------------------------------- |
| `await`, pending, `latest`, `pending?`  | 04-rows, 05-holds | Introduces the in-flight version of state (V-13)       |
| Regions other than "the program"        | 03-regions     | Needs `if`/`for` branches as scopes with lifetimes        |
| FFI, impure functions, `io` row         | 04-rows        | Needs function coloring                                   |
| Structured values, paths, draft, key    | 06-stores      | Needs identity and path-granular propagation              |
| Concrete syntax                         | 07-surface     | Decided after the semantics are closed                    |

---

## 6. Worked scenario (abstract syntax)

`scenarios/S-core-1.md` — the counter.

```
source count = 0
source show  = true
double = op*(count, 2)
label  = op+("prev ", pre double -> 0)
effect (double) { log(double) }
view <p>{if show then double else "-"} {label}</p>
```

| instant | action                           | frame `<p>`  | effect    | notes                                           |
| ------- | -------------------------------- | ------------ | --------- | ----------------------------------------------- |
| 0       | mount                            | `0 prev 0`   | `log(0)`  | EF-4; C-2a discharges `undefined`               |
| 1       | handler `count := 1`             | `2 prev 0`   | `log(2)`  | one instant; `pre` is frame 0's `double`        |
| 2       | handler `count := 1`             | `2 prev 2`   | —         | E-6: equal value cuts; effect does not run      |
| 3       | handler `count := 5; count := 7` | `14 prev 2`  | `log(14)` | two writes, one instant (W-3)                   |
| 4       | handler `show := false`          | `- prev 14`  | —         | `double` still demanded by the effect's compute half; `pre` is frame 3 |
| 5       | handler `count := 8`             | `- prev 14`  | `log(16)` | `label` reads `pre double` = frame 4's 14       |

Variant without the effect (so `double` is undemanded while `show` is false):

| instant | action                  | frame `<p>`  | notes                                                          |
| ------- | ----------------------- | ------------ | -------------------------------------------------------------- |
| 4       | handler `show := false` | `- prev 14`  |                                                                |
| 5       | handler `count := 8`    | `- prev 0`   | P-6: `double` not in frame 4 → `pre double` undefined → `-> 0` |

Solid 2.0's lazy memo would give `prev 14` at instant 5 (last evaluation);
this spec gives `prev 0` (previous frame). Recorded as a known divergence to
confirm against the runtime in `ref/` phase 3.

Rejected programs for the same scenario:

| program fragment                  | rule | diagnostic bin (99) |
| --------------------------------- | ---- | ------------------- |
| `double := 4` in a handler        | W-1  | unwritable          |
| `count := 1` at top level         | W-2  | unwritable          |
| `a = op+(b, 1); b = op+(a, 1)`    | C-1  | static              |
| `effect (count) { count := count + 1 }` | C-3 | static (info)    |

# 01 — Language design (ReactiveScript)

Repo at `e650b85` (main). Sources: `README.md`, `CHANGELOG.md`, `CONTRIBUTING.md`, `spec/00…13, 99`,
`guide/{language,async,diagnostics,libraries,reference}.md`, `scenarios/TEMPLATE.md` + samples
(`S-core-1`, `S-fail-4`), `examples/README.md`, `examples/todo.rx`, `examples/signup.rx`, `eval/README.md`.

---

## 1. Thesis

**Problem.** Most Solid bugs are *shape* mistakes: writing to something that should be derived, writing during a
computation, reading async data with no loading/error boundary above it, leaking a value past its owner. Solid's dev
runtime warns about many of these *when they happen*. ReactiveScript moves them to compile time: "things the
compiler refuses, the way Rust refuses a borrow" (`README.md` §Why).

**Why a language, not a library.** The checks need facts a TS library can't see: which scope a line sits in, every
`await` in a body, every read/write in one run, the static application tree. Examples:
- `AC-1b` inferred actions: "a TypeScript function's promises are invisible to the transition … here every
  suspension is a statement the compiler sees" (`spec/06-stores.md`).
- `AC-1c HELD_WRITE`, `AC-1e STALE_WRITE_BACK`, `AC-1g STALE_CAPTURE`: each says "the check is the language's,
  not Solid's (Solid cannot see a body)".
- `R-5`: inputs are static, so `UNTRACKED_READ_AFTER_AWAIT` is unwritable.
- The README's "Revisiting ReactiveScript" note frames the case as *strictness* on two axes (signals vs stores,
  read vs write) plus reactivity across function boundaries, answered by `source`/equation, `W-1/W-5/O-4`, and
  `ref` params / instantiation (`E-9`, `RG-6`).

**Static only, zero runtime overhead.** "A `.rx` program compiles to ordinary Solid 2.0 code and adds nothing at
run time beyond what Solid does" (`README.md`, `spec/11-compiler.md`). `CN-3b`: the compiler *never* replaces a
failed static check with a runtime one; static and runtime have disjoint domains. `SV-7c` explicitly declines
runtime recording to fix hydration mismatches ("the first version does nothing beyond Solid").

**Rust stance** (`spec/08-constraints.md`): every static check is an error (`CN-1a`, no warning tier); checks are
sound over-approximations (`CN-3a`); modular (checked against signatures, `CN-4b`); the only escape is explicit,
local, greppable: `pure` and `fails A | B` at the JS boundary (`CN-5`, `CN-6c`). No `allow`, no `unchecked`, no
`dynamic` (withdrawn). Failures vs panics mirror Rust `Result` vs panic (`R-f`, `CN-6b`).

**AI-writability as a design goal.** Words over sigils "because an AI reader keys on words" (`07 §Design stance`).
Fresh agents given only the spec wrote `examples/ai`, `examples/ai2` cold and predicted 70/71 frames
(`examples/README.md`). An eval (`eval/README.md`) benchmarks the same agent building the same apps in `.rx` vs
React 19 under adversarial async orderings. Many rules were *found* by those evals (AC-1e round 4, AC-1g round 15,
AC-3a round 12, CN-3e round 9, R-8 round 8 fuzzer, MO-1d round 4). Parse errors name the JS/React habit they come
from (`JS_LOCAL`, `JS_RETURN`, `JS_API`, `ASSIGNMENT`; `99 §Parse errors that name a habit`).

---

## 2. Conceptual model

**Vocabulary** (`spec/00-vocabulary.md`). Every noun maps 1:1 to a Solid 2.0 term; internal runtime names never
appear in rules. Deliberately absent: signal/memo/store/projection (collapsed into source/equation; structured vs
atomic is the type, `ST-1`), transition/transaction (→ hold), batch (→ instant).

**Scopes** (`02 §2`, `01-scopes.md` is *NOT OPEN*, only summarised). `SC-1` reactive scope (declarations,
expressions, views; no statements). `SC-2` imperative scope (handlers, apply blocks, actions; writes legal; every
read a snapshot). `SC-3` closures inherit scope. `SC-4` an arrow in `on*=` is imperative.

**Sources** (`V-1`, `E-4`, `W-1..W-6`, `ST-5`). `source x := e` is state, assigned once (initializer is a snapshot;
reading reactive values there needs `peek`, else `SNAPSHOT_INITIALIZER`, DV-6). `source x = e` is a source with a
*standing question*: re-derives from `e` until written (`ST-5a`; Solid `createSignal(fn)`). Only sources take
`:=`; only in imperative scope; only by the declaring region (`W-5`/`O-4`); functional writes compose (`W-6`).
Writes are invisible until the instant commits (`W-4`, `STALE_OWN_READ`).

**Equations** (`V-2`, `E-1..E-12`, `C-1..C-3`). `x = e` holds for all time, demand-driven (`E-3`), equality cuts
(`E-6`, no override), order-free system (`E-7`), lazy `?:` (`E-11`), errors are values (`E-12`). `pre x` is
"before its most recent change" (`C-2`, ruled to match Solid, DV-5); no instantaneous cycles (`C-1`). `fn` params
are value or `ref` (`E-9`); a call with a `ref` param or node-declaring body is an *instantiation* (`RG-6`), else
lifted. Grounded in Lustre (`pre`) and Adapton (demand, from-scratch consistency `P-3`) (`02` header).

**Effects** (`V-3`, `EF-1..EF-8`). Two halves by grammar: compute exprs in parens, apply block in braces with
`$0…$n`. Runs once per instant after settle; cleanup is the return (`EF-5`); a failed input skips the apply
(`EF-2a`, new 2026-11-19); an apply writing its own compute's source is an error (`C-3`). `onSettled` / `onFlush`
are language functions for "after the change commits" / "own instant now" (`EF-7`, `EF-8`).

**Actions** (`AC-1..AC-7`, `06`). `action f() { … }` is one change across its awaits; writes held until return.
Inferred: an arrow that guesses, declares `affects`, or writes *and* awaits is an action (`AC-1b`). Guard rails
around it: `HELD_WRITE` (`AC-1c`), `STALE_OWN_READ` (`AC-1d`), `STALE_WRITE_BACK` (`AC-1e`), `ARGUMENT_COUNT`
(`AC-1f`), `STALE_CAPTURE` (`AC-1g`), `UNCAUGHT_ACTION_FAILURE` (`R-f-6`). `await` in imperative scope is a
statement only (`AWAIT_IN_EXPRESSION`, 07 decision 16). `refresh x` re-asks quietly (`AC-4`), `affects x` sets
`pending?` (`AC-5`), `await until(() => p)` waits on the authoritative view (`AC-6`).

**Guesses and holds** (`05-holds.md`, `H-1..H-12`, `AC-3`, `AC-3a`). Two versions of state: committed `σ` and
in-flight `σ′` (`V-13`). An instant is held by its pending readers (`H-2`); `loading` catches while *armed*,
forwards once *disarmed*, `on(k)` re-arms (`H-5`, `H-6`). Probes `latest x` / `pending? x` read ahead in a *lane*
and never hold (`R-9..R-11`, `H-7`); "posture is per read" (Solid #4695 decision 1). `deferred` is declared lag
(`H-1`, `V-16`). `guess x := e` (renamed from `optimistic` in 0.2.0, 07 decision 18) is a display-ahead,
verdict-inert edit over a truth, confirmed/corrected by the answer or reverted when the hold ends (`H-11`); legal
on question sources, equations (decision 19) and, since 2026-11-20, plain writables (decision 21).
`GUESS_WHILE_LOADING` (`AC-3a`) refuses a guess a click can make while its value loads. `05` *restates* Solid's
`RULES-FUNDAMENTALS.md` F-1…F-12 and inherits Solid's open questions without ruling (`05 §What this document
inherits`).

**Regions / rows.** Regions (`03`, `O-1..O-5`, `RG-1..RG-8`) are lexical owners: `if` branch (dispose/recreate,
narrowing `RG-1c`), `for` row (identity, `RG-2`), component (`RG-4`, props one live structured equation, no return
channel), instantiation (`RG-6`), context (`RG-7`: declared/provided/used; read-only), boundaries (`RG-5`), portals
(`PT-1..4`). Escape analysis refuses a closure outliving its region (`O-3`, `REGION_ESCAPE`); the `escape` keyword
and `lend` are withdrawn. Rows (`04`) are inferred effect-type properties: `io`, `pending`, `lane(x)`,
`fails(C)`. `io` taint only rises (`R-io-1`); `pure` lowers it only at the JS boundary (`R-io-4`). Failures:
`error C(…)` classes (`R-f-1`), every reader's failures discharged by an `errored` above it or `await … catch` at
the await (`R-f-4`, `R-f-5`, `UNHANDLED_FAILURE`), `Panic` root boundary (`R-f-10`). A handler snapshot of a
maybe-absent/failing value must be handled or covered (`R-8`, `UNGUARDED_SNAPSHOT`).

**Stores** (`ST-1..ST-6`). Structured is a type property; deps per object/key (`ST-2`); path writes; per-key
pending (`ST-2c`). `draft(e) { d… := }` is the one place an equation writes (`ST-3`, Solid's projection draft).
`key k` reconciles by identity (`ST-4`, `UNSTABLE_LIST_IDENTITY`). Streams are `await*` (`ST-6`).

**Modules / ownership** (`09`). File = module; module state is app state, instantiated once per app, once per
request on the server (`MO-1b`, `SV-4`); top-level markup refused; entry is `export default component App`
(`MO-1c`). Module boundary is a *value* boundary: imported sources are read-only; modules export actions as their
write interface (`MO-2a`). Checked against signatures only (`MO-3`); `.d.rx` declaration files give rows to JS
(`MO-8`) or stand in for an `.rx` module (`MO-9`). Solid libraries declared, not wrapped: `ref T`, `instantiates`
(`MO-10`). No cycles (`MO-5`); no shadowing imports (`MO-1d`).

**Server / SSR / server fn** (`10`, `12`). SSR is "the client's mount, streamed": served chunks are client frames
(`SV-1`); server runs no apply/handler/action (`SV-2`); full hydration first, answers cross, rest recomputed
deterministically (`SV-3`); declared failure classes cross, everything else redacted (`SV-5`); mismatches
"unwritable" where possible (`SV-7`: no globals, `CLIENT_QUESTION_UNHELD`, `CONTENT_MODEL`). `server fn` is one
form; the *call site* decides query vs mutation (reactive = question, imperative = request) (`SF-1`, `SF-2`);
bodies can't name reactive state (`SERVER_CAPTURE`) or write it (`SERVER_WRITE`); `server`/`client` are rows
like `io` (`SF-5`).

**Surface** (`07`). TS expression grammar verbatim minus assignment ops/`this`/`function`/`async`; reactive forms
are words (`source`, `effect`, `action`, `pre`, `peek`, `latest`, `pending?`, `guess`, `refresh`, `affects`,
`use`, `provide`). JSX verbatim; control flow is braced `{if}`, `{for}`, `{loading}`, `{errored}`, `{portal}`,
not components. Scoped `<style>` per view via TSRX's engine (`CSS-1..5`), class maps as values. 21 numbered
surface decisions, all ruled.

**Types via TSX projection** (`13`). No type system of its own: the checked program is projected to TSX and
TypeScript checks it with Solid's JSX types (`TY-1`). Some language rules are stated *as types* there:
`MISSING_AWAIT` (`TY-5b`), static `WIRE_VALUE` (`TY-5a`). `rx-tsc` is `tsc` with `.rx` in the program.

---

## 3. Recurring design principles

- **Plain words, named for what they mean.** "question", "re-ask", "answer", "guess", "hold", "lane", "instant",
  "frame". `optimistic` → `guess` because "a guess on state nothing will answer reads wrong on its face"
  (07 #18). `throw` not `raise` (#11). `source` kept over `state`/`signal` (#2, #18). Operators carry meaning:
  `=` always an equation, `:=` always "assign now" (`E-4`).
- **Every claim is a numbered rule or a scenario.** "The spec is the product" (`README`, `CONTRIBUTING`). Rule-id
  families per file (`README §Rule IDs`). A change ships with its rule and ≥1 scenario.
- **Scenarios as executable spec.** program → action rows → expected frames → accepted/rejected
  (`scenarios/TEMPLATE.md`): `resolve`/`reject` flights by key, variants, rejected-variant fences
  (`-- reject: RULE`, `-- types: CODE`), `## Divergences`, `## Hydration window`, `## Server frames`,
  `## Before hydration`. 135 scenarios; 47 are ports of Solid's `SCENARIOS.md` (`S-solid-n`).
- **Reference impl checked against Solid itself.** Five runners (interpreter, oracle on Solid, compiled, SSR in
  Chromium, types; `CONTRIBUTING`, `CP-5`). Solid pinned (`ref/SOLID_NEXT`, now Solid `main`). Disagreements are
  `DV-n` records with plain-Solid repros in `ref/oracle/repros/`, filed upstream, many fixed upstream (DV-3, 4,
  8, 13, 16, 17, 18, 19, 20, 23). Solid is "the source for holds" (DV-10 reversed to match Solid).
- **Every diagnostic names its rule and a fix.** `file:line:col: error CODE [rule] message-with-fix`. Codes keep
  Solid's dev-runtime names (`CN-1b`). Every code has a before/after page in `guide/diagnostics.md`, and the
  compiler's tests run those fences (`compiler/tests/diagnostics_page.rs`).
- **Diagnostics binned** (`99`): U unwritable (grammar removes the position), S static, R runtime. Advisory
  shape/perf rows split out "rustc/clippy" style, never failing a build.
- **Vetoable defaults vs rulings.** "Ruled <date>" = settled, open an issue to revisit; "taken by default
  (veto here)" = still open (`CONTRIBUTING`). Rulings often cite Ryan by quote.
- **Solid's fundamentals are upstream.** `05` restates F-rules; Solid's open Q-n is open here. Divergences are
  explicit and per scenario.
- **Rules come from evidence.** Agents' defects in the eval become checks only when they recur or follow from a
  held principle; `R-f-11` was withdrawn as "too specific" (matched 1 program in 695). Each AC-1x rule records
  its hit rate across eval corpora.
- **Core before holds** (`README §Discipline` 1): `02` closed before `05`. One grammar (`07`). Concrete syntax
  written last.
- **Explicit over implicit snapshots.** Only initializers and `peek` snapshot in reactive scope; reactive arg to a
  value param flagged (`E-10`).
- **Principles named in rulings:** "a write must not read stale state" (AC-1e/g, AC-3a); "a failure belongs to
  its own section / shown where it's read" (R-f-4, EF-2a); "the owner decides what a write may be" (O-4);
  "a frame may be skipped, never invented" (SV-1b).

---

## 4. Open questions, TODOs, not-yet, withdrawn

**Status headers.** `01-scopes` NOT OPEN; `00`, `02`, `99` DRAFT; `03–10` OPEN; `11` RULED; `12`, `13`
"executable". README Discipline says `02` must be closed before `05` opens, yet `02` is still DRAFT and `05` is
in heavy use.

**Withdrawn.** `escape` keyword and `lend` (03 O-3); `RG-7c` writing through a provision / `source` contexts
(2026-10-31); `R-f-11 FOREIGN_FAILURE` (2026-11-03); frame-indexed `pre`/`P-6` (DV-5); `dynamic` marker (CN-5);
`catch` after anything but `await` (`CATCH_NOT_ON_AWAIT`, 2026-11-19); `optimistic` keyword (0.2.0); `"rx"`
export condition for package `.d.rx` (MO decision 7).

**Known gaps.** `O-4a`: escape analysis doesn't follow a closure passed to an action/`on*` prop and stored there.
`AC-1f`: arity not checked for actions imported from `.rx` or passed as props ("signature carries no parameters
yet"). `MO-10e`: foreign setter writes invisible to `AC-1d`. `CN-3e`: through-prop reads left to runtime.
`R-1a`: `any`-typed promise in an equation escapes `MISSING_AWAIT` ("noted, not adopted"). `EF-6`: apply order
unspecified.

**Not yet / ref lagging crate.** `UNGUARDED_SNAPSHOT` (R-8) and `CN-3d` client-only first-load check are in
`rxc`, "not yet by `ref/`" — inverting the "ref is the conformance suite" stance (`CP-5`). Not in `ref/`: computed
keys (07 §3), `for`/`while` statements (07 §5; guide says no loops at all), awaited `refresh` (AC-4), path guesses
on structured question sources (07 §5). `AC-6 until`: Solid's `{ timeout, signal }`. Handler statements not
typed in scenario `handler` rows (08 end). Partial hydration "later" (`SV-3a`).

**Solid rulings not yet built in Solid** (spec ahead of runtime): `DV-21` posture per read, `DV-22` `pending?`
under a new question under a guess, including inside a held `loading on` region.

**Noted, not adopted.** SV-7c server-recorded `pure` call results with a `stable` opt-out; TY decision 4 narrower
insertable JSX type; MO decision 6 comparing stale `.d.rx` to computed signature (`.mli`-style); R-1a refusing
`any`-typed JS calls without `await`.

**Taken by default (veto here).** EF-7 `onSettled`, EF-8 `onFlush`; AC-1e, AC-1f, AC-1g, AC-3a; ST-4a key at
depth; CN-3d; MO-1d, MO-9 (decision 6), MO-10 (decision 7); 07 decision 16 (`await` as a statement); CP-6
resolved model; all of `11 §Decisions` (helper names, `compile_program` upstream seam, crate byte-matching `ref/`,
lowered-layout spans, wasm LSP, no WASM compile fallback, diagnostic range = line).

**Upstream dependency.** `CP-1c`: `compile_program` entry in Solid's crate "proposed upstream"; fallback is a
pinned fork. `CP-1d` styles seam.

**Stale text I found** (spec contradicting itself):
- `02-core.md §6` worked table still shows frame-indexed `pre` (`2 prev 2`, variant `- prev 0`, "recorded as a
  known divergence to confirm") while `C-2`/`P-6`/DV-5 and `scenarios/S-core-1.md` use evaluation-indexed
  (`2 prev 0`, `- prev 14`).
- `07 §3` table: `pre x` "value in the previous instant" (stale vs C-2); `peek` cites "E-?".
- `03 §Scenarios`: S-region-4 "rejected without `escape`" (keyword withdrawn).
- `04 §Scenarios`: `S-row-1..5` listed but no such files exist; `S-guard-1` exists only inline.
- `04 R-14`: `! io`, `! pending` declaration syntax predates `.d.rx` (MO-8).
- `06 ST-6a`: `yield` body form "waits on 07's concrete syntax" but 07 ruled no `yield`.
- `99` bin S says "compile error or warning" vs `CN-1a` no warning tier; TEMPLATE still has `-- warn: CODE`.
- Diagnostic format disagrees: README shows `file:line: error …`, `guide/diagnostics.md` says
  `file:line:column: error …`, and `CP-8d` says a range is its line.
- No advisory tool found in `compiler/src` for `ASYNC_WATERFALL`/`HUGE_FAN_IN` etc. (99 says they "move to a
  separate advisory tool").

---

## 5. Where the spec implies it's heading

- **From "Solid with checks" to "Solid's semantics, specified."** `05` restates Solid's fundamentals as rules and
  scenarios, files bugs upstream, and pins Solid `main`. ReactiveScript is becoming Solid 2.0's executable
  semantics document and regression oracle. Logical end: Solid's `RULES-FUNDAMENTALS.md` and `.rx`'s `05` converge,
  and `S-solid-*` is Solid's conformance suite too.
- **More of the async correctness story moves static.** The trend line of 2026-10-28 → 11-20: HELD_WRITE,
  STALE_OWN_READ, STALE_WRITE_BACK, STALE_CAPTURE, GUESS_WHILE_LOADING, UNGUARDED_SNAPSHOT, LOADING_ON_OUTSIDE_HOLD,
  CATCH_NOT_ON_AWAIT, EF-2a. Each tightens "a write must not read stale state" and "a failure is shown where
  it's read". Expect more race classes (lost update, stale capture, wrong-pane failure) to become compile errors,
  each gated by eval evidence.
- **Signatures carry more.** Gaps cluster at boundaries (action params in signatures, closures through actions,
  prop-through reads, `any`). Next step is richer `.d.rx`/signatures and leaning on TS types (`WIRE_VALUE`
  static, `MISSING_AWAIT`) so the row checker and type layer meet.
- **Types do more of the language's work.** `13` already states rules as types; "noted, not adopted" items
  (narrower insert type, `any` refusal) point there.
- **Server story widens.** Partial hydration "later"; `server`/`client` rows; mismatch "unwritable"; a cross-request
  cache explicitly left to JS. Likely: routing/pages as regions with lifetimes (the guide's "data belongs with its
  lifetime" already implies app/visit/screen tiers).
- **Library ecosystem via `.d.rx`.** MO-10 makes solid-primitives usable without wrappers; packages shipping
  `.d.rx` is the adoption path.
- **Guides become prescriptive patterns.** `guide/async.md` has "rule zero: don't track requests yourself", "one
  store over the server", guesses on the answer, data by lifetime. The language plus guide is converging on one
  canonical shape for server data (question source → keyed store → guesses → refresh), which may become rules.
- **Stabilisation follows Solid 2.0 final.** 0.x tracks Solid RCs; `01-scopes` still unwritten and `02` DRAFT
  means a "close the core" pass is owed before 1.0.

---

## Open threads

- `spec/01-scopes.md` is NOT OPEN; scopes only summarised in `02 §2`.
- `02-core` still DRAFT despite README's "core before holds" discipline; `02 §6` table stale vs C-2/S-core-1.
- Stale cross-references: 07 §3 `pre`/`E-?`, 03 `escape`, 04 `S-row-*`, 04 `R-14` syntax, 06 `yield`, 99 "warning".
- `O-4a` closure-through-action escape gap.
- `AC-1f` arity unchecked across modules/props (signatures lack params).
- `MO-10e` foreign setter writes invisible to stale-read checks.
- `ref/` lags `rxc` on `UNGUARDED_SNAPSHOT` and `CN-3d`; conformance direction inverted there.
- Not in `ref/`: computed keys, loops, awaited `refresh`, path guesses on structured question sources.
- `until` options (`timeout`, `signal`) not yet.
- DV-21 / DV-22: Solid rulings not yet built in Solid; spec frames ahead of runtime.
- Solid Q-7 and the U-table open questions inherited unruled (05).
- Partial hydration deferred; SV-7c recording not adopted.
- `compile_program` seam still needs upstream acceptance (CP-1c) or a fork.
- Advisory (clippy-style) tool for waterfall/fan-in/silent-hold not found in the crate.
- Many "taken by default, veto here" items (EF-7/8, AC-1e/f/g, AC-3a, CN-3d, ST-4a depth, 07 #16, all of 11) need
  a ruling pass.
- Unchecked trust points by design: `pure`, `fails`, `.d.rx`; `HYDRATION_MISMATCH` only names the lying assertion.
- No WASM compile fallback (StackBlitz etc.).
- Diagnostic ranges are lines; per-node ranges deferred (CP-8d).

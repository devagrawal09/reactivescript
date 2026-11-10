# Slice 3: the live evaluator

`eval` runs code that arrives as a string, while the program runs, against explicit bindings. The code goes through
the same frontend, the pinned checker and plan v2 as authored code, and runs as a plan: with `plan/solid-plan.ts` on
Solid 2's own primitives in JS, and with the Rust plan v2 consumer, which gets each compiled plan from its host.

Use cases: AI-generated UI (strict checking, nothing in scope but the capabilities passed), a playground or REPL, and
plugins (a typed binding interface as the plugin contract).

**What is verified, and what is not.** Three levels are kept apart, as in `plan/docs/PLAN-V2.md`.

- **Syntax we recognize** is this document's grammar: the eval site forms, the binding object, the options and the
  interface strings below. Evaluated code is whatever the RX or TSX frontend loads, minus the refusals below.
  Recognizing a form does not make it verified.
- **The verified subset** is what the gate runs (see "Gate"): the eval slice (`slices/eval/`), whose code strings
  change while it runs, and the eval fuzz, which takes each plan fuzz program and runs it as evaluated code. On those
  programs the evaluated legs (createEval in native Solid, the plan on `solid-plan.ts`, the plan on Rust) give the static
  twin's frames and full host log, entry for entry. The code inside is plan v2's verified subset; eval adds no forms
  to it.
- **Full readiness** is not claimed. `preserve` and `place` are deferred, the yield syntax is deferred, error
  boundaries are verified on the JS legs only (the Rust port has no `Errored`), and the typing rules are the plan's
  value domain, not TypeScript's.

## Syntax

### RX

```rx
import { save } from "./api";

export default component Studio() {
  source code := "<p>{\"count \" + count}</p>";
  source code2 := "return (<p>{\"n is \" + n()}</p>);";
  source formula := "\"n=\" + count";
  source count := 0;
  action bump(n: number) { count := count + n; }

  label: string = eval(formula, { count });                       // a value eval; the markup evals are element children
  <section>
    <div>{eval(code, { count, bump, save })}</div>
    <aside>{eval(code2, { n: count, bump }, { syntax: "tsx" })}</aside>
    <i>{label}</i>
  </section>
}
```

```
site      := markup | value
markup    := "{" "eval" "(" code "," bindings [ "," options ] ")" "}"      an element's child
value     := name ":" scalar "=" "eval" "(" code "," bindings [ "," options ] ")" ";"
                                                                          the whole value of an equation
code      := expression                                                    a reactive string
bindings  := "{" [ binding { "," binding } ] "}"
binding   := name | name ":" name                                          inner name, or inner name: outer name
options   := "{" option { "," option } "}"                                 string and boolean literals only
option    := "syntax" ":" ("\"rx\"" | "\"tsx\"")                            default "rx"
           | "check" ":" ("\"strict\"" | "\"lenient\"")                     default "strict"
           | "type" ":" ("\"number\"" | "\"string\"" | "\"boolean\"")       a value eval's type (or the equation's)
           | "interface" ":" string                                         see "Bindings and their types"
           | "preserve" ":" "false"                                         `true` is refused: deferred
scalar    := "number" | "string" | "boolean"
```

`eval` is a site form, not a function: anywhere else (inside a handler, inside an expression, as a binding) the
frontend refuses it. An RX string literal keeps its line breaks, and a backslash escapes the next character (`\"`, `\\`;
`\n` is the letter n): write an explicit interface's declarations on separate lines, or separate them with `;`.

### TSX

```tsx
import { action, createSignal } from "solid-js";
import { createEval } from "reactivescript-tsx/eval";
import { save } from "./api";

export default function Studio() {
  const [code, setCode] = createSignal('<p>{"count " + count}</p>');
  const [code2, setCode2] = createSignal('return (<p>{"n is " + n()}</p>);');
  const [formula, setFormula] = createSignal('"n=" + count');
  const [count, setCount] = createSignal(0);
  const bump = action(function* bump(n: number) { setCount(count() + n); });
  const label = createEval(() => formula(), { count }, { type: "string" });   // a value eval: an accessor
  return (
    <section>
      <div>{createEval(() => code(), { count, bump, save })}</div>
      <aside>{createEval(() => code2(), { n: count, bump }, { syntax: "tsx" })}</aside>
      <i>{label()}</i>
    </section>
  );
}
```

- `createEval(() => code, { bindings }, { options })`. The first argument is an arrow with no parameters returning the
  code (an expression, or a block with one `return`). Bindings are `name` or `name: name` properties naming an accessor
  (a signal, memo, optimistic source or value createEval), a store, an action or an imported host function in scope.
  Options are string or boolean literals.
- A markup eval is a JSX child of an element: `{createEval(…)}`. Solid's compiler inserts it as `() => createEval(…)`.
- A value eval is a setup constant with `{ type }`: `const label = createEval(…, { type: "string" })`, read as `label()`.
- The TSX frontend lowers both to the RX site (`tsx/lower.ts`), so the `.rx` and `.tsx` twins emit one plan.

### The code

- **Markup code** (`syntax: "rx"`) is an RX component body: declarations, then markup, e.g.
  `source clicks := 0; <p><button onClick={() => { clicks := clicks + 1 }}>more</button>{"clicks " + clicks}</p>`.
  With `syntax: "tsx"` it is a TSX component body ending in its return:
  `const [t, setT] = createSignal("x"); return (<p onClick={() => setT(t() + "x")}>{t() + n()}</p>);`.
- **Value code** is one expression: `"n=" + count` (RX), `"n=" + count()` (TSX).
- In TSX syntax a read binding is an accessor (`n()`), a store is read by path (`db.list`), an action is called
  (`bump(1)`); in RX syntax a read is the bare name. Host bindings are awaited inside the code's own actions
  (`let r = await save(n)` / `const r: string = yield save(n)`).

## Bindings and their types

The binding object is the only way anything reaches the code: there is no ambient scope. Each binding is one of:

| kind | names | the code may | TSX spelling inside the code |
| --- | --- | --- | --- |
| `read` | a signal, memo, optimistic source or value eval | read it (tracked) | `count()` |
| `store` | a store | read it by path (tracked per path) | `db.list`, `db.list.length`, `For each={db.list}` |
| `action` | an action | call it from a handler | `bump(1)` |
| `host` | an imported host function | await it in its own actions | `yield save(n)` |

Bindings are **read-only**. A write, path write or guess to a binding is refused (`READ_ONLY`). The code changes outer
state only by calling a bound action: the code decides when, the enclosing component decides what.

**Typing: derived from the checked program, carried as an RX declaration string.** The checker derives each site's
*interface* from the enclosing component, after the pinned checker has accepted it: it builds the component's plan and
types it (`plan/types.ts`): sources from their seeds, memos from their expressions, actions from their declared
parameter types (RX `action f(id: number)`, TSX `function* (id: number)`), hosts from their `.d.rx`. The interface is
printed in RX declaration syntax (`eval/interface.ts`):

```
read count: number
store db: { list: { id: number, title: string }[] }
action bump(number)
host save(number): string
```

(types: `number` (an integer), `string`, `boolean`, `T[]`, `{ k: T, … }`; parameter names are accepted and dropped).
Plan v2.1 adds `pure host loadIssues(): { id: number, title: string }[]`: a pure host, whose result may be structured
("Async data", below).
It is written into the plan's eval node and, for TSX, into the `createEval` call (`eval/inject.ts`, the one source edit
between the frontend and Solid's compiler). The code is then checked against exactly that interface. A site that writes
`interface` itself must equal the derived one (same names, kinds and types; order and parameter names do not count).

Why this and not the alternatives:

- *Deriving from TS types* would need TypeScript at run time and its types are not the plan's: `number` includes
  non-integers, which plan v2 refuses, and `Accessor<T>`/`Store<T>` hide the read/store distinction the consumer needs
  (a store root is not a call in the TSX twin, so Solid's compiler treats it differently). The pinned checker does not
  type programs (spec 13: types are TypeScript's, through a projection this package does not run).
- *Only a hand-written declaration string* would let the interface drift from the program. Deriving it makes the
  checker the authority, and the string is still what a plugin host writes when the enclosing program is not compiled
  by this frontend (the error-boundary test does this: `Errored` is outside the TSX subset, so it passes `interface`).

The runtime (`eval/runtime.ts`) refuses a call without an interface, and a bindings object whose names are not exactly
the interface's, or whose values are not of the declared kind (an accessor for `read`, an object for `store`, a
function for `action` and `host`).

## Semantics

1. **The code string is a reactive source.** A markup eval is Solid's keyed `Show` over it:
   `createEval(code, …)` renders as
   `<Show when={code()} keyed>{(src) => <Compiled />}</Show>`, where `Compiled` is the component `src` compiles to, i.e.
   `createComponent(Show, { get when() { return code() }, keyed: true, children: (src) => createComponent(Compiled(src), {}) })`
   (`plan/solid-plan.ts` `evalView`, shared by the runtime). When the string changes, the evaluated subtree is disposed
   (its sources, memos, effects and DOM) and the new code's component is created. An unchanged string does nothing.
   The empty string renders nothing. The code's own state is not kept across a change (see `preserve`).
2. **No ambient scope.** Only the bindings and the code's own declarations resolve; the enclosing component's other
   names, the module's imports and globals are `UNBOUND` (the pinned checker's own SCOPE rule, because the code is
   checked as a separate component whose only declarations are the bindings).
3. **Read-only bindings**; writes through bound actions only (above). A bound action runs as the enclosing component's
   action: its transaction, its writes, its outcome in the host log under its own name.
4. **Fail closed.** The code is compiled when it is first evaluated (and cached per request). A refusal is an
   `EvalRefused` error (`code: "EVAL_REFUSED"`, `diagnostics: [{ code, message, line?, rule? }]`), thrown inside the
   boundary's memo, so it reaches the nearest error boundary (`Errored`); with none, the run fails with it, as any
   uncaught error does (`[REACTIVITY_HALTED]`). Nothing of refused code is rendered. When the code changes to valid code,
   the boundary recovers (verified on the JS legs; the Rust port has no error boundary).
5. **The result.** A markup eval is a renderable (an element child). A value eval is an accessor of its declared scalar
   type: a memo that reads the code, then evaluates the code's expression over the bindings (tracked); a value of
   another type at run time fails it.
6. **Async follows the normal rules.** The code's actions may await bound hosts; RX infers an action from a handler
   that guesses or writes and awaits (AC-1b). An ordinary async callback is refused (`ASYNC_CALLBACK`, issue #20): an RX
   handler that awaits but is not inferred as an action, a TSX `async` arrow.
7. Requests a disposed subtree left pending stay pending until the host settles them; their action then finishes
   (writing only the disposed code's own sources, which nothing reads).

## Options

| option | values | meaning |
| --- | --- | --- |
| `syntax` | `"rx"` (default), `"tsx"` | the code's frontend. `"yield"` is deferred (refused). |
| `check` | `"strict"` (default), `"lenient"` | strict: any type error refuses the code. Lenient: type errors are warnings and the code runs; the consumers still check every value at run time, so a type error that is reached fails the run there. Capability refusals (scope, read-only, subset, async) and a value eval's declared type are enforced in both modes. |
| `type` | `"number"`, `"string"`, `"boolean"` | a value eval's result type (RX may write it as the equation's type instead). |
| `interface` | a declaration string | the binding interface; must equal the derived one when the frontend compiles the site, required when it does not. |
| `preserve` | `false` | **Deferred.** REPL state retention: keep the code's sources across code changes when their declarations are unchanged. Refused if `true`: today every change starts fresh. |
| `place` | — | **Deferred.** Server placement of the evaluation. Refused. |

## Evaluation

```
code ─► frontend (RX parser | TSX lowering) ─► pinned checker (CP-6) ─► plan v2 (resolve-v2.ts) ─► types ─► run
```

`eval/compile.ts` places the code in a synthetic module whose first line declares the bindings, so the frontend and the
pinned checker resolve them as declarations and nothing else:

```
import { save } from "./eval-hosts"; export default component Eval() { source count := 0; action bump(a0: number) {}
<code, from line 2>
}
```

(TSX: `const [count, $evalSet0] = createSignal(0)`, `createMemo(() => [ … ])` for a structured read, `createStore(…)`,
`action(function* (a0: number) {})`; a value eval wraps the code as `$value = ( … );`). The placeholders' values are
never used: `resolve-v2.ts` turns those declarations into the plan's `bindings` and refuses any write to them (from
CP-6's write facts; `compile.ts` reports one first as `READ_ONLY`). The code may not close the component or declare or
import anything beside it. Diagnostics carry the code's own line numbers.

- **On JS** the plan runs on `plan/solid-plan.ts`, Solid 2's own primitives, never on upstream's RX interpreter (which
  disagrees with the compiler, #33). `createEval` (`eval/runtime.ts`) compiles each code string at run time; the plan
  consumer compiles an eval site's code the same way (`Options.compile`).
- **On Rust** there is no frontend: the host provides the plans. `plan-trace PLAN SCENARIO EVALS` (and
  `App::mount_with`, `scenario::trace_v2_with`) take the host's *eval table*: one entry per request (code, interface,
  syntax, check, a value eval's type) with the frontend's plan or its refusal. An eval site looks its code up; a code
  with no entry fails the run explicitly; a refused entry fails it with the same `eval refused: …` message.

### Plan v2 additions

All additions are new keys or new node kinds; plans without eval sites are unchanged byte for byte.

```json
{ "kind": "eval", "code": Expr, "bindings": [{ "name": "n", "target": "count" }],
  "interface": "read n: number\naction bump(number)", "syntax": "tsx", "check": "strict" }
{ "op": "eval", "code": Expr, "bindings": […], "interface": "read count: number", "syntax": "rx", "check": "strict",
  "type": "string" }
```

- The `eval` view is an element child (an eval site directly in a component position is refused by the builder and by
  both consumers). It is inserted as the compiler inserts `{createEval(…)}`: `insert(el, () => createEval(…), marker)`.
- The `eval` expression is only the whole value of a memo.
- An evaluated plan has `"bindings": [{ "name", "kind": "read" | "store", "type" } | { "name", "kind": "action",
  "params" }]` (hosts stay in `hosts`, under their inner names), and a value plan has `"value": Expr` and nothing else.
  A consumer links each binding to the enclosing plan's source, memo, action or host (`solid-plan.ts` `linked`,
  `plan_v2.rs` `linked`); a read of a bound store root is not a call in the TSX twin, so it is not dynamic for the
  compiler's condition rewrite.
- The eval table: `{ "version": 1, "evals": [{ "code", "interface", "syntax", "check", "type"?, "plan" | "refused" }] }`.

## Typing

`plan/types.ts` types a plan over the value domain of PLAN-V2.md. Most rules are ones the consumers already enforce at
run time, applied before running; three are stricter, as TypeScript is: `==`/`!=` across types (never equal), and
`&&`, `||` and `?:` whose two values have different types.

| op | rule |
| --- | --- |
| `add` | integer + integer is an integer; string + (string or integer), either way, is a string; anything else is an error |
| `eq`, `ne` | operands of one type (records by field set) |
| `lt` … `ge` | integers |
| `and`, `or`, `cond` | both values of one type (the result is one of them) |
| `get` | a record that has the field |
| `length`, `filter`, `map`, `findIndex`, `For` | an array; lambda parameters and row items get the item type |
| text | an integer or a string |
| writes, guesses, awaits, calls | the value's type is the target's (path writes: the path's leaf; updaters: the source's type); arguments match the host's or action's parameter types |

Empty array literals have item type `never`, which joins with any type.

## Refusals

Every refusal is a typed diagnostic (`eval/compile.ts`), never a partial plan:

| code | when |
| --- | --- |
| `UNBOUND` | a name that is neither a binding nor the code's own declaration (ambient scope: the enclosing component's other names, imports, globals) |
| `READ_ONLY` | a write, path write or guess to a binding (TSX: through the hidden setter) |
| `ASYNC_CALLBACK` | an ordinary async callback (issue #20): an RX handler that awaits without being an inferred action, a TSX `async` arrow |
| `PLAN` | outside plan v2 (e.g. `*`, `-`, a constant text hole, text in a component position), or code that closes the component and declares or imports something beside it |
| `TSX` | outside the TSX frontend's subset (including an unknown accessor call) |
| `CHECK` | any other pinned-checker diagnostic (e.g. `STALE_OWN_READ`) |
| `PARSE` | the RX parser's |
| `TYPE` | a type error (strict mode; in lenient mode a warning), or a value eval whose value is not its declared type (both modes) |
| `INTERFACE` | a malformed interface, option or call (no interface at run time, bindings not the interface's) |
| `EVAL_SITE` | `eval` used inside the code other than as a site |

At the eval site the frontend refuses (before or while building the enclosing plan): a binding that is not a name, a
spread, a repeated binding, a target that is not a source, memo, action or host import of the component (a row item, a
setter, props), `eval` outside the two site forms, a value eval without a type, an eval site directly in a component
position, `preserve: true`, `place`, `syntax: "yield"`, and an `interface` that differs from the derived one.

## Upstream

The upstream checkout is read-only and has no `eval`; nothing upstream was changed. The frontend adapts before checking
(`eval/sites.ts`): it records each site and replaces the call with its code expression, so the pinned checker sees, and
CP-6 records, the boundary's only reactive read, the code. The bindings are references, not reads, so CP-6 has no fact
for them; the plan builder resolves each binding against CP-6's symbols. What upstream would need for a native `eval`:
the site forms in the parser, a binding-reference fact in CP-6, and a lowering in the compiler (the upstream compiler
does not lower eval sites, so `tsx/build.ts` refuses a program that has one).

## Gate

`npm run verify:subset` runs:

- `slices/eval.test.ts` (2 tests). The slice `slices/eval/`: `eval.rx`, its TSX twin `eval.tsx`, its static twin
  `eval.static.tsx`, `programs.json` (the seven code strings), and the saved `eval.plan.json`, `eval.scenario.json`
  (23 steps) and `eval.evals.json` (the host's table). Code strings change over time: three RX programs (local state,
  an optimistic source and an awaiting action, a store with `For` and `Show`), the empty string, two TSX-syntax
  programs at a second site with a renamed binding (`{ n: count }`), and a value eval whose formula changes. The steps
  switch code while a request is pending, settle it after its subtree is gone, reject a bound action's request, and
  come back to fresh state. The static twin's frames are recorded on native Solid, and createEval, the plan
  (`.rx` and `.tsx` emit it byte for byte) and Rust give the same frames and the same 363-entry host log.
- `eval/eval.test.ts` (5 tests): the refusals (out-of-subset code, ambient scope, writes to read-only bindings, ordinary
  async callbacks, types, in both syntaxes), the site checks, the error boundary (a refusal reaches `Errored` as an
  `EvalRefused` with its diagnostics, new valid code recovers, a bare refusal fails the run with them), seeds 1..8 of
  the eval fuzz on every leg, and the harness classifying a differing leg as divergent.
- The eval fuzz on seeds 1..100 (`scripts/eval-fuzz.ts`), checked against `baselines/eval-fuzz.json`.
- `tsx/verifier.test.ts`: the eval fuzz summary check.

rust-solid: `crates/runtime/tests/eval.rs` (5 tests) replays the slice and an eval fuzz corpus
(`tests/fixtures/eval/`, `scripts/eval-fuzz-corpus.ts`) against native Solid's trace entry for entry, checks a refused
program fails with its refusal, the fixtures' coverage, the missing-table error, and the schema refusals.

### Eval fuzz

`eval/fuzz/` takes the plan fuzz program for each seed and splits it (`eval/fuzz/gen.ts`):

- **whole**: the code is the whole component body; bindings are the hosts.
- **split**: the code is some of the section's children (those whose handlers only call actions) plus the declarations
  nothing else uses; the enclosing component keeps the rest of the markup, with the eval site where the code was, and
  binds what the code uses: values, stores, actions, hosts.
- The code is written in RX or TSX syntax, and half the programs keep it in a signal with a `reload` button that
  empties and restores it, so the subtree is disposed and recreated (pending requests and all) while the scenario runs.

Four files come out (`App.rx`, `App.tsx`, `Static.tsx`, `api.d.rx`), the plan fuzz's chooser records a scenario on the
static twin, and four legs replay it (`eval/harness/run.ts`). A program agrees when every leg equals the static twin,
result and full host log. Refused code is never agreement: every eval leg must fail with the refusal (the two JS legs
identically, log included), and the refusal must be the plan fuzz's refusal of the same program written statically.

Results (`.out/eval-fuzz/run-*/summary.json`; rust-solid keeps copies in `docs/eval/`):

| seeds | agree | refused | divergent | invalid | generator bug |
| --- | --- | --- | --- | --- | --- |
| 1..1000 | 869 | 131 (43 `*`, 49 `-`, 39 constant hole) | 0 | 0 | 0 |
| 1001..3000 (held out) | 1713 | 287 (89 `*`, 91 `-`, 107 constant hole) | 0 | 0 | 0 |
| 1..100 (gate) | 85 | 15 | 0 | 0 | 0 |

- The agreeing programs replay 9,621 scenario steps, 574 of which change the code, and 313,420 host log entries per
  leg (1..1000); held out, 19,887 steps (1,198 code changes) and 639,808 entries.
- Shapes (1..1000): 661 split and 208 whole; 414 with RX-syntax code and 455 with TSX-syntax code; 432 with `reload`.
  Bindings: 1,954 read, 109 store, 371 action, 490 host.
- The agreeing programs are exactly the programs the plan fuzz's emitter accepts (1..1000: its 861 agreeing and 8
  upstream programs, where only compiled RX differs; eval has no compiled RX leg). The refused ones are its `outside`
  family, with the same diagnostics.
- Fixed on the way: a structured read binding in TSX syntax was declared with `createSignal`, which the TSX frontend
  refuses; it is now a memo. A site with no bindings has the empty interface, which the injection took for a missing
  one. A write or guess to a read binding is reported as `READ_ONLY` before the checker's `OPTIMISTIC_NO_QUESTION`.

## Async data (plan v2.1)

Evaluated code may use plan v2.1's async data (`plan/docs/PLAN-V2.md`, "v2.1: async data"), and an enclosing v2.1
program may hold eval sites.

- **Interface.** `pure host name(params): type` declares a pure host (the `.d.rx`'s `export pure fn`), whose result may
  be any type of the grammar; `host` results may be structured too. The canonical print keeps `pure`, and a written
  interface must match it (purity, parameters, and the result by type). The checker derives `pure host` for a pure host
  binding, and a read binding's type for an async memo of the enclosing component (its host's result).
- **Compiling.** `eval/compile.ts` always compiles code with the v2.1 builder and the TSX async tier (the synthetic TSX
  module also imports `Loading`, `Errored`, `isPending`, `latest`, `refresh` and `affects`). Code that uses none of
  their forms, against an interface without a pure or structured host, gets its v2 plan byte for byte; a pure or
  structured host binding alone makes the code's plan v2.1, as it does for any plan. `plan/types.ts` types the new
  forms: an async memo and an await by the host's result, `pending` as a boolean, `latest` as its value, `refresh` and
  `affects` of async memos only, and `loading`/`errored` views by their children.
- **Bindings stay read-only.** `refresh x` and `affects x` are writes (CP-6 write facts), so code cannot do them to a
  binding (the checker refuses `refresh` of a non-question, `INVALID_REFRESH_TARGET`); an async memo of the enclosing
  component is read through a read binding, and its loading, pending state and errors reach the code as they reach a
  native component that reads it (the nearest `loading`/`errored` above the reader, in the code or around the site).
- **Enclosing programs.** The v2.1 builder accepts eval sites (it refused them before): `eval/harness/run.ts`,
  `eval/inject.ts` and the fuzz take `async` to emit and inject the enclosing component with the v2.1 builder.
- **Rust.** rust-solid's `plan-trace` consumes v2.1 plans, the enclosing one and those in the host's table (its
  `docs/PLAN-V2-CONSUMER.md`, "Plan v2.1"); a v2-only `plan-trace` would refuse them by their version, which the eval
  legs report as `rust-unsupported`, never as agreement.

**The async eval slice** (`slices/eval-async/`, `slices/eval-async.test.ts`, 2 tests): `eval-async.rx`, its TSX twin
and static twin, three code strings (`programs.json`) and the saved plan, format-2.1 scenario (19 steps) and eval table.
One code string (RX) loads its own data through the `pure host` binding: an async memo, Errored with a retry, Loading,
an `isPending` indicator, an action with `affects` and a `refresh` after its await; one reads the enclosing component's
async memo through a read binding, under the enclosing component's Errored (with its own retry); one is TSX-syntax code
with its own async memo. The steps switch code while a request is pending (the subtree is disposed and the request
settled after), reject the enclosing memo's re-ask and retry it, reject the code's own first load and retry it, and
reject a mutation. The static twin's frames are recorded on native Solid; createEval and the plan (`.rx` and `.tsx`
emit it byte for byte) give the same frames and the same 295-entry host log; every evaluated code compiles to a v2.1
plan; Rust's `plan-trace` with the host's eval table gives the same log. `scripts/eval-slice.ts --async` records it.

**The async eval fuzz** (`eval/fuzz/gen.ts` `generateEvalAsync`, `npm run eval-fuzz -- --async`): each seed takes the
plan v2.1 fuzz's program (`plan/fuzz/gen-async.ts`) and splits it as the eval fuzz does (half whole, half split; an
Errored around the whole markup is one child; the `outside` family is whole, so the code holds its refused form).
Pure hosts are bound as `pure host`; async memos move with the code or stay outside as read bindings; refresh and
affects count as writes when the split is closed. The scenario is recorded with gen-async's chooser (format 2.1).
Outcomes are the eval fuzz's plus `rust-unsupported` (for a v2-only Rust). Results
(`.out/eval-fuzz/async-run-*/summary.json`, with rust-solid's v2.1 consumer):

| seeds | agree | rust-unsupported | refused | divergent | invalid | generator bug |
| --- | --- | --- | --- | --- | --- | --- |
| 1..1000 | 878 | 0 | 122 (64 `*`, 58 `-`) | 0 | 0 | 0 |
| 1001..3000 (held out) | 1748 | 0 | 252 (134 `*`, 118 `-`) | 0 | 0 | 0 |
| 1..100 (gate) | 84 | 0 | 16 (8 `*`, 8 `-`) | 0 | 0 | 0 |

(Before rust-solid consumed v2.1 the same runs gave 878, 1748 and 84 `rust-unsupported` programs whose JS legs agreed.)

- On every program, the static twin, createEval, the plan and Rust give one result and one full host log: 16,081 scenario
  steps (1,475 clicks on `reload`, which disposes and recreates the evaluated subtree, pending requests and all) and
  240,093 host log entries per leg (1..1000); held out, 32,027 steps (2,819 reloads) and 479,170 entries.
- Shapes (1..1000): 478 whole and 400 split; 430 with RX-syntax code and 448 with TSX-syntax code; 469 with `reload`.
  Bindings: 1,437 host (pure and mutation), 457 read (131 of them an async memo of the enclosing component, in 110 programs), 150 action.
  524 evaluated codes compiled to a v2.1 plan, 480 of them with an async memo of their own.
- The refused programs are the plan v2.1 fuzz's `outside` family, refused with its own diagnostic; every eval leg,
  Rust's included, fails with it. No program diverged on any leg.

The gate: `eval/eval.test.ts` has two v2.1 tests (the `pure host` grammar, async code in RX and TSX compiling to one
v2.1 plan, v2 plans kept, the refusals: an impure host in reactive scope, a refresh of a binding, an async memo read in
a handler, a type error over a structured result; and seeds 1..8 of the async eval fuzz on every leg, Rust's included), the slice's
two tests (every leg, Rust's included), and `verify-pinned.sh` runs the async eval fuzz on seeds 1..100
(`baselines/eval-fuzz-async.json`: 84 agree, 0 `rust-unsupported`). The v2
eval slice and eval fuzz are unchanged, summaries byte for byte (`rust-solid/docs/eval/summary-1-1000.json`).

## Deferred and not verified

- `preserve` (REPL state retention) and `place` (server placement): refused, with the design above.
- `syntax: "yield"`: refused. The yield frontend lowers actions without parameter types, so a yield-authored enclosing
  component cannot yet derive an action binding's type.
- Error boundaries in Rust: the port has `Errored` (plan v2.1), but an eval refusal still fails the Rust run (the
  evaluator's fatal error) instead of being thrown into the graph for an `Errored` to catch; no generated program
  puts a refused site under one.
- Eval sites in a component position (the markup root, a Show branch, a For row), and `const v = createEval(…)` used as
  `{v}`: refused; the compiler lowers those children differently.
- Nested eval (an eval site inside evaluated code) is recognized only when its bindings are the code's own declarations;
  it is not exercised.
- The fuzz never generates value evals or explicit interfaces; the slice and the tests cover them.
- Upstream's compiled RX and interpreter cannot run eval sites; RX with eval runs as a plan only.
- Server rendering (slice 5): Rust's `ssr` refuses a plan with an eval site, and an evaluated code's plan, with an
  explicit diagnostic (rust-solid `docs/SSR.md`, "Refused"); the SSR fuzz never generates eval sites.

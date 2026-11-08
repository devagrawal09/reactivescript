# Plan schema v2 (slice 2: the tracker)

A v2 plan is JSON data for one component. It contains no source text and no JavaScript. Its contract is the slice-2
scenario: a consumer that builds the plan and drives it with `slices/tracker/tracker.scenario.json` (format version 2,
`docs/SCENARIO-FORMAT.md`) must produce every expected frame byte for byte.

The v1 schema (`PLAN.md`, `like.plan.json`) is unchanged; Rust still consumes it. v2 is a separate schema with a
separate builder, `resolve-v2.ts`. Both are reached through the one emitter, `plan/emit.ts` (below).

| File | What it is |
| --- | --- |
| `plan/resolve-v2.ts` | The v2 builder: checked RX AST + CP-6 → plan. |
| `plan/emit.ts` | The emitter for both schemas. `node --experimental-strip-types plan/emit.ts slices/tracker/tracker.rx` (or `.tsx`, `.yield.tsx`) prints the v2 plan. |
| `plan/tracker.plan.json` | The emitted tracker plan. It is never handwritten. The `.rx`, `.tsx` and `.yield.tsx` fixtures emit byte-identical plans. |
| `plan/like.plan-v2.json` | The like slice in v2. All three frontends emit it identically too. |
| `plan/solid-plan.ts` | The JS reference consumer. It builds a plan with Solid 2's own primitives (below). |
| `plan/plan.test.ts` | The v1 tests, then v2: equal emission, the saved artifacts, the frames from the plan alone, the refusals, checker errors, schema selection, and the tracker's Rust leg (gated; see Gate). |

**What is verified, and what is not.** The gate checks six things: all three frontends emit the same v2 plan through
`emit.ts`; the saved plans are current; `solid-plan.ts` renders each scenario's exact frames from the plan alone;
unsupported shapes are refused; checker errors never become plans, from the builder or from `emit.ts`; and every CP-6
read, write and call of every component computation is encoded, and vice versa. That
proves the plan carries what the frames need *when Solid does the scheduling*. It does not prove that the prose
semantics below are a complete specification of Solid's scheduler. The Rust v2 consumer (rust-tracker,
`docs/PLAN-V2-CONSUMER.md`) is the first independent check: the gate also runs the tracker plan, freshly emitted from
each frontend, through it and requires the exact scenario frames. Plans are not fuzzed.

## Emitting: which schema

`plan/emit.ts [--schema 1|2] INPUT [OUTPUT]` loads INPUT (`.rx`, `.tsx` or `.yield.tsx`) through its frontend and runs
one builder: `resolve.ts` for v1, `resolve-v2.ts` for v2. The schema is the format version of the slice scenario beside
INPUT, `<stem>.scenario.json`, because a plan's consumer is driven by that scenario and the v1 consumer (rust-solid's
`scenario` binary) accepts only version-1 scenarios. So `slices/tracker/tracker.*` emits v2 and `slices/like/like.*`
emits v1, byte-identical to `like.plan.json`. `--schema` overrides the scenario: `--schema 2` on the like fixtures emits
`like.plan-v2.json`. With no scenario and no `--schema`, with a scenario version other than 1 or 2, or with any other
argument shape, `emit.ts` refuses. A builder's refusal is final: `emit.ts` never retries with the other schema, and it
writes no output file when a builder throws. The v1 builder refuses the tracker (`unsupported expression rec`).

## Top level

```json
{ "version": 2, "component": "Tracker",
  "hosts":   [{ "name": "assignIssue", "params": ["number"], "returns": "string" }],
  "sources": [Source…], "memos": [Memo…], "actions": [Action…], "markup": [View…] }
```

- `component`: the default component's name, for diagnostics only.
- `hosts`: each imported host function, in import order, from its `.d.rx` declaration (`export fn assignIssue(id:
  number): string`). Types are `number | string | boolean`. Every host is asynchronous. A call creates a new pending
  request (scenario call numbering: one-based per host, per mount). It never returns synchronously. The JS runner
  requires `hosts` to equal the scenario's `host` list.
- Names are unique per plan. `sources`, `memos` and `actions` share one namespace, and `read`/`call` refer to it.
  The arrays are in declaration order. Creation order has no observable effect here, but a consumer should create
  sources, then memos, then actions, then the view.

## Values

A runtime value is one of:

- **integer**: a JSON number with an integer value. Arithmetic stays integral. A non-integer literal is refused when the
  plan is built.
- **string**, **boolean**.
- **array**, **record** (an object with ordered string keys). Literals create fresh, plain values.
- **store node**: a record or array inside a store (see `store`). A store node has stable identity until it is replaced.

There is no `null`/`undefined`. Any operation outside its types below is a runtime error, and the run fails.
**Truthiness** (JS): `false`, `0` and `""` are falsy. `true`, other integers, non-empty strings, arrays, records and
store nodes are truthy.
**ToString** (text and concatenation): a string is itself; an integer is base ten with a leading `-` if negative, no
grouping and no decimal part. Any other type is an error.

## Expressions

Every expression is `{ "op": …, … }`. Evaluation is pure; the only effect is to record dependencies (below).

| op | shape | value | JS / Solid reference |
| --- | --- | --- | --- |
| `literal` | `value`: scalar | that scalar | |
| `array` | `items`: [Expr] | a fresh array | array literal |
| `object` | `fields`: [{`key`, `value`: Expr}] | a fresh record; keys unique, in order | object literal |
| `read` | `source`: name | a source's or memo's current value (see Sources). A store reads as its root node | `x()`; a store's proxy |
| `local` | `name` | a bound local: an action parameter, an `await` binding, a lambda parameter, an updater parameter, or a row item | |
| `get` | `object`: Expr, `key` | the field of a record or store node. A missing field is an error. Not for arrays | `o.key` |
| `length` | `array`: Expr | the array's (or store array's) length. Not for strings | `a.length` |
| `filter` | `array`, `param`, `body` | a fresh array of the items whose `body` (with `param` bound to the item) is truthy, in order | `Array.prototype.filter` |
| `map` | `array`, `param`, `body` | a fresh array of the `body` results | `Array.prototype.map` |
| `findIndex` | `array`, `param`, `body` | the first index whose `body` is truthy, else `-1` | `Array.prototype.findIndex`; RX `indexOf(xs, f)` |
| `add` | `left`, `right` | two integers: their sum; if either is a string: `ToString(left) + ToString(right)` | `+` |
| `eq`, `ne` | `left`, `right` | strict equality: scalars by type and value; arrays, records and store nodes by identity | `===`, `!==` (RX `==`, `!=`) |
| `lt`, `le`, `gt`, `ge` | `left`, `right` | integer comparison; other types are errors | `<`, `<=`, `>`, `>=` |
| `and`, `or` | `left`, `right` | short-circuit, returning an operand (not a boolean) | `&&`, `\|\|` |
| `not` | `value` | boolean negation of truthiness | `!` |
| `cond` | `test`, `then`, `else` | by truthiness of `test`; only the chosen branch is evaluated | `c ? a : b` |

Lambdas (`param` + `body` in `filter`/`map`/`findIndex`, and an updater) are not values. They exist only in these
positions and capture the enclosing locals.

**Dependencies.** An expression is evaluated either in a *reactive* context (a source seed of an optimistic source, a
memo, a text value, `show.when`, `for.each`) or an *imperative* one (handler and action steps). In a reactive context,
every `read`, and every `get`/`length`/element access through a store node, is a tracked dependency: when it changes,
the context re-evaluates. Row items read from a store are store nodes, so `issue.assignee` in a row's text updates when
that store path is written, and the row is kept. In an imperative context, reads are untracked snapshots. Reactive
contexts are pure, so over-tracking (for example, invalidating every reader of a store on any path write) yields the
same frames. Solid's per-property store tracking is an optimisation, not a frame-visible rule.

## Sources

`{ "name", "kind": "signal" | "store" | "optimistic", "seed": Expr }`

| kind | Solid API | seed | value of `read` | written by |
| --- | --- | --- | --- | --- |
| `signal` | `createSignal(seed)` (`signals/src/signals.ts:407`) | constant (no reads), evaluated once | the committed value | `write` without `path` |
| `store` | `createStore(seed)` (`signals/src/store/index.ts:89`) | constant record/array tree, copied into store nodes | the root store node | `write` with `path` |
| `optimistic` | `createOptimistic(() => seed)` (`signals.ts:449`) | reactive expression, re-evaluated when its reads change (its *base*) | the live guess if any (see Transactions), else the base | `optimistic` |

The tracker has `issues` (store), `shown` (optimistic; base `issues.list`, so its value is the store's list node until a
claim guesses), and `mode` and `status` (signals). The builder classifies kinds from CP-6 write facts: a source with any
optimistic write is `optimistic`, with any path write is `store`, otherwise `signal` (see fallback 5). An optimistic
store is refused.

## Memos

`{ "name", "value": Expr }`: Solid `createMemo(() => value)` (`signals.ts:511`). The value is derived in a reactive
context and recomputed when a dependency changes. The tracker has `visible` (filter over `shown` and `mode`) and
`unassigned` (length of a filter over `shown`).

## Actions and steps

`{ "name", "params": [string], "steps": [Step] }`: Solid `action(function* (…params) { … })` (`signals/src/core/action.ts`).
Calling it with scalar arguments binds `params` as locals and runs `steps` as one transaction (below). An action body
lifted from a handler (RX AC-1b inferred action, or TSX's inline `action(function* () { … })`) is named `$action<N>`
and has no parameters (the like plan).

| op | shape | semantics |
| --- | --- | --- |
| `write` | `source`, `value`, no `path` | Set a signal to `value`. |
| `write` | `source`, `path`: [Segment], `value` | Store path write. `{"key": k}` selects a record field; `{"index": Expr}` an array element (an integer; `-1` or out of range is an error). Evaluate segments left to right, then `value`, then set the last slot. All intermediate nodes must exist. Solid `setStore(draft => { draft.list[i].assignee = v })`. |
| `optimistic` | `source`, `value` | Guess `value` for an optimistic source. |
| `optimistic` | `source`, `updater`: {`param`, `body`} | Guess `body` with `param` bound to the source's value as currently shown: its live guess if any, else its base. Solid `setShown(list => …)`; `optimisticWrite` composes on the guessed value (`signals/src/core/lanes.ts:186`). |
| `await` | `host`, `args`: [Expr], `bind` | Call the host (a new pending request) and suspend the action. On resolution, check the result's type, bind it to the local `bind` (`$await0`, `$await1`, … in plan order) and continue. On rejection, the error is thrown at this step. Solid: `const owner = yield assignIssue(id)`. Allowed only in actions. |
| `try` | `body`: [Step], `catch`: [Step] | Run `body`. If a host rejection is thrown in it, run `catch` instead of the rest of `body`. The error is not bound: a catch that reads it is refused when the plan is built. Untyped catch only, no `finally`. |
| `call` | `action`, `args`: [Expr] | Invoke the action with the evaluated arguments and continue at once, without waiting. Allowed only in handlers. An action calling an action is refused. |

Locals are lexically scoped: a `try` body and a `catch` see the locals bound before them.

## Handlers and events

An element's `events` is `[{ "name": "onClick", "steps": [Step] }]`. A handler takes no arguments; the DOM event is not
passed. Its steps run synchronously as a plain handler, outside any transaction, in the lexical scope of the element.
Inside a `for` row, that scope includes the row item. A plain handler contains only `write` without awaits, and `call`;
the builder refuses an `await`, a `try` or an `optimistic` step in one. (RX infers a handler that guesses, or writes and
awaits, as an action, so those reach the plan only as a lifted action.)
Its plain writes are visible in the next frame. The tracker's filter button is `write mode := cond(…)`. Each row's
button is `call claim(issue.id)`, Solid's `onClick={() => claim(issue.id)}`. A handler that RX infers as an action
becomes `call $action<N>()`, and that action may not capture a row item.

## Transactions (what the frames observe)

This is the part of Solid's scheduler the scenario exercises. References are to `solid-next/packages/signals/src/core`
at 2105ffb8.

1. **One transaction per action call.** Calling an action opens a transaction (`action.ts`; `scheduler.ts:225–300`).
2. **Guesses are visible at once.** An `optimistic` step makes its value the source's shown value in the next frame.
   Readers re-evaluate. The base keeps tracking underneath. In the trace, steps 1, 2, 5, 8 and 11 show `me`.
3. **Plain and store writes are held.** A `write` inside an action does not change what readers see until its
   transaction lands. This includes writes after an `await` and writes in a `catch`.
4. **Overlapping guesses merge transactions.** If an action guesses on an optimistic source that already holds a live
   guess of another transaction, the two become one transaction (`lanes.ts`, applyGuesses: "a guess over another
   transaction's guess merged them"; `scheduler.ts` A15 overlap, `merge` at line 433). Both tracker claims guess on
   `shown`, so overlapping claims always merge.
5. **Landing.** A transaction lands when every action in it has returned, normally or through its `catch`. Then all its
   held writes commit, in the order they were made. The trace observes this order only through the final `status`.
   All its guesses are dropped, so each optimistic source shows its recomputed base again. All of this appears in one
   frame. Scenario step 3: the request of `claim(3)` resolves. Its store write and `status := ""` are held, because
   `claim(1)` in the same merged transaction is still waiting. The frame is unchanged. Step 4: the request of
   `claim(1)` rejects, and its catch writes the status. The transaction lands: `Typo` shows `dev`, `Crash` reverts to
   `nobody`, and the status shows the later write.
6. **Uncaught failure.** A rejection with no enclosing `try`, or a runtime error, fails the run. It is never rendered.

Not exercised, so not specified here: a plain write while a transaction holds a node it touches, two transactions
that do not overlap, nested actions, and a base change under a live guess. Refuse them or report them; do not guess.

## Markup

`markup` is a list of views. The frame of a list is the concatenation of its views' frames, in order. Each view:

| kind | shape | semantics | Solid |
| --- | --- | --- | --- |
| `element` | `tag`, `events`, `children`: [View] | A host node. Its frame is its children's frame; the tag and handlers contribute nothing. Only lowercase host tags. | `createElement(tag, { onClick })` |
| `text` | `value`: Expr | A literal is a static text node. Otherwise a reactive text node showing `ToString(value)`. Adjacent static texts are already merged. | `createTextNode`, `insert(parent, () => value, marker)` |
| `show` | `when`, `children`, `fallback`: [View] | When `when` is truthy, render `children`, otherwise `fallback`. Switch, and create or dispose a branch, only when truthiness changes. | `<Show when fallback>` without `keyed` (`solid/src/client/flow.ts:168`; equality `!a === !b`) |
| `for` | `each`, `item`, `key: "identity"`, `children` | `each` must be an array. Render `children` once per element, with `item` bound to the element itself, not an accessor. Rows are keyed by identity (`===`: store nodes and fresh records by identity, scalars by value). A row whose element is still present is kept, not re-created. Order follows `each`. No fallback. | `<For each>` default keyed mode (`flow.ts:65`, `mapArray` in `signals/src/map.ts:52`) |

Children appear in list order. `solid-plan.ts` inserts each dynamic part before its next static sibling, as Solid's
compiler does (`insert` in `universal/src/universal.ts:134`). A Rust renderer only needs the same order. Identity
is not frame-visible in this slice, because rows hold no local state. For example, while a claim's guess is live, the
claimed row's item is a fresh record, not the store node, so under identity keying it is a different row. The text is
the same either way.

## The tracker plan, abridged

The full file is `plan/tracker.plan.json`. The store seed is the three issues as records with `id`, `title` and
`assignee`.

```json
{"name": "shown", "kind": "optimistic", "seed": {"op": "get", "object": {"op": "read", "source": "issues"}, "key": "list"}}
{"name": "visible", "value": {"op": "filter", "array": {"op": "read", "source": "shown"}, "param": "issue", "body": {"op": "or", "left": {"op": "eq", "left": {"op": "read", "source": "mode"}, "right": {"op": "literal", "value": "all"}}, "right": {"op": "eq", "left": {"op": "get", "object": {"op": "local", "name": "issue"}, "key": "assignee"}, "right": {"op": "literal", "value": ""}}}}}
{"name": "claim", "params": ["id"], "steps": [
 {"op": "optimistic", "source": "shown", "updater": {"param": "list", "body": {"op": "map", "array": {"op": "local", "name": "list"}, "param": "issue", "body": {"op": "cond", "test": {"op": "eq", "left": {"op": "get", "object": {"op": "local", "name": "issue"}, "key": "id"}, "right": {"op": "local", "name": "id"}}, "then": {"op": "object", "fields": [{"key": "id", "value": {"op": "get", "object": {"op": "local", "name": "issue"}, "key": "id"}}, {"key": "title", "value": {"op": "get", "object": {"op": "local", "name": "issue"}, "key": "title"}}, {"key": "assignee", "value": {"op": "literal", "value": "me"}}]}, "else": {"op": "local", "name": "issue"}}}}},
 {"op": "try", "body": [
   {"op": "await", "host": "assignIssue", "args": [{"op": "local", "name": "id"}], "bind": "$await0"},
   {"op": "write", "source": "issues", "path": [{"key": "list"}, {"index": {"op": "findIndex", "array": {"op": "get", "object": {"op": "read", "source": "issues"}, "key": "list"}, "param": "issue", "body": {"op": "eq", "left": {"op": "get", "object": {"op": "local", "name": "issue"}, "key": "id"}, "right": {"op": "local", "name": "id"}}}}, {"key": "assignee"}], "value": {"op": "local", "name": "$await0"}},
   {"op": "write", "source": "status", "value": {"op": "literal", "value": ""}}],
  "catch": [{"op": "write", "source": "status", "value": {"op": "add", "left": {"op": "literal", "value": "Could not assign #"}, "right": {"op": "local", "name": "id"}}}]}]}
{"kind": "show", "when": {"op": "gt", "left": {"op": "length", "array": {"op": "read", "source": "visible"}}, "right": {"op": "literal", "value": 0}},
 "children": [{"kind": "for", "each": {"op": "read", "source": "visible"}, "item": "issue", "key": "identity", "children": [
   {"kind": "element", "tag": "p", "events": [], "children": [
     {"kind": "text", "value": {"op": "get", "object": {"op": "local", "name": "issue"}, "key": "title"}},
     {"kind": "text", "value": {"op": "literal", "value": ": "}},
     {"kind": "text", "value": {"op": "or", "left": {"op": "get", "object": {"op": "local", "name": "issue"}, "key": "assignee"}, "right": {"op": "literal", "value": "nobody"}}},
     {"kind": "element", "tag": "button", "events": [{"name": "onClick", "steps": [{"op": "call", "action": "claim", "args": [{"op": "get", "object": {"op": "local", "name": "issue"}, "key": "id"}]}]}],
      "children": [{"kind": "text", "value": {"op": "literal", "value": "take"}}]}]}]}],
 "fallback": [{"kind": "element", "tag": "i", "events": [], "children": [{"kind": "text", "value": {"op": "literal", "value": "Nothing to triage"}}]}]}
```

The other section children are: a button (filter handler; text `"Filter: "` + `read mode`), `<b>` (`read unassigned` +
`" open"`), and `<em>` (`read status`).

## How the builder uses CP-6, and the 8 fallbacks

As in v1, `resolve-v2.ts` runs `checkModules`, refuses any diagnostic, and takes identities, symbol kinds, question
flags, computation kinds, reads, writes, calls and regions from CP-6. v2 also checks in both directions. Every
reactive read, write and call in the plan must be a CP-6 fact of its computation. Every CP-6 read, write and call of
every computation in the component, including nested regions, must appear in the plan. Every CP-6 computation must be
used. Markup computations are matched in checker walk order by kind, `at` label (`{…}`, `if`, `for`, `button onClick`)
and region (`then`, `else`, `for` regions must exist where the plan opens them).

**Closed by v2: none of the 8 completely.** The pinned CP-6 is read-only and unchanged, and every executable structure
still comes from the checked AST. v2 narrows two fallbacks and adds verification to three:

| # | fallback (PLAN.md) | v2 status |
| --- | --- | --- |
| 1 | Entry and declaration association | Remains. Markup computations are now verified by kind, `at` and region, not only by order. |
| 2 | Values and expressions | Remains, with more forms: records, arrays, `get`, `length`, `filter`/`map`/`findIndex` lambdas, comparisons, logic, `cond`. Reads are now checked against CP-6 in both directions. |
| 3 | Control flow and ordering | Remains: step order, try/catch and await points come from the AST. |
| 4 | Locals and updater bindings | **Narrowed.** v1's rewrite of an updater parameter into a synthetic `current(target)` read is gone: the updater is an explicit lambda whose parameter the consumer binds to the shown value. Action parameters, lambda parameters, row items and `$awaitN` temporaries still come from the AST. |
| 5 | Optimistic capability and seed relation | Remains. A new gap of the same kind: CP-6 has no store kind, so `store` is inferred from path-write facts. A store that is never path-written would be emitted as a `signal` (frame-equivalent here, but not Solid's API). |
| 6 | Action/handler linkage | **Narrowed for declared actions.** A row handler's `call claim(…)` is verified against the handler's CP-6 call fact; only the arguments come from the AST. The inferred-action boundary still uses the AST plus upstream's AC-1b reading (`actionInference`). Unlike v1, which lifted every statement handler, v2 lifts only AC-1b bodies; others are plain handlers. |
| 7 | Markup and event layout | Remains for tags, static text, event names and child order. Show/For structure is now cross-checked against CP-6 regions and reader computations. |
| 8 | Text coercion normalization | Remains: `"" + x` is dropped only at text holes, justified by ToString. One new normalization of the same kind: adjacent static text nodes are merged (the RX parser gives `" "` + `"open"` where JSX gives `" open"`). Both are frame-neutral by the text rule. |

New gaps that v2 depends on, beyond the 8:

- **Row item reads.** CP-6 records no reads for paths through a row item: the `for` region's readers have empty
  `reads`. The plan's `local issue` + `get` is AST-only, and its reactivity follows from the item being a store node.
- **Host signatures** come from the `.d.rx` declaration file, not from CP-6.
- **For key mode.** RX has no key mode. `"identity"` is Solid's default, not a checker fact.
- **Await temporaries and authored local names.** Lambda, parameter and row names are emitted as authored. Plan
  equality across frontends therefore also requires equal local names. A frontend that renames a local on a clash (the
  yield lowering's `__yieldLocal<N>`) makes the plans differ, and the equality test refuses that.

## Refused by the builder

The builder never emits a partial plan. It refuses: checker diagnostics; more than one RX module, or any declaration
other than one default component and its host imports; props on the entry component; non-integer, null or undefined
literals; a signal or store seeded from another source; template strings, `peek`, `pre`, `latest`, probes, spreads,
optional chaining and calls other than `filter`/`map`/`indexOf`; locals that shadow a resolved name; derived
non-optimistic questions, constant-seeded optimistic sources (yield `$optimistic(0)`), and optimistic stores;
`refresh`/`affects`; functional plain writes; typed catches and `finally`; a catch that reads its error; awaits
outside actions; a `try` or guess in a plain handler; action-to-action calls; aliased host imports; hosts not declared
as `fn name(scalar…): scalar` in a `.d.rx`; component tags, non-event attributes, handlers with parameters; branch and
row declarations (`tDecls`, `fDecls`, `decls`); and any CP-6 computation, read, write or call the plan does not
encode.

## Gate

`npm run verify:subset` runs `plan/plan.test.ts` and `slices/tracker.test.ts` (nine tests) with the rest. Of the plan
tests, eight are v2 and are listed in `baselines/subset-tests.json`: equal emission and the saved artifact for the
tracker and for like (`--schema 2`), the frames from each plan alone, the refusals, checker errors (builder and
`emit.ts`), schema selection, and the tracker's Rust leg (below). The gate passes 83/83. `plan/tsconfig.json` includes
`resolve-v2.ts` and `solid-plan.ts`. `tsc -p plan/tsconfig.json` reports no diagnostics in `plan/` or `slices/`. It
does report the 12 known upstream strict diagnostics (`baselines/upstream-tsc.txt`), because the plan test imports the
slice runner and through it the upstream compiler. v1 reported 3 of them.

**The tracker's Rust leg is gated.** `plan.test.ts` has "Rust consumes the tracker plan freshly emitted from each
frontend". It emits the tracker plan from each frontend with `emit.ts`, checks it against `tracker.plan.json`, runs
`$RUST_SCENARIO PLAN tracker.scenario.json`, and requires the exact scenario frames, as the like leg does. The Rust v2
consumer is rust-tracker's `scenario` binary, which picks its consumer by the plan's `version` (v1 for like, v2 for the
tracker). The test is listed in `baselines/subset-tests.json`, and the gate fails on any skipped, unlisted or unrun
test.

`verify-pinned.sh` builds `scenario` from `RUST_SOLID` (default `../rust-solid`), sets `RUST_SCENARIO` to it, and
always exports `RUST_PLAN_V2=1`. The export is required: with `RUST_SCENARIO` set, `plan.test.ts` registers the tracker
leg only when `RUST_PLAN_V2=1` declares the binary a v2 consumer, so without it the listed test never runs and the gate
fails ("ran 0 times"). Any other value of `RUST_PLAN_V2` fails the plan tests. Outside the gate, with neither variable
set, the leg is skipped, as the like leg is.

The default `../rust-solid` is a v1 consumer and refuses the v2 plan (``unknown field `component` ``), so the tracker
leg fails there, as it should. Until the v2 consumer lands in rust-solid, run the gate as:

```sh
RUST_SOLID=/workspace/rx-tsx-refresh/rust-tracker npm run verify:subset   # PASS 83/83
```

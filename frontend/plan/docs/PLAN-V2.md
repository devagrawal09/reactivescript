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
| `plan/plan.test.ts` | The v1 tests, then v2: equal emission, the saved artifacts, the frames from the plan alone, the refusals, checker errors, schema selection, the emitter rules the plan fuzz found, and the tracker's Rust leg (gated; see Gate). |
| `plan/fuzz/` | The plan fuzz (below): `gen.ts` (the generator: TSX, RX and yield twins, and the scenario chooser), `host.ts` (the recording host), `leg.ts` (one JS leg in a worker), `run.ts` (one program, four legs), `renderer.ts` and `solid-native.ts` (what compiled code imports). |
| `plan/plan-fuzz.test.ts` | Five plan-fuzz tests in the gate (below). |
| `scripts/plan-fuzz.ts` | `npm run plan-fuzz -- --seeds N --start S`: the fuzz run and its summary. The gate runs seeds 1..100. |
| `scripts/plan-fuzz-corpus.ts` | Picks agreeing programs that cover every plan node kind and writes them as rust-solid's `tests/fixtures/plan-fuzz/`. |

**What is verified, and what is not.** Three levels are kept apart.

- **Syntax we recognize** is what the frontends load and the builder accepts: the forms this document describes, minus
  the refusals below. Recognizing a form does not make it verified.
- **The verified subset** is what the plan fuzz exercises, plus the tracker and like pairs. For every generated program
  (seeds 1..3000, below), native Solid running the TSX twin, compiled RX, `solid-plan.ts` and the Rust consumer give the
  same frames and the same full host log, entry for entry, except where only compiled RX differs and a probe pins the
  difference on one upstream RX lowering (two classes, below). The program shapes are those of `plan/fuzz/gen.ts`:
  tracker-like components with a store of rows, signals, optimistic sources over a store path or a signal, filter, map,
  length and indexOf memos, Show and For (Show in rows, For in Show, a second For over an inline filter), per-row
  actions with one or two awaits in a try, plain handlers, and scenarios that overlap actions, settle them out of
  order, reject them, toggle filters and write the store while guesses are live. A form the builder accepts but the
  generator does not produce is recognized, not verified.
- **Full readiness** is not claimed. The prose semantics below are not a complete specification of Solid's scheduler:
  where the fuzz verifies behaviour (overlapping and non-overlapping transactions, plain writes while a transaction
  holds a node, base changes under a live guess), it verifies that the consumers do what Solid does, not a rule
  written here.

The gate checks: all three frontends emit the same v2 plan through `emit.ts`; the saved plans are current;
`solid-plan.ts` renders each scenario's exact frames from the plan alone; unsupported shapes are refused; checker
errors never become plans, from the builder or from `emit.ts`; every CP-6 read, write and call of every component
computation is encoded, and vice versa; the Rust consumer gives the tracker's frames from the plan emitted by each
frontend; and the plan fuzz on seeds 1..100 (four legs, full host logs) matches `baselines/plan-fuzz.json`.

**Eval (slice 3).** `docs/EVAL.md` adds the `eval` view (an element child), the `eval` expression (a memo's whole
value), an evaluated plan's `bindings` and `value`, and the host's eval table for the Rust consumer. They are new keys
and node kinds only: a plan without eval sites is unchanged byte for byte, and every gate artifact here is.

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
| `get` | `object`: Expr, `key` | the field of a record or store node, read as `o.key` reads it: one Get (a store node's `get` trap), never a HasProperty first. A missing field (an `undefined` result: no plan value is `undefined`) is an error. Not for arrays | `o.key` |
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
| `write` | `source`, `path`: [Segment], `value` | Store path write. `{"key": k}` selects a record field; `{"index": Expr}` an array element (an integer; `-1` or out of range is an error). Solid `setStore(draft => { draft.list[i].assignee = v })`, evaluated as that JS evaluates it: inside the store setter, each segment in turn (an index when the walk reaches it), then `value`, then the set. All intermediate nodes must exist. Inside the setter a node that a pending transaction holds reads as that transaction has it, so evaluating the segments or the value before the setter is a different program (see "Plan fuzz", root cause 8). |
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

The tracker scenario does not exercise a plain write while a transaction holds a node it touches, two transactions
that do not overlap, or a base change under a live guess. The plan fuzz does, on every leg, and the consumers agree
with native Solid there; that is verification by Solid, not a rule specified here (see "What is verified"). Nested
actions are refused.

## Markup

`markup` is a list of views. The frame of a list is the concatenation of its views' frames, in order. Each view:

| kind | shape | semantics | Solid |
| --- | --- | --- | --- |
| `element` | `tag`, `events`, `children`: [View] | A host node. Its frame is its children's frame; the tag and handlers contribute nothing. Only lowercase host tags. | `createElement(tag, { onClick })` |
| `text` | `value`: Expr | A literal is a static text node. Otherwise a reactive text node showing `ToString(value)`. Adjacent static texts are already merged. | `createTextNode`, `insert(parent, () => value, marker)` |
| `show` | `when`, `children`, `fallback`: [View] | When `when` is truthy, render `children`, otherwise `fallback`. Switch, and create or dispose a branch, only when truthiness changes. | `<Show when fallback>` without `keyed` (`solid/src/client/flow.ts:168`; equality `!a === !b`) |
| `for` | `each`, `item`, `key: "identity"`, `children` | `each` must be an array. Render `children` once per element, with `item` bound to the element itself, not an accessor. Rows are keyed by identity (`===`: store nodes and fresh records by identity, scalars by value). A row whose element is still present is kept, not re-created. Order follows `each`. No fallback. | `<For each>` default keyed mode (`flow.ts:65`, `mapArray` in `signals/src/map.ts:52`) |

**Construction order.** Frames do not depend on it; the host log does, and the plan fuzz compares the host log. The
consumers build the views as Solid's universal compiler builds the TSX twin (solid-next `packages/compiler`,
`src/universal/transform.rs`: `lower_native_element`, `lower_universal_children`; `src/shared/condition.rs`):

- An element tree is one template. First its elements are created in pre-order, each with its events as static props
  of `createElement(tag, { onClick })` (the host applies a static prop through its `setProperty`). An element with more
  than one child also creates its static texts there, in child order.
- Then, per element in the same order, its static children are appended (`insertNode`; a lone static text is created
  at its append), and then its children's own steps and its dynamic children's inserts run, in child order.
- A dynamic child of an element with more than one child is inserted before its next static sibling (a text or an
  element), or with `null` if none follows; adjacent dynamic children take the same marker. A lone dynamic child is
  inserted with no marker.
- A component position (the markup, a Show branch, a For row) holds elements, Shows and Fors: one view is itself, more
  are an array. Text there is lowered by the compiler to a string or a memo, not a template text node; the builder and
  the consumers refuse it.
- Show is `createComponent(Show, { get when, get fallback, get children })`; with no fallback views the `fallback` prop
  is absent. For is `createComponent(For, { get each, children: item => … })`.
- A `when` or `each` that is a conditional or a logical expression is rewritten as the compiler's
  `transformCondition(…, inline)` rewrites a dynamic prop: the test of a conditional with a dynamic branch, or the left
  of `&&` when both sides are dynamic, is read through `memo(() => test)()` created in the getter (`!!test` unless the
  test is a comparison or `!`), and `||` walks its left spine to such an `&&`. Dynamic means what the compiler means:
  the TSX twin has a call or a member access there (a read of a signal, memo or optimistic source, a `get`, a `length`,
  an array method), not only literals, locals and a bare store root.
- A text hole inserts `() => ToString(value)`. A hole the compiler would fold to static text (a confidently constant
  value) and an uncoerced hole with `&&` on its `||` spine (which the compiler would memoize) are refused by the
  builder, because the TSX and RX twins differ there (below).

Identity is not frame-visible in this slice, because rows hold no local state. For example, while a claim's guess is
live, the claimed row's item is a fresh record, not the store node, so under identity keying it is a different row.
The text is the same either way; the host log shows the new row's nodes.

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
and region (`then`, `else`, `for` regions must exist where the plan opens them). CP-6 opens an `else` region for every
`if`, with or without an else branch, so the builder takes one for each `if` (the plan fuzz found it skipping them).

**Closed by v2: none of the 8 completely.** The pinned CP-6 is read-only and unchanged, and every executable structure
still comes from the checked AST. v2 narrows three fallbacks and adds verification to three:

| # | fallback (PLAN.md) | v2 status |
| --- | --- | --- |
| 1 | Entry and declaration association | Remains. Markup computations are now verified by kind, `at` and region, not only by order. |
| 2 | Values and expressions | Remains, with more forms: records, arrays, `get`, `length`, `filter`/`map`/`findIndex` lambdas, comparisons, logic, `cond`. Reads are now checked against CP-6 in both directions. |
| 3 | Control flow and ordering | Remains: step order, try/catch and await points come from the AST. |
| 4 | Locals and updater bindings | **Narrowed.** v1's rewrite of an updater parameter into a synthetic `current(target)` read is gone: the updater is an explicit lambda whose parameter the consumer binds to the shown value. Action parameters, lambda parameters, row items and `$awaitN` temporaries still come from the AST. |
| 5 | Optimistic capability and seed relation | Remains for optimistic sources. **Narrowed for stores:** CP-6 has no store kind, and v2 first inferred `store` from path-write facts, so a store never written by path was emitted as a `signal`. A source with a structured seed (a record or array literal) is now a `store`, as RX lowers `source x := {…}` (ST-1) and TSX's `createStore` lowers to it; a path write to a scalar-seeded source and a root write to a store are refused. The seed shape is still AST-only. |
| 6 | Action/handler linkage | **Narrowed for declared actions.** A row handler's `call claim(…)` is verified against the handler's CP-6 call fact; only the arguments come from the AST. The inferred-action boundary still uses the AST plus upstream's AC-1b reading (`actionInference`). Unlike v1, which lifted every statement handler, v2 lifts only AC-1b bodies; others are plain handlers. |
| 7 | Markup and event layout | Remains for tags, static text, event names and child order. Show/For structure is now cross-checked against CP-6 regions and reader computations. |
| 8 | Text coercion normalization | Remains: `"" + x` is dropped only at text holes, justified by ToString; every leading coercion is dropped, because TSX's lowering adds one over an authored `{"" + n()}` (ToString is idempotent). One new normalization of the same kind: adjacent static text nodes are merged (the RX parser gives `" "` + `"open"` where JSX gives `" open"`). Both are frame-neutral by the text rule. They are not host-neutral: an idiomatic TSX number hole `{n()}` inserts the number, where RX and the plan insert its string (the plan fuzz's TSX twins coerce; see "Plan fuzz", remaining classes). |

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
row declarations (`tDecls`, `fDecls`, `decls`); a path write to a source with a scalar seed and a root write to a store;
text directly in a component position (the markup, a Show branch, a For row); a text hole whose value Solid's compiler
folds to a constant (Babel's confident evaluation: literals, `!`, the plan's binary operators, `&&`/`||` and `?:` on a
confident test, even with a read in the branch not taken), which native Solid makes static text and RX inserts; a text
hole with `&&` on its `||` spine, which the compiler memoizes in an uncoerced TSX hole and nowhere else; and any CP-6
computation, read, write or call the plan does not encode.

## Plan fuzz

`plan/fuzz/` turns the plan into a verified subset rather than two verified plans. For each seed:

1. **Generate.** `gen.ts` builds one program inside the plan v2 subset and prints it as Solid TSX, as RX and, where the
   yield dialect can say it, as yield, with the host declarations (`api.d.rx`). Each host is awaited at one site in
   a try. The program families are `tracker`, `mixed`, `strings`, `rows`, `scalar`, and `outside`: one form both
   frontends accept and the builder must refuse (`*`, `-`, or a hole the compiler folds to a constant).
2. **Emit.** The TSX and RX twins load through their frontends and the pinned checker, and `resolve-v2.ts` emits a
   plan from each. The two must be byte-identical, refusals included. A yield twin must emit the same plan too.
3. **Record.** Native Solid runs the compiled TSX on the recording host, and the generator's chooser picks each step
   from the live clickables and pending requests: clicks, resolves and rejects (only of awaits inside a try), in any
   order; then every pending request is settled. The steps and their frames are the scenario (format version 2).
4. **Replay.** Four legs replay that scenario, each in a fresh worker (or process) on the same recording host
   (`host.ts`, a port of rust-solid's `fuzz/plan-oracle.mjs` host): native Solid; compiled RX (upstream's compiler and
   runtime, Solid's universal transform for the views); the plan built by `solid-plan.ts`; and rust-solid's
   `plan-trace`. A leg's trace is its result (the frames, or the error) and its full host log: every host call with
   queries, every request, every settled action (`['action', name, outcome]`), and after each step the step, the tree
   and the frame. Each trace must equal native's replay, and native's replay must equal its recording. Nothing is
   filtered or normalized.

Solid runs its production client builds (`--conditions=browser`), as the Rust port does.

**Outcomes.** `agree`: all four traces are native's. `refused`: the builder refused the program (its diagnostic is
kept, and native and RX are still compared, apart); never agreement. `invalid`: native Solid failed while recording
(`oracle-error`, `oracle-halted`, `oracle-timeout`, as the rust fuzzers classify an invalid oracle). `generator-bug`: a
twin does not load or check, or the twins' plans differ. `upstream`: only compiled RX differs, and a probe that
changes just one upstream RX lowering makes it native's exactly (below). `divergent`: anything else.

**Results.** Seeds 1..1000 and held out 1001..3000 (`.out/plan-fuzz/run-*/summary.json`; rust-solid keeps copies in
`docs/plan-fuzz/`):

| seeds | agree | upstream (compiled RX only) | refused | divergent | invalid | generator bug |
| --- | --- | --- | --- | --- | --- | --- |
| 1..1000 | 861 | 8 (3 AC-3, 5 path write) | 131 (43 `*`, 49 `-`, 39 constant hole) | 0 | 0 | 0 |
| 1001..3000 (held out) | 1694 | 19 (9 AC-3, 10 path write) | 287 (89 `*`, 91 `-`, 107 constant hole) | 0 | 0 | 0 |

The agreeing programs replay 9,651 scenario steps and 301,340 host log entries per leg (1..1000), and 19,959 steps
and 610,856 entries per leg (held out). On every program the emitter accepted, `solid-plan.ts` and Rust's `plan-trace`
equal native Solid: the upstream programs differ in compiled RX alone.

**Divergences found and fixed, by root cause.** The first runs disagreed; each fix is in the emitter or a consumer
(`solid-plan.ts`, rust-solid's `plan_v2.rs` and `fuzz/plan-oracle.mjs` alike), never in the comparison:

1. *Construction order* (consumers). The consumers built each element with its subtree, then appended its static
   children and inserted the dynamic ones. Solid's compiler creates a template's elements first, in pre-order, with
   events as static props of `createElement`, then appends, then inserts; a lone static text is created at its append;
   a Show without fallback has no `fallback` prop. Frames agreed; host logs differed from the second element on. The
   consumers now lower templates as the compiler does ("Markup").
2. *Coercion levels* (emitter). TSX's lowering wraps every hole in `"" + …`, so an authored `{"" + n()}` became
   `"" + ("" + n)`; the builder dropped one level and the TSX and RX plans differed. It now drops every leading one.
3. *A field read is one Get* (consumers). The consumers checked `key in o` before reading `o[key]`: a store's `has`
   trap, then its `get`. The TSX twin reads `o.key` alone. Inside a transaction the two track different nodes, and a
   row's Show inside a For was inserted at a different point. A `get` is now one Get.
4. *Else regions* (emitter). CP-6 opens an `else` region for every `if`. The builder took one only when the `if` had
   an else branch, so a later `if` was matched to the wrong regions and the program was refused
   (`markup reader absent from CP-6`). It now takes one per `if`.
5. *Constant holes* (emitter). Solid's compiler folds a hole it can evaluate with confidence to static text, even
   `(false ? x : "a") + ""`, where RX and the plan insert it. The builder now refuses such a hole; the generator keeps
   it in the `outside` family only.
6. *Text in a component position* (emitter, consumers). TSX lowers a conditional hole `{c ? "a" : b}` to a Show with
   text branches; the compiler lowers that text to strings and memos, which the consumers do not mirror. The builder
   and the consumers refuse text directly in a component position. The generator's TSX holes coerce a conditional
   (`{"" + (c ? a : b)}`), the twin of RX's text hole.
7. *Adjacent dynamic children* (consumers). The consumers refused them ("need a marker the plan does not give"). The
   compiler inserts both before the same next static sibling; the consumers now do too.
8. *Path writes inside the setter* (consumers). The consumers evaluated a path write's index and value before calling
   the store setter; TSX evaluates `draft.a[i].b = v` inside it, where a node a pending transaction holds reads as the
   transaction has it. A plain store write while a transaction held the node then wrote a different value: frames
   differed (native `3`, plan and Rust `5`). The consumers now evaluate inside the setter.
9. *Condition memos* (consumers). The compiler rewrites a conditional or logical `when`/`each` with memos in the
   getter (`memo(() => firstAt() > 0)() && …`). The consumers evaluated it plainly; effects ran in a different order.
   They now apply the same rewrite.
10. *Stores without path writes* (emitter, fallback 5). Found by inspection while classifying: a structured source with
    no path write was emitted as a signal. No run diverged on it, because those programs only read it. It is now a
    store; a root write to a store and a path write to a scalar seed are refused.

`solid-plan.ts` was also brought to the schema on two points no valid program exercises: its `try` catches only host
rejections, and a path write evaluates its segments before its value.

**Remaining classes.**

- *Upstream: RX's optimistic source is a guess layer over a computed signal (AC-3).* Upstream's runtime lowers `source
  shown = issues.list` (guessed) to `createSignal(fn)` plus `createOptimistic(() => truth())`, one node deeper than
  native's `createOptimistic(() => issues.list)`. Effects that read memos over it can apply in a different order
  within one flush. Frames agree; the host log's order differs. The probe (`leg.ts` `directOptimistic`) lowers the
  guessed sources as native does, and RX then gives native's exact trace. Seeds 117, 460 and 534, and held out 1073,
  1457, 1518, 1578, 1740, 1871, 2390, 2511 and 2853; one refused program (784) shows it too.
- *Upstream: RX evaluates a path write's keys and value before the store setter.* `w.path(keys, v)` takes evaluated
  arguments, so under a pending transaction that holds the node RX reads the committed value where TSX and the plan
  read the transaction's (root cause 8). Frames differ. The probe rewrites the compiled `w$x.path(k, v)` to
  `w$x.pathIn(() => k, () => v)` and evaluates both inside the setter; RX then gives native's exact trace. Seeds 138,
  580, 685, 730 and 980, and held out 1309, 1349, 1540, 1695, 2080, 2468, 2757, 2776, 2848 and 2850.
- *Refused programs, native against RX.* On the constant holes, native makes static text and RX inserts
  (`rx: insertNode-getFirstChild`), as root cause 5 says. 39 programs in 1..1000, 107 held out.
- *Not generated: idiomatic TSX number holes.* `{n()}` inserts the number: the host is given `2`, not `"2"`. RX and
  the plan insert the string. The tracker's `<b>{unassigned()} open</b>` is such a hole, and so is like's `{shown()}`.
  `plan-fuzz.test.ts` pins that for the tracker this is the whole difference: with the hole coerced, all four legs give
  the same 453-entry log; without it, only that hole's `createTextNode`, `replaceText` and tree text entries differ, by
  the number's string. The generator's TSX twins coerce number holes.
- *Not generated: uncoerced TSX holes with `&&` on their `||` spine.* The compiler memoizes their test; the builder
  refuses them (above).
- *Not generated: inline action handlers.* Like's TSX handler is `onClick={action(function* () { … })}`, a call, which
  the compiler sets with `setProp` in a render effect after the inserts; the plan's lifted `$action0` is a static prop.
  Like's frames agree on every leg; its host log is not claimed. The generator declares its actions and calls them
  from handlers, as the tracker does.

**Coverage.** Every plan node kind occurs in the agreeing programs (seeds 1..1000; programs containing the kind,
occurrences):

| kind | programs | occurrences |
| --- | --- | --- |
| `action` | 861 | 1617 |
| `event:onClick` | 861 | 4319 |
| `expr:add` | 861 | 4351 |
| `expr:and` | 280 | 349 |
| `expr:array` | 861 | 861 |
| `expr:cond` | 861 | 3385 |
| `expr:eq` | 861 | 5036 |
| `expr:filter` | 861 | 2366 |
| `expr:findIndex` | 843 | 2336 |
| `expr:ge` | 179 | 193 |
| `expr:get` | 861 | 19092 |
| `expr:gt` | 861 | 1066 |
| `expr:le` | 165 | 184 |
| `expr:length` | 861 | 2805 |
| `expr:literal` | 861 | 37890 |
| `expr:local` | 861 | 25647 |
| `expr:lt` | 163 | 179 |
| `expr:map` | 822 | 1630 |
| `expr:ne` | 323 | 372 |
| `expr:not` | 660 | 1234 |
| `expr:object` | 861 | 4682 |
| `expr:or` | 817 | 1951 |
| `expr:read` | 861 | 17378 |
| `memo` | 861 | 2921 |
| `source:optimistic` | 861 | 1184 |
| `source:signal` | 861 | 2678 |
| `source:store` | 861 | 861 |
| `step:await` | 861 | 1990 |
| `step:call` | 861 | 1833 |
| `step:optimistic:updater` | 835 | 1498 |
| `step:optimistic:value` | 119 | 119 |
| `step:try` | 861 | 1617 |
| `step:write:path` | 857 | 2613 |
| `step:write:signal` | 861 | 4556 |
| `view:element` | 861 | 11915 |
| `view:for` | 861 | 1117 |
| `view:show` | 861 | 1559 |
| `view:text:dynamic` | 861 | 6922 |
| `view:text:static` | 861 | 7721 |

Scenario features (agreeing programs, seeds 1..1000): rejection 526, overlapping requests 500, settled out of order
396, filter toggle while pending 304, store write under a live guess 285, two claims on one row 272, base write under
a live guess 34 (of 861).

Yield twins (seeds 1..3000): 469 programs have a yield twin (153 in 1..1000, 316 held out), and each emits the RX
twin's plan, or its refusal, byte for byte. The others have none, because the dialect cannot spell them: an action's
try writes before its await or awaits twice, which `attempt` cannot say (1,699 programs); a hole, `when`, `each` or
row handler reads a source or a row inside a lambda, where a `yield*` cannot go (617); or a row has two elements
(215).

**Reproduce.**

```sh
nix shell nixpkgs#nodejs_24 -c sh -c '
  (cd ../rust-solid && cargo build -q --bin plan-trace)
  export RUST_SOLID=$PWD/../rust-solid
  npm run plan-fuzz -- --seeds 1000 --start 1
  npm run plan-fuzz -- --seeds 2000 --start 1001
  npm run plan-fuzz-corpus -- --start 1 --seeds 300 --max 12 --out ../rust-solid/crates/runtime/tests/fixtures/plan-fuzz'
```

## Server rendering (slice 5)

rust-solid renders a v2 plan on the server (its `docs/SSR.md`) as Solid's `renderToString` renders the plan's canonical
TSX twin: the generator's twin, with integer and conditional text holes coerced (`{"" + x}`). The two TSX spellings of
a hole that fallback 8 merges are different server programs (a scoped hole takes a hydration id, a coerced one does
not), so the plan alone cannot give the idiomatic tracker's keys; `ssr/` here is the oracle (byte-identical HTML,
Chromium hydration, the scenario's frames), and `docs/RESULTS.md` has the results. Plans with eval sites (slice 3) are refused by the
server renderer with a diagnostic.

## Gate

`npm run verify:subset` runs `plan/plan.test.ts` (12 tests), `plan/plan-fuzz.test.ts` (5) and
`slices/tracker.test.ts` (9) with the rest. Of the plan tests, nine are v2 and are listed in
`baselines/subset-tests.json`: equal emission and the saved artifact for the tracker and for like (`--schema 2`), the
frames from each plan alone, the refusals, checker errors (builder and `emit.ts`), schema selection, the emitter rules
the plan fuzz found, and the tracker's Rust leg (below). The plan-fuzz tests are generation (deterministic, and the
twins emit one plan or one refusal), seeds 1..12 on every leg, a refused program counted as refused, the tracker's host
log against native's (the number hole above), and the probe classification of two upstream seeds. With
`tsx/verifier.test.ts`'s check of the plan-fuzz summary, the gate passes 90/90. `plan/tsconfig.json` includes
`resolve-v2.ts`, `solid-plan.ts`, `plan/fuzz/` and the two scripts. `tsc -p plan/tsconfig.json` reports no
diagnostics in `plan/`, `slices/` or `scripts/`. It does report the 12 known upstream strict diagnostics
(`baselines/upstream-tsc.txt`), because the plan test imports the slice runner and through it the upstream compiler.

**The plan fuzz is gated.** `verify-pinned.sh` builds `plan-trace` beside `scenario`, exports `RUST_PLAN_TRACE`, and
after the TSX fuzz runs `scripts/plan-fuzz.ts --seeds 100 --start 1`, recording its exit (`plan-fuzz`). `report.ts`
requires that exit and checks the summary against `baselines/plan-fuzz.json`: all 100 seeds ran; no program is
divergent, invalid or a generator bug; the agreeing and refused counts are the baseline's; every refusal diagnostic is
listed; and every upstream difference is a listed seed of a listed class. A new seed in either upstream class fails the
gate until it is reviewed, as with the TSX fuzz's `baselines/fuzz-upstream.json`.

**The tracker's Rust leg is gated.** `plan.test.ts` has "Rust consumes the tracker plan freshly emitted from each
frontend". It emits the tracker plan from each frontend with `emit.ts`, checks it against `tracker.plan.json`, runs
`$RUST_SCENARIO PLAN tracker.scenario.json`, and requires the exact scenario frames, as the like leg does. The Rust v2
consumer is rust-solid's `scenario` binary, which picks its consumer by the plan's `version` (v1 for like, v2 for the
tracker). The test is listed in `baselines/subset-tests.json`, and the gate fails on any skipped, unlisted or unrun
test.

`verify-pinned.sh` builds `scenario`, `plan-trace` and `ssr` from `RUST_SOLID` (default `../rust-solid`), sets
`RUST_SCENARIO`, `RUST_PLAN_TRACE` and `RUST_SSR` to them (`ssr` is slice 5's server renderer, for `ssr/ssr.test.ts`
and the SSR fuzz step; docs/RESULTS.md), and always exports `RUST_PLAN_V2=1`. The export is required: with
`RUST_SCENARIO` set, `plan.test.ts` registers the tracker leg only when `RUST_PLAN_V2=1` declares the binary a v2
consumer, so without it the listed test never runs and the gate fails ("ran 0 times"). Any other value of
`RUST_PLAN_V2` fails the plan tests. Outside the gate, with neither variable set, the leg is skipped, as the like leg
is; the plan-fuzz tests then run their three JS legs only.

The default `../rust-solid` (the repository's `rust-solid/`) holds all three since slices 3 and 5 were integrated; a
checkout without a v2 consumer, `plan-trace` or `ssr` fails the Rust build step, as it should:

```sh
npm run verify:subset   # PASS 106/106
```

# The plan v2 consumer and the scenario v2 runner

The Rust side of slice 2. A v2 plan is the JSON that `frontend/plan/emit.ts` emits from the
`.rx`, `.tsx` or `.yield.tsx` tracker. Its schema is `frontend/plan/docs/PLAN-V2.md`, and
`slices/tracker/tracker.scenario.json` (format version 2, `docs/SCENARIO-FORMAT.md` there) is its
contract. The consumer builds the plan with the ported Solid 2 primitives (`slice1/`) and renders
it with the port of `@solidjs/universal` (docs/RENDERER.md). It does no scheduling of its own.
Reference: solid-next `2105ffb8` (2.0.0-rc.21), production builds.

## Three readiness levels (kept apart)

- **Syntax we recognize.** Not this folder. The frontends and the v2 emitter live in
  `../frontend`, and that is where the RX, TSX and yield syntax is recognized.
- **Verified subset.** The programs of the frontend's plan fuzz (`frontend/plan/fuzz/`,
  `docs/plan-fuzz/README.md` here), plus the tracker (13 steps) and like in v2 (5 steps,
  version-1 scenario). For every generated program of seeds 1..3000 that the emitter accepts,
  this consumer's `plan-trace` gives native Solid's result and full host log, entry for entry:
  native Solid is the compiled TSX twin on `@solidjs/universal` with the recording host. The
  frontend gate runs seeds 1..100 and the tracker plan freshly emitted from each of the three
  frontends; `cargo test --test plan_fuzz` replays twelve recorded programs that cover every plan
  node kind. A form the schema allows but the generator does not produce is not verified.
- **Full readiness.** Not claimed. See "Gaps".

## Files

| file | what |
| --- | --- |
| `crates/runtime/src/plan_v2.rs` | the schema (serde, unknown fields refused), `validate` (static refusals), the evaluator, the action body, the markup builder, `App` |
| `crates/runtime/src/scenario.rs` | `ScenarioV2`/`StepV2`/`Target`, `run_v2`, `trace_v2` (version 1 is unchanged: `Scenario`, `run`) |
| `crates/runtime/src/bin/scenario.rs` | `scenario PLAN SCENARIO`. The plan's `version` picks the consumer: 1 goes to `plan.rs` (version-1 scenarios), 2 goes to `plan_v2.rs` (version-1 or -2 scenarios), and any other version is refused |
| `crates/runtime/src/bin/plan-trace.rs` | `plan-trace PLAN SCENARIO`: the result plus the recording host's log |
| `fuzz/plan-oracle.mjs` | the same plan and scenario on Solid 2's own primitives, `@solidjs/universal` and `@solidjs/web` delegation, over the recording host of `fuzz/universal.mjs`; prints the same log |
| `fuzz/plan-diff.mjs` | runs both and compares them exactly |
| `crates/runtime/tests/tracker.rs` | 16 tests (below) |
| `crates/runtime/tests/plan_fuzz.rs` | 2 tests: the recorded plan-fuzz programs give native Solid's host log; they cover every plan node kind |
| `crates/runtime/tests/fixtures/plan-fuzz/seed-*.json` | 12 programs from the frontend's plan fuzz (seeds 1..300), each its plan, its recorded scenario and native Solid's trace, picked by `frontend/scripts/plan-fuzz-corpus.ts` |
| `docs/plan-fuzz/` | the plan-fuzz summaries for seeds 1..1000 and 1001..3000 (copies of the frontend's) and how to reproduce them |
| `crates/runtime/tests/fixtures/{tracker.plan.json,like.plan-v2.json,tracker.scenario.json}` | byte copies of the frontend artifacts |
| `crates/runtime/tests/fixtures/{tracker,like-v2}.oracle.json` | `plan-oracle.mjs` output, the expected host logs |

## How the plan is built (mirrors `frontend/plan/solid-plan.ts`)

Everything runs inside `Universal::render(rt, code, root)`, as `app.mount(() => Component())`
does. `code` creates the parts in the order Solid's calls create them:

1. **Sources.** A `signal` is `signal_value(seed)`. A `store` is `create_store(seed, false)`,
   whose root proxy is the value of a `read`. An `optimistic` source is `optimistic_memo(seed
   body)`.
2. **Memos.** Each is `memo_with(body, None, false)`.
3. **The view**, in the order Solid's universal compiler emits the TSX twin (PLAN-V2.md,
   "Markup"; compiler `src/universal/transform.rs`). An element tree is one template:
   - `declare` creates its elements in pre-order: `create_element`, then `set_prop(el,
     "onClick", handler)` for each event (the log of the compiler's static props, which the
     recording host applies with `setProperty`), and, for an element with more than one child,
     its static texts (`create_text`).
   - `exprs` then appends each element's static children in order (a lone static text is
     created at its append), and runs its children's `exprs` and its dynamic children's inserts
     in child order: `insert` before the next static sibling (`Marker::Null` if none follows,
     `Marker::Undefined` for a lone child). Adjacent dynamic children take the same marker.
   - Dynamic text is a zero-length function returning `ToString(value)`.
   - Show is `create_component(show_component(ShowProps { when, keyed: undefined, children,
     fallback }))`, with getters evaluated where Solid reads the props, and `fallback: None` when
     the plan has no fallback views. For is `for_component(ForProps { each, keyed: undefined,
     children: a one-argument mapper, fallback: None })`. Rows are keyed by identity and the item
     is a raw value.
   - A conditional or logical `when` or `each` gets the compiler's `transformCondition(…,
     inline)`: the test of a conditional with a dynamic branch, or the left of `&&` with both
     sides dynamic, is read through `Universal::memo` created in the getter and called once.
   - A component position (the markup, a Show branch, a For row) is one view or an array of
     views; text there is refused by `validate`.

Expressions follow the schema's types. `get`, `length`, `filter`, `map` and `findIndex` on a store
node go through the store's traps, in the order ECMA-262 runs the native methods (method read,
`length`, species, `HasProperty`/`Get` per index). `get` is one `Get`, as `o.key` is; an
`undefined` result is a missing field. A read inside a memo, seed, text, `when` or `each`
therefore tracks what JS tracks.

- **Handlers.** A handler is a zero-length function value. A `write` step is `write_with(signal,
  () => value)` or a store path write. A `call` step invokes `Runtime::action` with the
  arguments bound as locals.
- **Actions.** An action is an `ActionBody` with a frame stack. A guess is `optimistic_write_with`
  (an updater over the shown value, or a constant). A path write is `store_set(proxy, draft => …)`,
  and the segments and then the value are evaluated inside it, as `draft.a[i].b = v` is. An
  `await` records a request and yields its flight (`host#n`). A rejection is thrown in at the await and unwinds to the nearest `try`. A runtime error is not
  caught by the plan's `try`: it fails the run (PLAN-V2.md, Transactions 6). The JS reference
  consumer's `try` catches every throw; on valid plans the two agree.

**The scenario runner** follows `slices/run-js.ts`:

- It validates the scenario and requires the plan's `hosts` to equal its `host` signatures.
- After each step it runs three host turns (queued microtasks, then `flush()`), then compares
  exactly one frame.
- A click is a DOM-style dispatch at the target, handled by the ported `@solidjs/web`
  `eventHandler`.
- A target `{text, parent?, index}` is resolved against the live tree each time. It counts the
  nodes handling `click` in depth-first order, compares each one's text by the frame rule, and
  compares its parent element's text too when `parent` is given.
- A settle step must name an issued, pending request with exactly its arguments.
- Every request must be settled by the end.
- Any evaluator error, runtime error record or uncaught action failure fails the run at its step.

## Results

Frames (`scenario PLAN SCENARIO`):

| plan | scenario | frames |
| --- | --- | --- |
| `tracker.plan.json`, emitted from `.rx`, `.tsx` and `.yield.tsx` | `tracker.scenario.json` (v2) | all 13 equal the recorded native-Solid frames |
| `like.plan-v2.json` | `like.scenario.json` (v1) | `["0","1","0","1","1"]` |
| `like.plan.json` (v1, through `plan.rs`, unchanged) | `like.scenario.json` | `["0","1","0","1","1"]` |

**Host log, beyond frames.** `node --conditions=browser fuzz/plan-diff.mjs PLAN SCENARIO` compares
the full log. That covers every host call (queries included), every request, every action outcome,
and the tree and frame after each step.

- **Tracker:** 453 of 453 entries identical.
- **Like v2:** 34 of 34 identical.
- **The test:** `the_host_log_is_solids` replays the recorded oracle logs. `tracker.oracle.json`
  was re-recorded for the template order below (its frames are unchanged); `like-v2.oracle.json`
  is unchanged (one element, one hole).

**Native Solid's host log, on generated programs.** The frontend's plan fuzz replays each
generated program's scenario on native Solid (the compiled TSX twin), compiled RX, the frontend's
`solid-plan.ts` and `plan-trace`, and compares results and full logs
(`docs/plan-fuzz/README.md`). Over seeds 1..3000, `plan-trace` equals native Solid on every
program the emitter accepts. Seeds 1..1000 give 861 agreeing programs, 8 where only compiled RX
differs (upstream) and 131 refused; held out, 1001..3000 give 1694, 19 and 287. None is
divergent, invalid or a generator bug. The tracker's own log equals native Solid's once its
`<b>{unassigned()}</b>` hole is coerced to a string (453 of 453); the idiomatic hole inserts the
number `2` where the plan inserts `"2"` (frontend `plan/plan-fuzz.test.ts`). Like's log is not
compared with native Solid: its TSX handler is an inline `action(function* …)`, which the
compiler sets with `setProp` in a render effect, where the plan has a static prop.

**Sensitivity check.** Each single change below to the consumer was built and diffed against the
recorded oracle log, then restored. It was measured on the earlier builder, before the template
order below, and not re-run.

| change | frames | log |
| --- | --- | --- |
| For with `keyed: false` (accessor rows) | the run fails at mount | — |
| Every dynamic part inserted with `Marker::Null` | differ | differs |
| A shallow store | agree | differs at entry 204 |
| One host turn per step instead of three | agree | identical |
| `write_value` instead of `write_with` | agree | identical |

The last two rows show the scenario settles within one turn, and that the two signal-write forms
cannot be told apart here.

## Root causes the plan fuzz found

The first plan-fuzz runs disagreed with native Solid. Each fix below is in `plan_v2.rs`, made the
same in `fuzz/plan-oracle.mjs` and in the frontend's `solid-plan.ts`:

- **Construction order.** The builder created an element with its whole subtree, then appended
  its static children and inserted the dynamic ones. Solid's compiler creates a template's
  elements first, in pre-order, with events as static props, then appends, then inserts; it
  creates a lone static text at its append and passes no `fallback` to a Show without one. Frames
  agreed; logs differed from the second element on. `declare`/`exprs` now follow the compiler.
- **A field read is one `Get`.** `get` did `HasProperty` then `Get` (the JS consumers did
  `key in o`). The TSX twin reads `o.key`: one `get` trap. Inside a transaction the `has` read
  tracks a different node, and a row's Show inside a For was inserted at a different point.
- **Path writes inside the setter.** The segments and value were evaluated before
  `store_set`. TSX evaluates `draft.a[i].b = v` inside the setter, where a node that a pending
  transaction holds reads as the transaction has it. A plain store write while a transaction held
  the node then wrote a different value (native `3`, Rust `5`).
- **Condition memos.** The compiler rewrites a conditional or logical `when`/`each` with a memo
  in the getter; the builder evaluated it plainly, and effects ran in a different order.
- **Adjacent dynamic children** were refused by `validate`; the compiler inserts both before the
  same next static sibling, and so does the builder now. `validate` refuses text directly in a
  component position instead, which the compiler lowers to strings and memos.

## The root cause found on the way (the tracker)

The first run panicked at step 1 with `a property read of node#36 is outside the op language`.
Claiming a row guesses a fresh record, so `<For>` creates a new row inside the action's lane
transaction. The insert's render effect then runs `attachWaits` (verdict.ts:845-860,
`attachHook`). Its `valueInserts` reads `v.nodeType` on each value it inserts, here a host node.
The port refused any property read of a host node except `then` and the symbols.

In JS, the recording host's nodes (`fuzz/universal.mjs` `FakeNode`) and the reference string
renderer's `{kind, …}` nodes have no `nodeType`. `undefined > 0` is false, so `attachWaits` returns
false and the effect runs. `js_get` now answers `nodeType` of a host node with `undefined`
(`slice1/store/mod.rs`). Nothing else changed, and the frames were not touched.

The renderer fuzz never reached this, because its programs have no transactions. The slice fuzz
never reached it either, because its values are never host nodes.

## Tests (`crates/runtime/tests/tracker.rs`, 16; `plan_fuzz.rs`, 2)

- **Frames:** the tracker frames; like v2 on the v1 scenario.
- **Adjacent dynamic children** take the compiler's marker (a row with three adjacent holes).
- **Negative cases:**
  - a wrong expected frame (step 3 showing `dev` early) fails with `step 3: expected …`;
  - a duplicate settlement fails with `already settled`;
  - an unknown row target fails with `no clickable … (0 match)`;
  - a stale row target (step 2 addressing the row by its step-0 text) fails;
  - an index past the matches fails;
  - wrong settle arguments fail;
  - an unissued call fails;
  - an unsettled request fails with `scenario left host calls pending`;
  - scenario version rules are enforced (targets and args are version 2 only, args are required
    in version 2, element and target together are refused, unknown fields are refused, plan
    hosts must match);
  - an uncaught rejection fails (`claim` without its `try`);
  - values outside their types fail: `{mode.title}`, `ToString(true)`, a store path index of -1;
  - static refusals (a guess in a handler, an action calling an action, text directly in a
    component position, `1.5`, a constant seed that reads, unknown sources, `key: "id"`, a path
    write to a signal, unbound locals, version 3, duplicate names, unknown ops).
- **Identity keying:** a claimed row gets new host nodes and an unchanged row keeps its own.
  This is checked on the host tree, because it is not frame-visible.
- **Binary dispatch:** the `scenario` binary routes by plan version and refuses version 9.
- **Host log:** `the_host_log_is_solids`.
- **Plan fuzz** (`plan_fuzz.rs`): `generated_programs_give_native_solids_host_log` replays the 12
  recorded programs and requires native Solid's result and log, entry for entry;
  `the_corpus_covers_every_plan_node_kind` requires every expression op, step op (both writes
  and both guesses), view kind (static and dynamic text) and source kind to occur in them.

## Frontend gate

`frontend/scripts/verify-pinned.sh` builds `scenario` from `RUST_SOLID` (default
`../rust-solid`, this folder) and always exports `RUST_PLAN_V2=1`, so the tracker leg is registered and required.
`baselines/subset-tests.json` lists `plan/plan.test.ts :: Rust consumes the tracker plan freshly
emitted from each frontend`. `RUST_SOLID=/workspace/rx-tsx-refresh/rust-tracker npm run
verify:subset` passed 83 of 83 when slice 2 landed (106 of 106 now, with plain `npm run verify:subset`). A v1-only
consumer fails the tracker leg, because it refuses the plan with ``unknown field `component` ``.

## Gaps

Toward a native window (slice 4):

- **Host.** `TreeRenderer` is a recording, in-memory host, and no native host implements the
  `Renderer` trait. Plans carry no attributes, styles, classes or layout. Non-event props are only
  stored.
- **`nodeType`.** A DOM-like host whose nodes have `nodeType > 0` makes `valueInserts` true. It
  then reaches `bornHeldOpen` and the #4574 attach-wait, which are not ported: `attach_waits`
  panics. A native host must either be a host without `nodeType` (as now) or that path must be
  ported first.
- **Events.** Only argument-less `onClick` handlers are in the plan, and the DOM event is not
  passed. A window would also need:
  - input, keyboard and focus events and controlled values;
  - hit-testing from window coordinates to host nodes;
  - `composedPath`, retargeting and `handleEvent` objects, none of which are ported.
- **Event loop and I/O.** The runner drives microtasks and `flush()` by hand, and host functions
  are flights that the scenario settles. A window needs:
  - a real microtask queue tied to its event loop;
  - real asynchronous host calls (I/O, timers) and their cancellation.
- **Memory.** Function values are never freed (`Runtime::functions`), node ids are never reused,
  and the recording host keeps its whole log. A long-running window would grow without bound.
- **Values.** Integers only, with no floats. Strings are UTF-8 with UTF-16 length, and lone
  surrogates panic. Host errors panic instead of returning errors.
- **Components and coverage.** A plan has one component with no props: no child components,
  context, Switch/Match, Repeat, Loading/Errored, Portal or Dynamic. `spread`, `mergeProps` and
  `ref` are not ported. The tracker scenario does not exercise a filter toggle while a claim is
  pending, two claims on one row, a store change under a live guess or non-overlapping
  transactions; the plan fuzz does, and there the consumer agrees with native Solid (verified by
  Solid, not by a written rule).
- **Performance.** The plan is interpreted: environments are cloned maps and steps are cloned per
  execution. The runtime is a structural port. Nothing is measured.

Toward SSR (slice 5): see [SSR.md](SSR.md). A server renderer now renders a v2 plan to the HTML
Solid's `renderToString` renders for the plan's canonical TSX twin, byte for byte, and Solid's
client build hydrates it (verified subset: the plan fuzz's programs, seeds 1..3000, the tracker and
like). Still open there:

- **Hydration in Rust.** The client that hydrates is Solid's: no Rust hydration path is ported
  (For's hydrating `create()`, the `insertExpression` claim pass, event replay).
- **Async SSR.** Plan v2 has no async source, so no `Loading` boundaries, streaming or
  resolved-data transfer (seroval) are ported.
- **The document.** Only body fragments render; `</head>` splices, nonces and streaming are not
  ported.

## Reproduce

```sh
cargo test --test tracker
cargo test --test plan_fuzz
cargo run --bin scenario -- crates/runtime/tests/fixtures/tracker.plan.json crates/runtime/tests/fixtures/tracker.scenario.json
node --conditions=browser fuzz/plan-diff.mjs crates/runtime/tests/fixtures/tracker.plan.json crates/runtime/tests/fixtures/tracker.scenario.json
node --conditions=browser fuzz/plan-oracle.mjs crates/runtime/tests/fixtures/tracker.plan.json crates/runtime/tests/fixtures/tracker.scenario.json > crates/runtime/tests/fixtures/tracker.oracle.json
```

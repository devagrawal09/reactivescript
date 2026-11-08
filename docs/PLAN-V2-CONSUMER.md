# The plan v2 consumer and the scenario v2 runner

The Rust side of slice 2. A v2 plan is the JSON that `frontend-tracker/plan/emit.ts` emits from the
`.rx`, `.tsx` or `.yield.tsx` tracker. Its schema is `frontend-tracker/plan/docs/PLAN-V2.md`, and
`slices/tracker/tracker.scenario.json` (format version 2, `docs/SCENARIO-FORMAT.md` there) is its
contract. The consumer builds the plan with the ported Solid 2 primitives (`slice1/`) and renders
it with the port of `@solidjs/universal` (docs/RENDERER.md). It does no scheduling of its own.
Reference: solid-next `2105ffb8` (2.0.0-rc.21), production builds.

## Three readiness levels (kept apart)

- **Syntax we recognize.** Not this repository. The frontends and the v2 emitter live in
  `frontend-tracker`, and that is where the RX, TSX and yield syntax is recognized.
- **Verified subset.** Exactly two plan/scenario pairs are verified: the tracker (13 steps) and
  like in v2 (5 steps, version-1 scenario). Both are checked against the native-Solid frames and
  against Solid's own host log, entry for entry (below). The frontend gate runs the tracker plan
  freshly emitted from each of the three frontends. Plans are not fuzzed.
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
| `crates/runtime/tests/tracker.rs` | 15 tests (below) |
| `crates/runtime/tests/fixtures/{tracker.plan.json,like.plan-v2.json,tracker.scenario.json}` | byte copies of the frontend artifacts |
| `crates/runtime/tests/fixtures/{tracker,like-v2}.oracle.json` | `plan-oracle.mjs` output, the expected host logs |

## How the plan is built (mirrors `frontend-tracker/plan/solid-plan.ts`)

Everything runs inside `Universal::render(rt, code, root)`, as `app.mount(() => Component())`
does. `code` creates the parts in the order Solid's calls create them:

1. **Sources.** A `signal` is `signal_value(seed)`. A `store` is `create_store(seed, false)`,
   whose root proxy is the value of a `read`. An `optimistic` source is `optimistic_memo(seed
   body)`.
2. **Memos.** Each is `memo_with(body, None, false)`.
3. **The view.** An element is `create_element`, then `set_prop(el, "onClick", handler)` for
   each event, then its children. A literal text is `create_text`. Dynamic text is a zero-length
   function returning `ToString(value)`.
   - Show is `create_component(show_component(ShowProps { when, keyed: undefined, children,
     fallback }))`, with getters evaluated where Solid reads the props.
   - For is `for_component(ForProps { each, keyed: undefined, children: a one-argument mapper,
     fallback: None })`. Rows are keyed by identity and the item is a raw value.
   - Children: the static nodes are appended in order, then each dynamic part is inserted with
     `insert` before its next static sibling (`Marker::Null` if none follows, `Marker::Undefined`
     for a lone child).

Expressions follow the schema's types. `get`, `length`, `filter`, `map` and `findIndex` on a store
node go through the store's traps, in the order ECMA-262 runs the native methods (method read,
`length`, species, `HasProperty`/`Get` per index). A read inside a memo, seed, text, `when` or
`each` therefore tracks what JS tracks.

- **Handlers.** A handler is a zero-length function value. A `write` step is `write_with(signal,
  () => value)` or a store path write. A `call` step invokes `Runtime::action` with the
  arguments bound as locals.
- **Actions.** An action is an `ActionBody` with a frame stack. A guess is `optimistic_write_with`
  (an updater over the shown value, or a constant). A path write is `store_set(proxy, draft => …)`,
  with segments, then value. An `await` records a request and yields its flight (`host#n`). A
  rejection is thrown in at the await and unwinds to the nearest `try`. A runtime error is not
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
- **The test:** `the_host_log_is_solids` replays the recorded oracle logs.

**Sensitivity check.** Each single change below to the consumer was built and diffed against the
recorded oracle log, then restored.

| change | frames | log |
| --- | --- | --- |
| For with `keyed: false` (accessor rows) | the run fails at mount | — |
| Every dynamic part inserted with `Marker::Null` | differ | differs |
| A shallow store | agree | differs at entry 204 |
| One host turn per step instead of three | agree | identical |
| `write_value` instead of `write_with` | agree | identical |

The last two rows show the scenario settles within one turn, and that the two signal-write forms
cannot be told apart here.

## The root cause found on the way

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

## Tests (`crates/runtime/tests/tracker.rs`, 15)

- **Frames:** the tracker frames; like v2 on the v1 scenario.
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
  - static refusals (a guess in a handler, an action calling an action, adjacent dynamic
    children, `1.5`, a constant seed that reads, unknown sources, `key: "id"`, a path write to a
    signal, unbound locals, version 3, duplicate names, unknown ops).
- **Identity keying:** a claimed row gets new host nodes and an unchanged row keeps its own.
  This is checked on the host tree, because it is not frame-visible.
- **Binary dispatch:** the `scenario` binary routes by plan version and refuses version 9.
- **Host log:** `the_host_log_is_solids`.

## Frontend gate

`frontend-tracker/scripts/verify-pinned.sh` builds `scenario` from `RUST_SOLID` (default
`../rust-solid`) and always exports `RUST_PLAN_V2=1`, so the tracker leg is registered and required.
`baselines/subset-tests.json` lists `plan/plan.test.ts :: Rust consumes the tracker plan freshly
emitted from each frontend`. `RUST_SOLID=/workspace/rx-tsx-refresh/rust-tracker npm run
verify:subset` passes 83 of 83. With the default, the v1 consumer in `../rust-solid`, the tracker leg fails,
because that consumer refuses the plan with ``unknown field `component` ``.

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
  `ref` are not ported. The scenario does not exercise these, so they are unverified in Rust as in
  JS:
  - a filter toggle while a claim is pending;
  - two claims on one row;
  - a store change under a live guess;
  - non-overlapping transactions.
- **Performance.** The plan is interpreted: environments are cloned maps and steps are cloned per
  execution. The runtime is a structural port. Nothing is measured.

Toward SSR (slice 5):

- **Server rendering.** Nothing of Solid 2's server rendering is ported: `@solidjs/web`'s server
  build, `renderToString`/`renderToStream`, HTML escaping, hydration keys, and seroval
  serialization of async data. The frame rule is text concatenation, not HTML.
- **Hydration.** No client hydration path is ported: For's hydrating `create()`, the
  `insertExpression` claim pass, or event replay.
- **Async SSR.** No `Loading` boundaries, streaming or resolved-data transfer.
- **No oracle.** No SSR oracle exists in this repository. The render oracle deliberately loads the
  client builds (`--conditions=browser`).

## Reproduce

```sh
cargo test --test tracker
cargo run --bin scenario -- crates/runtime/tests/fixtures/tracker.plan.json crates/runtime/tests/fixtures/tracker.scenario.json
node --conditions=browser fuzz/plan-diff.mjs crates/runtime/tests/fixtures/tracker.plan.json crates/runtime/tests/fixtures/tracker.scenario.json
node --conditions=browser fuzz/plan-oracle.mjs crates/runtime/tests/fixtures/tracker.plan.json crates/runtime/tests/fixtures/tracker.scenario.json > crates/runtime/tests/fixtures/tracker.oracle.json
```

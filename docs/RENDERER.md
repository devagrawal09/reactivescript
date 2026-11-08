# The universal renderer port, string values and event delegation

This tier adds what the slice-2 tracker needs on the Rust side and does not depend on the plan v2
emitter:

1. string values in the runtime (`crates/runtime/src/slice1/value.rs`);
2. a structural port of Solid 2's own renderer, `@solidjs/universal`'s `createRenderer`, with
   `<Show>`, `<For>` and `createComponent` from `solid-js` and `flatten` from `@solidjs/signals`;
3. a differential harness that runs Solid's universal renderer and the port on the same programs
   and compares every host call;
4. event handlers with arguments, delegated as Solid 2's `@solidjs/web` delegates them.

Reference: solid-next `2105ffb8` (2.0.0-rc.21), built, read-only, production builds
(`packages/universal/dist/universal.js`, `packages/solid/dist/solid.js`,
`packages/web/dist/web.js`, `packages/signals/dist/prod`). No dom-expressions, solid-refresh or
Solid 1 code is used or ported.

## Three readiness levels (kept apart)

- **Syntax we recognize** — not this repository: the frontends and the plan v2 emitter live in
  `frontend-tracker`.
- **Verified subset** — what the differential tests below check: the renderer program language of
  this document (inserts of text, numbers, arrays, nested arrays, thunks, renderer memos and the
  compiler's conditional pattern; elements with static children, static and effect-bound props;
  `createComponent`; `<Show>` keyed or not, element or function children, with or without a
  fallback; `<For>` in its three keying modes, arity 1 or 2, with or without a fallback;
  delegated and native event handlers with and without data; dispose), and the string programs
  of `--strings`.
- **Full readiness** — not claimed. The Rust plan v2 consumer now exists
  ([PLAN-V2-CONSUMER.md](PLAN-V2-CONSUMER.md)) and is verified on two plans only;
  `spread`/`mergeProps`/`ref` are not ported, and the gaps under "Not ported" and "Deviations"
  stand.

## Files

| file | what |
| --- | --- |
| `slice1/value.rs` | `Value::Str` (a JS string, `===` by content), `Value::Node` (a host node, by identity); `truthy` (`""` falsy), `type_of`, `to_js_string` (ECMA-262 `ToString` of primitives), `js_add` (the binary `+`), `str_get` (`length` and indexing in UTF-16 code units); `from_json` accepts strings |
| `slice1/function.rs` | JS function values the host creates: `Runtime::function(length, body)`, `call`, `function_length`, `accessor(node)` (signals.ts:140-144) |
| `slice1/flatten.rs` | `flatten` (signals/src/flatten.ts:12-80) |
| `slice1/flow.rs` | `createComponent` (solid/src/client/component.ts:92-104), `For` (flow.ts:83-111), `Show` (flow.ts:192-263) |
| `slice1/universal.rs` | `createRenderer` (universal/src/universal.ts:118-630): `insert`, `insertExpression`, `normalize`, `reconcileArrays`, `cleanChildren`, `appendNodes`, `replaceNode`, `collectNodes`, `collectMounted`, `defaultCleanupNodes`, `render`, and the exported `effect`, `memo`, `setProp`, `createElement`, `createTextNode`, `insertNode` |
| `slice1/events.rs` | `@solidjs/web` delegation (web/src/client.ts): `DelegatedEvents` (constants.ts:50-73), `delegateEvents` (488-496), `registerDelegatedRoot`/`Container` (500-530), `attachDelegatedEvent` (547-555), `parentOf`/`findOwner` (642-652), `addEvent` (985-1017), `assignProp`'s event arm (2900-2935), `eventHandler` (2961-3053) |
| `slice1/effect.rs` | `EffectOptions` and `effect_opts`/`render_effect_opts`: `sync` (CONFIG_SYNC) and `schedule` (queue the first run, effect.ts:99-101) |
| `renderer.rs` | the `Renderer` trait extended to universal's `RendererOptions` (`first_child`, `is_text`, `create_text_value`, `replace_text_value`, `create_sentinel`, `set_property`, all with defaults over the old methods except the first two); `TreeRenderer`, the recording host |
| `bin/render-driver.rs` | the `--render` adapter (mirrors `fuzz/universal.mjs`) |
| `bin/slice1-driver.rs` | strings: `enc`/`lg` log a string as itself, `add` is JS `+`, a flight key is the memo value's `ToString` |
| `fuzz/universal.mjs`, `fuzz/render-worker.mjs` | the oracle: Solid's universal renderer with the recording host, one worker per program, loaded with `--conditions=browser` |
| `fuzz/generate-render.mjs`, `fuzz/generate-strings.mjs` | the generators |
| `fuzz/run.mjs` | `--render` and `--strings` (additive; every other mode is unchanged) |
| `fuzz/solid.mjs`, `fuzz/worker.mjs` | `enc` gives a string as itself; strict mode `'strings'` (the tier-C domain plus strings) |
| `tests/render.rs`, `tests/strings.rs` | unit programs with Solid's logs (`tests/fixtures/render-units.json`, `strings-units.json`) and API tests |
| `docs/render-fuzz/`, `docs/strings-fuzz/` | run artifacts and tools (coverage, unit expectations) |

Every ported function carries a `// Solid: file.ts:lines` comment.

## How the port composes

- **Insert.** `Universal::insert(rt, parent, accessor, marker, initial, options)` is
  universal.ts:134-183 line by line: a non-function value is normalized and inserted at once; a
  function gets a render effect (`sync: true`) whose compute normalizes `accessor()` with
  `doNotUnwrap`, and, when that yields a function (an array holding accessors), a nested render
  effect owned by the first (scheduled when the outer one re-runs) that unwraps it. Both apply
  through `insertExpression` against the region's `current`.
- **Values in flight** are `Value`s: a string or number is `Str`/`Int`, a host node `Node`, an array
  a `JsObj` array compared by identity (`normalize` writes text nodes into it in place, as JS does),
  an accessor a function value. `null`/`undefined`/booleans/`""` are dropped by `flatten`
  (`skipNonRendered`). A host call on anything that is not a node panics (in JS the host throws).
- **Show/For/createComponent** are `Runtime::show_component`, `for_component` and
  `create_component`. A props object is a struct of getters (`Getter`), called where Solid reads
  the prop, so `props.when` is read inside the condition memo and `props.children` inside the outer
  memo (Show) or when the map is first created (For). `keyed` is a value, read once at the call, as
  both components read it. For returns the zero-length `list` accessor that creates its `mapArray`
  (`slice1/map.rs`) on the first read under the owner of the call; Show returns the accessor of its
  outer memo. Both are inserted like any accessor.
- **Render.** `Universal::render(rt, code, element)` creates a root, evaluates `code` under it,
  inserts `() => tree` with `schedule: true` and an `onUpdate` that records the mounted nodes, and
  drains the queued mount with `flush()`. The returned `Disposer` disposes the root and removes the
  mounted nodes (`defaultCleanupNodes`).
- **Events.** Universal has no event code: `onClick={…}` reaches the host's
  `setProperty(node, "onClick", value, prev)`. `TreeRenderer::set_property` routes an event prop
  (`on` + an uppercase letter) through the port of `@solidjs/web`'s `assignProp` event arm with the
  host's `prevProps` of that prop. A name in `DelegatedEvents` (`click`, `input`, …) is delegated:
  `addEvent` stores the handler on the node (`node["_$$click"]`) and, for a tuple
  `[handler, data]`, the data (`node["_$$clickData"]`); `delegateEvents` attaches one listener per
  name to each registered container (`TreeRenderer::register_delegated_root`). Any other name gets
  a native listener (a tuple becomes `e => handler.call(node, data, e)`); the previous one is
  removed. On a click, the host's DOM-style dispatch reaches the container's listener, Solid's
  `eventHandler` walks from the target up the parents to the container and calls each stored
  handler as `handler(data, e)` when data is defined, else `handler(e)`, skipping `disabled` nodes
  and stopping when a handler sets `cancelBubble`; `e.currentTarget` is the node being handled.
  **Handler arguments** are therefore Solid 2's: the bound data of a `[handler, data]` tuple, then
  the event.

## The recording host and the comparison

`TreeRenderer` (Rust) and `FakeNode`/`createRenderer({...})` in `fuzz/universal.mjs` (JS) are the
same host. Node ids are creation order; node 0 is the root container. Every host call is logged
with its arguments and its result, the queries included (`getParentNode`, `getFirstChild`,
`getNextSibling`), as are `setProperty` (values encoded: a function as `{fn: n}` numbered in
first-logged order, an array element-wise), native `addEventListener`/`removeEventListener`,
handler calls (`["handler", id, argument count, data, type, currentTarget, target]`), the program's
`dispatch` ops, and the tree after every op. `insertNode` and `removeNode` have the DOM's
`insertBefore`/`removeChild` semantics (a node already in a parent moves; inserting before itself
is a no-op; a missing anchor or a non-child is an error). A run agrees only if the two logs are
identical; nothing is filtered or normalized.

The oracle worker loads the client builds with `--conditions=browser`: `solid-js` then resolves to
`packages/solid/dist/solid.js` (not the server build Node's default condition picks), and its
signals to `packages/signals/dist/prod/index.js`, the file the other modes use.
`@solidjs/universal` and `@solidjs/web` import that same `solid-js` instance. A throw in the
oracle is `oracle-error`, a reactivity halt `oracle-halted`; either makes the program invalid
(fail-closed). The Rust driver logs `["error", …]` and stops on a thrown error or a runtime error
record, and panics on a host error (a non-node operand, `NotFoundError`).

## Program language (`--render`)

A program is a list of ops; after each, the tree is logged.

- `{op: "signal", id, value: D}`: `createSignal(data(D))` (no owner).
- `{op: "render", view: X}`: `render(() => ev(X), root)` (one live view at a time).
- `{op: "write", id, value: D}`, `{op: "flush"}`.
- `{op: "dispatch", node, type}`: logs `["dispatch", node, type, exists]` and, if node `node`
  exists, dispatches an event of that type at it.
- `{op: "dispose"}`: calls the disposer `render` returned.

Data `D`: a string, number or boolean as itself, `null` as `undefined`, an array element-wise,
`{row: k}` as the program's row object `k` (`{id: k, label: "r" + k}`, one identity per program).

Expressions `X` (JS on the left, the Rust driver mirrors each):

| X | JS |
| --- | --- |
| a string, number, boolean; `null` | itself; `undefined` |
| `{x: "read", id}` | `signal()` |
| `{x: "cat", a, b}` / `{x: "not", a}` / `{x: "cond", test, yes, no}` | `a + b` / `!a` / `test ? yes : no` |
| `{x: "arr", items}` | an array (a fragment) |
| `{x: "fn", body}` | `() => body` |
| `{x: "memo", body}` | universal `memo(() => body)` |
| `{x: "cmemo", test, yes, no}` | the compiler's conditional: `(() => { const c = memo(() => !!test); return () => c() ? yes : no })()` |
| `{x: "el", tag, props, kids}` | `createElement(tag)`; static kids (`{k: "text", v}`, `{k: "el", el}`) created and `insertNode`d in order; props `{name, v, dyn}`: `setProp(el, name, v)` or `effect(() => v, (v, p) => setProp(el, name, v, p))`; then each `{k: "ins", x, fn}` as `insert(el, fn ? () => x : x, marker)` with the next static sibling as marker, `null` if none follows, none for a lone child (the compiled universal shape, compiler fixtures `universal/*/output.js`) |
| `{x: "comp", body}` | `createComponent(() => body, {})` |
| `{x: "show", when, keyed?, kids, fallback?, fn?}` / `{x: "sarg"}` | `createComponent(Show, {get when(), keyed, get children(), get fallback()})`, children `a => kids` when `fn`; `sarg` reads `a` (calling an accessor) |
| `{x: "for", each, keyed?, arity, kids, fallback?}` / `{x: "item"}` / `{x: "index"}` | `createComponent(For, {get each(), keyed, children: (item, index) => kids, get fallback()})`; `keyed: "id"` is `r => r.id`; `item`/`index` call an accessor |
| `{x: "field", of, key}` | `of[key]` |
| `{x: "let", id, v, body}` / `{x: "var", id}` | binds `v` once (a node or handler used in two places) |
| `{x: "handler", id, data?, stop?, write?}` | a new `function (a, b)` that logs its call, sets `cancelBubble` if `stop`, writes a signal if `write`; with `data`, the tuple `[handler, data]` |

## Generator (`fuzz/generate-render.mjs`)

Families by seed: `text` (3/19), `arrays` (3), `show` (3), `for` (3), `bulk` (2: 66-100 rows;
reversals, rotations, block moves of more than 64 rows, shuffles, removals, replacement),
`events` (3), `mixed` (2: everything, then dispose and more writes). In `arrays` and `mixed`, 6%
of child positions share one node between two places, so universal's `isLive` checks and
`cleanChildren`'s not-a-child arm run. Event props use `onClick`/`onInput` (delegated) and
`onChange` (native), functions or tuples, static or effect-bound, sometimes one handler value set
again (the `value === prev` and same-tuple arms); `disabled` props; dispatches at random node ids.

## Results

Artifacts are in [render-fuzz/port](render-fuzz/port/).

| run | result |
| --- | --- |
| `node fuzz/run.mjs --render --seeds 1000` | **993/1000**; every valid program agrees; 7 invalid (`oracle-error`) |
| `node fuzz/run.mjs --render --start 1001 --seeds 2000 --no-reduce` (held out) | **1979/2000**; every valid program agrees; 21 invalid (`oracle-error`) |

By family (1-1000 / 1001-3000): text 158/158, 315/315; arrays 153/159, 297/315; show 159/159,
315/315; for 159/159, 315/315; bulk 105/105, 211/211; events 156/156, 318/318; mixed 103/104,
208/211. Op counts over 1-3000: 3000 renders, 10758 dispatches, 31873 writes, 32566 flushes, 861
disposes.

**The 28 invalid programs are one case: a node shared by two regions.** All 28 contain a
`let`-shared node, and in all 28 Solid's `reconcileArrays` asks the host to remove a node that
another region has taken (`removeNode` of a non-child; the host throws `NotFoundError`, as a DOM's
`removeChild` would, and the render effect halts reactivity). The Rust port panics at the same host
check in all 28 (`removeChild: not a child (NotFoundError)`), so these programs fail closed on both
sides and are not compared. All 28 throw from the same call: the map-fallback removal of
`reconcileArrays`, `else removeNode(parentNode, a[aStart++])` (universal.ts:313, dist/universal.js:186),
which removes `a[aStart]` without the liveness test the prefix and suffix arms make (`isLive`,
universal.ts:251, #574) and `cleanChildren` makes (universal.ts:330). The bulk-removal arm
(universal.ts:273-276) lacks the same check, but none of the 28 reaches it. Checked on an instrumented
copy of dist/universal.js that tags each `removeNode` call site: over seeds 1-3000 exactly these 28
programs throw, all at :186, and so does the repro below. A suspected universal issue, not reported
upstream. Standalone repro on Solid's API:
[solid-bug-shared-node.mjs](render-fuzz/port/solid-bug-shared-node.mjs) (output in
[solid-bug-shared-node.txt](render-fuzz/port/solid-bug-shared-node.txt)); the fuzz program of seed
269 is [fail-269.json](render-fuzz/port/fail-269.json). Programs that share a node without
reaching that arm are valid and agree (`tests/render.rs` `a_node_shared_by_two_regions`).

**The gates are unchanged.** With these changes, `--slice1`, `--slice2a`, `--slice2b` and
`--slice2c` over 1-1000 and 1001-3000 give summaries byte-identical to the recorded ones
([render-fuzz/port/byte-gate.txt](render-fuzz/port/byte-gate.txt): `cmp` against
`docs/slice1-fuzz/parity/summary-*.json` and `docs/slice2{a,b,c}-fuzz/port/summary-*.json`).

**Mutation check.** A single-line mutant of the port must make agreeing seeds disagree
(`--no-reduce`; the source restored after each):

| mutant | seeds | disagree |
| --- | --- | --- |
| `reconcileArrays` swap-backward break test `a_start >= a_end` (for `a_end - 1`) | render 300 | 14 |
| no sentinel for an empty multi region (`normalize`) | render 300 | 52 |
| `eventHandler` ignores `disabled` | render 300 | 2 |
| Show's `condition` memo compares with `===` (for `!a === !b`) | render 300 | 27 |
| `reconcileArrays` map arm `sequence >= index - bStart` (for `>`) | render 300 | 3 |
| `isLive` without the parent test | render 150 | 28 |
| `eventHandler` calls `handler(e)` with data defined | render 150 | 7 |
| string `===` by identity (for content) | strings 150 | 142 |
| `""` truthy | strings 150 | 82 |

## Coverage of Solid's code (V8, `docs/render-fuzz/tools/cov-run.mjs`, seeds 1-3000)

Every program runs in its own worker ([cov-run.mjs](render-fuzz/tools/cov-run.mjs),
[cov-worker.mjs](render-fuzz/tools/cov-worker.mjs)); [cov-report.mjs](render-fuzz/tools/cov-report.mjs)
lists the source segments of a dist file that no worker executed (V8 block coverage: an offset counts
as covered if any worker ran it).

- `universal/dist/universal.js`, the ported part (`insert` to `defaultCleanupNodes`, `render`): every
  segment runs except these, none reachable through compiled inserts and one live `render`:
  - `onUpdate(accessor)` on the static path and `options.schedule` in the nested effect's options:
    only `render` passes options, always with an accessor that never re-runs;
  - `multi && current` and `multi ? marker` in `insertExpression`: a multi region's value is always
    an array (`normalize` wraps it), so neither is reached with a non-array in a multi region;
  - `render`'s `catch` (a throw from `code` or the first flush: invalid programs only) and a second
    call of the disposer.
  `spread` and its helpers, `ref`/`applyRef` are not ported and not run. (Seeds 1-1000 alone also
  miss `cleanChildren`'s `insertNode(parent, replacement, marker)` for a replaced first node that
  another region took; seeds 1001-3000 run it.)
- `solid/dist/solid.js`: `createComponent`, `For`, `Show` all run except `props || {}` (props are
  always given), For's hydrating `create()`, and Show's verdict-window token test and
  `narrowedError` (no `latest`/`isPending` window and no stale read in render programs).
- `signals/dist/prod/flatten.js`: all run except the `NotReadyError` catch of `flattenArray` (no
  pending value is rendered: render programs have no async sources). The port has the catch.
- `web/dist/web.js` delegation: `delegateEvents`, `registerDelegatedRoot`/`Container`,
  `attachDelegatedEvent`, `addEvent` (delegated, tuple and function listeners), `assignProp`'s event
  arm (`value === prev`, the same-tuple arm, removal of a native listener) and `eventHandler`'s walk
  (data and no data, `disabled`, `cancelBubble`, `atOwner`) run; never run: the resume walk of
  nested roots, `findOwner` across several owners, `composedPath`, retargeting, `handleEvent`,
  hydration dedup, `unregister*`, and `assignProp`'s non-event arms (the host keeps other props
  itself). The port has the resume walk and `findOwner`; neither is reached here (one root).

## Not ported

- `spread` and its source machinery (`collectSources`, `collectProps`, `pushEntry`,
  `resolveSource`, `entryHas`, `entryGet`), `mergeProps`, `ref`/`applyRef`, and `createElement`'s
  `staticProps` (the host gets props through `setProp`).
- `RendererOptions.cleanupNodes` (the default `defaultCleanupNodes` is ported and always used).
- `Repeat`, `Switch`/`Match`, `Loading`, `Errored`, `Reveal`, `children()`, `lazy`, `Dynamic`,
  `Portal`; hydration everywhere (`For`'s hydrating `create()`, web's `insertExpression` claim
  pass).
- `@solidjs/web`'s DOM renderer itself (`insert`, `template`, `assign` for non-event props,
  `style`/`class`), portals, shadow roots and `composedPath` retargeting, `handleEvent` objects,
  nested delegated roots' resume walk (ported, never reached: one root), `findOwner` across several
  owners (ported, never reached), hydration event replay, the observe tier.

## Deviations

- A runtime error inside the initial `flush()` of `render` (a render effect's error with no
  boundary) is recorded in `Runtime::take_errors` instead of thrown, so `render`'s catch arm runs
  only for a throw from `code`. Programs that reach it are invalid on the oracle (`oracle-halted`).
- Host errors (a non-node operand, a missing anchor or child) panic in Rust; JS throws. Both make
  the program disagree; neither is compared.
- `INNER_OWNED` is one object per `Universal` (Solid: one per module); it is only compared within a
  renderer's own effects. The delegation state (`delegatedEvents`, `delegatedContainers`) is per
  host (Solid: module-global in `@solidjs/web`); one host per program here.
- The effect options `transparent` and `name` are not ported: they only pick hydration ids and dev
  names.
- Function values are never reclaimed (`Runtime::functions`); fine for bounded programs.
- Strings are UTF-8; `length` and indexing count UTF-16 code units; a lone surrogate is not
  representable (panics). Numbers are integers; `+` refuses a sum outside ±(2^53 − 1), `undefined`
  operands (NaN) and object operands (ToPrimitive). There is no `null` value: render data map JSON
  `null` to `undefined`.
- A host node answers `nodeType` with `undefined`, like the JS hosts it mirrors (`FakeNode`, the
  reference string renderer): `valueInserts` (verdict.ts:836-840) is false for it, so the #4574
  attach-wait (`bornHeldOpen`, not ported) is never reached. Found by the plan v2 tracker, the first
  program that inserts host nodes inside an action's lane ([PLAN-V2-CONSUMER.md](PLAN-V2-CONSUMER.md)).
- `For`'s `keyed` is a value, not a getter (Solid reads it once at the call, so only a getter
  with side effects could tell).

## Strings (`--strings`)

`Value::Str` follows JS: `===` by content (memo/signal equality, `eq`, Map keys in `mapArray`),
`""` is falsy, `+` concatenates when either operand is a string (`ToString` of integers and
booleans), a store field or row may hold a string. The slice-1 driver logs a string as itself and
builds a flight name from the memo value's `ToString`. `fuzz/solid.mjs`'s `enc` gives a string as
itself (before, `{nonscalar: "string"}`); the strict `'strings'` worker accepts strings where the
tier-C domain accepts values. No earlier generator makes a string, and their recorded summaries are
byte-identical (below). `generate-strings.mjs`: `str-scalar` (string signals and optimistic
signals, concatenating and comparing memos, equal-string writes, actions writing strings over
flights resolved with strings, an async memo whose flight is named by a string), `str-list` (an
array of strings with duplicates under each keying mode), `str-tracker` (the slice-2 tracker with
its titles, assignees, mode and status strings, Show + For, claims guessing `"me"`, the catch
writing `"Could not assign #" + id`).

| run | result |
| --- | --- |
| `node fuzz/run.mjs --strings --seeds 1000` | **1000/1000**, 0 invalid (str-scalar 300, str-list 300, str-tracker 400) |
| `node fuzz/run.mjs --strings --start 1001 --seeds 2000 --no-reduce` (held out) | **2000/2000**, 0 invalid |

Summaries: [strings-fuzz/port](strings-fuzz/port/). Unit programs with Solid's traces
(`tests/strings.rs`): an equal-string write is no change, `+`/truthiness coercions, string lists
under each keying mode, and the slice-2 tracker scenario's 12 steps (claims, the merged
transaction of steps 2-4, rejections, the filter both ways) as ops.

## API for a plan v2 evaluator

The evaluator builds the plan with the runtime's own primitives and lets Solid's scheduler (the
port) do the scheduling, as `frontend-tracker/plan/solid-plan.ts` does in JS:

- **Sources.** `signal`: `Runtime::signal_value(Value)`, `write_value(id, Value)`. `store`:
  `create_store(from_json(seed), false)` → a proxy `Value`; path writes through
  `store_set(&proxy, &mut |rt, draft| { … rt.js_set(&node, &Key::name("assignee"), v) … })`,
  reads through `js_get`. `optimistic` with a reactive base:
  `optimistic_memo(BodyFn, None)`, guesses with `optimistic_write_with(id, &mut |rt, shown| …)`
  (an updater over the shown value) or `optimistic_write(id, v)`.
- **Memos.** `memo_with(BodyFn, None, false)` (default `isEqual`: `===`, strings by content), read
  with `read_value(id)` (tracked inside a computation), `accessor(id)` as a function value.
- **Expressions.** `Value::js_add` (`add`), `==` (`eq`/`===`), `truthy` (`and`/`or`/`not`/`cond`),
  `to_js_string` (text), `js_get` (`get`, `length`), `function`/`call` (lambdas passed to Solid).
- **Actions.** `Runtime::action(Box<dyn ActionBody>)` with `ActionStep`/`Resume` (as `plan.rs`
  runs the like plan); a host call returns a flight name and the step yields it;
  `settle_flight_value(name, Ok(Value::str("dev")) | Err(message))`; then `run_microtasks` and
  `flush`.
- **Markup.** `Universal::new(Rc<RefCell<TreeRenderer>>)`; `create_element`, `create_text`,
  `append` for static nodes; `insert(rt, parent, rt.function(0, getter) | value, Marker::Node(next
  static) | Marker::Null | Marker::Undefined, None, InsertOptions::default())` for each dynamic
  part; `set_prop` / `effect` for props; `rt.create_component(Rc::new(move |rt|
  Ok(rt.show_component(ShowProps { … }))))` and `for_component(ForProps { … })` for Show/For;
  `render(rt, getter, root)` to mount (it flushes) and `Disposer::dispose` to unmount.
- **Handlers.** `host.borrow_mut().register_delegated_root(root)` once; a row's
  `onClick={() => claim(issue.id)}` is `set_prop(button, "onClick", &rt.function(0, body),
  &Value::Undef)` with the body calling the action (or the tuple form
  `[claim_fn, issue.id]`, which Solid calls as `claim_fn(id, event)`); a scenario click is
  `TreeRenderer::dispatch(rt, &host, target, "click")`, then `run_microtasks` and `flush`.
- **Frames and targets.** `TreeRenderer::frame(root)` (the concatenated text);
  `handlers_of(root, "click")`, `children`, `tag` and `frame(node)` resolve a scenario v2 target
  `{text, parent?, index}`; `tree(root)` for diagnostics.
- **Failures.** `Runtime::take_errors()` after each step; any entry fails the run.

# Trace contract v0.10: live, timeline, time travel, module replacement

One protocol between a **host** (something that knows what the app did: the real runtime bridge in `./live`, a fake, a
recording, a replay) and a **view** (the map page, the MCP live tools, tests). The UI is built against a fake host now;
the real host must pass the same conformance suite before it ships.

## 0. Evolution rules

- Every message carries `v: 1` (protocol major) besides `source: "rx-map"`. A view ignores messages with an unknown
  `type` and fields it doesn't know.
- **Minor change** (add an optional field, a new message type, a new reason code): edit this file, bump to v0.x+1,
  add a CHANGELOG line at the bottom, extend the conformance suite. Hosts and views keep working.
- **Breaking change** (rename/remove/retype a field, change meaning): bump `v`, update fake + real hosts + views +
  suite in one change, and ask the orchestrator first. No silent breaks.
- The conformance suite (`@reactivescript/map/conformance`) is the arbiter: if the suite and this text disagree, fix
  one of them explicitly.

## 1. Shared shapes

```ts
type Key = string;                 // `<module>|<scope>|<name>[#n]` (SLICE1-CONTRACT §1)
type Preview = string;             // ≤ 80 chars, display only
type Seq = number;                 // flush sequence, starts at 1, strictly increasing, never reused in a session
interface Change { key: Key | null; name: string; preview?: Preview; prev?: Preview; origin?: string }
interface Step {                   // one flush as recorded in the timeline
  seq: Seq; at: number;            // performance.now() ms
  origin?: string;                 // action/interaction label, e.g. "action save(book)"
  cause?: Key;                     // the action or source key that started it, when known
  changes: Change[];               // keyed changes (prev filled when known)
  order?: Key[];                   // causal order of changed keys when known (for edge pulses)
}
```

## 2. Host → view messages

Existing (slice 1, unchanged except `v`, `prev`, `cause`, `order` become optional extras on `flush`):
- `{type:"flush", seq, at, changes, origin?, cause?, order?}`
- `{type:"flight", key, state:"start"|"land"|"abandon", at?}`
  (v0.9) A `start` may carry `cause: [{key?, name, prev?, value?}]`: the inputs whose change re-asked the question (from
  the engine's rerun causes; `key` when the input is a keyed node, `prev`/`value` previews; absent on a first ask), and
  `origin` (the interaction, as on a flush change). An `abandon` caused by the ask's rejection carries `error` (the
  preview); an `abandon` without `error` is a superseded or disposed ask. With `run` records and the graph's `call`
  edges this is the map's call history: which question or action called which JS import, when, why, and how it ended.
- `{type:"reset"}`: forget all live state (new session or page reload).
- `{type:"caught", key, id, site, class, at}` (v0.10): a named action's typed catch matched and is about to run. `key`
  and `id` identify the open `run`; `site` is the zero-based index among that action's typed catches in model order
  (outer before nested); `class` is the matching name as written in the catch. No error message or object is sent.

Current state (v0.3):
- `{type:"snapshot", at, values:[{key, preview, full?}], flights:[{key, since}], boundaries:[{region, state:"ok"|"fallback"|"error", error?}], runs:[{key, id, since}]}`:
  the app's state *now*. Sent in answer to `hello` (before `timeline`) and whenever the view asks (`{type:"snapshot?"}`).
  `values` covers every keyed node that has a value (questions never asked are absent; asked-but-unanswered appear in
  `flights`). `region` is the graph's region key (`<module>|<region path>`), e.g. `src/App.rx|/component:App/errored`.
  `full` (optional) is a longer preview (≤ 2000 chars) for lists/objects; `preview` stays ≤ 80.
- `{type:"boundary", region, state, error?, at}`: a boundary changed state.
- (v0.4) `snapshot.values[]` entries may carry `error` (the node's current error, ≤ 200 chars, e.g. `"NotFound: issue #9"`)
  and `pending: true`; `snapshot.held: [{key, by: Key[], since}]` lists sources whose last write is *held* (written by an
  action/transition that hasn't landed: the shown value is still the old one), with the keys it waits on.
- (v0.4) `{type:"held", key, by: Key[], at}` / `{type:"released", key, at}`: a write to `key` became held / landed.
- (v0.4) A flush change on a node whose error changed carries `error` (and no `preview`). Errors and boundaries are
  attributed to the RX key/region whenever the runtime knows them; nodes with no RX name are dropped from `flush` by
  the bridge unless `hello.want` includes `"internals"`.
- `{type:"run", key, id, state:"start"|"end"|"error", at, args?, error?}`: an action run (actions are keyed like sources:
  `<module>|<scope>|<name>`). `args` is a ≤ 80-char preview. `id` pairs start with end/error. Async actions may stay
  open across flushes.
- `{type:"revert", key, origin?, at, reason?}`: an optimistic value (`guess`) was reverted (the action failed or was
  superseded).
- `flush.changes[].preview` for a store-property change is the preview of the *root* value (the whole list/object), and
  `path` (optional) names the property that changed, e.g. `"3.read"`.

Timeline:
- `{type:"timeline", head: Seq, viewing: Seq|null, steps: Step[], capacity}`: full snapshot, sent on `hello` and after
  `reset`. `viewing` null = live.
- New flushes keep arriving as `flush` while live; the view appends them to its timeline itself.

Time travel:
- `{type:"step", from: Seq, to: Seq, direction:"back"|"forward", changes: Change[]}`: the app is now *showing* the
  state as of `to` (after flush `to` applied). `changes` lists every keyed node whose shown value differs between
  `from` and `to`, with `prev` = value at `from` and `preview` = value at `to`. While viewing, live flushes are
  buffered by the host, not shown.
- `{type:"resume", head: Seq, changes: Change[]}`: back to live at `head` (buffered flushes applied); `changes` as above
  from the viewed seq to head.
- `{type:"travel-denied", to: Seq, reason}`: e.g. `"evicted"` (outside capacity), `"pending"` (a hold is landing).
- (v0.6) `{type:"travel-pending", to: Seq}`: the travel waits for a hold to land, then goes (§4b).
- (v0.8) The wait is bounded (≈3 s): then `{type:"travel-denied", to, reason:"pending", keys: Key[]}`, `keys` being
  what it still waits on (questions in the air, running actions, held writes), so the view can say what.

Module replacement (HMR):
- `{type:"hmr", phase:"plan", id, modules: string[], graph, plan: Plan}`: an edit was saved; this is what will
  happen. `graph` is the full new graph (same shape as `buildGraph`).
- `{type:"hmr", phase:"apply", id}` then
  `{type:"hmr", phase:"done", id, changes: Change[], fallback?:"refresh", uncarried?: Key[]}`, or
  `{type:"hmr", phase:"failed", id, error, fallback:"reload"|"none"}`. `done.changes` lists immediate replacement
  changes. `fallback:"refresh"` reports the keys whose state could not be carried in `uncarried`.

```ts
interface Plan {
  kept:    Key[];                  // state carried over as is
  reset:   Key[];                  // state re-initialised
  rerun:   Key[];                  // derived/effects recomputed (no own state)
  added:   Key[];                  // new in the new graph
  removed: Key[];                  // gone from the new graph
  moved:   { from: Key; to: Key }[]; // same declaration, key changed (e.g. `#n` shift, rename detected)
  reasons: Record<Key, Reason>;    // why, for every key in the plan
}
type Reason =
  | "unchanged" | "init-changed"      // kept: a source whose initialiser changed keeps its current value
  | "type-changed" | "kind-changed" | "scope-changed"   // reset
  | "expr-changed" | "upstream-changed"                  // rerun
  | "new" | "gone" | "renamed" | "reindexed";
```
Graph nodes carry `decl` (the declaration's source text) and `type` (declared/inferred type text) when known; the
planner uses them and falls back to the graph's `lines`.

`planHmr(oldGraph, newGraph, edits?)` with `edits = { renamed?: {from, to}[], reindexed?: {from, to}[] }` (hints from
the compiler; the planner also detects renames and `#n` shifts heuristically).

Rules beyond the reasons table: a `moved.to` may be in kept, reset **or rerun** (a rename that also changed the
expression). A source with a standing question (`source x = await …`) whose question expression changed is `rerun`
with reason `expr-changed`: it re-asks, keeping its current value shown until the answer lands. Comment/whitespace-only
edits are `unchanged`. Props are not in the plan. A module path change is removed + added, not moved. Values that change
because of an HMR are also emitted as a `flush` (origin `"hmr <id>"`), so the timeline and travel include them.
Later answers from questions started by replacement land in flushes with the same HMR origin, not in `done.changes`.
`travel` to a seq never recorded or evicted → `travel-denied` with reason `"evicted"`. Fake `rate` = ticks between
automatic actions (default 0 = only on `act`).

Partition rule: every key of old ∪ new graph that is a source/equation/effect is in exactly one of
kept/reset/rerun/added/removed or is a `moved.from` (whose `to` is in kept, reset or rerun). Actions have no state: they are
`rerun` if changed, else `kept`.

## 3. View → host messages

- `{type:"hello", want: ("live"|"timeline"|"travel"|"hmr")[]}`: sent by the view on load; host answers `timeline`.
- `{type:"travel", to: Seq}` → `step` or `travel-denied` (or, v0.6, `travel-pending` then `step`/`travel-denied`; §4b).
- `{type:"resume"}` → `resume`.
- `{type:"snapshot?"}` → `snapshot`.
- `{type:"select", key}`: informational (host may highlight in app; may ignore).

## 4. Hosts

- **Real** (future slices): `./live` bridge. Timeline = ring buffer of flush records (capacity 2000). Travel uses
  Solid's `openView` (#5089: `show` + `branch`) keyed by Solid node name `rx:<key>`. HMR plan comes from the RX Vite
  front end diffing old/new models (`diffGraphs` + the rules above) before Solid's refresh pass applies it.
- **Fake** (`@reactivescript/map/fake`, now): `createFakeHost(graph, { seed, rate?, capacity? })` →
  `{ post(msg), subscribe(fn) → unsubscribe, tick(n?), act(actionKey?), editModule(module, mutation?), dispose }`.
  - Deterministic from `seed`. Simulates an action: picks an action (or the given one), writes the sources it writes,
    propagates along the graph's edges in topological order (equations recompute, effects run), with plausible
    previews per kind (numbers tick, strings change, lists grow/shrink, booleans flip). Questions open a flight first,
    then land (or abandon ~10%) after a delay in ticks.
  - Keeps true history so `travel`/`resume` produce exact `step`/`resume` changes.
  - `editModule` mutates a copy of the graph (rename one node, change one equation's expression, change a source's
    type, add a node, remove a node) and emits `hmr` plan → apply → done with a real plan computed by the same planner
    function the real host will use (`planHmr(oldGraph, newGraph, edits)` exported from `./hmr`, reusable).
  - `./fake/page` mode: `map.html?fake=<seed>` (or `pageHTML(graph, {live:true, fake:seed})`) runs the fake inside the
    page itself, with a small dev HUD to trigger act / edit / travel, so the UI can be demoed as a static file.
- **Recording** (later): a JSON file of `timeline` + messages; replayed by the same view.

## 4b. Travel details (v0.5)

- Before a key's first recorded change, its value is that change's `prev` (hosts send `prev` on first changes when known;
  replay and views use it).
- `step.inexact?: Key[]`: keys the app can't show exactly at that seq (e.g. Solid's store-guess gap); views mark them.
  (v0.6) It also covers a list rewritten wholesale after that seq whose records name only its length, and the names
  that read it. (v0.7) It also covers keys whose old code or store backing cannot be reproduced after replacement.
- (v0.6) Travel asked for while a question is in the air, an action is running, a write is held or a resume is
  landing waits: the host answers `travel-pending {to}` and travels once that has landed. The newest target wins;
  `resume` drops it; validity (`evicted`) is checked when it goes. A v0.5 host's `travel-denied "pending"` stays
  allowed.
- (v0.6) An error is a shown state, not an absence: `step`/`resume` changes carry `error` instead of `preview` when the
  key shows an error at `to`, and `prevError` instead of `prev` when it showed one at `from`; replay treats an `error`
  change as a state, not a deletion.
- (v0.6) Values are per live instance: a component-scoped key's timeline state is that of the newest instance alive at
  each seq. An instance appearing, being disposed, or getting its first answer is recorded as a change (including
  the absent state: no live instance, or no value yet), so a disposed instance's value or error never shows for a
  later seq.
- One `resume` lands buffered work as a single new step (sent as `resume` then that step as a `flush`).
- While viewing, the app is read-only: the host blocks user input on the app (pointer/keyboard) and the view says so;
  interacting means resuming first.

## 5. Conformance suite

`@reactivescript/map/conformance`: `runConformance(makeHost, graphs) → results`, and `runConformanceAsync` for hosts
whose calls take time (a real app in a browser). Replay ignores keyless changes; an `error` change is a state.

**The arbiter is what the app shows** (v0.8). A host's messages can agree with each other and still describe an app
that shows something else. So `makeHost` returns an optional `shown(keys) → { [key]: {preview} | {error} }`: what the
app displays now for each key (its newest live instance; absent: shows none). The real host implements it by
inspecting the running app (`./live` `attach().shown`), the fake by its true state. The suite compares it with the
replay of the host's own messages after every `travel` and `resume` (except keys a step marks `inexact`). A real host
also passes the DOM check of `test/real-host.mjs` (the page's DOM after `travel(n)` equals the DOM it showed at `n`).
The real host ships only when both hold.

Checks at least:
- `seq` strictly increasing; `at` non-decreasing; every change key exists in the graph or is null.
- Flight `start` precedes `land`/`abandon` for the same key; no double start without an end.
- Travel consistency: values shown after `travel(n)` equal the values reconstructed by replaying steps 1..n, and the app
  shows them (`shown`); `travel(n)` then `travel(m)` equals `travel(m)` directly, in the messages and in the app;
  `resume` equals the live state, and the app shows the replay of the timeline at its head (so work done while viewing
  is not lost).
- `step.changes` lists exactly the keys whose values differ, with correct `prev`/`preview` (`prevError`/`error`).
- A pending travel goes once the hold lands, or is denied `pending` (with `keys`).
- `snapshot` answers `hello` (before `timeline`) and `snapshot?`; it is well formed, agrees with the timeline's head
  (values per live instance), and with `shown`.
- `boundary` messages are well formed; `run`s pair start with end/error; `held` precedes `released`; `revert` keys
  exist; a change carrying `error` carries no `preview`.
- HMR plan satisfies the partition rule; `reasons` covers every key in the plan; `done.changes` ⊆ rerun ∪ reset ∪
  added keys; `done.uncarried` comes with `fallback:"refresh"` and names known keys.
- Unknown message types are ignored by the view (page test).
A host that shows wrong values, loses work done while viewing, or reports a snapshot it doesn't show fails (the
suite's own tests run such broken hosts). The fake must pass it; the real host must pass it, with `shown`, before it
replaces the fake.

## CHANGELOG
- v0.10 (2026-11-25): named action runs report a matching typed catch as `caught` with its site and class.
- v0.9 (2026-11-25): flight starts carry `cause` (what re-asked them) and `origin`; a rejected ask's `abandon` carries
  `error`. Additive: a view that ignores them is unchanged. (round 4: the call history)
- v0.8 (2026-11-25): the arbiter for travel is what the app shows (`makeHost().shown(keys)`, §5); the suite checks
  the v0.3–v0.7 messages; a pending travel's wait is bounded and its denial names the `keys` it waited on.
  (review 1, findings 4 and 9)
- v0.1 (2026-11-24): first draft.
- v0.7 (2026-11-25): real host replacement; reconcile the partition rule with `moved.to` in `rerun`; report refresh
  fallback and uncarried keys; distinguish immediate `done.changes` from later HMR-origin flushes; mark old code or
  backing that travel cannot reproduce as `inexact`. (slice 7, real HMR)
- v0.6 (2026-11-25): `travel-pending` (travel waits for a hold, newest target wins, `resume` drops it); an error is a
  shown state (`error`/`prevError` on step/resume changes; replay keeps it); values per live instance (instance
  appearing/disposed/first answer recorded, absent state included); `step.inexact` covers wholesale list rewrites.
  (slice 4d, round-3 usability)
- v0.5 (2026-11-24): first-change `prev` is the before-value; `step.inexact`; single-step resume; read-only while
  viewing; `runConformanceAsync`; replay ignores keyless changes. (real travel host, slice 4)
- v0.4 (2026-11-24): `error`/`pending` on snapshot values and flush changes, `held`/`released`, `snapshot.held`,
  internals dropped by default. (round-2 usability: "failures invisible", "held write silent", noisy tail)
- v0.3 (2026-11-24): `snapshot`, `boundary`, `run`, `revert`; store-property previews are the root value + `path`;
  `snapshot?`. (round-1 usability: "show current state", "light actions", "whole lists", "boundary tripped")
- v0.2 (2026-11-24): nodes carry `decl`/`type`; `edits` spelled out; `moved.to` may be rerun; standing-question
  expression change re-asks; HMR value changes are flushes; evicted travel; fake `rate` defined. (from the fake host
  implementation; all additive)

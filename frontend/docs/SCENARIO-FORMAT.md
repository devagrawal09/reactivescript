# Scenario format, versions 1, 2 and 2.1

Version 1 is defined first and is unchanged. [Version 2](#version-2-slice-2-the-tracker) is a strict extension for
lists: it adds click targets by rendered text and settled-request arguments. A version 1 file validates exactly as
before, and must not use version 2 fields. [Version 2.1](#version-21-async-data) extends version 2 for async data:
structured host results, and frames that show `Loading` and `Errored` fallbacks; a version 2 file validates exactly as
before.

A scenario is JSON data, not executable code. It contains no source text and names no runtime APIs.
The fixture key selects a separately stored program; each backend supplies its own program loader.
See `slices/like/like.scenario.json` and `slices/run-js.ts`.

## Schema

The root has these required fields:

- `version`: the integer `1`.
- `name`: a human-readable label.
- `fixture`: a lowercase filename stem (`[a-z][a-z0-9-]*`), relative to the scenario file.
- `host`: an array of signatures. Each has `name`, `parameters` (an ordered array of scalar type names),
  `returns` (a scalar type name), and `async: true`. Version 1 type names are `number`, `string`, and `boolean`.
- `steps`: an ordered array. Every step has `type` and `frame` (a JSON string).

Step fields in addition to `frame`:

| type | required fields | meaning |
| --- | --- | --- |
| `mount` | none | Mount the default entry. Must be first and occur exactly once. |
| `click` | `element`: nonnegative integer | Click that live clickable element, zero-based. |
| `resolve` | `host`: name, `call`: positive integer, `value`: scalar | Resolve that invocation. Value must match the host result type. |
| `reject` | `host`: name, `call`: positive integer, `error`: string | Reject that invocation with an error whose message is this string. |

Element order is depth-first, parent before children, in current child order. Only elements with a click
handler count; the synthetic mount root and text nodes do not count. Recompute the list at each click.
No tag names or markup are needed in the scenario.

## Exact frame text

A frame is the universal test renderer's text, **not HTML**:

1. A text node contributes its exact text.
2. An element contributes the concatenation of its children, in order. Its tag, attributes and handlers
   contribute nothing. There are no separators, indentation, quotes, escaping, or added line breaks.
3. The synthetic mount root follows the same rule. Empty nodes contribute the empty string.
4. Do not trim, normalize whitespace, or escape HTML characters. JSON escaping is only file encoding;
   compare the decoded strings exactly (equivalently, their UTF-8 bytes).
5. This version excludes portals, suspense markers and error fallbacks. A future format must define those
   before using them; do not invent text for them here.

For example, a button containing the number 0 renders `0`, not `<button>0</button>`.
A paragraph with three text pieces `2`, ` items / `, and ` / 0` renders `2 items /  / 0`.
A Rust renderer can reproduce a frame by recursively appending text-node bytes in child order.
Numeric holes in these fixtures are integers, rendered in base ten with no decimal suffix or grouping.

## Host calls and timing

Call numbers are **one-based per host function, per mount**, in invocation order. Every invocation creates a
new pending request, including repeated calls with identical arguments or no arguments (SF-2c). Never key
requests by arguments. Rejecting `save` call 1 does not reject a later `save` call 2. A resolve/reject step
requires that call to exist and still be pending; settling it twice is an error. All issued requests must
be settled by the end. Host argument count/types and resolved value types must match their signatures.

After each step, run the resulting synchronous work and ready continuations until the renderer has
settled, without answering any other pending request. Then compare exactly one frame. The JS runner
drains three event-loop turns and flushes Solid after each. These fixtures have one await per action.
Clicks never wait for a pending host request. Rejection becomes an error at the wait point and enters
the program's catch; it is not an out-of-band renderer failure. An uncaught runtime error fails the run.

## Like slice and JS legs

The like trace is mount → click → reject `save` #1 → click → resolve `save` #2 with 1.
Expected frames, recorded from native Solid: `["0", "1", "0", "1", "1"]`. These are stored in the JSON,
not generated from the other backends. `run-js.ts` checks them after **every** step on native Solid and
compiled RX from TSX, handwritten RX and yield. It injects fresh promises through `createApp({ api })`;
the native fixture imports an app-local host module. The interpreter cannot accept that host injection,
so it is deliberately not a leg in this slice's gate. This is not a claim of interpreter parity.

The yield frontend has no declared-action form and expands `$event` at the button. Therefore the TSX
twin binds an inline generator action, and the RX twin uses the same inferred-action handler. The
optimistic increment, committed source, tracked optimistic base, catch, and host wait are unchanged.
TSX requires a `number` annotation on the local host result. Yield uses `attempt` instead of try/catch, as that syntax requires. Its new synchronous optimistic
body form keeps the tracked dependency on the committed source; a constant seed would not be faithful.

## Second example: upstream S-infer-1

`slices/like/s-infer-1.scenario.json` converts the main confirmation trace from
`upstream/scenarios/S-infer-1.md` at fdbcad92: mount, click, resolve the first `fetch` call with `"yes"`.
Its frames are `"no "`, `"yes "`, `"yes "` (including the trailing spaces). The adjacent RX fixture is the
original Program block, unchanged. The JSON replaces the handler-source row with a click and the
argument-keyed resolution with call number 1. It runs on compiled RX and a cheap native Solid twin.
Solid spells the RX question source as a committed signal plus an optimistic accessor; this second
example checks frames, not equal facts across those different source layouts. Its scalar host signature
is `fetch(string): string` (async). No server wrapper or browser network is involved.

Luna's initial suggestion, S-action-1, also has an array question source and a finally block. S-infer-1
fits this slice more closely: scalar values, one optimistic handler, one wait, and one catch.

## Version 2 (slice 2: the tracker)

`"version": 2` keeps every version 1 rule (schema, exact frame text, host calls and timing) and changes only these:

| type | version 2 fields | meaning |
| --- | --- | --- |
| `click` | `target`: `{ "text": string, "parent"?: string, "index": nonnegative integer }`, **or** `element` as in version 1 | See below. Exactly one of `target` and `element`. `target` has no other fields. |
| `resolve` | `host`, `call`, `args`, `value` | `args` is **required**: the exact arguments of that invocation, one scalar per parameter, typed by the signature. |
| `reject` | `host`, `call`, `args`, `error` | Likewise. The error is still a message string. |

**Click targets.** Take the live clickable elements in version 1 order. Keep those whose rendered text (the frame rule
applied to that element alone) equals `text` exactly. If `parent` is given, keep only those whose parent element's
rendered text equals `parent` exactly; the parent of a top-level element is the synthetic mount root. Click the
`index`-th of the rest, zero-based. If there is none, the run fails. Recompute at each click.

A row is addressed by its content, not by a key. In the tracker a row is the element that holds the row's text and its
button, so `{"text": "take", "parent": "Slow search: anatake"}` means "the take button of the row that now reads
`Slow search: ana` + `take`". The scenario still names no tags, keys, ids or handler names. A Rust renderer computes the
same targets from its node tree: parent pointers and the text rule are all it needs. Parent text can change with
state, so a target is only meaningful at its step; the expected frame of the previous step shows what it will match.

**Request arguments.** The runner records each invocation's arguments and compares them (as JSON values) with `args`
before settling. Call numbers keep the version 1 rule: one-based per host, per mount, in invocation order, never keyed
by arguments. `args` only checks that the scenario settles the request it means to.

**Values.** Version 2 adds no types: host parameters and results are `number`, `string` or `boolean`. These fixtures use
integer numbers and string results.

**Overlapping actions.** Several actions may be waiting at once, and requests may be settled in any order. The timing
rule is unchanged: after each step, run until settled without answering any other request, then compare one frame.
What a frame shows while actions overlap is Solid's behaviour, recorded from native Solid; see step 3 below.

### Tracker trace

`slices/tracker/tracker.scenario.json` runs the slice-2 tracker (`tracker.tsx`, `tracker.rx`, `tracker.yield.tsx`, host
`assignIssue(number): string`, async). Each step's expected frame was recorded from native Solid
(`node … slices/run-js.ts SCENARIO --record native`) and is then checked, never regenerated, on native Solid and on the
compiled TSX, RX and yield legs (`slices/tracker.test.ts`). The interpreter is not a leg, as in the like slice.

| # | step | expected frame |
| --- | --- | --- |
| 0 | mount | `Filter: all2 openCrash on save: nobodytakeSlow search: anatakeTypo in footer: nobodytake` |
| 1 | click `take` in `Crash on save: nobodytake` → `assignIssue` #1 `(1)` | `Filter: all1 openCrash on save: metakeSlow search: anatakeTypo in footer: nobodytake` |
| 2 | click `take` in `Typo in footer: nobodytake` → #2 `(3)` | `Filter: all0 openCrash on save: metakeSlow search: anatakeTypo in footer: metake` |
| 3 | resolve #2 `(3)` with `"dev"` | unchanged: `Filter: all0 openCrash on save: metakeSlow search: anatakeTypo in footer: metake` |
| 4 | reject #1 `(1)`, `"offline"` | `Filter: all1 openCrash on save: nobodytakeSlow search: anatakeTypo in footer: devtakeCould not assign #1` |
| 5 | click `take` in `Slow search: anatake` → #3 `(2)` | `Filter: all1 openCrash on save: nobodytakeSlow search: metakeTypo in footer: devtakeCould not assign #1` |
| 6 | resolve #3 `(2)` with `"bo"` | `Filter: all1 openCrash on save: nobodytakeSlow search: botakeTypo in footer: devtake` |
| 7 | click `Filter: all` | `Filter: open1 openCrash on save: nobodytake` |
| 8 | click `take` in `Crash on save: nobodytake` → #4 `(1)` | `Filter: open0 openNothing to triage` |
| 9 | resolve #4 `(1)` with `"ana"` | `Filter: open0 openNothing to triage` |
| 10 | click `Filter: open` | `Filter: all0 openCrash on save: anatakeSlow search: botakeTypo in footer: devtake` |
| 11 | click `take` in `Slow search: botake` → #5 `(2)` | `Filter: all0 openCrash on save: anatakeSlow search: metakeTypo in footer: devtake` |
| 12 | reject #5 `(2)`, `"offline"` | `Filter: all0 openCrash on save: anatakeSlow search: botakeTypo in footer: devtakeCould not assign #2` |

What it exercises: per-row optimistic claims (1, 2, 5, 8, 11); two overlapping claims settled out of order (2 → 3 → 4);
a rejection that reverts one row while the other claim commits (4), and one that reverts an assigned row to its stored
owner (12); a store path write of the awaited string (4, 6, 9); a filter toggle in both directions (7, 10); rows leaving
and re-entering the keyed list, and the Show fallback (7, 8, 10). The tracker has no list move or removal action, so
none is scripted.

Step 3 is Solid's semantics, not a runner artifact. Both claims guess on the same optimistic list, so their transactions
merge ("a guess over another transaction's guess merged them", `solid-next/packages/signals/src/core/lanes.ts` and the
A15 overlap rule in `core/scheduler.ts`). A merged transaction lands only when every action in it has returned. Until
step 4 the store write `dev`, the status write of `claim(3)` and both guesses are held together. At step 4 they land at once,
and the status shows the later write, `Could not assign #1`.

Not exercised: a filter toggle while a claim is pending, two claims on the same row, and a store change under a live
guess. A consumer must not infer their behaviour from this trace.

### JS legs and the plan leg

`run-js.ts` accepts versions 1 and 2. Besides the four legs above it has a `plan` leg: `runScenario(path, "plan", {
plan: PLAN.json })` builds a [v2 plan](../plan/docs/PLAN-V2.md) with Solid's own primitives and checks the same frames.
It requires the plan's `hosts` to equal the scenario's `host` signatures.

## Version 2.1 (async data)

`"version": 2.1` (a JSON number) keeps every version 2 rule and changes only these. It drives a
[plan v2.1](../plan/docs/PLAN-V2.md#v21-async-data) program: `run-js.ts` turns on the TSX frontend's async tier for it,
and `emit.ts` picks the v2.1 builder.

- **Host results.** A host's `returns` is a scalar type name, as before, or a structured type in the eval interface
  grammar (`docs/EVAL.md`, "Typing"): `number`, `string`, `boolean`, `T[]`, `{ key: T, … }`, e.g.
  `"{ id: number, title: string, assignee: string }[]"`. A `resolve` step's `value` is the JSON of a value that
  conforms exactly: integers for `number`, arrays, and records with exactly the type's keys. The runner checks it
  before running (`slices/run-js.ts`; the plan fuzz's recording host, `plan/fuzz/host.ts`, checks it at the step and
  hands the program a fresh copy). Each `resolve` step passes its own value, parsed from the file. Parameters stay scalars, and a
  host may take none (`"parameters": []`, `"args": []`). Versions 1 and 2 still require scalar results ("host results
  are scalars before version 2.1").
- **Fallbacks in frames.** Rule 5 of "Exact frame text" excluded suspense markers and error fallbacks. In version 2.1 a
  `Loading` or `Errored` fallback is ordinary content: the frame is the text of the nodes on screen, by rules 1–4,
  whichever of content and fallback is shown. Only text counts, so a boundary adds nothing to the frame beyond the
  content or fallback it shows. Portals are still excluded.
- **Timing.** Unchanged. A request a re-ask supersedes is still a request: it must be settled by the end like any
  other, and settling it is an ordinary step (its answer may change nothing).

### Tracker-async trace

`slices/tracker-async/tracker-async.scenario.json` runs `tracker-async.tsx` and `tracker-async.rx` (hosts
`assignIssue(number): string` and `loadIssues(): { id: number, title: string, assignee: string }[]`, both async; the
`.d.rx` declares `loadIssues` pure). Frames were recorded from native Solid (`node … slices/run-js.ts SCENARIO --record
native`) and are checked, never regenerated, on native Solid, compiled TSX, compiled RX, the plan and rust-solid's
`scenario` runner, which reads format 2.1 (`slices/tracker-async.test.ts`). The frame starts with the indicator (`ready` or `saving…`, `isPending` of the list)
when the list is on screen; `Loading issues…` and `Could not load issuesretry` are the fallbacks; the status is last.

| # | step | expected frame |
| --- | --- | --- |
| 0 | mount → `loadIssues` #1 `()` | `Loading issues…` |
| 1 | resolve `loadIssues` #1 `()` with [1:"", 2:"ana", 3:""] | `readyCrash on save: nobodytakeSlow search: anatakeTypo in footer: nobodytake` |
| 2 | click `take` in `Crash on save: nobodytake` → `claim(1)`: `affects`, `assignIssue` #1 `(1)` | `saving…Crash on save: nobodytakeSlow search: anatakeTypo in footer: nobodytake` |
| 3 | resolve `assignIssue` #1 `(1)` with "dev" → `refresh`: `loadIssues` #2 | `saving…Crash on save: nobodytakeSlow search: anatakeTypo in footer: nobodytake` |
| 4 | resolve `loadIssues` #2 `()` with [1:"dev", 2:"ana", 3:""] | `readyCrash on save: devtakeSlow search: anatakeTypo in footer: nobodytakeAssigned #1 to dev` |
| 5 | click `take` in `Typo in footer: nobodytake` → `claim(3)`, `assignIssue` #2 `(3)` | `saving…Crash on save: devtakeSlow search: anatakeTypo in footer: nobodytakeAssigned #1 to dev` |
| 6 | resolve `assignIssue` #2 `(3)` with "bo" → `loadIssues` #3 | `saving…Crash on save: devtakeSlow search: anatakeTypo in footer: nobodytakeAssigned #1 to dev` |
| 7 | reject `loadIssues` #3 `()`, `"offline"` | `Could not load issuesretryAssigned #3 to bo` |
| 8 | click `retry` (the `errored` fallback) → plain `refresh`: `loadIssues` #4 | `Could not load issuesretryAssigned #3 to bo` |
| 9 | resolve `loadIssues` #4 `()` with [1:"dev", 2:"ana", 3:"bo"] | `readyCrash on save: devtakeSlow search: anatakeTypo in footer: botakeAssigned #3 to bo` |
| 10 | click `take` in `Slow search: anatake` → `claim(2)`, `assignIssue` #3 `(2)` | `saving…Crash on save: devtakeSlow search: anatakeTypo in footer: botakeAssigned #3 to bo` |
| 11 | click `take` in `Crash on save: devtake` → `claim(1)`, `assignIssue` #4 `(1)` | `saving…Crash on save: devtakeSlow search: anatakeTypo in footer: botakeAssigned #3 to bo` |
| 12 | resolve `assignIssue` #4 `(1)` with "ana" → `loadIssues` #5 | `saving…Crash on save: devtakeSlow search: anatakeTypo in footer: botakeAssigned #3 to bo` |
| 13 | resolve `assignIssue` #3 `(2)` with "cy" → `loadIssues` #6 | `saving…Crash on save: devtakeSlow search: anatakeTypo in footer: botakeAssigned #3 to bo` |
| 14 | resolve `loadIssues` #6 `()` with [1:"ana", 2:"cy", 3:"bo"] | `readyCrash on save: anatakeSlow search: cytakeTypo in footer: botakeAssigned #2 to cy` |
| 15 | resolve `loadIssues` #5 `()` with [1:"ana", 2:"ana", 3:"bo"] | `readyCrash on save: anatakeSlow search: cytakeTypo in footer: botakeAssigned #2 to cy` |
| 16 | click `take` in `Typo in footer: botake` → `claim(3)`, `assignIssue` #5 `(3)` | `saving…Crash on save: anatakeSlow search: cytakeTypo in footer: botakeAssigned #2 to cy` |
| 17 | reject `assignIssue` #5 `(3)`, `"offline"` | `readyCrash on save: anatakeSlow search: cytakeTypo in footer: botakeCould not assign #3` |

What it exercises: the first load behind `Loading` (0–1); a claim whose `refresh` after its await holds the claim's
status write until the re-ask lands (2–4); a re-ask that rejects inside a claim's transaction, so `Errored` shows its
fallback and the claim's write lands with it (5–7); a retry from the fallback (a plain `refresh`) that keeps the
failure on screen while in flight (8) and recovers the boundary when it lands (9); two overlapping claims whose
re-asks are settled out of order: the newer request (#6) lands both claims' writes (14), and the superseded one (#5)
changes nothing (15); a claim that fails before any re-ask: its catch writes the status and the pending mark goes
(16–17). The indicator is `affects` + `isPending`: true from each claim's start until its transaction lands.

Not exercised: `latest`; an async memo with arguments; `Loading` falling back again after content has shown; nested or
sibling boundaries; a re-ask while the first load is still in flight; a rejection of the first load. A consumer must
not infer their behaviour from this trace. The plan v2.1 fuzz's generated format-2.1 scenarios
(`plan/docs/PLAN-V2.md`, "Plan fuzz v2.1") exercise `latest`, async memos with arguments, nested and sibling boundaries,
re-asks while a first load is in flight and first-load rejections, and the JS legs agree there; those scenarios are
recorded per run, not saved as contracts.

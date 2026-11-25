# What the RX bridge needs from Solid (asks for #5089)

The live bridge (`tooling/rx-map/live.mjs`) and the dev runtime (`ref/compile/rt-web.ts`) read a few Solid engine
internals the attribution records don't carry. Those names are not API: the observe artifact mangles some
(`_plumbing`), and a rename breaks the bridge silently. Each read below is feature-detected in `live.mjs` (`supports(…)`,
reported in `globalThis.__RX__.solid` and once in the console), so on a Solid without it the feature it serves is
off rather than wrong. Each comes with the record or query that would replace it, as an ask on the attribution
records of solidjs/solid#5089 (openView).

Line numbers: rx/integ at slice4f (`tooling/rx-map/live.mjs`, `ref/compile/rt-web.ts`).

| # | Read today | Where | What it serves | Ask | Without it |
|---|---|---|---|---|---|
| 1 | `node._x._inFlight` (a new promise on a computation that just ran) | live.mjs:1303 | flight **start** (amber orbit, `flight start`, travel `pending`) | a `flight` record with `outcome: "start"` (the record today only comes at landing/supersession) | `supports("flightStart")` false: no flight starts; travel never waits for questions |
| 2 | `node._flags & (1 << 6)` (REACTIVE_DISPOSED) | live.mjs:1319 | ending the flight of a node disposed while asking (else travel waits on it) | `flight` record `outcome: "disposed"`, or `OBSERVE.isDisposed(node)` | `supports("disposed")` false: such flights stay open until the travel wait bound (3 s) |
| 3 | `node._host`, then `target.pk` / `target.u` up the chain | live.mjs:1367 | the store path of a changed leaf (`flush.changes[].path`, e.g. `3.read`) | `FlushChange.path`: the property path from the store root, not only the leaf `key` | `supports("storePath")` false: `path` is the leaf only |
| 4 | `node._owner` / `node._parent` | live.mjs:29 | telling the bridge's own probe nodes (openView capability probes) apart from the app's in flush records | records for nodes under an owner marked `OBSERVE.exclude` deliverable to a subscriber that asks (`{ excluded: true }`), or `OBSERVE.ownerOf(node)` | the probes' nodes would show as keyless internal changes; probes are skipped where it matters |
| 5 | `createMemo(…, { _plumbing: true })` | live.mjs:93 | the HMR module slot memo kept out of the app's graph/diagnostics | a public option (or `OBSERVE.exclude` on the slot's owner being honoured by every check) | harmless when ignored: the slot shows in diagnostics |
| 6 | `node._fn`, `node._x._q` (a computation, and whether it asked) | live.mjs:435 | HMR: which reincarnated node openView can pin (signal, store leaf, async memo) | `View.pinnable(node)` (openView already computes it internally) or a `kind` on records | not detectable: a renamed field makes every node look like a signal, and HMR pins a sync memo that then re-derives (harmless but no carry-over) |
| 7 | `openView` | live.mjs:966 | time travel, the HMR transaction | merge of #5089 (draft) | `supports("openView")` false: travel answers `travel-denied "unsupported"` |
| 8 | `node._name` | live.mjs:515 | labels in `why`/`held by` for engine nodes found through `DEV.getObservers` | `OBSERVE.nameOf(node)` (records already carry `nodeName`) | falls back to `OBSERVE.ownerPath` |
| 9 | `get[$REFRESH]` (the node behind a signal accessor) | rt-web.ts:106 | the dev registry's node per RX key (HMR carry-over, held-by) | `OBSERVE.nodeOf(accessor)` | no node: HMR carries values by write, not by pin |

## 10. A view pins values, not error or pending status

**Repro:** `rx-vision/repro/view-error-state/view-error-state.test.ts` (on Solid's own `tests/view-time-travel.ts`
helper); the RX app case is `rx-vision/repro/round5-ratelimited/` (a `RateLimited` rejection trips `errored`).

An async memo answers, then rejects (its error boundary shows the fallback), then recovers. Viewing the step where it
rejected shows the old rows, not the fallback: `View.show(values)` writes each pin with `optimisticWrite(node, value)`,
and an error is the node's status (`_statusFlags & STATUS_ERROR`, `_x._error`), which only the node's own run sets. The
flush record does name the boundary's internal nodes at that step, but pinning them back doesn't re-trip the boundary,
and the record has no entry for the rejection itself (no shown value changed). Pending status (`isPending`, a
`loading` fallback for a first ask) has the same gap.

**Ask:** let a pin carry a status: `show(new Map([[node, { error }]]))` (or `View.showError(node, error)`) shows the node
as errored under the view (readers throw it, the nearest boundary shows its fallback), and the flush record lists a
node whose shown status changed (`{ node, prev, value, status: "error", error }`) so a recorder knows what to pin.

**Meanwhile:** the bridge marks such keys `step.inexact` and lists them in `step.recordedErrors`; the map labels them
"recorded error · not replayed".

Exactness also depends on two openView fixes that are local drafts on top of #5089 (branch `rx/view-on-30e7805` in
`solid-view`):

- `f9ee22ade` fix(signals): name the store properties a guess changed in the flush record. Without it a store guess is
  recorded on its `$guess` carrier only; the bridge detects this (a guess record with no property entries) and marks
  `step.inexact`.
- `980f5b4c5` fix(signals): a view reads a list's unnoded keys through its pinned container. Without it a list rewritten
  wholesale doesn't rewind; the bridge probes for it at the first travel and marks `step.inexact` otherwise.
- `49b25a45c` fix(signals): a view rewinds a list an optimistic store guessed over across an await. Without it such a
  list reads wrong rows before the guess; the bridge probes for it (asynchronously, at the first travel that needs it)
  and marks `step.inexact` otherwise.

On stock Solid 2.0 (no `openView`) the map is live (values, flights after #1, runs, boundaries, snapshot) but travel
and HMR state carry-over are unsupported.

## From reactive coverage (slice 9)

1. **Per-node recompute causes.** The flush record says why a *question* was re-asked (its changed inputs), but not why each memo/derived node recomputed. Coverage credits an edge as "propagated" when both ends changed in the same flush, which over-credits a node with several changed inputs. Ask: an observe-tier record (or an optional field on the existing rerun/flush records) naming, per recomputed node, which of its sources actually changed.
2. **"Settled equal" for guesses.** A confirmed optimistic guess on a store row is reported as "superseded", the same word as a guess replaced by a different answer. Ask: distinguish "settled equal by value" (the answer confirmed the guess) from "superseded" (replaced by a different value) in the revert/guess records, so tools needn't infer it from the action's run.

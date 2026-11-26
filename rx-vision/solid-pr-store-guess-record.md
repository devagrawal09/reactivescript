# PR draft (not opened): fix(signals): name the store properties a guess changed in the flush record

- Branch: `fix/attribution-store-guess-record` (worktree `<workspace>/solid-guess-record`), off `main` @ `5420b4a7c`
- Commits (squash on merge):
  1. `9a6e2ecb5 fix(signals): name the store properties a guess changed in the flush record`
  2. `c74dabbd2 test(signals): name a chained optimistic store's guessed properties; comparator idiom` (review follow-up: the RX-shape test, the comparator idiom, comments)
- Status: committed locally, **not pushed, no PR opened**.
- RX carry: cherry-picked onto `rx/view-on-30e7805` (`<workspace>/solid-view`) as `f9ee22ade` and `494698cfe`. The only conflict was the generated `RULES-INDEX.md`, which I regenerated.

---

## Title

fix(signals): name the store properties a guess changed in the flush record

## Motivation

The attribution engine's `flush` record (`FlushEvent.changes`, with `FlushLive` beside it) is meant to list every signal, memo and store property whose **shown** value a drain changed, "an optimistic value appearing or lifting" included. For an optimistic **store** that is not true today.

A store guess does not write the guessed keys' nodes. It goes on the store's guess carrier (`<store>.$guess`, `store/optimistic.ts`), readers of a guessed key read through the carrier, and the key's own leaf stays silent while the guess covers it (`coveredSet`, F-11). The record compares staged nodes at drain end, and the only staged node is the carrier, so the record names only the carrier:

```ts
const [list, setList] = createOptimisticStore(fetchList, [] as string[], { name: "list" });
// a,b on screen
const add = action(function* (x: string) {
  setList(l => { l.push(x); });  // guess: a,b,c on screen
  yield save(x);
  refresh(list);                  // the answer lands equal to the guess
});
```

Records today: `["list.$guess"]` when the guess appears, `["list.$guess", …]` when it lands. No record ever names `list.length` or `list.2`, and for a nested guess (`l[0].read = true`) none names the row's `read`. When the answer equals the guess nothing shown changes, so the properties are never listed at all.

Consumers that rebuild the screen from the record cannot tell which properties a guess changed:

- **devtools** show "list.$guess changed" with two whole frames, not "length 2 → 3, [2] → "c"";
- **time travel** over the record (related, not a dependency: #5089 `openView`) pins each node a step changed back to its previous value. The properties a guess changed are in no step, so stepping back before the guess keeps showing `a,b,c`.

## What changes

At drain end, when a store's guess carrier changed what it shows, the engine also lists the nodes of the keys the guess recorded (`wk`, `del`), from the carrier's frames before and after the drain, exactly as a plain store write lists them:

- the property's leaf (`list.length`, `list.2`, a row's `list.read`) when its value differs by the leaf's own equality (logical slot: a keyed row the answer adopted is the same row);
- the presence node of a key the guess added or removed.

Each entry has `nodeId`, `nodeName`, `key` and the carrier's `origin` (the action that wrote the guess); `FlushLive` carries the node and, for a `{ bodies: true }` listener, `prev` / `value` — what the screen showed. Listed:

- when the guess **appears** (`list.length 2 → 3`, `list.2 undefined → "c"`);
- when it **lifts**: a revert (`list.read true → false`), or a correction (`count 2 → 3`);
- **not** when the answer confirms the guess: nothing shown changed.

One entry per node per drain: if the drain also changed the leaf directly, its entry is kept (with the value the screen showed before, when the guess covered it). The live side stays index for index with `changes`. A leaf a reader released when the lift took its key away (a reverted push) is still the node the screen showed it through and is still listed.

The carrier's own entry (`<store>.$guess`) stays, as the store's container node already appears beside its leaves for a plain write; consumers that already match on it keep working.

Code: `packages/signals/src/core/attribution.ts` (`drainChanges` → `guessedKeys`, `mergeKeyed`), plus the `FlushEvent.changes` JSDoc.

## Rules

- **F-11** — an optimistic value is the displayed value until its hold commits or its source answers; an equal answer confirms silently, a different one corrects. The record follows what F-11 says is on screen: listed on appear and on lift/correction, silent on confirmation.
- F-6 (the guess shows now, ahead of its hold) is why the appearance drain is the one that lists it.
- No new rule. `RULES-INDEX.md` regenerated (`node packages/signals/scripts/rules-index.mjs`; the new F-11 citation in `attribution.ts` and in the test).

## Public API

No new export, option or type. `FlushEvent.changes` lists more entries for optimistic stores: that is the documented contract ("each … store property whose shown value differs … an optimistic value appearing or lifting") now holding for stores. The `FlushEvent.changes` JSDoc gains one sentence saying so. Flagged here because it is a visible change in what the record contains.

## Tests

`packages/signals/tests/attribution-flush-changes.test.ts`, new `describe("FlushEvent.changes: store guesses")`:

1. a push guess names `list.length` and `list.2` with prev/value and the action's origin; an equal answer names nothing again;
2. a nested guess (`l[0].read = true`) names the row's `read`; the action ending without an answer lifts it and names it again (`true → false`);
3. a different answer names the property once more (`2 → 3`), once per node;
4. `FlushLive.changes` lines up with `changes` index for index (node name and key), one entry per node, a reverted push's released leaf included;
5. **the RX shape**: an optimistic store chained to another store (`createOptimisticStore(() => source(), [])`, `source` holding the other store). A push guessed across an `await` names `list.length 2 → 3` and `list.2 undefined → "c"`, and the confirming answer names nothing. A guess the action ends without answering (`shift`) names every index it moved back, plus the length, on lift. A chained carrier's frame before the guess (and after its lift) is the inner store's proxy, so these values are read through it at drain end; the test pins that this gives what the screen showed.

All five fail on `main` and pass with the fix.

Results (local, `pnpm --filter @solidjs/signals build && pnpm --filter @solidjs/signals test`):

| | test files | tests |
|---|---|---|
| main `5420b4a7c` | 560 passed | 7247 passed, 17 expected fail, 2 skipped |
| this branch, first commit | 560 passed | 7251 passed, 17 expected fail, 2 skipped (+4 new) |
| this branch, with the review follow-up `c74dabbd2` | 560 passed | 7252 passed, 17 expected fail, 2 skipped (+5 new) |

An earlier run of the follow-up, concurrent with another suite, hit a 5 s timeout in `attribution-retention` and a vitest worker-start timeout. The sequential re-run above is clean.

`pnpm types` (part of the signals build) passes. Rules index check passes after regenerating.

`@solidjs/web` full suite (`pnpm test`: client, server, hydrate configs), signals + solid-js + web rebuilt each time:

| | client | server | hydrate |
|---|---|---|---|
| main sources | 2042 passed | 4 failed / 2219 passed (`exports-server-conditions`, `server-owner-walks`, `ssr-error-sanitization`: 5 s timeouts under load, unrelated) | not reached |
| this branch | 2042 passed | 2223 passed | 790 passed |

(Local note: the worktree needed `packages/compiler` built natively, `pnpm build` in `packages/compiler`, for the web suite to run.)

### RX branch (`rx/view-on-30e7805`, Solid pin 30e7805eb + openView), cherry-pick `f9ee22ade`

| | signals suite (+ RX repro `store-guess-gap.test.ts`, uncommitted) | focus: repro, `attribution-view-time-travel`, `attribution-view`, `lane-outside-view`, `attribution-flush-changes` | web: `view-time-travel`, `client-records`, `diagnostic-element-ref`, `frames-slot-arg-flights-3852` |
|---|---|---|---|
| before | 1 failed (the repro) / 7325 passed | 1 failed / 92 passed | 65 passed |
| after | 7330 passed | 97 passed | 65 passed |

With the review follow-up (`494698cfe`) on the RX branch, dist rebuilt with types: signals 7338 passed, 0 failed; web full suite 2040 / 2221 / 788 passed, 0 failed.

Earlier, at the first commit: full web client suite on the RX branch after: 2033 passed, 7 failed, all in `dist-nested-manifests.spec.ts` (web `types/` not generated on that checkout: `pnpm types` in web fails there because solid-js has no built declarations; unrelated to this change).

## Maintainer questions, answered ahead

**Should the record name a node that is no longer in the graph?** (`Watched.keys` keeps strong references to leaf and presence nodes a reader has since released.)

Yes. The record names what the screen showed change, and that node is what the screen showed the key through. The case is a reverted push: the guess appended index 2, a row rendered it through `list.2`, and the lift takes the key away. The reader re-runs inside the lift's drain and releases `list.2` before `flushEnd` compares. If the record left it out, a consumer would see `length 3 → 2` and keep `list.2 = "c"` forever: a devtools row that never clears, or a time-travel step that can't rewind the row it once showed.

- **It is what a plain store write already does.** The drain-end comparison keeps every staged node in `watched` strongly until it settles, whether or not a reader still holds it. `Watched.keys` extends that to the leaves a guess carrier covered, because they are never staged themselves.
- **The references end with the carrier.** They live in the carrier's `Watched` entry, which is dropped when the carrier settles (its action ends and the lift is shown). Nothing outlives the guess, and nothing is kept unless the attribution engine is enabled with a `flush` listener (`guessedKeys` runs only when the drain is recorded).
- **A released node that comes back is a new node** with a new `nodeId`. A consumer should treat the old id as gone after the entry that took its key away (its `value` is `undefined`, its presence node goes `true → false`).
- **The alternative,** if you'd rather the record never name a released node: list only live nodes and accept that a reverted push's index is never named. Consumers then keep a stale entry for it.

**Why does the chained case read through a live proxy?** A chained optimistic store's committed frame is the inner store's proxy by design (`store/optimistic.ts`). The carrier's `_value` is that proxy before the guess and after its lift, and the record carries it as the carrier's `prev`/`value` (it did before this change too). `guessedKeys` indexes it at drain end, which reads the inner store's current values. At appearance the inner store hasn't changed in that drain; at lift, its current values are what the screen now shows. Test 5 pins both. A drain in which the inner store changes *and* a guess over it appears would read the inner store's new value as `prev`. That case is not covered; a snapshot of the carrier's committed frame would close it, at the cost of a copy per guess.

## Compatibility

- Observe and dev tiers only. The code is in the attribution engine (`core/attribution.ts`, reached only through `@solidjs/signals/attribution`); `attribution.prod.ts` is untouched and `dist/prod` has none of it. No core or store file changed; no engine state was added (the engine keeps, per watched carrier, the leaf nodes it already listed, dropped with the carrier when it settles).
- Cost: only in `drainChanges` for a carrier whose shown frame changed — a walk over the guess's recorded keys. Nothing on the write path.

## Open points for the maintainer

- **Keep the `$guess` entry?** Kept for compatibility and because it is a real node whose value changed. A consumer that rewinds every node in a step now sees both the carrier and its keys; dropping the carrier entry would make the record purely author-level.
- **Keys from the record, not from a read.** The keys listed are the guess's record (`wk` ∪ `del`), compared on the carrier's frames. A key borrowed from another live carrier (#4784) is not listed by the borrower, and two live carriers on one target are assumed to own disjoint keys (they entangle onto one carrier when they share a key, D-33).
- A leaf that no reader ever created is not listed (there is no node to name), the same as a plain store write.

## Related

- #5089 `openView` (feat/signals-view) — time travel over the flush record. With this change the RX repro (a confirmed optimistic push, viewed at the step before the guess) shows `a,b` instead of `a,b,c`. Not required by this PR, and this PR does not require it.

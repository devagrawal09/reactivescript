# Round 3 "Crew": browser tester (dev toolbar → Structure → Map, pop-out)

**Outcome.** All 10 spec items work in the running app. `pnpm build`, `pnpm typecheck` and `pnpm test` (7/7) pass. There are 14 `.rx` modules in `/home/lucifer/work/solidjs/rx-r3-browser`, 7 local commits. Verified in headless Chromium:
- boards plus hash routes;
- optimistic move/reorder/create/edit/assign/label, with rollback and inline errors under `?chaos`;
- drawer with separately loaded activity, optimistic comments, debounced @mention;
- chat polling, append, pinned scroll, "n new", and optimistic send with retry;
- presence every 5 s with fading;
- undo (last 5, optimistic);
- URL-backed filters with "n of m" counts;
- NotFound pages for board and card, Forbidden read-only, retry boxes, the connection-trouble banner (`?outage`), and `?slow`.

**Gaps.** The title draft in the drawer doesn't reseed after an undo. Comments still show on a not-found card. Presence never shows a pending state, and SILENT_HOLD fires every 5 s.

**Time.** About 32 min by the machine clock (21:40→22:12; load avg ~30). Iterations: 8 build/typecheck runs, 5 test runs, ~35 look→act loops.
| # | spec item | time | map helped? | time travel? |
|---|---|---|---|---|
| 1 | boards + hash routes | 3m | no | – |
| 2 | cards optimistic/rollback | 6m | yes (values of `cards`/`errors`/`undo`, HELD badge on `undo`) | no |
| 3 | drawer, comments, @mention | 5m | **yes**: found that the board-wide region "can fail from comments activity detail" | no |
| 4 | chat poll/scroll/retry | 5m | no (the bugs were DOM scroll and order) | no |
| 5 | presence | 2m | no | – |
| 6 | undo | 3m | partly | **misled**: past undo list rendered `↶ undefined` |
| 7 | filters in URL | 2m | no | – |
| 8 | typed errors | 4m | **yes, decisively** (below) | – |
| 9 | connection trouble | 2m | no | – |
| 10 | tests | 5m | n/a | n/a |

**Biggest RX language win:** guesses on the answer plus `refresh` work exactly as the guide says. Move, edit, undo and create were optimistic with rollback in one try, with zero request bookkeeping. `errored fallback(e: NotFound)` and `await … catch (e: Forbidden) => false` make the typed-error spec almost free.

**Biggest RX language blocker:** `.d.rx` and rx-tsc disagree about JS libraries.
- rx-tsc ignores `lib.d.rx` and typechecks against `lib.ts`, so `ref` results come out as `Accessor<T>` and fail (`Accessor<string>` not assignable to `string`).
- Workaround: rename it to `lib.js` and hand-write a second `lib.d.ts` that uses ".rx view" types (plain values). Every primitive is now declared twice.
- `.d.rx` also can't `import` a type (PARSE), so I copied the `Card` type into `logic.d.rx`.
## Top 5 RX language friction points
1. **Two declarations for every JS primitive** (`.d.rx` for the compiler, `.d.ts` for rx-tsc), as above. No `import` in `.d.rx`.
2. **Typed vs generic `errored` nesting is a silent trap.** I wrote `errored(e: NotFound)` *outside* `errored(e)`. The inner generic one catches NotFound first, nothing warns, and the typed branch is dead code. The checker could flag a typed region shadowed by an inner catch-all.
3. **SNAPSHOT_ARGUMENT on a block-bodied `fn`, but not on the same `fn` written with `=>`.** `fn neighbor(cols, id, step) { i = …; … }` called with `props.x` failed. The expression form of the same function compiled fine. This looks like a bug or an inconsistency.
4. **No JSX inside a ternary** (`{c ? <span/> : ""}` gives a PARSE error near `<span`). You have to use `{if c { … }}`; the error doesn't say so. Also no `for … , index`: I had to restructure Column to compute neighbours itself.
5. **Polling and timers need JS primitives** (`createTicker`, `createScrollKeeper`), and `whoIsHere` needed a dummy `poll` argument to be re-asked. Chat polling as `effect (tick) { poll() }` works, but it's a pattern you have to invent. A guide recipe for "poll every n s" and "append-only log" would help.
## Top 5 tool wins / frictions (concrete moments)
1. **Win: tripped boundary on open.** With `#/b/web/c/c999` the drawer showed the generic "Card didn't load". In the map, the CardDrawer plate said **SHOWING FALLBACK NotFound** on the inner `errored (e)`, and the typed region above it sat idle. That pinpointed the nesting bug in seconds; I fixed it in both files.
2. **Win: "can fail from / pending from" chips on regions.** BoardPage's top `loading` listed `comments activity detail`, which told me the drawer's questions hang off the board-wide region. I checked with a bad card id: the board survived and only the drawer failed. The per-token live values (`cards` 5 rows, `errors {c101:""}`, `undo` "HELD waiting") were the fastest way to read state.
3. **Friction: time travel misrenders.**
   - Dragging back to before an undo showed the undo bar as `↶ assigned GH`, `↶ undefined`; it should be `edited …`, `assigned GH`.
   - At frame #91 the map showed `board ⚠ NotFound "nope"` and `canEdit ⚠ NotFound`, values from an earlier disposed BoardPage instance, while the app at that frame showed a healthy board.
   - Mid-drag toast "can't travel to #111: pending".
   - The LOOKING BACK banner covers the top token row (`undo`/`errors`).
4. **Friction: navigation.**
   - Mouse wheel panned instead of zooming (the guide says wheel zooms). Double-click on a card panned too. Only a single click on a module card zoomed in.
   - The overview (~27%) shows nothing live: no pulses or orbits on module cards during a move or a slow request. I had to zoom into a module to see activity.
   - Text at 60% is tiny in a 1440×900 pop-out.
5. **Friction: noise and small mislabels.**
   - The Health badge climbed to 200+ within a minute, from STRICT_READ_UNTRACKED on internals (`_flags`, `_time`, `_subs`, `_config`), apparently the devtools' own reads. That buried my real warnings (UNSTABLE_MEMO_OUTPUT on `Column.shown`, WIDE_SCOPE_DEPS 202 sources on the chat `<For>`).
   - The token inspector lists keyed rows by their first string field (`web web web …`) rather than a title.
   - Win: the pop-out survived page reloads ("connected to the app again").
## 3 tool changes that would have saved the most time (ranked)
1. **Flag a dead typed boundary**: mark an `errored (e: X)` region whose children already have a catch-all, and show which region actually caught each live error with an arrow from the failing token. This was my one real bug, and only the open-state badge exposed it.
2. **Make time travel exact per instance**: restore arrays of objects intact, don't show values from disposed component instances, and keep the banner off the token rows. Until then I can't trust it, so it went unused for debugging.
3. **Show liveness at overview zoom, and filter devtools' own diagnostics out of Health**: pulses or in-flight badges on module cards, and wheel = zoom toward the pointer.

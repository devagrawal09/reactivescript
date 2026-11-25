# Round 4 "Ledger" — browser tester (devtools Map, pop-out, time travel, HMR)

**Outcome:** all 10 items work in the running app. `pnpm build`, `pnpm typecheck` and `pnpm test` (12 tests) pass. 16 `.rx` modules plus TS helpers (server, ops, formulas, prims). 15 commits in `rx-r4-browser`.
**Time:** 01:05 to 01:37 by `date` and the git timestamps. That's 32 min on the clock, which looks short for the work, but it's what the clock says. About 24 builds (9 failed to compile) and about 45 Playwright runs.
**Setup:** the docked map is about 300 px tall at 1440x900, too small to use, so I worked in the ↗ pop-out at 1440x900. It stayed connected through app reloads.

## Per spec item (time from the git log · did the tool help · did HMR keep state · did time travel help)
| # | item | min | tool | HMR | time travel |
|---|---|---|---|---|---|
| 1 | workspaces, hash routing, back/forward | 4 | **yes**: map showed a NotFound caught by the wrong boundary | n/a | no |
| 2 | grid: edit, keys, add/delete, multi-select, bulk, rollback | 8 | **yes**: found the bulk revert | kept (2 edits) | **yes**: decisive |
| 3 | formulas, totals, live FX every 3 s | 2 | no | kept | no |
| 5 | SVG bars and burn-down | (with 3) | no | n/a | no |
| 6 | undo/redo ×20, Ctrl+Z / Ctrl+Shift+Z, optimistic | 1 | no | n/a | no |
| 8 | NotFound, Forbidden read-only, RateLimited countdown, retry boxes | 5 | **misled**: no call history; scrubbing showed no change | n/a | no: frames all looked final |
| 7 | changesSince merge, conflict badge (keep mine / take theirs) | 3 | yes: live `editingId`/`editingCol` proved the wiring | n/a | no |
| 9 | offline queue, "n pending", replay in order | 1 | no (it worked first try) | n/a | no |
| 4 | CSV paste, preview, batched progress, partial failure, retry | 3 | no | n/a | no |
| 10 | vitest | 1 | no | n/a | n/a |

**HMR log** (edits made with the app running):
- Kept: Grid hint text (twice), the `edit` action body, a new `tipShown` source (map said ADDED).
- Lost, and the map warned "NOT CARRIED":
  - BulkBar's typed `category` ("Promo" became "").
  - fx.rx's module state (`table`, `updates`, `cursor`) after a **comment-only** edit.
- Lost, and the map said **"kept (unchanged)"**: CellEditor's `draft` went from "Pizza night" back to its seed "Meetup pizza". The map was wrong here.
- One full reset came from outside: the linked Solid `dist` was rebuilt and Vite did a page reload.

## Top 5 RX language frictions
1. **A source array passed to an action stays live.** `bulk(selected, …)` followed by `onFlush(selected := [])` emptied `ids` before the server call. The guess showed, then reverted with no error. I had to JSON-snapshot it. The guide says handler reads are snapshots; arrays aren't. (~15 min, the worst bug.)
2. **`UNCAUGHT_ACTION_FAILURE` for an action that reads a failing prop isn't cleared by try/catch around the whole body.** The only fix was moving the reads into a plain handler and passing values in.
3. **Missing JS:**
   - no regex literals (PARSE error)
   - no `Object`/`Math` (`Math` came with a helpful fix message, `Object` didn't)
   - no `!` operator (reported as a misleading `JS_LOCAL`)
   - no narrowing after `if (c == null) return` or `if (mine != null)` under rx-tsc
4. **Holds bit me twice:**
   - The cell editor stayed open until the save landed: `editing := false` was held with the action it launched.
   - Clearing the selection and the bulk inputs needed `onFlush`.

   Both follow the rules, but I had to remember them for every write next to an action.
5. **Small papercuts:**
   - `STALE_OWN_READ` fires across mutually exclusive `if` branches.
   - A bare instantiation (`createUndoKeys(…)`) only gets "expected a declaration or markup".
   - There's no keyed remount idiom (I used `{for id in [route.budget]}`).
   - Derived lists need `key` or Solid warns `UNSTABLE_LIST_IDENTITY`.

## Top 5 tool wins and frictions
1. **WIN, time travel on the app DOM.** Clicking flush ticks #5 to #13 re-rendered the real grid. The bulk guess showed with `v:1` up to #13 and reverted at #14, which proved the server write never happened. That pointed me at the live-proxy capture.
2. **WIN, the boundary view.** At 51% zoom: "SHOWING FALLBACK NotFound" on the generic `errored`, a caught-by arrow, and the typed one labelled "nothing read below awaits". It found my boundary-order bug in one look; the compiler doesn't warn about it.
3. **WIN, the Reload plan.** Mostly honest and specific: ADDED `tipShown`, RE-RUN `edit (expr-changed)`, NOT CARRIED with names. But its header says "Applied, with a refresh fallback … the names below lost their state" above a list headed KEPT.
4. **FRICTION, no flight or call history.** The `listItems` panel only says "called by items". I couldn't answer "who called listItems a second time, and why did RateLimited heal in under 0.5 s". Unresolved after about 20 min; I worked around it on the server. The token panel's "last changed by JS call listItems" was also shown when the last write was a `run` guess.
5. **FRICTION, rough handling:**
   - the wheel zoom step is huge (6 ticks took it from 15% to 260%)
   - the guide panel reopens on every reload
   - the pop-out header's module list goes stale
   - the `draft` "kept" claim above was wrong

## 3 tool changes that would have saved the most time
1. **Flights per JS import and per question:** each call with its args, outcome (resolved / rejected with class / dropped as stale), the flush it landed in and **what caused the call** (input change, refresh, boundary reset).
2. **Per-token change history** (flush number, writer, kind: guess / `:=` / revert, old→new), so I don't have to bisect by clicking ticks. Also mark "captured by an action" for live proxies.
3. **Reload-plan truth for nested component state:** verify after the swap (compare values) rather than predict; never say "kept" for a value that was reseeded.

## RX vs plain TS + Solid 2
- **Saved time:**
  - guesses that revert by themselves, per row (rollback cost zero code)
  - typed `errored` regions
  - `refresh`
  - effects as one-line polling and replay loops (`effect (offline, queue.length, …)`)
  - writing the whole offline queue, collab merge and import in about 10 min, each right the first time
- **Cost time:**
  - the missing JS (regex, `Object`, `Math`, `!`), so about 40% of the logic went to TS helpers
  - snapshot semantics on arrays
  - checker rules that need restructuring instead of a local fix

  In TS + Solid I'd write about 30% more code on optimistic stores, but I'd skip the 3 detours above.

**Biggest language win:** `guess items := rs => applyLocal(rs, op)` plus `catch` gave per-row optimistic rollback with inline errors, verified under `?chaos`, with no revert code.
**Biggest language blocker:** the live-proxy capture of a source array passed to an action: a silent revert with no diagnostic.
**Biggest tool win:** time travel that re-renders the app at each flush.
**Biggest tool blocker:** no call or flight history with causes, which left the RateLimited "auto-heal" a mystery.

Other notes:
- `page.evaluate(import('/src/server.ts'))` gets a different module instance from the app's (a Vite URL identity issue, not RX). It cost about 10 min of confused collab testing.
- Shots are in `r4-browser-shots/`; the driver is in `r4-browser-driver/`.

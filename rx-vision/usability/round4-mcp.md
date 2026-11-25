# Ledger — round 4, RX MCP

Outcome: Ledger implemented in 19 active `.rx` modules; all ten items exercised in Chromium or Vitest. `pnpm build`, `pnpm typecheck`, `CI=1 pnpm test` (7 tests) passed. ~25 min wall clock, ~20 build/debug/verification iterations, 10 local commits. Fake server lives in the browser; only the pending queue persists across full reloads. History shortcuts are scoped to the budget panel and history is disabled while offline/replaying. Time travel was not exercised: MCP lists traces but has no rewind/seek tool, and the visual map was out of scope.

## Per item
1. Workspaces — 4 min, verified hash/back/forward; MCP yes (`state`/`tail` showed hashes), `why` only old runs after replacement, no recording/time travel. Header edit kept hash/Travel but instance 1→5; URL reseeds it, so not proof of retention. `check` misled on documented `.d.rx`: production/typecheck passed, warm check parsed it as a module and still reported the deleted path.
2. Grid — ~6 min, verified arrows/Enter/Escape, bulk, add/delete, optimistic edit + inline rollback; MCP yes, `record`/`why` linked keydown → pending → visible and completion → rollback, though key filter retained whole flushes; no time travel. Editing draft survived a toolbar `.rx` edit (MCP instance 10→33; state and DOM agreed). `check` correctly found `import type`/undeclared exports/`Object`, but falsely parsed `ledger.d.rx` after normal build succeeded.
3. Formulas — ~5 min, USD total $1,479.50→$1,457.99 with FX only; all three breakdowns rendered. MCP yes: `reach` showed FX plus rows, `why summary` traced FX cursor, `tail rows` only initial load. `find` returned `summary.total` but `why` rejected that key. Selection survived breakdown `.rx` edit (9→33); no recording/time travel.
4. Imports — ~4 min, verified quoted CSV, row validation, intermediate 3/4 progress and partial retry without duplicate. MCP yes, `record` traced processed updates. HMR loss: editing ImportPreview reset ImportDialog.text to empty (26→77) while the dialog stayed open; tail showed a new empty source. No time travel.
5. Charts — ~3 min, verified SVG bars and changing line points. MCP yes, `reach` confirmed summary/FX dependency; no record/why/time travel. Selected row survived burn-chart label save (9→35). Earlier chart introduction was followed by a blocking Vite overlay; had to reload before selection test.
6. Undo/redo — ~5 min, verified keyboard bulk undo/redo and import undo/redo under `?slow`; MCP yes, `why` identified write completion runs and `state` showed grouped history persisted across controls `.rx` save (16→67); no recording/time travel. Default action parameter produced misleading `ASSIGNMENT` suggesting writing to the type name.
7. Collaboration — ~5 min, verified active draft untouched by poll and both resolution choices. MCP yes: `state` showed remote conflict and separate local draft, `why` linked poll run. Both survived conflict badge `.rx` edit (conflict instance 19→52); no recording/time travel.
8. Permissions/errors — ~4 min, verified bad hash + recovery via sidebar, archive read-only, generic load retry, and rate countdown/retry. MCP yes, `boundary` showed live `MissingRoute` and `why` traced back to the hash; static boundary listing oddly highlighted `visible`. Selection survived retry-box `.rx` edit (10→45); no recording/time travel.
9. Offline queue — ~5 min, triggered three failures, queued two edits to one cell, replayed FIFO, and confirmed the final value after leaving/returning. MCP yes, `record` showed queue 2→1→0; pending queue survived banner `.rx` save (24→66, `state`/`tail`). No time travel.
10. Tests — ~2 min, 7 passed (all five named areas + typed errors/FIFO overlay); MCP no for Vitest itself. `overview` confirmed 19 modules, `diff` failed on `ledger.d.rx` despite green checks. Selection survived header `.rx` edit (10→51, state/tail); no record/why/time travel.

## RX: five friction points, biggest win and blocker
- **Biggest win:** `visible key id = …`, `summary = …`, `graphics = …` made the grid → totals → SVG chain readable without accessors, memos, or manual refresh.
- **Biggest blocker:** no `import type`; TS-side shapes and helper signatures needed shadow `.d.rx` declarations, even for ordinary pure functions.
- Declaring a TS module changed *all* its exports: plain `fields` was rejected as undeclared, so I exposed a declared `fieldsList()` instead.
- `Object` is unbound, even for pure operations such as `Object.keys` and `Object.fromEntries`; moved them into TS rather than extending the RX layer.
- Default action params fail with `ASSIGNMENT` and suggested `Intent := Intent + 1` for `operation: Intent = "edit"`.
- Automatic async-action transactions aren't a natural fit for progress and independent row settlements; I used callbacks into RX actions for writes and native `await` for loading/polling.

## MCP: five moments, biggest win and blocker
- **Biggest win:** live `why` and `record` made rollback explainable without log prints: keydown → pending change → updated grid → completion with error and original description.
- **Biggest blocker:** warm `check` parsed valid declaration files as entries and kept a deleted `browser.d.rx` error; `diff` repeated the declaration parse failure in the Git temp tree. Production and typecheck were green.
- Static answers warned “last good build” for most of the run, yet `reach` included the newly added graphics/FX edges. Useful, but I couldn't tell which modules were current.
- `find` offered `summary.total` which `why` called unknown; `why summary` then traced the precise FX cursor. Static-to-live key mismatch was confusing.
- `boundary` showed the missing-route error live; `state`/`tail` distinguished a genuine nested CSV draft reset from retained parent state even when instance IDs changed. Recording filters were noisy because entire matching flushes came back.

## Three ranked changes
1. Exclude `.d.rx` as standalone entries in `check`/`diff`; forget deleted entries and label freshness per entry.
2. Make `find`/`node`/`state`/`why` share addressable keys and expose HMR old→new instance/restored/reset status.
3. Add a targeted trace view (strict-key event filter, callback/action attribution) and expose timeline seek/restore through MCP.

## Compared with plain TS + Solid 2
Plain TS + Solid 2 would save declaration duplication and make browser interop, CSV, and queue mechanics about the same. RX saved repetitive signal/memo plumbing in the grid and derived UI, with a readable native error region and polling actions. The MCP model added wins not inherent to the syntax. For this mixed async app, declaration/tooling overhead ate much of the speedup; a TS-first domain plus RX presentation was productive.

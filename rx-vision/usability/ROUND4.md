# Usability round 4: "Ledger" (team budgeting with live rates)

Same rules and report format as ROUND1.md (+ ROUND3.md extras). Biggest app so far, and the first round where module
replacement keeps state on save (edit a .rx file while the app runs: state should survive) and time travel is exact.

## App spec
A team budgeting workspace against a fake server `src/server.ts` (150–900 ms; `?chaos` ~1 in 3 calls reject; `?slow` ×4).
At least 16 `.rx` modules.
1. **Workspaces & budgets**: sidebar of workspaces → budgets; hash routing `#/w/<id>/b/<id>`; back/forward.
2. **Grid**: a spreadsheet-like table of line items (category, description, amount, currency, date, tags) with inline
   editing, keyboard navigation (arrows/enter/escape), add/delete rows, multi-select + bulk edit. All writes optimistic
   with per-row rollback and inline errors.
3. **Formulas**: computed columns and a totals row (per category, per tag, per month), converted to the budget's base
   currency using live FX rates; rates stream from `rates(since)` polled every 3 s; totals update without refetching rows.
4. **Imports**: paste CSV into a dialog → preview with per-row validation errors → import (batched server calls with
   progress, partial failure keeps the failed rows for retry).
5. **Charts**: monthly spend per category (bars) and burn-down vs budget (line), drawn with plain SVG from derived data.
6. **Undo/redo**: the last 20 edits (incl. bulk edits and imports) with keyboard shortcuts; optimistic.
7. **Collaboration-ish**: `changesSince(budgetId, cursor)` polled every 2 s merges other users' edits into the grid
   without clobbering a cell being edited; conflicts show a resolvable badge.
8. **Permissions & errors**: typed `NotFound`, `Forbidden` (read-only budget: editing disabled, banner), `RateLimited`
   (retry-after countdown); anything else → a retry box at the nearest sensible boundary.
9. **Offline queue**: when calls fail 3× in a row, queue writes locally, show "n pending", replay in order when back.
10. **Tests**: vitest for formulas/conversion, rollback, import partial failure, undo/redo, conflict merge.

Done = `pnpm build`, `pnpm typecheck`, `pnpm test` pass and every item verified in the running app.

## Report extras
- Per spec item: time, tool helped (yes/no/misled); did HMR keep your state when you edited files (note each time it
  didn't); did time travel help.
- Compare honestly with what you'd expect building the same in plain TS + Solid 2 (where RX saved or cost time).
- The single biggest RX language win and blocker; the single biggest tool win and blocker.

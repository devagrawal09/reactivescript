# Round 5 — Dispatch / MCP

Outcome: Dispatch has 24 `.rx` modules, no `.d.rx`, eleven local commits, no push. Build/typecheck pass; Vitest 5/5 (`pnpm test --run --maxWorkers=1`). Browser exercised every feature area; analytics computation is split, but dashboard markup is static. Inbox pagination is client-side. ~28 min wall time, ~30 build/check/debug iterations.

## Spec log
Item | Time | Outcome | MCP / record / why / travel | HMR
---|---|---|---|---
1. Inbox | ~4 min | verified view/search/facet/scroll, local pages | yes: `record` showed input→query in 301 ms; `why limit` named scroll; wrapper rejects numeric `seq` | text-only Inbox edit reset limit 60→30, instance 5→14
2. Ticket | ~4 min | verified macro, attachment progress, optimistic reply/fail/retry, internal note | yes: `check` exposed parser/prelude errors; `why outbox` found exact revert/run IDs; `node upload` showed rejects-only | structural edits required reload; no isolated probe
3. Assignment/status | ~3 min | verified conflict, apply compatible, transition | yes: `check` rejected `instanceof` and invalid branch alias; `why overlay` showed rollback (including successful overlay retirement) | structural edits/reload
4. SLAs | ~2 min | verified ticking soon→breached and single dismissible toast | yes: `why notices`; JSON-RPC `travel`/`resume` rewound/restored ticker after wrapper rejected numeric seq | structural edits/reload
5. Realtime | ~3 min | remote reply/assignment/status, typing, dirty draft verified | yes: `why feed` exposed overlapping poll blocker; `record` spanning page reload returned no records | Composer rows=4→5: draft carried 27→58, verified DOM and state/tail
6. Palette | ~3 min | verified keyboard-only goto, macro, assign, status | yes: actionable `FOR_INDEX`; `node hotkey` shows instantiates; no travel | structural edits/reload
7. Bulk | ~3 min | verified progress, #117 partial failure, undo success | yes: actionable stale write/snapshot diagnostics; `node bulkUpdate` confirmed default | structural edits/reload
8. Analytics | ~3 min | chart/metrics/range verified; computation separate lazy chunk, RX view static | yes: `check` found spread and unstable list; `boundary` confirmed route-local regions | config restart/reload; no isolated probe
9. Errors | ~3 min | verified missing/read-only/rate countdown/offline recovery; conflict in #3 | yes: `state` showed thread unobserved when app blank; `why tickets` proved retry landed; browser log needed to identify owned-scope write | structural edits/reload
10. Tests | ~6 min | 5 passing, including live RX mount with dirty draft | `check` stayed green during a later production-only helper failure; test coverage tool not used | shared runtime rebuild disconnected the page; navigation reconnected it

## Language: five observations, biggest win/blocker
1. Biggest win: `guess` + catch reconciled an optimistic reply and its failed/retry representation in one frame; no separate promise lifecycle store.
2. Biggest blocker: simultaneous work ownership is hard to predict. Competing polls joined a feed hold; uploads and bulk needed explicit independent `onFlush` callbacks for progress.
3. `STALE_WRITE_BACK` and prop failure-row checks caught real review risks in bulk undo and a potentially failing `props.selected` snapshot; passing a rendered value and a functional update made intent clearer.
4. JS-looking syntax isn't JS: `instanceof`, direct DOM assignment, call spread, and `Array.from` failed in ordinary-looking imperative code. TS adapters add small but frequent context switches.
5. `key date` on SVG bars was both concise and mandatory; making identity explicit is valuable, but `for x, i` was absent and `from` was a bad source name with an unrelated assignment diagnostic.

## MCP: five observations, biggest win/blocker
1. Biggest win: `why` named the actual competing poll action ID blocking the feed, and identified guess reverts on the failed reply; browser snapshots alone couldn't explain either.
2. Biggest blocker: `check` said `ok` while browser import analysis rejected synthetic `/src/model.d.rx` (also server/browser) and later production rejected redundant helper nesting. Added a serve-only, app-local virtual empty-module shim for generated declaration dependencies; no compiler/plugin edits.
3. `node` made generated contracts inspectable (loadInbox pure + NetworkError, upload rejects-only, bulkUpdate default). Stale entry stamps lingered for nested files after reload, obscuring which graph was fresh.
4. `state` distinguished Composer carried state from Inbox reset; `tail` showed the HMR marker between old/new instances instead of implying an ordinary write.
5. `record` measured debounce directly but lost data over a full reload; timeline is verbose for arrays. Wrapper stringifies `seq`/booleans and cannot express array filters; typed JSON-RPC worked for travel/resume.

## Three changes, ranked
1. Make `check` cover actual dev import analysis and compare production/typecheck contracts; highlight stale or mismatched compiler build revisions prominently.
2. Add concise per-call/per-action trace summaries with result, owner, cause and holds, plus filtered timeline output and type-aware wrapper arguments.
3. Explain HMR `reset` vs `carried` per source, including initializer/effect replays and whether parent boundaries remounted.

## Generated declarations, review, and comparison
- `pure`, `rejects`, `pure(rejects)`, `ref` (input/output), `instantiates`, exported types/error classes and unwrapped defaults all worked in final code. Did not exercise client/server helpers. Early dev accepted guide-style `pure(ref(...))` / `pure(instantiates(...))`; later build required implicit purity (bare helper), while `node` printed bare `fn` for `debounced`. Wanted a way to express “never rejects” for bulk, not a hand-written `.d.rx`; empty `rejects([])` is rejected.
- Review spot 1: Inbox route↔draft bridge. A small edge table with hash ownership, debounce and reset ordering would make the two effects easier to audit.
- Review spot 2: optimistic send + realtime merge + progress. A compact per-message call/write graph with explicit joins and frame boundaries would make settlement and draft isolation reviewable.
- Review spot 3: bulk apply/undo across JS and RX. Show which writes are immediate vs held, which callbacks run on their own frame and which versions an undo is allowed to restore.
- Plain TS + Solid 2 would be faster for DOM interop, splitting the route UI, and knowing which syntax parses. RX saved boilerplate on derived keyed collections, async boundaries, optimistic transitions and traceability; holds and cross-module callback effects still require careful review. No firsthand round 4 comparison; generated TS contracts avoid handwritten declarations when the dev bridge cooperates.

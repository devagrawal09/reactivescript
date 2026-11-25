# Usability round 5: "Dispatch" (support desk with SLAs)

Same rules and report format as ROUND1.md (+ ROUND3/ROUND4 extras). New since round 4: JS/TS modules need NO `.d.rx` — declarations are generated from the `.ts`. RX-only facts are stated with zero-cost helpers from `@reactivescript/js`, nested one way: `export const load = rejects([NotFound, Forbidden], async (id: string) => …)`, `export const fmt = pure((n: number) => …)`, `pure(rejects([E], fn))`, `ref({ args, result }, fn)`; TypeScript infers through them; an unwrapped export is io that may reject with any Error. `import pure`/`fails` on a local .ts import is an error (use the helper).
A small pure prelude (`Math` minus random, `Number`, `String`, pure `Object` statics, `Array.isArray`, `JSON`); a Calls
view on the map (every server/JS call with its cause) and MCP `travel`/`resume` (opt-in). RX's design goal: agents
write it, humans review it — judge it on that.

## App spec
A support desk against a fake server `src/server.ts` (150–900 ms; `?chaos` ~1 in 3 reject; `?slow` ×4). At least 20
`.rx` modules. Write your JS/TS modules as `.ts` using the helpers; do not write any `.d.rx`.
1. **Inbox**: tickets list with saved views (my open, unassigned, breaching soon, all), facets (status, priority, tag,
   assignee) with counts, full-text search (debounced), sort, infinite scroll (pages of 30), URL-backed state.
2. **Ticket**: thread of messages + internal notes, reply composer with macros (templates with `{{customer.name}}`
   placeholders), attachments with upload progress per file (fake `upload(file, onProgress)`), optimistic send with
   per-message retry.
3. **Assignment & status**: assign/claim/unassign, status transitions with allowed-transition rules (typed `Conflict`
   error when another agent changed it first → show a merge prompt), all optimistic.
4. **SLAs**: each ticket has first-response and resolution deadlines; live countdowns; "breaching soon" (< 15 min) and
   "breached" states update without refetching; a breach raises a toast once.
5. **Realtime**: `events(since)` polled every 2 s brings other agents' replies/assignments/status changes; merge into
   the inbox and the open ticket without clobbering a draft reply; "someone is typing" presence per ticket.
6. **Command palette**: ⌘K with fuzzy actions (assign to me, set status, apply macro, go to ticket #), keyboard-only
   flow end to end.
7. **Bulk actions**: multi-select in the inbox → assign/status/tag for up to 100 tickets in batches with progress,
   partial failure report, and undo for the whole batch.
8. **Analytics**: a dashboard page (lazy-loaded) with tickets per day, median first response, SLA compliance %, from
   derived data over a date range; SVG charts.
9. **Errors**: typed `NotFound`, `Forbidden` (read-only ticket), `Conflict`, `RateLimited` (retry-after); anything
   else → a retry box at the nearest sensible boundary; a global "connection trouble" banner after 3 failures.
10. **Tests**: vitest for SLA math, merge of realtime events into a dirty draft, conflict flow, bulk partial failure +
    undo, macro rendering.

Done = `pnpm build`, `pnpm typecheck`, `pnpm test` pass and every item verified in the running app.

## Report extras
- Per item: time; tool helped (yes/no/misled); HMR kept state on your edits (note each time it didn't); time travel /
  Calls view (browser) or record/why/travel (MCP) helped?
- Generated declarations: did brands + defaults work for every helper? any case you wanted a `.d.rx` for?
- "Agents write, humans review": pick the 3 hardest-to-review spots in your own code and say what would make them easier
  to review (language or tooling).
- Compare with plain TS + Solid 2, and with round 4 if you remember it.

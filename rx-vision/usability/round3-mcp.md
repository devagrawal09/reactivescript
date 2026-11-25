# Crew — RX MCP usability run

Started 23:16 local. Existing Vite process on 3122 matched this checkout; reused it.

## Per item (elapsed; MCP helped?; record/why)
1. Boards (~6 min; yes; why partial): verified columns, board/card hashes and Back. `check` caught `.d.rx` declaration grammar; `why route` showed current route but “unknown origin” for the TS adapter. Restarted Vite with `RXC` set after warm `check` could not run rxc.
2. Cards (~15 min including restart; yes; record/why yes): verified optimistic create/edit/member/label/move/reorder and rejected move rollback. The trace shows `revert reverted` and the inline `cardError` together; successful guesses also say `revert superseded`. `why cards` lined up action args/flight, but duplicate column instances shared one `rows` preview. Fresh `check` said ok while Vite still served a stale entry transform; touching `App.rx` recovered.
3. Drawer (~3 min; misled by check; record yes): verified direct hash, details/activity/comments, and optimistic @leo comment under `?slow`. Record measured 252 ms to search flight after input. `check` spuriously parsed `.d.rx` as ordinary modules (runtime accepted them); `rx-tsc` isolated the real generic `createSignal` overload error.
4. Chat (~2 min; yes; record yes): verified append, unchanged scrollTop at top, new badge/jump, immediate send, and rejected send/retry without a duplicate. `record` showed adjacent `poll` starts 2,000 ms apart and cursor advance; cursor still had “unknown origin.”
5. Presence (~1 min; yes; record yes): verified three avatars and Mia fading to “away.” `record` separated the timed `pollPresence` run/land from chat and clock activity without opening the map.
6. Undo (~4 min; yes; record/why yes): verified a sub-500ms optimistic undo on `?slow`, the last five of six moves undoable, and edit undo reflected in activity. `why history` exposed a held/released write after the mutation returned. `STALE_CAPTURE` rejected a local ID projected from a row; final code uses the server’s returned stack.
7. Filters (~2 min; yes; record/why not needed): verified combined URL filters, case-insensitive text, live query changes and 1/2→0/2 counts. `reach route` showed the path to board/filter props but also overstated paths through the generic `props` node.
8. Errors (~2 min; yes; why yes): verified friendly bad board/card screens, chat still live behind failed drawer, archive locks, and successful retry after chaos. `state details` showed `NotFound` while the drawer was blank: its failure was not read because the card guard was false. `why info` also showed unsuccessful retry really re-issued the flight.
9. Offline-ish (~2 min; no; record/why no): verified the banner appeared and cleared during chaos polling. `why trouble` only exposed the initial `false` with “unknown origin,” and `record` omitted the actual external signal changes visible in the DOM.
10. Tests (~1 min; no; record/why N/A): Vitest exercises actual RX move rollback and optimistic undo, chat merge/dedup, and typed errors (including the drawer boundary). Assertions and fake timers were more direct here.

## Outcome
All ten items implemented and verified across headless Chromium and Vitest. 14 app `.rx` modules; `pnpm build`, `pnpm typecheck`, and `pnpm test --run` (4 tests) pass. ~27 min wall clock including service restart; roughly 20 build/debug loops, excluding routine MCP queries. Ten local commits; nothing pushed. Fake server data is page-local and resets on hard reload.

## RX friction (top 5)
1. **Biggest blocker: JS/TS interop.** Without `.d.rx`, type-only `Card`/`Route` imports leaked into Vite output as runtime imports. The declaration syntax diverges from TS (optional argument and `export const` were rejected).
2. `STALE_CAPTURE` rejected even `let id = entry.id` before `await`; passing the primitive separately or returning the full authoritative history avoids this.
3. Cross-component error rows made a simple create action’s `props.disabled` read illegal even though the caller rendered only below an error boundary. Keep the check in the control, not the action.
4. A failed lazy equation does not trip its boundary until someone reads it. `if shown` on a nonexistent card silently skipped the failed detail; `if details && shown` fixed it.
5. Holds are hard to predict once chat/presence and card history coexist. Under `?slow`, the undo affordance appeared seconds after the write action reported `run end`; `why` exposed `history held` then `released`.

**Biggest RX win:** one `guess` plus the authoritative answer gave the move, edit, comment and undo immediate feedback and automatic rollback, with no parallel list of pending card operations.

## MCP friction / wins (top 5)
1. `check` was not equivalent to build in this checkout. It first required `RXC` in **Vite’s** environment, then misparsed valid `.d.rx` declarations while Vite and `rx-tsc` passed; static tools printed misleading error banners.
2. `record` was the fastest proof of rejected move mechanism: `revert reverted`, inline error and action end together. On success `revert superseded` is technically distinct, but easy to misread as a failed save.
3. `why history` explained why an undo button wasn’t visible when the server had returned. It reported held/released, but not the exact reader/flight keeping it held.
4. `state details` immediately located the typed error behind a blank drawer; `boundary` listed the regions, but did not say “not tripped because this failed value has no live reader.”
5. Live values collapse repeated instances (`rows` previews all showed Done) and external signals (`Connection.trouble`) missed real changes. `reach` across component props was useful but too broad at field level.

## Highest-value changes, ranked
1. Make warm `check` run the exact Vite/RX entry and declaration pipeline; flag stale graph/entry transform separately and give the exact launch fix for missing `RXC`.
2. Add an actionable `why` chain for held writes and untripped failures: specific blocking reader, instance, boundary, flight/action, and timing.
3. Give live keys instance selectors and track `.d.rx` `ref` edges; add key/instance filtering to `record` so the useful events don’t disappear in timer and polling noise.

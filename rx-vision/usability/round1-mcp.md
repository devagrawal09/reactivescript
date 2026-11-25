# Round 1 — MCP (Shelf)

## Outcome

Incomplete. Shelf is written (`src/App.rx`, `src/components/Book.rx`, `src/api.ts`: 600ms `load`, `?fail` throws, `save` 400ms and ~1/4 `Error("save failed")`, optimistic `guess` add/toggle, filter chips, search, counts, retry action) but does not run. `pnpm typecheck` passes after two local fixes (`aria-pressed` stringified; `src/map-vite.d.ts` for a pre-existing missing `@reactivescript/map/vite` declaration). `pnpm build` fails `ASYNC_OUTSIDE_LOADING_BOUNDARY` at `src/App.rx:124` — `{if pending? books}` in the errored fallback, outside `loading`. `vite --port 3102` hit that error in the dep scan and then `SIGSEGV`. No page, so add, rollback, filter/search, counts, and `?fail` retry were never verified in the browser. `src/App.test.ts` still asserts the deleted demo. ~90 min. 2 compile iterations, ~10 static MCP calls, 0 live loops.

Static tools, before I was stuck, could say: `books` is a question source; `addBook`/`toggleRead` write it optimistic + affects + refresh; `shown`/`total`/`unread` read it; the errored boundary is notified by `books`. They could not say the program is illegal, which reader is outside `loading`, or any runtime value. `value` / `why` / `tail` / `pending` / `live_status` never ran.

Midway toolchain update (`./api` import fixes, new `state` tool, wrapper plain-text + exit 1) did not reach this session. `from "./api"` already resolved in overview. My `--list` had no `state`. Live tools were already blocked by the crash.

## RX friction

1. `pending? books` in the errored fallback (I wanted "Retrying…" during quiet `refresh`) is `ASYNC_OUTSIDE_LOADING_BOUNDARY`. The diagnostic says `a reader of …`, not the name. Legal shape is `loading on(k)` above `errored` (H-12); I had inverted it.
2. Page shape is the boundary's. Add/toggle must sit under `loading` (`GUESS_WHILE_LOADING`), so counts and the form cannot stay up on first load.
3. A save error must be written twice (plain write + `onFlush`) or the clear-on-start `onFlush` eats it. Copied from `async.md`, never verified.
4. `aria-pressed={bool}` fails `rx-tsc` (boolean vs `EnumeratedPseudoBoolean`). `check` did not mention it.
5. No `String`/`console`, no loops. Path-guess index is a snapshot `findIndex` inside the action; the guide says compute it in the handler. Unresolved which the checker wants.

## Tool: wins and friction

1. Win: `node key=src/App.rx|App|books` (1.3s) was the one call that paid. `marks=pending,question`, readers (`shown`, `total`, `unread`, both `pending?` readers), writers (`addBook` optimistic/affects/refresh, same for `toggleRead`, `retryLoad` refresh). Confirmed the add was wired to the list and counts before any run.
2. Win: `boundary` on `src/App.rx|/component:App/errored` named `books` as the notifier via the loading reader. `overview` (11s cold, then ~1.5s) handed out those keys. `find query=books` was instant and exact.
3. Miss, and why I stopped: `check` returned `ok` (3.1s) on the program `vite build` rejected. I trusted it and spent the rest of the session tracing a program that cannot mount. Live tools never got a page.
4. Miss: the wrapper splits args on spaces. `reach key=…|prop:Book book` returned `Invalid parameter format: book` (JSON blob, exit not signaled). Generated keys contain spaces (`prop:Book book`), so the Book prop was unqueryable. This was before the wrapper's plain-text/exit-1 change.
5. Miss: `node` leads with `reads: none` / `writes: none`, then lists `read-by` / `written-by`. `diff` listed added sources and actions and removed the demo, but not the new loading/errored boundaries — the thing I was checking had landed.

## Tool changes, ranked

1. `check` must emit the same diagnostics as `vite build`, and name the reader (`pending? books` at line 124, not `…`). That was the whole stuck point.
2. Quote wrapper args. Keys with spaces are unusable. Exit 1 on tool errors (landed after I stopped) would have made the miss obvious instead of a JSON line that still looked like output.
3. Don't require a healthy page to see "this reader is outside loading / this node has no value yet." `state` showed up after the server had already crashed; I never got to try it.

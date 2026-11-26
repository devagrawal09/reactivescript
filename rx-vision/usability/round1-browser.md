# Round 1, browser (visual Map): "Shelf"

App: `<workspace>/rx-r1-browser` (3 local commits). Screenshots were kept locally, not published.

## Outcome
- Everything works and was checked in the running app: load + loading state, optimistic add with rollback and an error
  message (the first add happened to fail: 20→21), toggle with rollback (25→26), a successful add that stays after the
  refresh (36a/b), all/unread/read chips and case-insensitive search (33, 34, 35), "No books match" (43), counts,
  `?fail` showing the errored state, and Retry recovering (37b, 40a/b). `pnpm build` and `pnpm typecheck` pass.
- `?fail` fails only the **first** `load()`. If it failed every time, Retry could never be seen to work.
- I removed the template's demo test (`App.test.ts`), which tested the old demo, and didn't write new tests.
- Time: about 25 min, from reading the brief to the last check. 4 build/debug iterations (2 compile errors, 2 runtime traps).

## Top 5 RX language friction points
1. **A JS module named `./api` is silently replaced by a test-harness stub.** `import pure { load } from "./api"` compiled
   to `__rt.api("load")`, which with no `opts.api` is a "flight" that never resolves. The app sat on "Loading books…"
   forever with no error from the compiler, typecheck or console (03, 14). I only found it by reading the compiled JS.
   The fix was renaming the file to `server.ts`. This was the biggest time sink.
2. **A type import is emitted as a value import.** `import { save, Book } from "./server"` failed at run time
   ("does not provide an export named 'Book'"). `rx-tsc` passed it, and there is no `import type`. I worked around it by
   declaring `type Book` in `Book.rx`, so the type now lives in two places (`server.d.rx` and `Book.rx`).
3. `STALE_OWN_READ`: in `toggle`, I read `books[i]` after `guess books[i].read`. The message was clear, and I fixed it by
   passing the row in. But the guide says "pass actions plain values, not rows", and the checker accepted the row anyway.
4. There are several kinds of write to choose between: `guess`, `onFlush`, plain, and writing an error "both ways".
   The async guide covers it well, but it takes a careful read before the first action.
5. Retry is quiet (`refresh` doesn't set `pending?`), so Retry gives no feedback for 600 ms. To show
   "retrying…" you have to learn `affects` and `loading on(...)`.
- Tooling outside RX: `vite.config.ts` doesn't typecheck because `@reactivescript/map/vite` ships no types. I added
  `rx-map-vite.d.ts` to get past it.

## Tool (Map view): friction and wins
1. **Win: shows the data flow clearly.** Clicking `books` (09) listed READ BY (shown, total, unread, BookRow onToggle with
   tracked/snapshot labels), WRITTEN BY (add guess/refresh, toggle guess (path)) and CALLS load. That answered "what does
   an optimistic add touch?" before I had clicked anything. Clicking `errored` (39) showed "can fail from books", which
   answers what can trigger that boundary.
2. **Win: live values on the chips during an add or toggle.** In 21, `total 5→4`, `unread 4→3` and the `saveError` text
   ring as the add rolls back. In 31c, the amber glow on `books` during the refresh after a save was clear. In 41, "changed
   5× … by click on button Retry" was a nice causal hint.
3. **Friction: it couldn't help with the one real bug (the stuck load).** `books` was striped with an amber mark (08),
   but per the guide those are static "can be pending" marks. "Live value: No change seen since the map opened" (13).
   Nothing said whether `load` was called, still in flight or never started, and the `load` chip looked like a normal JS
   call (no sign it was a stub). I had to add `console.log` and read the compiled JS.
4. **Friction: no live state for boundaries or actions.** With `?fail` the page showed the errored fallback, but the
   `errored` frame and `books` chip looked the same as when healthy (38). During the 400 ms `save` nothing on the map was
   lit (27b), and the guide confirms actions are never lit. So "is my save in flight?" can't be answered here. The
   OPTIMISTIC_REVERTED event showed up only under Health (32), not on the map.
5. **Friction: values and layout are confusing.** The `books` chip and "Live value" show one row (`{id:"b4",…}`) rather
   than the list (41). Errored fallback sites (L77/L78) are drawn in the component's row, outside the errored frame. In a
   half-height dock (the only way to see the app beside it), traces run off-screen (42). Switching to Health and back
   reset the map's scroll and its flush counter (33). The dock opens on Activity, so Map is 3 clicks away each session.

## The 3 changes that would have saved the most time
1. **Show live state, not only changes since the map opened.** Each question should show "in flight since Xs / never
   asked / answered / failed (message)" right away, and each boundary "showing fallback now". That would have found the
   stuck load in one click instead of ~8 minutes in the compiled JS.
2. **Light up actions and their io calls while they run** (`toggle` → `save` in flight, then the guesses held or
   reverted), and put Health's revert/error events on the chips they name.
3. **Show the whole value of keyed collections** (a count plus an expandable list of rows), and mark JS imports that
   resolve to the harness `api` stub instead of a real module.

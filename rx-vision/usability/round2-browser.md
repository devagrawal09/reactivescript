# Round 2 — Tracker — browser (Map view) tester

**Outcome:** all 10 spec items work and were verified in the running app (headless Chromium, 1440×900, screenshots in
kept locally, not published). `pnpm build`, `pnpm typecheck` and `pnpm test` (6 vitest tests) all pass. App:
`<workspace>/rx-r2-browser`, 8 `.rx` modules (App, data, Sidebar, IssueList, CreateIssue, IssueDetail, Comments, ServerBadge)
plus `server.ts`/`browser.ts` with `.d.rx`, 5 local commits. **Time:** 19:44 → 20:03 to done-and-verified (~20 min), plus a
late fix. **Late:** after the linked `rx-integ` builds changed (~20:35), all 6 tests fail on the *old* passing commit too
("createComponent: expected a component function but got undefined"); build/typecheck still pass. **Iterations:** 6 builds, 4 typechecks (2 red),
2 test runs, 5 fix/debug loops.

## Per spec item (relative effort · did the tool help?)
1. Sidebar + hash routing, back/forward: small · **yes**. The `route`/`projectId` chips showed the parsed hash live.
2. List, filter, debounced search, pages, dimmed reload: medium · **yes**. The trace `qInput → q → filterKey → page → issuePage`
   goes through the JS debounce. It **missed** the held filter chip (see bottom).
3. Detail + separately loaded comments: small · no (the screenshot said it all).
4. Optimistic edit in row + detail, rollback: medium · **yes**. The `projects` panel said "a request is in the air ·
   changed 1× by action" mid-edit, and an `editError` chip exposed a bug (bottom).
5. Create, identity kept: small · no (DOM mark; the map can't show remounts). 6. Counts: small · partly (writers listed).
7. NotFound vs retry: medium · **misled**. The map shows IssueDetail's *outer* generic `errored (e)` labelled
   `e: NotFound | NotFoundHere`, the same as the inner one, but at runtime the outer correctly catches ServerError.
8. Badge: small · **yes** (Health flagged SILENT_HOLD on the poll → `pending? stats` dot). 9. n/a. 10. Tests: small · no.

## Top 5 RX language friction
1. **rx-tsc narrows a source inside its own `{if open {…}}`**: `open := false` there is TS2345 "'false' is not assignable
   to 'true'". Worked around with a component `action setOpen(v)`. Also `source open := false` infers type `false`.
2. **rx-tsc reads the `.ts`, not the `.d.rx`**. A `ref` param/result becomes `Accessor<string>` vs `string` (4 errors).
   Worked around by re-exporting `createX as unknown as (s: string) => string` in `browser.ts`.
3. **`e.currentTarget.value as Status` in a handler** gives a misleading `JS_LOCAL` pointing at the `let` two lines
   up ("`let` declares a local only in a handler…"), which *is* in a handler. Replaced it with a `toStatus` fn.
4. **No null narrowing into handlers**: under `{if detail != null {…}}`, a handler still sees `detail` as possibly null.
   Needed `let d = detail; if (d == null) return`.
5. **Held writes are silent until you look**: the clicked status chip stayed on "open" until `listIssues` landed (needs
   `latest status`). Also, a component's `<style>` doesn't reach a second component in the same file (`Row` was unstyled).

## Top 5 tool wins / friction (each with a moment)
1. **Win: value chips after a change.** On issue #50 the dock map showed `editError "updateIssue: serv…"`, an error from
   #45. That exposed my module-level error source leaking across issues. Fixed by keying errors to issue/project.
2. **Win: trace + panel.** A second click on "what it affects" drew the full chain through a JS primitive. The
   "written by" list (`editIssue guess`, `refresh`, `button onClick refresh`) confirmed the guess/refresh shape.
   Minimap click-to-jump was the only fast way to move around.
3. **Friction: failures are invisible.** With "Couldn't load issues" on screen (a failure that happened *while* the
   popout watched), IssueList's `errored (e)` looked the same as healthy, and so did the `projects`/`stats` tokens. The
   panel never mentions an error, and boundary chips can't be clicked.
4. **Friction: the popout is fragile.** It (a) froze for good once the dock left the Map tab (stuck at "29 flushes"),
   (b) went silently stale after the app reloaded, still saying "live" while showing `projectId "web"` with the app on
   api, and (c) ↗ did nothing after closing a popout, until a page reload.
5. **Friction: no values on open, and clumsy navigation.** Opening `issuePage`/`projects` said "No change seen since the
   map opened" even though both were loaded. The wheel zooms instead of scrolling. Fit gave a 10% two-column strip on a
   1440px window, and zooming stays blurry for ~1 s. "/" search highlights a match but Enter doesn't open it.
   Time-travel said "can't travel to #27: unsupported", as the brief warned.

## 3 tool changes that would have saved the most time
1. **Show runtime state on the static map**: a tripped boundary filled with its error message, failed tokens marked,
   values on open, and a "held: waiting on issuePage" badge on a written-but-held source. This would have caught both
   the chip lag and the errored state at a glance.
2. **Robust popout**: stream independently of the dock tab, reconnect after reload, say "disconnected" not "live".
3. **Navigation**: wheel scrolls (ctrl+wheel zooms), fit-to-width, and search Enter selects the token into the panel.
**Found fastest by the tool:** the `editError` leak (item 4), via a dock value chip. **Should have found but didn't:** the held `status` write behind `listIssues` (chip lag). I found it from an app
screenshot taken 70 ms after the click. The map had no held/pending mark on `status`. Nor did it flag
`LOADING_ON_OUTSIDE_HOLD` (Comments' `loading on(props.issue)` keyed on `detail`); only the vite terminal had it.

# S-ai2-search — search with a detail pane, four modules

Rules exercised: E-11, ST-4, R-1, R-9, R-f-1, R-f-3, R-f-4, R-f-5, H-2, H-3,
H-5, H-6, H-7, H-9, H-12, AC-1, AC-4, RG-1, RG-2a, MO-2a.
Solid scenario mirrored (holds only): none directly. Instants 4 and 8 have the shapes of S-solid-24 (lane header beside a held list) and S-ai-grid (`loading on(…)` re-arm).

## Program

file: ../examples/ai2/search/main.rx

## Frames

| instant | action | frame | effect / probe verdicts |
| ------- | ------ | ----- | ----------------------- |
| 0  | mount | `pick a result` | — |
| 1  | handler `setQuery("a")` | `too short: a pick a result` | `pending? results` false |
| 2  | handler `setQuery("ap")` | `searching… too short: a pick a result` | `pending? results` true |
| 3  | resolve "search:ap" [{"id":1,"name":"apple"},{"id":2,"name":"apricot"}] | `2 results for ap apple apricot pick a result` | `pending? results` false |
| 4  | handler `setQuery("app")` | `searching… 2 results for app apple apricot pick a result` | `pending? results` true; `latest query` "app" |
| 5  | resolve "search:app" [{"id":1,"name":"apple"},{"id":3,"name":"applesauce"},{"id":4,"name":"apple pie"}] | `3 results for app apple applesauce apple pie pick a result` | `pending? results` false |
| 6  | handler `select(4)` | `3 results for app apple applesauce > apple pie loading…` | — |
| 7  | resolve "fetchItem:4" null | `3 results for app apple applesauce > apple pie item 4 not found` | — |
| 8  | handler `select(3)` | `3 results for app apple > applesauce apple pie loading…` | — |
| 9  | reject "fetchItem:3" "timeout" | `3 results for app apple > applesauce apple pie failed: timeout retry` | — |
| 10 | handler `retry()` | `3 results for app apple > applesauce apple pie failed: timeout retry` | `pending? item` false (re-ask is quiet) |
| 11 | resolve "fetchItem:3" {"id":3,"name":"applesauce","blurb":"stewed apples"} | `3 results for app apple > applesauce apple pie applesauce stewed apples` | — |

- 0: `query` is `""`, so `if query != ""` mounts nothing and `results` is `[]` with no fetch (E-11). `selected` is null, so the pane shows its prompt. The input has no text.
- 1: The branch mounts. `results` takes the `throw TooShort("a")` arm with no `await`, so it fails at once (R-f-3). The typed `errored fallback(e: TooShort)` shows the hint (R-f-4). The `pending?` line is empty (an error is an answer, so the verdict is false).
- 2: `results` now awaits `search:ap`. The TooShort boundary is on its fallback and stays there while the content under it is pending (H-12), so the old hint `too short: a` stays up. The readers behind it hold nothing (H-4), so the instant commits. `pending? results` is a probe and shows `searching…` now (H-7, H-9). `results` has a committed value (the error), so this is not a first load (R-9).
- 3: The landing replaces the error, so the boundary leaves its fallback. The inner `loading` never showed content, but its readers now have values, so the content shows. The verdict is final at commit, so it reads false (H-9).
- 4: `count` and the `for` are plain readers of pending `results` under a disarmed `loading`, so they forward into the hold (H-6) and keep `2` and the old rows. `{latest query}` and `pending? results` are lane readers and show ahead: `app` and `searching…` (H-7). This is requirement 2: the list is dimmed, the count lags, and the header shows the typed query.
- 5: The hold commits as one frame. The list is reconciled by `key id`, so row 1 keeps its region (ST-4a), row 2 leaves, and rows 3 and 4 are created.
- 6: `select` has no `await`, so its change is plain (AC-1 has nothing to hold). The `else` branch mounts a fresh, armed `loading`. It catches the pending `item.name`/`item.blurb` readers and shows `loading…` (H-5), so nothing holds the click and the row marker moves now.
- 7: `fetchItem` lands `null`, and `found` throws `NotFound(4)`. The armed `loading` has no pending reader left, so it shows content. The inner typed boundary takes the error.
- 8: `loading on(selected)` re-arms (H-6). The `for id in [selected]` row is replaced, so the old NotFound boundary ends and a fresh one mounts (RG-2a, O-2). Its readers are pending on `fetchItem:3`, so the fallback shows `loading…`. The results list only moves its marker.
- 9: The rejection is an `Error`. The armed `loading` shows content, the inner `NotFound` boundary passes `Error` up (R-f-4), and the outer `fallback(e)` shows the message and the retry button. The list is untouched.
- 10: `retry()` is `refresh item`: a quiet re-ask under the same key (AC-4). The error stays the display through the retry (H-12), and readers behind the fallback hold nothing, so the frame is unchanged.
- 11: A value replaces the error, so the outer boundary leaves its fallback and the item shows (H-12). Whether the retry action's change was still open (AC-4: staged into it) or not, it commits with this landing.

## Divergences

- oracle "Frames" instant 2: `too short: a pick a result` — DV-8, not fully fixed by solidjs/solid#4280: after the projection's memo has failed, its re-ask reports no `pending?` through the projection (a plain memo does: no `key` shows `searching…`).
- oracle "Frames" instant 4: `2 results for app apple apricot pick a result` — DV-8: no `searching…`, the projection reports no pending verdict for its memo's re-ask.
- oracle "Frames" instant 5: `2 results for app apple apricot pick a result` — DV-18: since solidjs/solid#4280, a keyed projection's row readers miss every landing after the first, so the list and the count keep the `ap` rows (`ref/oracle/repros/dv18-projection-relanding.mjs`)
- oracle "Frames" instant 6: `2 results for app apple apricot loading…` — DV-18
- oracle "Frames" instant 7: `2 results for app apple apricot item 4 not found` — DV-18
- oracle "Frames" instant 8: `2 results for app apple apricot loading…` — DV-18
- oracle "Frames" instant 9: `2 results for app apple apricot failed: timeout retry` — DV-18
- oracle "Frames" instant 10: `2 results for app apple apricot failed: timeout retry` — DV-18
- oracle "Frames" instant 11: `2 results for app apple apricot applesauce stewed apples` — DV-18

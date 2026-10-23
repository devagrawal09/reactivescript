# S-ai-grid — a data grid: keyed rows, deferred fetch, `on(page)` boundary, selection

Rules exercised: H-1 (deferred), H-5/H-6 (`loading on(page)`), ST-4 (key), R-9/H-9 (`pending?`),
RG-2a/RG-2c (a region per page, row-local declarations), AC-1 (action with no await), EF-2.

## Program

file: ../examples/ai/grid.rx

## Frames

| instant | action | frame | effect |
| ------- | ------ | ----- | ------ |
| 0 | mount | `0 selected name* age Loading page 1… prev next` | log(sel, 0) |
| 1 | resolve "fetchRows:1,name" { rows: [{ id: 1, name: "ann", age: 30 }, { id: 2, name: "bob", age: 25 }], total: 5 } | `0 selected name* age ready [ ] ann (30)[ ] bob (25)Page 1 of 3 (5 rows) prev next` | — |
| 2 | handler `query := "b"` | `0 selected name* age ready [ ] bob (25)Page 1 of 3 (5 rows) prev next` | — |
| 3 | handler `toggle(2)` | `1 selected name* age ready [x] bob (25)Page 1 of 3 (5 rows) prev next` | log(sel, 1) |
| 4 | handler `query := ""` | `1 selected name* age ready [ ] ann (30)[x] bob (25)Page 1 of 3 (5 rows) prev next` | — |
| 5 | handler `sortBy := "age"` | `1 selected name age* updating [ ] ann (30)[x] bob (25)Page 1 of 3 (5 rows) prev next` | — |
| 6 | resolve "fetchRows:1,age" { rows: [{ id: 2, name: "bob", age: 25 }, { id: 1, name: "ann", age: 30 }], total: 5 } | `1 selected name age* ready [x] bob (25)[ ] ann (30)Page 1 of 3 (5 rows) prev next` | — |
| 7 | handler `page := 2` | `1 selected name age* Loading page 2… prev next` | — |
| 8 | resolve "fetchRows:2,age" { rows: [{ id: 3, name: "cat", age: 40 }, { id: 4, name: "dan", age: 35 }], total: 5 } | `1 selected name age* ready [ ] cat (40)[ ] dan (35)Page 2 of 3 (5 rows) prev next` | — |
| 9 | handler `toggle(3)` | `2 selected name age* ready [x] cat (40)[ ] dan (35)Page 2 of 3 (5 rows) prev next` | log(sel, 2) |
| 10 | handler `pageSize := 3` | `2 selected name age* ready [x] cat (40)[ ] dan (35)Page 2 of 2 (5 rows) prev next` | — |

Each page is its own region (`for p in [page]`), and the `deferred` fetch is declared in it.
Instant 0: the first load holds like any; the armed boundary catches the readers under it
(H-5), so the mount commits with the fallback. Instant 2: the search is a synchronous filter
over the keyed rows. Instant 5: a re-ask of the deferred holds nothing (H-1): the sort write
shows now, the rows stay, `pending? data` is `true`. Instant 6: the landing is its own change;
the keyed reconcile moves row 2 above row 1 and keeps its selection (ST-4). Instant 7: a new
page is a new region whose fetch is a first load; `on(page)` re-armed the boundary, so the
born-pending readers are caught and the fallback shows with the page write's frame (H-6); the
pager outside shows at once. Instant 8: the landing commits the new page's content. Instant 10:
the page size only changes the page count.

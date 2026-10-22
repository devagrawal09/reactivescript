# S-solid-16 — a reset ends the hold on writes only its readers observed; an outside reader keeps it (Solid S-16; D-14)

## Program

```
source page := 0
source count := 0
pageData = await fetch("pg:" + page)
details = await fetch("d:" + pageData + ":" + count)
<div>{loading on(page) fallback { <p>Loading...</p> } { <p>Details {details}</p> }} <p>Sum {page + count}</p></div>
```

## Frames

| instant | action                      | frame                       |
| ------- | --------------------------- | --------------------------- |
| 0       | mount                       | `Loading... Sum 0`          |
| 1       | resolve pageData 0          | `Loading... Sum 0`          |
| 2       | resolve details "d(0,0)"    | `Details d(0,0) Sum 0`      |
| 3       | handler `count := 1`        | `Details d(0,0) Sum 0`      |
| 4       | handler `page := 1`         | `Loading... Sum 2`          |
| 5       | resolve pageData 1          | `Loading... Sum 2`          |
| 6       | resolve details "d(1,1)"    | `Details d(1,1) Sum 2`      |

Instant 3: `details` re-asks under the shown boundary — forwarded, held.
Instant 4: the reset puts `details`' only reader behind the fallback; the
`count = 1` hold is over, `page = 1` joins and commits with it, one frame.
The boundary alone waits.

## Variant: an outside reader keeps the hold

```
source page := 0
source count := 0
pageData = await fetch("pg:" + page)
details = await fetch("d:" + pageData + ":" + count)
<div>{loading on(page) fallback { <p>Loading...</p> } { <p>Details {details}</p> }} <p>Outside {details}</p> <p>Sum {page + count}</p></div>
```

| instant | action                      | frame                                        |
| ------- | --------------------------- | -------------------------------------------- |
| 0       | mount                       | ``                                           |
| 1       | resolve pageData 0          | ``                                           |
| 2       | resolve details "d(0,0)"    | `Details d(0,0) Outside d(0,0) Sum 0`        |
| 3       | handler `count := 1`        | `Details d(0,0) Outside d(0,0) Sum 0`        |
| 4       | handler `page := 1`         | `Details d(0,0) Outside d(0,0) Sum 0`        |
| 5       | resolve pageData 1          | `Details d(0,0) Outside d(0,0) Sum 0`        |
| 6       | resolve details "d(1,1)"    | `Details d(1,1) Outside d(1,1) Sum 2`        |

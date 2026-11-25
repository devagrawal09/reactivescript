# S-arms-run-3 — `errored fallback(e) { arms }`: the selected arm owns the fallback

Rules: R-f-4, H-12, RG-1b, R-f-10. `./api` has only a declaration, so the
runners supply the flights (MO-8c) and reject with the class a row names.

## Modules

```rx
-- module: ./api.d.rx
export error Conflict
export error Stale
export error Offline
export pure fn load(id: number) rejects(Conflict | Stale | Offline)
```

## Program

```rx
import { load, Conflict, Stale, Offline } from "./api"
component Counter(props) {
  source clicks := 0
  <p>{props.label} {clicks}</p>
}
export default component App() {
  source id := 1
  source boom := false
  value = await load(id)
  crash = boom ? fail("boom") : ""
  errored fallback(e) { <p>outer: {e.message}</p> } {
    errored fallback(e) {
      Conflict => { <Counter label={e.message} /> }
      Stale => { <p>stale: {e.message}</p> }
      Offline => { {throw e} }
    } {
      <p>{value}{crash}</p>
    }
  }
}
```

The inner boundary has no `_`: it covers the row `load` declares. Its
`Offline` arm fails, and that failure goes to the outer boundary.

## Frames

| instant | action                           | frame       |
| ------- | -------------------------------- | ----------- |
| 0       | mount                            | ``          |
| 1       | resolve value "A"                | `A`         |
| 2       | handler `id := 2`                | `A`         |
| 3       | reject value Conflict("c1")      | `c1 0`      |
| 4       | handler `clicks := 1`            | `c1 1`      |
| 5       | handler `id := 3`                | `c1 1`      |
| 6       | reject value Conflict("c2")      | `c2 1`      |
| 7       | handler `id := 4`                | `c2 1`      |
| 8       | reject value Stale("s1")         | `stale: s1` |
| 9       | handler `id := 5`                | `stale: s1` |
| 10      | reject value Conflict("c3")      | `c3 0`      |
| 11      | handler `id := 6`                | `c3 0`      |
| 12      | reject value Offline("o1")       | `outer: o1` |

Instant 6: another `Conflict` keeps the `Conflict` arm's region — its
`clicks` stays 1 — and its `e` follows (`c2`). Instant 8: `Stale` selects
another arm, which replaces the region. Instant 10: back to `Conflict`, a
fresh region: `clicks` is 0 again (RG-1b). Instant 12: the `Offline` arm
fails; the failure goes to the enclosing boundary, not to another arm.

## Variant: a failure no arm takes passes to the enclosing boundary

| instant | action                 | frame         |
| ------- | ---------------------- | ------------- |
| 0       | mount                  | ``            |
| 1       | resolve value "A"      | `A`           |
| 2       | handler `boom := true` | `outer: boom` |

`fail` is a panic (R-f-10): outside the declared row, so no class arm takes
it, and this boundary has no `_`. It passes to the outer boundary, as any
unmatched failure does at run time.

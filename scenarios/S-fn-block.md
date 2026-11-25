# S-fn-block — declarations in a block fn instantiate

Rules: E-9, E-10. Declarations in a block `fn` belong to the
instantiation. An arrow with a value expression needs no snapshot.

## Program

```rx
fn size(xs: number[]) => xs.length
export default component App() {
  source xs := [1, 2]
  <p>{size(xs)}</p>
}
```

## Frames

| instant | action | frame |
| --- | --- | --- |
| 0 | mount | `2` |

## Rejected

```rx
-- reject: SNAPSHOT_ARGUMENT
fn total(xs: number[], k: number) {
  fn twice(n: number) => n * 2
  base = xs.length
  twice(base) + k
}
export default component App() {
  source xs := [1, 2]
  n = total(xs, 1)
  <p>{n}</p>
}
```

```rx
-- reject: SNAPSHOT_ARGUMENT
fn first(id: number) {
  rows = await fetch(id) catch (e) => ""
  rows
}
export default component App() {
  source id := 1
  row = first(id)
  <p>{row}</p>
}
```

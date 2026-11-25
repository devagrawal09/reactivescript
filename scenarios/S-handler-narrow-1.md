# S-handler-narrow-1 — A handler reads a snapshot, so a view branch does not narrow it

Rules exercised: 13 TY-2. A read in a handler is taken when the handler runs,
not when the view branch was chosen. The branch may no longer hold, so
narrowing the handler's read would be unsound. Snapshot it and narrow the
local.

## Program

```rx
type Item = { id: number }
export default component App() {
  source detail: Item | null := null
  {if detail != null {
    <button onClick={() => {
      let d = detail
      if (d == null) return
      d.id
    }}>{detail.id}</button>
  }}
}
```

`{detail.id}` is a read of the branch, re-checked while the branch is live, so
it is narrowed. The handler snapshots `detail` into `d` and narrows that: `d`
does not change before the read.

## Frames

| instant | action | frame |
| ------- | ------ | ----- |
| 0       | mount  | ``    |

## Rejected variants

```rx
-- types: TS18047
type Item = { id: number }
export default component App() {
  source detail: Item | null := null
  {if detail != null {
    <button onClick={() => { detail.id }} />
  }}
}
```

The handler still sees `detail` as `Item | null`. Narrow it after a snapshot:
`let d = detail; if (d == null) return`.

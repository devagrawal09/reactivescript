# S-source-write-1 — A source's type is its widened type, and a write checks that

Rules exercised: 13 TY-2. A source is written later, so its initializer's
literal is not its type, and a branch that narrows a read does not narrow
what a write may store.

## Program

```rx
export default component App() {
  source open := false
  {if open { <button onClick={() => { open := false }}>close</button> }}
  <button onClick={() => { open := true }}>{open ? "y" : "n"}</button>
}
```

`open` is a boolean: `false` says what it starts as, not what it may become.
Inside `{if open}` the read is `true`, and `open := false` is still a boolean
write — the branch does not change the source's type.

## Frames

| instant | action                 | frame |
| ------- | ---------------------- | ----- |
| 0       | mount                  | `n`   |
| 1       | handler `open := true` | `closey` |
| 2       | handler `open := false` | `n`  |

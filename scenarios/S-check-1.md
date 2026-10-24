# S-check-1 — the checker: what it accepts, and one program per diagnostic

Rules: 08 CN-1..CN-5, and every rule a code below cites.

The program is built from near-misses: each line is something a too-eager
checker would refuse. Every rejected variant below is refused by the
checker, statically, before the program runs.

## Program

```
import pure { len } from "./prelude"

source items := [1, 2]
source notes := []
source handlers := []
source mode := true

total = len(items)
a = mode ? 1 : (pre a -> 0)              // C-1: an equation's own `pre` breaks the cycle
fn twice(x) => x * 2 + total             // a fn may read module state; it stays pure
cb = () => total                         // a closure created in reactive scope: pure (SC-3)
action note(n) { notes := xs => [...xs, n] }

context panel: string                   // RG-7: a declared context
component Panel(props) {
  provide panel = props.label
  <section>{props.children}</section>
}
component Badge(props) {
  label = use panel                      // RG-7b: provided by Panel, read through Panel's children
  <b>{label}{props.n}</b>
}

<div>
  <Panel label="P"><Badge n={twice(1)} /></Panel>
  {for i in items {
    source hits := 0
    <i onClick={() => { hits := hits + 1; note(hits); handlers := [...handlers, () => total] }}>{i}:{hits}</i>
  }}
  <p>{a} {cb()} {len(notes)}</p>
</div>
```

In the row handler: storing the *value* of `hits` is never an escape;
storing a closure over `total` (module-level) into a module-level source is
not one either (O-3).

## Frames

| instant | action                 | frame              |
| ------- | ---------------------- | ------------------ |
| 0       | mount                    | `P41:02:01 2 0` |
| 1       | handler `mode := false`  | `P41:02:01 2 0` |
| 2       | handler `note(7)`        | `P41:02:01 2 1` |

Instant 1: `a`'s own `pre` is the value it is replacing, `1` (C-2).

## Rejected variants

```
-- reject: DUPLICATE_DECLARATION
source x := 1
x = 2
<p>{x}</p>
```

```
-- reject: CYCLE
source m := true
a = m ? b : 1
b = m ? 2 : a
<p>{a}</p>
```

The branches are exclusive and no run closes the cycle; the static graph is
the union of branches and refuses it (CN-3a).

```
-- reject: CYCLE
source s := 1
a = pre b
b = a + 1
<p>{b}</p>
```

`pre` of *another* node is an input of it (C-2): only an equation's own
`pre` breaks a cycle.

```
-- reject: PRE_OF_NON_REACTIVE
fn f(x) => x
y = pre f
<p>{y}</p>
```

```
-- reject: ROW_NARROWER_THAN_INFERRED
source id := 1
user: lane string = await fetch("u:" + id)
<p>{user}</p>
```

The written row says `lane` only; the value is also `pending` (CN-4a). Rows
are checked only when written.

```
-- reject: UNBOUND
component Row(props) { <p>{caption}</p> }
component List(props) {
  caption = "hi"
  <Row />
}
<List />
```

`Row` sees its declaration site, not its caller (RG-7a).

```
-- reject: UNKNOWN_COMPONENT
<Nope />
```

```
-- reject: ACTION_CALLED_IN_OWNED_SCOPE
source n := 1
action bump() { n := n + 1 }
x = bump()
<p>{x}</p>
```

```
-- reject: IO_IN_FN
import { log } from "./prelude"
fn noisy(v) => log(v)
source n := 1
<p>{noisy(n)}</p>
```

```
-- reject: REACTIVE_WRITE_IN_OWNED_SCOPE
source n := 1
reset = () => { n := 0 }
<p>{n}</p>
```

A closure created in reactive scope is pure (SC-3); a statement body is a
write position. Handlers are written on the element (`onClick={() => { … }}`).

```
-- reject: ASYNC_STORE_SETTER
source id := 1
sel = draft(pre sel -> {}) { refresh id }
<p>{sel}</p>
```

```
-- reject: WRITE_TO_NON_SOURCE
source n := 1
double = n * 2
<button onClick={() => { double := 4 }}>{double}</button>
```

```
-- reject: OPTIMISTIC_OUTSIDE_HOLD
source name := "Ann"
source shown = name
effect (name) { optimistic shown := "Zed" }
<p>{shown}</p>
```

```
-- reject: OPTIMISTIC_NO_QUESTION
source shown := "Ann"
action fix() { optimistic shown := "Zed"; await fetch("x") }
<p>{shown}</p>
```

```
-- reject: INVALID_REFRESH_TARGET
source base := 1
<button onClick={() => { refresh base }}>{base}</button>
```

```
-- reject: INVALID_AFFECTS_TARGET
action go(n) { affects n }
<p>x</p>
```

```
-- reject: REGION_ESCAPE
source handlers := []
source rows := [1, 2]
<ul>{for r in rows {
  source hits := 0
  <li onClick={() => { handlers := [...handlers, () => hits] }}>{hits}</li>
}}</ul>
```

`() => hits` captures the row's `hits`; `handlers` outlives the row (O-3).

```
-- reject: REGION_ESCAPE
source handlers := []
source open := true
<div>{if open {
  source n := 0
  <b onClick={() => { let read = () => n; handlers := xs => [...xs, read] }}>{n}</b>
}}</div>
```

Through a `let`, and through a functional write's result: the function a
functional write is given is applied, but what it returns is stored (W-6).

```
-- reject: REGION_ESCAPE
context fields: source unknown[]
component Form(props) {
  source rows := []
  provide fields = rows
  <form>{props.children}</form>
}
component Field(props) {
  source v := ""
  <input onInput={() => { use fields := fs => [...fs, () => v] }} />
}
<Form><Field /></Form>
```

A provision always outlives the component that writes through it.

```
-- reject: CONTEXT_NOT_FOUND
context panel: string
component Panel(props) {
  provide panel = "P"
  <section>{props.children}</section>
}
component Badge(props) { <b>{use panel}</b> }
<div><Panel><Badge /></Panel> <Badge /></div>
```

The second `<Badge />` is rendered on a path with no provision (RG-7b): one
path without it is enough.

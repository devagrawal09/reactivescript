# .rx diagnostics: every code and its fix

`rxc check` and the editor report a diagnostic as `file:line:column: error CODE [rule] message`. The message already
says what to do. This page says why, with a program that gets the code and the same program fixed, one section per
code. Codes keep Solid 2.0's names where Solid has the same check at run time (`REACTIVE_WRITE_IN_OWNED_SCOPE`,
`ASYNC_STORE_SETTER`, …), so a compile error here and a dev-mode warning from Solid mean the same thing.

The `[rule]` is the id of the rule in `spec/` (`grep -n "^- \*\*AC-1c" spec/*.md`). `reference.md` has every rule in
one line; you rarely need more than this page and that one.

Fences marked `rx before` get the section's code and fences marked `rx after` check clean: the compiler's tests run
every one of them (`compiler/tests/diagnostics_page.rs`). Fences with no mark are sketches that need other modules.

## Parse errors: habits from JavaScript, React and Solid

A parse error names the habit it looks like, when it recognises one; otherwise its code is `PARSE`.

### PARSE

The text has no `.rx` reading at that point. The message says what the parser expected and quotes what it found.
`reference.md`'s grammar is the whole syntax.

### JS_LOCAL

`const`, `let` and `var` declare locals in a handler or an action body only. A component and a module's top level hold
declarations: a value that changes is a `source`, one computed from others is an equation (E-1).

```rx before
export default component App() {
  const n = 1
  let d = n * 2
  <p>{d}</p>
}
```

```rx after
export default component App() {
  source n := 1
  d = n * 2
  <p>{d}</p>
}
```

### JS_FUNCTION

There is no `function`. A pure function is `fn`, code that writes or awaits is an `action`, code that renders is a
`component`.

```rx before
function twice(x) { return x * 2 }
export default component App() {
  <p>{twice(1)}</p>
}
```

```rx after
fn twice(x) => x * 2
export default component App() {
  <p>{twice(1)}</p>
}
```

### JS_RETURN

A component's body is its declarations, then its markup. There is no `return`.

```rx before
export default component App() {
  source n := 1
  return <p>{n}</p>
}
```

```rx after
export default component App() {
  source n := 1
  <p>{n}</p>
}
```

### JS_API

`createSignal`, `useState`, `createMemo`, `useEffect` and the rest are spelled as declarations: `source x := v` is
state, `x = e` is a memo, `effect (x) { … }` is an effect.

```rx before
export default component App() {
  [n, setN] = createSignal(0)
  <button onClick={() => { setN(n + 1) }}>{n}</button>
}
```

```rx after
export default component App() {
  source n := 0
  <button onClick={() => { n := n + 1 }}>{n}</button>
}
```

### JSX_TERNARY

`c ? a : b` is an expression, and markup is not an expression. A branch of elements is `{if c { … } else { … }}`.

```rx before
export default component App() {
  source c := true
  <p>{c ? <span/> : ""}</p>
}
```

```rx after
export default component App() {
  source c := true
  <p>{if c { <span/> } else { <span></span> }}</p>
}
```

### FOR_INDEX

`for` binds one name. The index is `xs.indexOf(x)` in the body, or map the list to pairs first.

```rx before
export default component App() {
  source xs := [1]
  {for x, i in xs { <p>{x}</p> }}
}
```

```rx after
export default component App() {
  source xs := [1]
  {for x in xs { <p>{x} {xs.indexOf(x)}</p> }}
}
```

### ASSIGNMENT

A source is written with `:=` as a statement, in a handler or an action (W-1). There is no `=`, `+=` or `++` on state.
To write from the value as it stands at the write, give a function: `n := v => v + 1` (W-6).

```rx before
export default component App() {
  source n := 0
  <button onClick={() => { n += 1 }}>{n}</button>
}
```

```rx after
export default component App() {
  source n := 0
  <button onClick={() => { n := v => v + 1 }}>{n}</button>
}
```

### REACTIVE_WRITE_IN_OWNED_SCOPE

A write happens in imperative scope only: a handler, an action, an effect's apply block (W-2). A closure created in a
component or an equation is a pure function (SC-3), so an arrow that writes needs a braced body in a handler position,
and a reusable writer is an `action`. Solid throws the same code at run time.

```rx before
export default component App() {
  source n := 0
  <button onClick={() => n := n + 1}>{n}</button>
}
```

```rx after
export default component App() {
  source n := 0
  <button onClick={() => { n := n + 1 }}>{n}</button>
}
```

```rx before
export default component App() {
  source n := 1
  reset = () => { n := 0 }
  <button onClick={reset}>{n}</button>
}
```

```rx after
export default component App() {
  source n := 1
  action reset() { n := 0 }
  <button onClick={() => { reset() }}>{n}</button>
}
```

## Writes

### WRITE_TO_NON_SOURCE

Only sources are written (W-1). An equation is always equal to its right side, and props, parameters and contexts are
read-only (O-4): the block that declares a source writes it, and others get an action that does.

```rx before
export default component App() {
  source n := 1
  double = n * 2
  <button onClick={() => { double := 4 }}>{double}</button>
}
```

```rx after
export default component App() {
  source n := 1
  double = n * 2
  <button onClick={() => { n := 2 }}>{double}</button>
}
```

A source imported from another module is written through an action that module exports (MO-2):

```rx
// store.rx
export source selected := 0
export action select(id: number) { selected := id }

// App.rx
import { selected, select } from "./store.rx"
export default component App() {
  <button onClick={() => { select(5) }}>{selected}</button>
}
```

### STALE_OWN_READ

All the writes of one run land together when the run ends, so after `count := count + 1` the run still reads the old
`count` (W-3, W-4). Keep the value you wrote in a local and read that.

```rx before
export default component App() {
  source count := 0
  source seen := 0
  <button onClick={() => { count := count + 1; seen := count }}>{count} {seen}</button>
}
```

```rx after
export default component App() {
  source count := 0
  source seen := 0
  <button onClick={() => { let next = count + 1; count := next; seen := next }}>{count} {seen}</button>
}
```

### STALE_WRITE_BACK

A write after an `await` that is computed from a read before it overwrites whatever changed the source in between
(another action, a reload). Write functionally, so the write applies to the value as it stands (W-6), or guess it with
`guess` and let the answer replace the guess (AC-3).

```rx before
export default component App() {
  source log := ""
  action add(x: string) {
    let before = log
    let r = await fetch(x) catch (e) => ""
    log := before + x
  }
  <button onClick={() => { add("a") }}>log: {log}</button>
}
```

```rx after
export default component App() {
  source log := ""
  action add(x: string) {
    let r = await fetch(x) catch (e) => ""
    log := v => v + x
  }
  <button onClick={() => { add("a") }}>log: {log}</button>
}
```


### STALE_CAPTURE

After an `await`, a write into a source with a question (the server's answer) takes only what the server answered,
plain arguments (an id, a title, an index) and the answer's own value at the write (`x := rs => …`, finding rows there
by id). A row the action was given, or read from a source before the `await` or after it, is what the screen showed:
by then it may have changed (a rename accepted), be somewhere else (an earlier move declined) or carry a write another
action still holds, so the screen loses the edit or shows the row twice. When the answer doesn't say where a row is now
(a move answers only where it went), re-ask the answers it left and joined with `refresh`.

Even `let id = entry.id` inside the action is still a projection of the row under AC-1g. If the id
identifies what the user asked for, pass just that primitive from the handler: change
`finish(entry)` to `finish(entry.id)` and `action finish(entry: Entry)` to `action finish(id: string)`
(or `number`, if that's the id type). Use `id` to find the current row inside the functional write;
don't carry the displayed row or its fields into the answer.

```rx before
type Card = { id: number; title: string }
export default component App() {
  source done = await fetch("done") -> "" catch (e) => ""
  action finish(card: Card) {
    let r = await fetch("move") catch (e) => ""
    done := v => v + card.title
  }
  <button onClick={() => { finish({ id: 1, title: "a" }) }}>{done}</button>
}
```

```rx after
export default component App() {
  source done = await fetch("done") -> "" catch (e) => ""
  action finish(id: number) {
    await fetch("move") catch (e) => ""
    refresh done
  }
  <button onClick={() => { finish(1) }}>{done}</button>
}
```

### SNAPSHOT_INITIALIZER

A source's `:=` seed is read once. Reading another reactive value there takes a snapshot, which must say so with
`peek(…)` (E-4). If the value should follow its input, it is an equation, or a source with a question (`source x = e`,
ST-5).

```rx before
export default component App() {
  source form := { email: "a@x" }
  source email := form.email
  <p>{email}</p>
}
```

```rx after
export default component App() {
  source form := { email: "a@x" }
  source email := peek(form.email)
  <p>{email}</p>
}
```

### SNAPSHOT_ARGUMENT

A block `fn` with declarations (including equations) reads its value parameters once. Declare the parameter `ref`
to pass the reactive value itself, or pass `peek(…)` to say a snapshot is meant (E-10). For a value-only calculation,
inline the equation: `fn size(xs) { n = xs.length; n }` becomes `fn size(xs) => xs.length`.

```rx before
export default component App() {
  fn watch(v) {
    effect (v) { log(v) }
    v
  }
  source n := 1
  w = watch(n)
  <p>{w}</p>
}
```

```rx after
export default component App() {
  fn watch(ref v) {
    effect (v) { log(v) }
    v
  }
  source n := 1
  w = watch(n)
  <p>{w}</p>
}
```

### DUPLICATE_DECLARATION

A name is declared once in a block (E-7). Rename one.

```rx before
export default component App() {
  source x := 1
  x = 2
  <p>{x}</p>
}
```

```rx after
export default component App() {
  source x := 1
  y = 2
  <p>{x} {y}</p>
}
```

### CYCLE

Equations that read each other in one instant have no value (C-1). Break the loop with `pre`, the value before the
last change (C-2), or make one side a source written by an event.

```rx before
export default component App() {
  source s := 0
  a = b + 1
  b = a + 1
  <p>{a}</p>
}
```

```rx after
export default component App() {
  source s := 0
  a = s + 1
  b = a + 1
  <p>{b}</p>
}
```

### PRE_OF_NON_REACTIVE

`pre x` is `x`'s value before its last change, so `x` has to be reactive: a source or an equation (C-2).

```rx before
export default component App() {
  fn f(x) => x
  y = pre f
  <p>{y}</p>
}
```

```rx after
export default component App() {
  source n := 1
  y = pre n -> 0
  <p>{y}</p>
}
```

### EFFECT_WRITES_OWN_SOURCE

An effect that writes what it reads runs again from its own write: a loop across instants (C-3). Derive the value as an
equation, as a source with a question (ST-5), or write it from the event that changes the inputs.

```rx before
export default component App() {
  source n := 0
  effect (n) { n := n + 1 }
  <p>{n}</p>
}
```

```rx after
export default component App() {
  source n := 0
  shown = n + 1
  <p>{shown}</p>
}
```

## Actions, guesses and holds

### HELD_WRITE

A handler that writes and awaits is an action (AC-1b), and an action's writes land when its body ends (AC-1). So a
write before the `await` does not show while the work runs. Say which you meant: `guess x := …` for state that
shows while the work runs (on a source with a question, ST-5c); `onFlush(() => { x := … })` for a reset that lands now
(EF-8); a declared `action` to hold it on purpose; or write it after the `await`. `async.md` ("What lands together, and
what waits") is the long form.

```rx before
export default component App() {
  source status := ""
  <button onClick={() => {
    status := "saving"
    let r = await fetch("save") catch (e) => e.message
    status := r
  }}>status: {status}</button>
}
```

```rx after
export default component App() {
  source status := ""
  <button onClick={() => {
    onFlush(() => { status := "saving" })
    let r = await fetch("save") catch (e) => e.message
    status := r
  }}>status: {status}</button>
}
```

### AWAIT_IN_EXPRESSION

In imperative code a run suspends only at a statement (AC-1). Bind the answer first, `let v = await e`, then use `v`.

```rx before
export default component App() {
  source status := ""
  action place() {
    try { status := `got ${await fetch("checkout")}` } catch {}
  }
  <button onClick={() => { place() }}>{status}</button>
}
```

```rx after
export default component App() {
  source status := ""
  action place() {
    try {
      let r = await fetch("checkout")
      status := `got ${r}`
    } catch {}
  }
  <button onClick={() => { place() }}>{status}</button>
}
```

### GUESS_OUTSIDE_HOLD

A guess lives in an action's hold until the server answers it (AC-3). An effect's apply block is never an action, so
declare one and call it from the block.

```rx before
export default component App() {
  source draft := "a"
  source saved = "a"
  effect (draft) { guess saved := $0 }
  <p>{saved}</p>
}
```

```rx after
export default component App() {
  source draft := "a"
  source saved = "a"
  action save(v: string) {
    guess saved := v
    await fetch("save:" + v) catch (e) => null
  }
  effect (draft) { save($0) }
  <p>{saved}</p>
}
```

### GUESS_ON_DEFERRED

A `deferred` equation is a lagging copy of another value (V-16), so nothing would confirm a guess on it. Guess the
value it lags.

```rx before
export default component App() {
  source name := "Ann"
  shown = name
  deferred later = shown
  action fix() { guess later := "Zed"; await fetch("x") catch (e) => null }
  <button onClick={() => { fix() }}>{later}</button>
}
```

```rx after
export default component App() {
  source name := "Ann"
  shown = name
  deferred later = shown
  action fix() { guess shown := "Zed"; await fetch("x") catch (e) => null }
  <button onClick={() => { fix() }}>{later}</button>
}
```

### INVALID_REFRESH_TARGET

`refresh x` re-asks `x`'s question (AC-4), so `x` is an equation that awaits or a source declared with `=`. A source
seeded with `:=` has nothing to re-ask: write it instead.

```rx before
export default component App() {
  source base := 1
  <button onClick={() => { refresh base }}>{base}</button>
}
```

```rx after
export default component App() {
  source id := 1
  base = await fetch("b:" + id) catch (e) => 0
  <button onClick={() => { refresh base }}>{base}</button>
}
```

### INVALID_AFFECTS_TARGET

`affects x` makes `pending? x` true until the action commits (AC-5), so `x` is a source or an equation of this
program, not a parameter or a plain value.

```rx before
export default component App() {
  action go(n) { affects n }
  <p>x</p>
}
```

```rx after
export default component App() {
  source total := 0
  action go(n: number) {
    affects total
    let r = await fetch("add:" + n) catch (e) => 0
    total := r
  }
  <button onClick={() => { go(1) }}>{pending? total ? "…" : total}</button>
}
```

### HOOK_CALLBACK

`onFlush` and `onSettled` take a closure with no parameters, `onFlush(() => { … })`: its body is the run they schedule
(EF-7, EF-8).

```rx before
export default component App() {
  source open := true
  <button onClick={() => { onFlush(open) }}>x</button>
}
```

```rx after
export default component App() {
  source open := true
  <button onClick={() => { onFlush(() => { open := false }) }}>x</button>
}
```

### SETTLED_CLEANUP_UNOWNED

A callback passed to `onSettled` runs once and has no region to bind a cleanup to (EF-7). Setup with teardown is an
`effect` whose apply block returns the cleanup (EF-4, EF-5).

```rx before
export default component App() {
  source n := 0
  <button onClick={() => { onSettled(() => { return () => { log(n) } }) }}>x</button>
}
```

```rx after
export default component App() {
  source n := 0
  effect (n) { return () => { log($0) } }
  <button onClick={() => { n := n + 1 }}>x</button>
}
```

### UNTIL_PREDICATE

`until` waits for a condition to become true, so it takes a predicate, `until(() => e)` (AC-6). A plain value is read
once and never changes.

```rx before
export default component App() {
  source ok := false
  action wait() { await until(ok) }
  <button onClick={() => { wait() }}>{ok}</button>
}
```

```rx after
export default component App() {
  source ok := false
  action wait() { await until(() => ok) }
  <button onClick={() => { wait() }}>{ok}</button>
}
```

## Reactive scope and io

### IO_IN_REACTIVE

An io function (an import without `pure`, `until`, an action) runs in imperative scope only: a handler, an action, an
effect's apply block (R-io-3, AC-6). An equation re-runs whenever its inputs change, so it may only ask pure questions.

```rx before
export default component App() {
  source ok := false
  done = until(() => ok)
  <p>{ok}</p>
}
```

```rx after
export default component App() {
  source ok := false
  action wait() { await until(() => ok) }
  <button onClick={() => { wait() }}>{ok}</button>
}
```

### ACTION_CALLED_IN_OWNED_SCOPE

An action is called from a handler or another action, never from an equation or the markup (R-io-3). Solid throws the
same code at run time.

```rx before
export default component App() {
  source n := 1
  action bump() { n := n + 1 }
  x = bump()
  <p>{x}</p>
}
```

```rx after
export default component App() {
  source n := 1
  action bump() { n := n + 1 }
  <button onClick={() => { bump() }}>{n}</button>
}
```

### ARGUMENT_COUNT

A call of an action passes one argument per parameter (AC-1f). A missing argument is `undefined` in the body and an
extra one is dropped, both silently, so the count is checked where the action is declared in the module.

```rx before
export default component App() {
  source n := 0
  action go(by: number) { n := n + by }
  <button onClick={() => { go(1, 2) }}>{n}</button>
}
```

```rx after
export default component App() {
  source n := 0
  action go(by: number) { n := n + by }
  <button onClick={() => { go(1) }}>{n}</button>
}
```

### IO_IN_FN

A `fn` is pure by definition (R-io-2). Code that calls io is an `action`, or the io call moves into the handler.

```rx
import { log } from "./prelude"
export default component App() {
  fn noisy(v) => log(v)                        // IO_IN_FN
  action noisy2(v: number) { log(v) }          // fixed
  source n := 1
  <button onClick={() => { noisy2(n) }}>{n}</button>
}
```

### ASYNC_STORE_SETTER

A draft block is a synchronous transaction on its draft `d` (ST-3b): it holds `let`, expressions and writes to `d`,
nothing that awaits, refreshes or calls io. Do that work in an action and write the result. Solid throws the same code
when a store setter returns a promise.

```rx before
export default component App() {
  source id := 1
  sel = draft(pre sel -> {}) { refresh id }
  <p>{sel}</p>
}
```

```rx after
export default component App() {
  source id := 1
  sel = draft(pre sel -> {}) { d[str(id)] := true }
  <p>{sel}</p>
}
```

### DRAFT_WRITE_OUTSIDE_DRAFT

A draft block writes only its draft, `d` (ST-3a). Other sources are written by the event that changes them.

```rx before
export default component App() {
  source id := 1
  source other := {}
  selected = draft(pre selected -> {}) { other[str(id)] := true }
  <p>{selected}</p>
}
```

```rx after
export default component App() {
  source id := 1
  selected = draft(pre selected -> {}) { d[str(id)] := true }
  <p>{selected}</p>
}
```

## Failures and loading

### UNHANDLED_FAILURE

A value that can fail is read where nothing handles the failure (R-f-5). Wrap the reader in an `errored` region where
it is read. To make a rejection an answer instead, catch it at the `await`: `await f(x) catch (err) => alt`.

```rx before
export default component App() {
  source id := 1
  user = await fetch("u:" + id)
  <p>{user}</p>
}
```

```rx after
export default component App() {
  source id := 1
  user = await fetch("u:" + id)
  {errored fallback(e) { <p>failed: {e.message}</p> } { <p>{user}</p> }}
}
```

### TYPE_IMPORT

A `.d.rx` imports types only (MO-8e): `import { T, U as V } from "./x"`, from another `.d.rx`, a `.ts` module, or an `.rx` `export type`. A function is a value. Copying the type into the file was the workaround; import the type instead.

```rx
-- module: ./fns.d.rx
export pure fn fetch(): string

-- module: ./api.d.rx
import { fetch } from "./fns"
export pure fn g(x: number): number
```

Import `Card`, not `fetch`.

### DEAD_TYPED_BOUNDARY

A typed `errored fallback(e: X)` wraps a catch-all with a static fallback. The catch-all takes `X` first and its static
fallback cannot fail into the typed region (R-f-4). Put the typed boundary inside the catch-all. The model marks the typed region
`deadTyped: true` and `shadowed` by the inner one, which is what the map draws.

```rx before
error NotFound
export default component App() {
  errored fallback(e: NotFound) { <p>{e.message}</p> } {
    errored fallback { <p>failed</p> } { <p>x</p> }
  }
}
```

```rx after
error NotFound
export default component App() {
  errored fallback(e) { <p>{e.message}</p> } {
    errored fallback(e: NotFound) { <p>{e.message}</p> } { <p>x</p> }
  }
}
```

### CATCH_NOT_ON_AWAIT

A `catch` follows something other than an `await` (R-f-4). A value that failed is shown where it is read, by an
`errored` region around its readers; a `catch` belongs on the `await`, where it makes the rejection the answer. A rule
the user breaks is a value (`""` or a message), not a failure.

```rx before
export default component App() {
  source id := 1
  user = await fetch("u:" + id)
  <p>{user catch (e) => "unknown"}</p>
}
```

```rx after
export default component App() {
  source id := 1
  user = await fetch("u:" + id)
  {errored fallback(e) { <p>unknown</p> } { <p>{user}</p> }}
}
```

### UNCAUGHT_ACTION_FAILURE

An action catches its own failures (R-f-6): a handler cannot, since it does not await the action. Put a
`try { … } catch (e) { … }` in the body, or `catch (e) => alt` on the `await`.

```rx before
export default component App() {
  source saved := ""
  action save() {
    let r = await fetch("save")
    saved := r
  }
  <button onClick={() => { save() }}>{saved}</button>
}
```

```rx after
export default component App() {
  source saved := ""
  action save() {
    let r = await fetch("save") catch (e) => "failed"
    saved := r
  }
  <button onClick={() => { save() }}>{saved}</button>
}
```

### NOT_AN_ERROR_CLASS

A `catch` or `errored` that names a class narrows to error classes declared with `error` (R-f-1). Declare the class,
or drop the name to take any failure.

```rx before
export default component App() {
  source id := 1
  user = await fetch("u:" + id)
  {errored fallback(e: Missing) { <p>{e.message}</p> } { <p>{user}</p> }}
}
```

```rx after
export default component App() {
  source id := 1
  user = await fetch("u:" + id)
  {errored fallback(e) { <p>{e.message}</p> } { <p>{user}</p> }}
}
```

### ROW_NARROWER_THAN_INFERRED

A declared row (`lane`, `fails(…)`) says less than the value does (CN-4a, RG-7e). Widen the declaration, or drop it and
let the compiler infer it.

```rx before
export default component App() {
  source id := 1
  user: lane string = await fetch("u:" + id)
  <p>{user}</p>
}
```

### UNGUARDED_SNAPSHOT

A handler reads a value as a snapshot when it can have no value yet (a first load) or can fail, so the click sees no
value or throws (R-8). Put the element inside the `loading` / `errored` regions whose content reads the value, with
`disabled={pending? x}` while a new question is out; or read it in the handler inside `try { … } catch (e) { … }`. The region must read the
value itself, not only `pending? x`: a probe takes no failure, so a region that reads `x` only through `pending?` stays
on its content when `x` fails, and the click throws.

```rx
export default component App() {
  source id := 1
  user = await fetch("u:" + id)
  {errored fallback(e) { <p>failed</p> } {
    {loading fallback { <p>loading…</p> } {
      <button disabled={pending? user} onClick={() => { log(user) }}>{user}</button>
    }}
  }}
}
```

### GUESS_WHILE_LOADING

A click can start a guess on a value while that value is loading a new question: its question reads what the click
reads (a selection, a row), and the element is neither inside the `loading` region that shows the value nor disabled
while it loads (AC-3a). The guess composes on the previous answer, and the new answer replaces it (D-34), so the
user's change disappears while its action is out. Put the element inside the value's `loading` region, give it
`disabled={pending? x}`, or keep the pending change in a source of its own until it lands. Solid warns
`OPTIMISTIC_WRITE_WHILE_LOADING` at run time for the same case.

Neither cover holds when the selection changes while a guess on `x` is out. That change joins the guess's hold
(H-11), so a `loading on(sel)` region keeps its content (H-6), and `pending? x` read in that region's markup is
`false` on Solid today although the rule says `true` (05 DV-22): the control stays enabled and a second click guesses
on the old answer. The check accepts it, since the element is covered. Test the verdict in the handler too, where it
reads `true` (R-12): `onClick={() => { if (!(pending? x)) { flip(it.id) } }}`, or keep the pending change in a source
of its own.

```rx before
export default component App() {
  source sel := 1
  source detail = await fetch("issue:" + sel)
  action rename(t: string) {
    try {
      guess detail := d => d == null ? d : { ...d, title: t }
      await fetch("rename:" + sel + "," + t)
      refresh detail
    } catch (e) {
      log(e)
    }
  }
  errored fallback(e) { <p>failed</p> } {
    loading on(sel) fallback { <p>loading…</p> } {
      <h2>{detail.title}</h2>
    }
  }
  <button onClick={() => { sel := sel + 1 }}>next</button>
  <button onClick={() => { rename("Bravo") }}>rename</button>
}
```

```rx after
export default component App() {
  source sel := 1
  source detail = await fetch("issue:" + sel)
  action rename(t: string) {
    try {
      guess detail := d => d == null ? d : { ...d, title: t }
      await fetch("rename:" + sel + "," + t)
      refresh detail
    } catch (e) {
      log(e)
    }
  }
  errored fallback(e) { <p>failed</p> } {
    loading on(sel) fallback { <p>loading…</p> } {
      <h2>{detail.title}</h2>
    }
  }
  <button onClick={() => { sel := sel + 1 }}>next</button>
  <button disabled={pending? detail} onClick={() => { rename("Bravo") }}>rename</button>
}
```

### ASYNC_OUTSIDE_LOADING_BOUNDARY

In a client-only build (`--spa`), a value with no answer yet and no `loading` region above it shows nothing until it
answers (CN-3d). Put it under `loading fallback { … } { … }`, or give the await a first paint, `await f() -> v`. Later
answers are transitions and need no region.

### LOADING_ON_OUTSIDE_HOLD

A value is read outside the `loading on(x)` region that waits on it, so that read holds the change: the region's
fallback never shows and the old content stays up with no sign of the wait (CN-3e). Move the read under the region, or
read `latest x` there. Solid warns with the same code at run time.

```rx before
export default component App() {
  source id := 1
  data = await fetch("d:" + id)
  {errored fallback(e) { <p>error: {e.message}</p> } {
    <div>{loading on(id) fallback { <p>spinner</p> } { <p>{data}</p> }} {loading fallback { <p>spinner</p> } { <p>{data}</p> }}</div>
  }}
}
```

## Components, regions and contexts

### UNBOUND

The name is not declared where it is read. A component sees its declaration site, not its caller (RG-7a): pass the
value as a prop, provide it in a context, or import it.

JavaScript globals are not in scope (SV-7a). For example, put `export const Number = globalThis.Number` in
`js-globals.js` and write `import pure { Number } from "./js-globals.js"` in `.rx`
to convert values in reactive scope. For `Math`, prefer exporting the operation you
need, e.g. `export const floor = Math.floor`, then `import pure { floor } from "./js-globals.js"`.

```rx before
component Row(props) { <p>{caption}</p> }
component List(props) {
  caption = "hi"
  <Row />
}
export default component App() {
  <List />
}
```

```rx after
component Row(props: { caption: string }) { <p>{props.caption}</p> }
component List(props) {
  caption = "hi"
  <Row caption={caption} />
}
export default component App() {
  <List />
}
```

`props` is a name only in a component that declares it: `component Lane()` has none (RG-4b), and a read of
`props.col` there would be `undefined`. Declare what it takes.

```rx before
component Lane() { <h3>{props.col}</h3> }
export default component App() {
  <Lane col="todo" />
}
```

```rx after
component Lane(props: { col: string }) { <h3>{props.col}</h3> }
export default component App() {
  <Lane col="todo" />
}
```

### UNKNOWN_COMPONENT

A capitalised tag names a component declared or imported in this module (RG-4a).

```rx before
export default component App() {
  <Nope />
}
```

```rx after
component Nope(props) { <p>nope</p> }
export default component App() {
  <Nope />
}
```

### COMPONENT_AS_VALUE

A component is applied in markup, `<Greeting name="x" />`, not stored or called as a function (RG-4a).

```rx before
component Greeting(props) { <p>{props.name}</p> }
export default component App() {
  x = Greeting
  <p>{x}</p>
}
```

```rx after
component Greeting(props: { name: string }) { <p>{props.name}</p> }
export default component App() {
  <Greeting name="x" />
}
```

### INSTANTIATION_NOT_BOUND

A `fn` that declares state makes new state each time it is called, so its result is bound to a name, `x = f(…)`, and
the name is read (E-9, RG-6).

```rx before
export default component App() {
  fn counter(ref base) {
    source extra := 0
    base + extra
  }
  source n := 1
  <p>{counter(n)}</p>
}
```

```rx after
export default component App() {
  fn counter(ref base) {
    source extra := 0
    base + extra
  }
  source n := 1
  c = counter(n)
  <p>{c}</p>
}
```

### REGION_ESCAPE

A closure that captures something from a region that ends sooner (a `for` row, an `if` branch) is stored where it
outlives that region (O-3). Keep the state at the level that stores the closure, or pass the value rather than a
closure over it.

### UNSTABLE_LIST_IDENTITY

The rows of a `for` are rebuilt as fresh records on every change, so every row's state and effects start over
(ST-4b). Declare a key, `rows key id = …`, so rows keep identity.

```rx before
export default component App() {
  source rows := [{ id: 1, name: "a" }, { id: 2, name: "b" }]
  view = map(rows, fn(r) => { id: r.id, name: r.name + "!" })
  {for r in view {
    effect (r.name) { log(r.id, $0) }
    <p>{r.name}</p>
  }}
}
```

```rx after
export default component App() {
  source rows := [{ id: 1, name: "a" }, { id: 2, name: "b" }]
  view key id = map(rows, fn(r) => { id: r.id, name: r.name + "!" })
  {for r in view {
    effect (r.name) { log(r.id, $0) }
    <p>{r.name}</p>
  }}
}
```

### CONTEXT_NOT_FOUND

`use x` reads the nearest provision of context `x` above the region, and some path that renders it has none (RG-7b).
Provide it above the component (`provide x = …`), or give the context a default (`context x: T = v`).

```rx before
context room: number
component Room(props: { id: number }) {
  <p>{(use room) == props.id ? "*" : "-"}</p>
}
export default component App() {
  <Room id={1} />
}
```

```rx after
context room: number
component Room(props: { id: number }) {
  <p>{(use room) == props.id ? "*" : "-"}</p>
}
export default component App() {
  provide room = 1
  <Room id={1} />
}
```

### CONTEXT_AS_VALUE

A context is read with `use`, which gives the nearest provision (RG-7): `{use theme}`, not `{theme}`.

### NOT_A_CONTEXT

`provide` and `use` name a `context` declaration (RG-7). Declare one, `context picked: number`, and provide it.

```rx before
export default component App() {
  source picked := 1
  provide picked = 2
  <b>{picked}</b>
}
```

```rx after
context picked: number
export default component App() {
  provide picked = 2
  <b>{use picked}</b>
}
```

### SOURCE_CONTEXT

A context is read-only beneath its provision (O-4); `context x: source T` was withdrawn (RG-7c, 2026-10-31). Provide the
value and the writes you allow, as actions: `context picked: { current: number; set: (v: number) => void }`.

## Modules

### TOP_LEVEL_MARKUP

A module is declarations (MO-1c). The app's view is a component: `export default component App() { … }`.

### SHADOWED_IMPORT

A local declaration has the name of an import (MO-1d). Rename one: `import { initials as initialsOf } from "./store.rx"`.

### NOT_EXPORTED

The module, or its declaration, does not export that name (MO-6, MO-8, MO-11). For a `.ts` module the declaration is
generated from the `.ts`, so the name is not among its exports: check the spelling, or export it from the `.ts`. A line
in a `.d.rx` beside a `.ts` that names an export the `.ts` lacks is reported at that line: remove it, or fix the name.

### DECLARATION_BRAND

A brand from `@reactivescript/types` in a `.ts` is somewhere the compiler can't read it as a fact (MO-11c). Brands go
on the return type of the exported function, wrapped in any order. `Ref` also goes on a parameter. The error is
reported at the brand, in the `.ts`:

```ts
export const limit: Pure<number> = 10                       // a brand on a value: it describes a call
export function load(id: Pure<number>): Promise<Item>       // Pure on a parameter
export function load(id: number): Promise<Pure<Item>>       // Pure inside the result
export function watch(src?: Ref<string>): Ref<string>       // Ref on an optional parameter
export function load(id: number): Rejects<Promise<Item>, "missing">   // a Rejects member that isn't an Error class
```

Write `export function load(id: number): Pure<Rejects<Promise<Item>, NotFound>>`, with
`class NotFound extends Error {}`. Overloads of one function carry the same brands, or none. `Ref` marks a parameter,
the result, or a top-level element or property of the result, and nothing deeper (`Promise<Ref<T>>` is refused).

### DECLARATION_UNAVAILABLE

The import names a TypeScript module, but no generator could read it (MO-11d). The compiler won't guess, because every
tool must give the same verdict. Usually TypeScript or `@reactivescript/compiler` (whose `rx-dts` generates the
declaration) isn't installed where native `rxc` runs: `npm i -D @reactivescript/compiler typescript`, or point `RX_DTS`
at an `rx-dts` command. A module written `export = …` (CommonJS) isn't an ES module. Declare it in a `.d.rx` beside a
`.js` re-export instead.

### MODULE_NOT_FOUND

No file at that import path (MO-6). `.rx` modules are imported with their extension, `"./ui.rx"`; JavaScript modules
without it.

### MODULE_CYCLE

Two modules import each other, directly or through others (MO-5). Move what both need into a third module.

### IMPORT_ROW_MISMATCH

An import restates what its source already declares (MO-4, MO-8, MO-11e, SF-5): `pure` on a function that is io,
`fails(…)` on an `.rx` module (its rows are its signature's), or `server` / `client` on a name its `.d.rx` declares
otherwise. For a `.ts` module, an import may still narrow a fact the `.ts` left to the default (`import pure` of an
unbranded function), but not one a brand or a `.d.rx` line states. Drop the annotation on the import and let the
declaration say it, or brand the `.ts` (`Pure<…>`, `Rejects<…>`).

## Server functions

### SERVER_CAPTURE

A server function runs in its own request on the server, so it cannot read the client's state: a module source, a
context (`use`), `refresh`, `affects`, `action { … }` (SF-3). Pass what it needs as an argument, and do the client's
part in the action that awaited the call.

```rx
source n := 1
server fn f(v: number) { return v }            // was: server fn f() { return n }
x = await f(n) catch (e) => 0
export default component App() {
  <p>{x}</p>
}
```

### SERVER_WRITE

A server function cannot write client state (SF-4). Return the value and write it in the action that awaited the call:
`let r = await save(x); status := r`.

### SERVER_ONLY

A `server` JS import is not in the client bundle (SF-5a). Call it in a `server fn` body and await that from the client.

### CLIENT_IN_SERVER

A `client` JS import (the browser's API) is called in a server function's body, which runs on the server (SF-5c). Call
it from the client and pass the value as an argument.

### CLIENT_NOT_AWAITED

In reactive scope a `client` JS function is a client question, asked once the browser has the page (SV-7b), so it is
awaited: `width = await viewport() -> 0`.

### CLIENT_QUESTION_UNHELD

The server never asks a client question, so the page needs a `loading` region above the reader, or a first paint on
the await, `await viewport() -> 0` (SV-7b).

## Markup and styles

### CONTENT_MODEL

The browser's HTML parser rewrites some nestings (a `<tr>` outside a table, a `<div>` inside a `<p>`), so the page the
server sends is not the tree the client builds and hydration fails (SV-7d). Nest the elements the way HTML allows.

### STYLE_SCOPE

A component's `<style>` scopes that component's view only (CSS-2). A second component in the same file is its own view: a class written in the first does not apply to the second, and the selector is pruned. Give the second component its own `<style>`, or pass a class map (`styles = <style>…</style>`, CSS-5).

```rx before
component Row() {
  <li class="row">x</li>
}
export default component App() {
  <style>
    .row { color: red }
  </style>
  <Row />
}
```

```rx after
component Row() {
  <style>
    .row { color: red }
  </style>
  <li class="row">x</li>
}
export default component App() {
  <Row />
}
```

### STYLE_PLACEMENT

A view has one `<style>`, at the top level of the component's view: it scopes the whole view, branches and loops
included (CSS-1). Move it there.

```rx before
export default component App() {
  <div><style>p { color: red }</style><p>x</p></div>
}
```

```rx after
export default component App() {
  <style>p { color: red }</style>
  <div><p>x</p></div>
}
```

## Types (`rx-tsc`, the editor)

These come from the TypeScript layer, which checks the program's projection (13).

### A handler read is a snapshot

`{if detail != null { … }}` narrows `detail` for a read in that branch. A handler
inside the branch runs later, and its read is a snapshot taken then — the
branch may no longer hold — so `detail` is still `Item | null` there
(`Object is possibly 'null'`). Snapshot it and narrow the local:

```rx
{if detail != null {
  <button onClick={() => {
    let d = detail
    if (d == null) return
    save(d.id)
  }}>{detail.id}</button>
}}
```

`{detail.id}` is narrowed: that read is re-checked while the branch is live.
`d` is a local, so the `if` inside the handler sticks.

### MISSING_AWAIT

An equation's value is a promise or a stream, which Solid would consume as a value (R-1a, TY-5b). Write `await e`, or
`await* e` for a stream.

### WIRE_VALUE

A server function's result or parameter is not data: a function or a class instance does not cross the wire (SF). Return
plain data.
### ACTION_PARAMETER_DEFAULT

An action takes one argument per parameter (AC-1f). Change
`action save(operation: Intent = "edit") { … }` to
`action save(operation: Intent) { … }` and call `save("edit")`.

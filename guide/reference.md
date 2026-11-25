# .rx reference: the rules on one page

`language.md` and `async.md` are how to write .rx. This page is the rules behind them, one line each, with the id of
the full rule in `spec/` (250 KB). Read this page instead of the spec; open a spec rule only when a checker message
cites it and the line here isn't enough (`grep -n "^- \*\*AC-4 " docs/spec/*.md`).

## Grammar

```
Module    ::= Import* Decl*                                  -- no markup at a module's top level: the view is a component
Import    ::= "import" "pure"? "{" Name ("as" Name)?,* "}" "from" String ("fails" Classes)?
                                                             -- types are imported the same way: import { Issue } from "./api"
                                                             -- (there is no `import type`)
Decl      ::= "export"? Decl' | "export" "default" "component" …
Decl'     ::= "source" Name Type? ("key" Name)? (":=" | "=") Expr      -- `:=` seed; `=` a question (ST-5)
            | Name Type? ("key" Name)? "=" Expr                       -- an equation
            | "type" Name "=" …  |  "interface" Name { … }
            | "effect" "(" Expr,* ")" Block
            | "fn" Name "(" Params ")" Type? ("=>" Expr | "{" Decl* Expr "}")
            | "action" Name "(" Params ")" Block
            | "component" Name "(" Name Type? ")" "{" Decl* Markup* "}"
            | "error" Name ("(" Params ")")? ("=>" Expr)?
            | "context" Name (":" Type)? ("=" Expr)?  |  "provide" Name "=" Expr
Control   ::= "if" Expr "{" … "}" ("else" ("{" … "}" | "if" …))?    -- `else if` chains, in markup too
            | "for" Name "in" Expr "{" … "}"
            | "loading" ("on" "(" Expr ")")? "fallback" "{" … "}" "{" … "}"
            | "errored" "fallback" ("(" Name (":" Classes)? ")")? "{" … "}" "{" … "}"
Stmt      ::= Target ":=" Expr | "guess" Target ":=" Expr | "refresh" Name | "affects" Name
            | ("let" | "const") Name "=" Expr | "await" Expr | ("let" | "const") Name "=" "await" Expr
            | "if" "(" Expr ")" … ("else" …)? | "try" … "catch" … "finally" … | "throw" Expr | "return" Expr? | Expr
Expr      ::= TypeScript's, without assignment, `this`, `function`, `new` on reactive values
            | "await" Expr | "pending?" Expr | "latest" Expr | "peek" "(" Expr ")" | "use" Name
            | "await" Expr "catch" ("(" Name (":" Classes)? ")")? "=>" Expr   -- only after an await (CATCH_NOT_ON_AWAIT)
            | "throw" Expr
```

## Writes and instants

- A write `x := v` happens in imperative code only (handlers, actions, effect apply blocks), in the block that
  declares `x` or one nested in it. Others get an action to call (W-5, O-4).
- All the writes of one run (one handler call, one apply block) are one **instant**. Nothing sees `v` until the run
  ends, the run itself included: after `x := v`, `x` still reads the old value (W-3, W-4, H-10).
- An instant is held while anything downstream of it is loading, with or without an `await` (H-2): in
  `open := false; page := 2`, the menu closes when page 2 lands. To land a write on its own, `onFlush` (EF-8).
- An `effect (a, b) { … }` runs after an instant in which `a` or `b` changed, once, with `$0`, `$1` the values; its
  writes are a new instant; `return () => …` is its cleanup (EF-2, EF-3, EF-5). It may not write what it reads (C-3).

## Actions

- An `action`'s body is **one change** across its awaits: every write in it, and every plain write of the handler that
  launched it, is held until the body returns (AC-1). A handler that guesses, declares `affects`, or writes and awaits
  is an action too (AC-1b).
- An action with no `await` (`select(id) { selected := id }`) is an ordinary instant.
- A call passes one argument per parameter (AC-1f, `ARGUMENT_COUNT`).
- A handler launches an action and goes on without waiting for it. An action that awaits another action waits for
  it; that await can't fail, since every action catches its own failures (AC-1, R-f-6).
- `await` is a statement: `await f(x)` or `let r = await f(x)`, optionally `… catch (e) => alt` (AC-1).
- A failure inside the body must be caught there: `try { … } catch (e) { … }` (R-f-6, AC-7). The catch runs inside the
  same change: its writes land with the body's end. A rejected body commits its plain writes and reverts its guesses
  (AC-1, DV-2).
- `guess x := e`: a guess on a source or an equation, shown now, kept until the action's change commits or `x`'s own
  answer differs (AC-3, H-11). A `:=` source needs no question: its plain writes land with the action's change,
  and if there were none, the guess ends and the previous value shows. Guesses on one source hold together.
- `refresh x`: asks `x` again, quietly (no `pending?`; the old value stays up until the new one lands). Inside an
  action, the answer lands with the action's commit (AC-4).
- `affects x`: `pending? x` is true until this change commits (AC-5).
- `onFlush(() => { … })`: runs right after this run's instant, even while the action holds it. Use it for a write
  that must land now, such as clearing an input or an error (EF-8). `onSettled(() => { … })` runs when the change
  commits (EF-7).
- Reading in a handler gives the committed value (what the screen shows). A handler that reads an equation that may
  have no value yet (first load) or may have failed must handle that: a `try`, a first value on the equation
  (`await e -> v`), the element inside that value's `loading` and `errored` regions, or `disabled={…}` reading it
  (R-8). For a failure, the region or the `disabled` must read the value itself: `pending? x` takes no failure.

## Holds (what the screen shows while work is out)

- The screen is always one consistent frame. A change whose readers are still waiting is **held**: nothing of it
  shows until all of it can (H-1, H-2).
- A `loading` region shows its fallback instead of holding while it is **armed**: before it first showed content,
  and again each time its `on(x)` value changes. Otherwise a change below it holds (H-5). Put a read that waits on
  `x` inside the `loading on(x)` region; a read of it outside holds the change (CN-3e).
- `pending? x` is true while a new answer for `x` is out; `latest x` is the value `x` is moving to (R-9). Use them to
  show work in progress without a fallback.
- Only the probe reads ahead. Beside it, a plain read of the same `x` shows what is on screen, and a plain read of
  another held value waits for its change, probe or not (R-11). `loading on(latest x)` shows its fallback at once;
  `loading on(x)` shows it with `x`'s change (H-6).
- `await e -> v` gives `v` until the first answer, so there is no first-load wait (R-7).

## Failures

- A rejected `await` is an error value: it flows through every equation and prop that reads it (R-6).
- Every reader of a value that can fail needs an `errored` region above it (UNHANDLED_FAILURE, R-f-5).
  `errored fallback(e) { NotFound => { <p>{e.message}</p> } _ => { <Retry /> } } { … }` picks a fallback by class.
- `catch` follows an `await` only: `await f(x) catch (e) => alt` makes a matching rejection the answer
  (CATCH_NOT_ON_AWAIT, R-f-4). A handler or action that reads a value which can fail uses `try`/`catch`.
- Use class arms in any of these handlers: `try { … } catch (e) { Conflict => { … } _ => { … } }`.
  An `await` catch with arms uses a single expression per arm; a boundary uses markup; a statement catch uses
  statements. The first match wins and narrows `e` for that body. Cover the declared error row; an open row needs
  `_`, which can only appear once and last. A failure in a selected arm leaves the dispatch. Ordinary untyped
  handlers remain the short form for a single catch-all. See [07 §3–5](../spec/07-surface.md) and
  [ordered error arms](../spec/ordered-error-arms.md).
- An error stays on screen until a new answer replaces it: `refresh x` (quiet) retries; changing an input asks a new
  question (H-12, D-41).
- A value borrowed from another section (a list passed into a detail) carries that section's failures: put its
  readers in an `errored` region of their own, or the other section's error shows in this one.
- A handler reads what its region shows, and passes it on as plain values.
- `throw NotFound(id)` in an equation's arm is a failure value: `found(it, id) => it == null ? throw NotFound(id) : it`.

## Collections

- `rows key id = …` or `source xs key id = …` keeps rows' identity by `id` (ST-4); `for r in rows` gives each row
  its own region. Write one row with `xs[i].field := v` or a functional write (W-6).
- `source xs = f(server)` is a client-owned layer over server data: written locally, reset when the server answer
  changes (ST-5). A write on server data guesses on the answers the screen reads (`async.md`, "Guesses go on the answer").

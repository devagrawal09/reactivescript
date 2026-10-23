# S-surface-1 — the concrete surface: types, imports, handlers, templates, `await*`

Rules: 07 §1–§5, R-io-4, W-6, E-11.

A program in the full `.rx` grammar. Types are TypeScript's and are kept
as text; `import pure` brings the prelude's value functions in; a JSX
handler is an imperative closure; `===` is `==`.

## Program

```
// a module: imports, declarations, then the mounted view
import pure { len, str } from "./prelude"
import { log } from "./prelude"              // io: callable only in imperative scope

type Todo = { id: number; title: string; done: boolean }

export source todos: Todo[] := [{ id: 1, title: "spec", done: false }]
source filter: "all" | "open" := "all"
shown: Todo[] = filter === "all" ? todos : todos.filter(t => !t.done)
summary = `${len(shown)} of ${len(todos)}`
export action toggle(id: number) { todos := ts => ts.map(t => t.id === id ? { ...t, done: !t.done } : t) }

export component Row(props: { todo: Todo }) {
  <li class={props.todo.done ? "done" : ""} onClick={() => { toggle(props.todo.id) }}>{props.todo.title}</li>
}

<main>
  <p>{summary}</p>
  <ul>{for t in shown { <Row todo={t} /> }}</ul>
  <button disabled={len(todos) === 0} onClick={() => { filter := filter === "all" ? "open" : "all" }}>{filter}</button>
</main>
```

## Frames

| instant | action                                                              | frame                      |
| ------- | ------------------------------------------------------------------- | -------------------------- |
| 0       | mount                                                               | `1 of 1 spec all`          |
| 1       | handler `toggle(1)`                                                 | `1 of 1 spec all`          |
| 2       | handler `filter := "open"`                                          | `0 of 1 open`              |
| 3       | handler `todos := ts => [...ts, { id: 2, title: "lex", done: false }]` | `1 of 2 lex open`       |

Instant 1: the functional write (W-6) toggles `done`; the row's `class`
changes, the text does not. Instant 3: a functional write appends.

## Rejected variants

```
-- reject: IO-2
import { log } from "./prelude"
source n := 1
m = log(n)
<p>{m}</p>
```

An `io` import called in reactive scope (R-io-3).

```
-- reject: W-2
source n := 1
m = (n := 2)
<p>{m}</p>
```

```
-- reject: SNAPSHOT_INITIALIZER
source form := { email: "a@x" }
source email := form.email
<p>{email}</p>
```

E-4 / DV-6: a snapshot must be written as one — `source email := peek(form.email)`.

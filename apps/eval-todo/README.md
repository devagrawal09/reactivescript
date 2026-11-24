# RX todos, evaluated live into Solid 2

A Solid 2 page (`@solidjs/web`, TSX through Solid's own compiler). Its apps are ReactiveScript strings, run with
`createEval(() => code(), { …bindings }, { interface })` (`frontend/eval`):

- **`src/todo.rx`**: a todo app with optimistic updates, all in RX. It guesses on `shown` (an optimistic source over
  the server's list) for toggle and delete, and on `adding` for a new row. Then it awaits the server. A failure rolls
  the guess back and sets `status`. A new todo is typed into an input bound to `draft`; the add button is
  `disabled={draft == ""}`, and since Enter in a form clicks its first enabled button, that one attribute guards both
  (plan v2 has no `if` statement in a handler, so the guard can't be a branch; the page's renderer stops a form in
  evaluated code from navigating). The host passes only `db` (the server's list, read only) and three server calls.
- **`src/inventory.rx`** (the "inventory" tab): an admin over the server's items, all in RX. It has a table with search,
  a category filter, a quantity sort and column toggles; an add/edit form with inline validation; a row toggle and
  delete; and a count summary. Every change is a guess that the server confirms or rolls back. It's there to stress
  the subset: what it can't say and the workarounds are in [`FINDINGS.md`](FINDINGS.md).
- **`src/editor.rx`**: a code editor in RX (a textarea, a keystroke count, the checker's verdict). It's evaluated three
  times: bound to `todo.rx`'s text, to `inventory.rx`'s, and to its own text, so it edits itself. Every accepted edit rebuilds it,
  and the page puts the caret back.

The host (`client/`) owns the fake server (latency slider, "fail every request"), each program's draft and running
text, and the checker. A draft is checked in a worker (`client/check-worker.ts`) once typing pauses, and runs once the
checker accepts it. The worker matters because the pinned RX parser hangs on some half-typed text (an unclosed tag at
the end). Until a draft is accepted, the last good version keeps running.

The editor needs plan v2.2 "DOM input" (`frontend/docs/EVAL.md`): attributes such as `value={code}`, and a handler that
takes its event (`onInput={e => { edit(e.target.value) }}`).

## Run it

From the repository root, after `sh scripts/setup.sh` (the Rust step isn't needed):

```sh
cd apps/eval-todo
npm install
npm run dev        # builds, watches and serves http://127.0.0.1:4190 (PORT to change it)
npm test           # the .rx files are accepted by the checker; misuse and FINDINGS.md's repros are refused
```

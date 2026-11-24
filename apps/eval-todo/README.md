# RX todos, evaluated live into Solid 2

A Solid 2 page (`@solidjs/web`, TSX through Solid's own compiler). Its apps are ReactiveScript strings, run with
`createEval(() => code(), { …bindings }, { interface })` (`frontend/eval`):

- **`src/todo.rx`**: a todo app with optimistic updates, all in RX. It guesses on `shown` (an optimistic source over
  the server's list) for toggle and delete, and on `adding` for a new row. Then it awaits the server. A failure rolls
  the guess back and sets `status`. The host passes only `db` (the server's list, read only) and three server calls.
- **`src/editor.rx`**: a code editor in RX (a textarea, a keystroke count, the checker's verdict). It's evaluated twice:
  once bound to `todo.rx`'s text, and once bound to its own text, so it edits itself. Every accepted edit rebuilds it,
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
npm test           # todo.rx and editor.rx are accepted by the checker; misuse is refused
```

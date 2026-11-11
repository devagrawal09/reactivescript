# Eval demo

A local page that renders ReactiveScript posted to an endpoint. It uses the fork's existing eval forms (`frontend/eval`,
`docs/EVAL.md`): posted code is a **markup eval** (`createEval(() => code, bindings, { interface })`) or, with `?type=`,
a **value eval** (`label: string = eval(formula, {…})`). Nothing here changes the eval runtime.

## Run it

From the repository root, after `sh scripts/setup.sh` (the Rust step is not needed):

```sh
cd apps/eval-demo
npm install
npm start                      # builds dist/app.js, serves http://127.0.0.1:4180 (PORT to change it)
npm run post                   # in another terminal: posts samples/* one by one, 1.5 s apart
npm run post -- todos --delay 0
curl -X POST --data-binary @samples/01-counter.rx http://127.0.0.1:4180/eval
npm test
```

The server binds to 127.0.0.1 only.

## Endpoints

| | |
| --- | --- |
| `POST /eval` | text body = the code. `?syntax=tsx` for TSX syntax (default `rx`), `?type=string\|number\|boolean` for a value eval. Answers `201` with the entry, `422` when the checker refuses it (the entry is still kept, with its diagnostics), `400` for a bad request. |
| `GET /history` | every entry, oldest first |
| `GET /events` | Server-Sent Events: `history` (the whole list) on connect, then `entry` for each new one |

## The page

- **Bindings**, the only names posted code can use (`src/interface.ts`): `count` and `increment()`, a `todos` store
  with `addTodo(text)` and `toggleTodo(id)`, and `fetchUser(id)`, a pure host that answers after 700 ms.
- **Result**: the selected entry, evaluated under an `Errored` boundary (refusals and runtime errors show as a panel
  with each diagnostic) and a `Loading` boundary.
- **History**: every entry; follows the newest unless you step back.

New code replaces the old evaluation: the old subtree and its own state are dropped and the new code starts fresh. The
bindings live outside every evaluation and keep their state.

## How code is compiled

RX code is checked and compiled in the page: frontend, pinned checker, plan v2, then `plan/solid-plan.ts` on Solid 2.
TSX lowering needs Oxc, which is a native module, so TSX code runs from the plan the server compiled when it was posted
(the same "host's eval table" idea rust-solid uses). The browser build stubs the Node-only modules the RX path never
calls (`client/stubs/`). The server checks every POST with the same compiler, so the poster gets diagnostics at once.

`scripts/smoke.ts` drives a running server in headless Chromium (`CHROMIUM=/path/to/chrome`), using the frontend's
Playwright.

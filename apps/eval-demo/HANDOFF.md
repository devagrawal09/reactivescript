# Handoff: eval RFC and the eval demo app

Branch `handoff/eval-demo` (same commits as `eval-demo`) on devagrawal09/reactivescript, based on `solid-model`
(c777377). Read this file, then `docs/eval/RFC.md`, then `frontend/docs/EVAL.md` (the spec of the eval the fork already
has). For the rest of `solid-model` (frontends, plans, rust-solid, Frames) start at `docs/HANDOFF.md`.

## Goal

Two tracks, both about one feature: `eval` in ReactiveScript, which takes `.rx` code as a string while the program runs,
gives it named bindings from the surrounding component, checks it with the same checker as authored code, and runs it.

- **Track A, the RFC** (`docs/eval/RFC.md`): a short proposal for Ryan, for ryansolid/reactivescript.
- **Track B, the demo** (`apps/eval-demo/`): a local app with an HTTP endpoint that receives ReactiveScript and a single
  page that renders the eval result.

Both use the two eval forms that already exist on `solid-model` (slice 3, `frontend/eval/`), and add nothing to them:

```rx
<div>{eval(code, { count, bump })}</div>                      // markup eval: renders the code's UI
label: string = eval(formula, { count }, { type: "string" })  // value eval: one typed scalar
```

TSX: `createEval(() => code(), bindings, options)`. A record-returning eval (values, actions and UI from one call) was
considered and moved to the RFC's "Alternatives" and open question 4.

## What's done

### The RFC (`docs/eval/RFC.md`)

A draft, not posted anywhere. Summary, motivation (generated UI, playgrounds, plugins), the grammar of both forms, three
examples (counter, todos, async fetch), semantics, the capability model, limits, six open questions, alternatives, and
a prototype section with the fork's verification numbers. The three examples were checked with the fork's compiler as
written (the todos example was adapted to the plan v2 subset: no functional writes, spreads or index reads).

### The demo (`apps/eval-demo/`)

| Path | What |
| --- | --- |
| `src/server.ts` | Node HTTP server on 127.0.0.1 only. `POST /eval` (text body; `?syntax=tsx`, `?type=string\|number\|boolean`), `GET /history`, `GET /events` (Server-Sent Events). Every POST is checked with `frontend/eval/compile.ts`; refused code is kept in the history with its diagnostics (422). |
| `src/history.ts` | The in-memory, append-only history and its listeners; parsing a request's options. |
| `src/interface.ts` | The binding interface every evaluation gets. |
| `client/main.ts` | The page: bindings panel, result (under `Errored` and `Loading`), history with back/forward and "follow latest". |
| `client/dom.ts` | Solid 2's universal renderer (`@solidjs/universal` `createRenderer`) over the browser DOM, plus a small `h()` for the page's own chrome. |
| `client/bindings.ts` | `count` + `increment()`, a `todos` store + `addTodo(text)` / `toggleTodo(id)`, `fetchUser(id)` (a pure host that answers after 700 ms). |
| `client/stubs/` | Browser stand-ins for the Node-only modules on the compile path that RX code never calls (Oxc, Solid's native compiler, `node:url`). |
| `samples/` | Eight snippets: counter, local state, todos, async user, a value eval, TSX syntax, and two that the checker refuses. |
| `scripts/` | `build.ts` (esbuild bundle), `post-samples.ts` (posts samples to a running server), `smoke.ts` (headless Chromium run). |
| `test/` | 15 spec-style tests (`node --test`). |

How code runs: **RX code compiles in the page** (frontend, pinned checker, plan v2, then `plan/solid-plan.ts` on
Solid 2). **TSX-syntax code runs from the plan the server compiled** when it was posted, because TSX lowering uses Oxc,
a native module. This is the same "host's eval table" idea rust-solid uses. New code replaces the old evaluation: its
subtree and own state are dropped (the fork's keyed-`Show` semantics); the bindings live outside and keep their state.
The page says so.

## What was tested, and what wasn't

Tested (last run 2026-11-17, Node 22.23, pinned Solid rc.21 build from `scripts/setup.sh`):

- `npm test`: 15/15. Request parsing (defaults, `?type`, `?syntax`, 400s), history numbering and listeners, every
  sample checks as its name says (refused ones refused, with `PLAN` and `READ_ONLY`), and the HTTP contract (POST answers
  201/422 and an open event stream receives the entry).
- `scripts/smoke.ts` against a running server in headless Chromium 157 (from nixpkgs), all eight samples, console
  clean: counter clicks update the binding; local state starts fresh when the code changes while `count` keeps its
  value; todo toggle and add go through the bound actions; the async sample shows its loading fallback and then the
  user, and refetches when `count` changes; the value eval shows `"count=2, todos=3"`; TSX code runs from the server
  plan; both refusals show in the error panel with their diagnostics; stepping back through history re-renders an older
  entry.

Not tested:

- A real browser by hand, or any browser other than headless Chromium. Mobile layout was only looked at in CSS.
- The Rust legs. The demo runs only the JS plan runtime; `rust-solid` wasn't built for this work.
- Runtime errors other than checker refusals (for example a host that rejects). `fetchUser` never fails, so the
  async sample's `errored` branch never shows.
- Many open pages at once, reconnecting after the server restarts (the history is in memory, so it's lost), and large
  or hostile input beyond the 64 KiB body cap.
- Node 24 (the repo pins 24.18; this ran on 22.23).

## How to run it

```sh
sh scripts/setup.sh                 # from the repo root; the final cargo step isn't needed for the demo
cd apps/eval-demo
npm install
npm start                           # builds dist/app.js and serves http://127.0.0.1:4180 (PORT changes it)
npm run post                        # another terminal: posts samples/* 1.5 s apart (or: npm run post -- todos --delay 0)
curl -X POST --data-binary @samples/01-counter.rx http://127.0.0.1:4180/eval
curl -X POST --data-binary '"n=" + count' 'http://127.0.0.1:4180/eval?type=string'
npm test
CHROMIUM=/path/to/chrome node --experimental-strip-types scripts/smoke.ts   # needs the server running
```

The bindings posted code can use:

```
read count: number
action increment()
store todos: { list: { id: number, text: string, done: boolean }[] }
action addTodo(string)
action toggleTodo(number)
pure host fetchUser(number): { id: number, name: string }
```

## Findings worth knowing

- **Async eval code needs its own `errored`.** The code is checked as a separate component, so a reader of a host that
  can fail needs a boundary inside the code (`UNHANDLED_FAILURE`, rule R-f-5). An `Errored` around the eval site still
  catches refusals but doesn't satisfy the check. This is in the RFC's "Limits".
- **The checker and TSX lowering are Node-only.** Oxc and Solid's compiler are native. The RX path runs in a browser
  once those imports are stubbed; the bundle is about 2.7 MB with its source map.
- **Solid 2 `For` passes rows as values**, not accessors, and the universal renderer's `insert` without a marker
  replaces a parent's other children; `client/dom.ts` gives each reactive child its own marker.
- While the async sample refetches, the old user stays on screen until the new one lands (Solid 2 keeps the settled
  value during a transition); the loading fallback shows only on first load.

## Open decisions for Dev

1. **Value eval: scalars only, or arrays and records too?** Today a value eval returns one number, string or boolean.
   The interface grammar and plan types already describe arrays and records, so lifting the limit looks small on the
   type side; the runtime check and the RFC's grammar would change.
   *Recommendation:* keep the RFC at scalars, as built and verified, and leave structured results as open question 4.
   Verified scalars are a stronger first ask than an unverified extension; structured results can follow once Ryan
   agrees on the shape.
2. **Where the RFC goes.** It's written for ryansolid/reactivescript. The choices are a GitHub Discussion, an issue,
   or sending it to Ryan directly first.
   *Recommendation:* send it to Ryan directly first. It asks him to adopt something designed outside his repo, and it
   cites a fork, so a private first read avoids a public thread he didn't start. Then post it where he prefers.
3. **Whether the RFC links this demo.** It now exists on a public branch of the fork (if the fork is public).
   *Recommendation:* link it in the "Prototype" section with the run commands; a page that renders posted code is the
   quickest way to see the feature.
4. **State on swap** (RFC open question 1): fresh on every change (as built) or an opt-in `preserve`. No decision
   needed before posting; the RFC asks it.

## Next steps

1. Dev decides 1–3 above; then finalize `docs/eval/RFC.md` (add the demo link if wanted) and send or post it.
2. If structured value results are wanted: extend `eval/compile.ts`'s value-eval type check and `runtime.ts`'s
   result check to arrays and records, add cases to `eval/eval.test.ts`, and run the eval fuzz.
3. Demo, if it's kept: an editor box on the page that POSTs (so no curl is needed), a failing `fetchUser` sample to
   show the `errored` branch, and persisting history to a file.
4. Nothing here touches upstream; an upstream `eval` still needs the parser site forms, a binding-reference fact in
   CP-6 and a compiler lowering (`frontend/docs/EVAL.md`, "Upstream").

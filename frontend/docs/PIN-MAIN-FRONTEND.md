# Moving the frontend to ReactiveScript main e650b85 and Solid main 30e7805e

From ReactiveScript fdbcad92 + Solid 2105ffb8 (2.0.0-rc.21) to ReactiveScript e650b85 + Solid 30e7805eb (the commit
e650b85's `ref/SOLID_NEXT` names; solid-js 2.0.3). Branch `pin-main`. Each re-recorded artifact below says what
changed upstream, what changed here, and the evidence. Expected numbers that involve the Rust legs are not
re-recorded: the Rust port is moved in other branches (`pin-main-rust-engine`, `pin-main-rust-render`), and those
numbers are re-measured after it lands (below, "For the Rust branches" and "Left for after the Rust port").

How old-pin evidence was taken: the frontend at `70edf62` (before the move) was copied out of the `rx-eval-todo`
worktree (Solid rc.21 built) into `/tmp`, and upstream trees at chosen commits were `git archive`d into `/tmp`; the
pinned checkouts were never touched and stay clean.

## Solid main changes the JS legs had to follow

### Solid compiles `<Show>` to a ternary in production builds (96ffcf7b, #4730)

- Solid: a `<Show>` with JSX children, `when` and at most `fallback` (no `keyed`, no spread) compiles to the ternary it
  renders, wherever that ternary is tracked (compiler `src/shared/lower_show.rs`). Dev builds keep the component.
  Every native leg here is compiled with the defaults (production shape), so native's host log changed: a lowered Show
  inserts its marker before it creates its branch.
- Here: `plan/solid-plan.ts` (the JS plan interpreter, also createEval's runtime) lowers Show exactly as the compiler
  does: as an element child `insert(el, (() => { const c = memo(() => test); return () => c() ? children : fallback;
  })(), marker)`; in a component position `memo(() => memo(() => test)() ? children : fallback)`; a non-dynamic `when`
  is the plain ternary; and it keeps `createComponent(Show, …)` only where the compiler does (a lone Show as Show's or
  Loading's `fallback` attribute, a Show beside other views in a Show/Loading/Errored body). The rule is written in
  `plan/docs/PLAN-V2.md`, "Construction order".
- Evidence: the compiler's output for each position and `when` form (element child, component root, sole child of
  Loading/Show, For row, Errored fallback, fallback attribute, nested; `x()`, `!x()`, `&&`, `||`, comparison,
  conditional, store member, local) was read from `@solidjs/compiler` at the pin; after the change the plan and
  createEval legs equal native entry for entry in the eval slices, the tracker-async scenario and every accepted plan
  and eval fuzz program on seeds 1–100 (v2 and v2.1). With `lowerShow: false` on the native side and the old
  interpreter, the eval slice legs agree too, which isolates the cause.
- Compiled RX does not follow: upstream's `ref/compile/emit.ts` writes every RX `if` as `<Show when fallback={(…)()}>
  {(__item) => { … }}</Show>`, a block-bodied callback the compiler never lowers. That is an upstream lowering
  difference, handled as the existing upstream classes are: a new root-cause probe `UPSTREAM_RX_SHOW`
  (`plan/fuzz/run.ts`) replays native compiled with `lowerShow: false` (the only change on the native side) and
  classifies the program upstream only if compiled RX equals that trace exactly (alone, or with the AC-3 / path
  probes). The outcome keeps that trace (`nativeShow`), and the tests assert RX equals it. Never agreement.
  `docs/UPSTREAM-ISSUES.md` has the entry.

### Delegated events add a capture listener (b9475d749, #5017)

- Solid web: `attachDelegatedEvent` now adds `container.addEventListener(name, resetDelegatedEvent, true)` before the
  delegated handler, so each container gets one more host call per event type.
- Here, re-recorded host-log lengths (one delegated `click` each): eval slice 363 → 364
  (`slices/eval.test.ts`), eval-async slice 295 → 296 (`slices/eval-async.test.ts`), tracker on the recording host
  453 → 454 (`plan/plan-fuzz.test.ts`), tracker-async 399 → 400 (`slices/tracker-async.test.ts`).
- Evidence: the native static twin's / native's full logs at both pins, `{fn}` ids normalized: the only difference
  is one `["addEventListener", 0, "click", …]` right after the first one (plus, in the eval slice, the Show lowering
  above). No other entry differs.

### Numeric text reaches the renderer as a string (842144cc5, #5112)

- Solid universal: `{n}` with a number now passes `"2"`, not `2`, to `createTextNode`/`replaceText`.
- Here: `plan/plan-fuzz.test.ts` "the tracker gives native Solid's host log once its number hole inserts a string"
  pinned the rc.21 difference (the idiomatic `{unassigned()}` differed from the coerced `{"" + unassigned()}` at
  exactly the hole's text values). It now asserts the two give one host log, entry for entry. Same test name.
- Evidence: at rc.21 the idiomatic log differed from the coerced one at 18 entries; at the pin at 0.

### SSR hydration keys: one id slot fewer before the tracker's rows (96ffcf7b again)

- Solid's server build lowers the tracker's `<Show>` too; the ternary under `_$scope` takes one id slot fewer than
  the `Show` component did.
- Here: `ssr/ssr.test.ts` `TRACKER_HTML` (Solid's own `renderToString` of the canonical twin) rows 70x0 → 60x0; the
  idiomatic twin's 80x0 → 70x0 (the one-slot relation is unchanged), and the fail-closed test's key arithmetic.
- Evidence: the compiled server modules at both pins differ exactly by `Show(new _P$2(…))` → the lowered ternary;
  Solid's own HTML hydrates on the prod and dev client builds and replays the scenario.

### seroval 1.8 (Solid main's dependency)

- `frames/harness.ts` hardcoded the pnpm store folders `seroval@1.7.0` / `seroval-plugins@1.7.0_seroval@1.7.0`; every
  frames page 404'd. The folders are now read from `@solidjs/web`'s own `node_modules` links. No expectation changed.

## ReactiveScript changes

### Upstream strict tsc baseline: 12 → 40 (`baselines/upstream-tsc.txt`)

- Upstream: MO-10 (`0b30229`) added `export type Shape` to `ref/src/parse.ts`; `ref/src/content.ts` already exported
  another `Shape` (SV-7d, `f3c6771`), and `check.ts` imports both. Upstream runs its sources with
  `--experimental-strip-types` and has no tsc step.
- Here: the 28 new lines (2 TS2300 "Duplicate identifier 'Shape'" and their consequences, in `check.ts` and
  `signature.ts`) are recorded; the 12 old ones are all still present. `scripts/check-types.ts` also strips this
  checkout's absolute path from a diagnostic (two new ones print `import("/…/upstream/ref/src/…")` types), so the
  baseline is the same on every machine.
- Evidence: tsc with the package's options on only `upstream/ref/src/check.ts` and `signature.ts` gives exactly
  those 28. Package diagnostics stay 0.

### TSX fuzz, seeds 0–199: 179 + 21 listed → 184 + 16 listed (`baselines/fuzz-upstream.json`, `tsx/fuzz.test.ts`)

- Upstream: `f51bb5e` (#33) "interpreter: a functional guess sees the screen; two actions guessing one slot are one
  hold" (interpreter only).
- Here: seeds 17, 92, 103, 149, 199 (all U1) now agree on all five legs and leave the list; the smoke test's exact
  list on seeds 0–19 is `[14]`. No new seed; the 16 left are the same class.
- Evidence: the pre-move frontend against archived upstream trees: those seeds are interpreter-only at fdbcad9,
  `c746908^`, `c746908`, `f51bb5e^`, and agree at `f51bb5e`; 14 and 40 stay interpreter-only throughout.

### Upstream runners (`pins.json` `upstreamBaseline`, measured)

`test` 111/1 → 135 pass, 0 fail (S-store-8 passes since `c746908`); `oracle` and `compiled` 112 → 135 pass, 0 fail,
0 skip; `types` 152 → 181 pass; `ssr` 105/0/7 → 127 pass, 1 fail, 7 skip. The ssr failure is upstream's
"Frames [hydrated late] hydrating after instant 0: … 404 (Not Found)" on this machine (Chrome, `NODE_PATH` the
frontend's `node_modules`, as `verify-pinned.sh` runs it); not investigated further, recorded as measured. The checkout
stayed clean.

## Refused: upstream surface the frontend paths do not port

New at e650b85, refused by name in every plan builder (v1 `resolve.ts`, v2/v2.1 `resolve-v2.ts`, v2.2
`resolve-frames.ts`) and so in emit.ts, the plan fuzz and createEval/`eval` (a `PLAN` diagnostic):

| Form | Upstream | Diagnostic |
| --- | --- | --- |
| `guess x := v` on a `:=` signal or store | d3cab00, 07 decision 21 (a createOptimistic layer over the writable) | `a guess on a writable signal or store (upstream 07 decision 21: …) is outside plan v2: x` |
| a guessed question source also written plainly | d3cab00 (the write goes to the truth under the layer) | `a guessed source that is also written plainly (…) is outside plan v2: x` |
| spread attribute `<p {...e}>` | 2674ecd, 07 §4 | `a spread attribute (`{...e}`, 07 §4) is outside plan v2` |
| object rest `{ a, ...rest } = e` (Expr `omit`) | 08255de, RG-4b | `an object rest (…, Solid's omit; RG-4b) is outside plan v2` |
| destructuring of a value that is not a name or path (its `$$n` temporary) | 08255de | `a destructuring of a value that is not a name or a path (…) is outside plan v2` |
| imported `.d.rx` library declarations (`ref` params, `instantiates`) | 0b30229, MO-10 | `a .d.rx library declaration (`ref` parameters or `instantiates`, MO-10): f is outside plan v2` |
| destructuring defaults, array destructuring | 08255de | refused by the existing expression rules (`unsupported literal undefined`, `unsupported expression index`) |
| destructuring `let` | 08255de | several `let`s, refused as hand-written `let`s are |
| any AST kind or field the pinned `ref/src/ast.ts` does not define (rx/integ's error `arms`, `as`, computed record keys, …) | after e650b85 | `` `arms` on `errored` (RX surface newer than the pinned ReactiveScript) is outside plan v2 ``; `plan/surface.ts` keeps the allow list, re-read on every pin move |

Not refused, because they are parse-level sugar whose AST is the hand-written expansion's, checked byte for byte in
`plan/plan.test.ts` ("unsupported shapes…"): `else if c { … }` (= `else { if c { … } }`) and a destructuring
declaration over a name or a path (= one equation per name). The TSX frontend refuses destructuring and spreads as
before ("outside the verified subset: ObjectPattern" / "setup binding or statement"); TSX's `createOptimistic` setters
always lower to guesses on a question source, so TSX never reaches the refused guess shapes. New checker codes
(`GUESS_ON_DEFERRED`, `GUESS_WHILE_LOADING`, `CATCH_NOT_ON_AWAIT`, `STALE_CAPTURE`, `ARGUMENT_COUNT`, `UNBOUND` for
`props` in `component C()`) only refuse more; the frontends pass the checker's diagnostics through unchanged.
`GUESS_NO_QUESTION` / `OPTIMISTIC_NO_QUESTION` are retired upstream; the comments that named them now name the plan
refusal.

## Measured state at the end (JS legs)

- Suite (`tsx yield slices plan eval ssr`, Rust env set as the gate does): 149 tests, 134 pass, 15 fail; each of the
  15 fails on a Rust leg only (list below). Without the Rust env: 137 registered, 132 pass, 4 skipped, 1 fail,
  "tracker-frames: the dev builds hydrate T, N, J and R…" (J's dev run misses the failing claim at step 15), which
  fails the same way at the old pin without `RUST_FRAMES` (checked on the pre-move frontend with rc.21): a
  pre-existing dependence of that test on the R leg running, not part of this move. With `RUST_FRAMES` it passes.
- `npm run check`: 0 package diagnostics, 40 upstream (baseline 40).
- TSX fuzz 0–199: 184 agree + 16 listed (matches `baselines/fuzz-upstream.json`).
- Plan fuzz 1–100, JS legs: 30 agree, 55 `UPSTREAM_RX_SHOW`, 15 refused, 0 JS divergence. v2.1: 73 agree, 11
  `UPSTREAM_RX_SHOW`, 16 refused. Every accepted seed currently also differs on the Rust leg.
- Eval fuzz 1–100, JS legs: 85 agree + 15 refused; v2.1: 84 + 16 (unchanged); every accepted seed differs on Rust.
- SSR fuzz 1–100: Solid's HTML hydrates and replays on all 85; 83 Rust HTML differences, 0 hydration failures of
  Solid's. v2.1: 59 agree, 25 Rust stream differences, 16 refused.
- Placement fuzz 1–100, T/N/J only: 50 agree, 42 client-only, 7 refused, seed 19 divergent: the baseline exactly. A
  run with `--rust` while other browser tests ran concurrently showed extra J/N divergences on 56, 57, 58, 65, 66, 67;
  each agrees alone and in a clean full rerun: load timing, not a behavior change. The same for one failure of "PL pin
  PL-3d" (last frame `modeOne open`), seen once in about eight runs under load and never alone.

## For the Rust branches (what the JS legs now expect)

- The plan consumer must lower Show as `plan/docs/PLAN-V2.md` "Construction order" now says (Solid #4730); the
  reference is `plan/solid-plan.ts` `lowerShow`/`fragment`.
- The recording host's delegated events: one extra `addEventListener(container, name)` (the capture listener) before
  the handler's, per container and event type (#5017).
- Numeric text is passed to the renderer as a string (#5112).
- SSR: Solid's server output for a lowered Show (one id slot fewer; e.g. tracker rows `_hk=6000`), and main's
  hydration bootstrap script (`_$HY` event capture records `[s, o, n]`).

Failing now on the Rust leg only:
`eval/eval.test.ts` eval fuzz (v2 and v2.1), `plan/plan-fuzz.test.ts` (seeds 1..12, tracker, probe test, v2.1 seeds
1..10), `slices/eval.test.ts` and `slices/eval-async.test.ts` (the static-twin test), `slices/tracker-async.test.ts`
("on the recording host"), `slices/tracker-frames.test.ts` (R), `ssr/ssr-async.test.ts` (generated v2.1 programs),
`ssr/ssr.test.ts` (Rust tracker HTML, its hydration, the fail-closed test, generated programs).

## Left for after the Rust port

- `baselines/plan-fuzz.json`, `plan-fuzz-async.json`: their `agree` counts include Rust. When Rust equals native on
  the JS-agreeing programs, the expected values are v2 30 agree + 55 upstream (`UPSTREAM_RX_SHOW`, listed by seed in
  the run's `upstreamSeeds`) + 15 refused, and v2.1 73 + 11 + 16; then add the class and seeds to each baseline's
  `upstream` block (`scripts/report.ts` now accepts one for v2.1 too, and checks the full seed list).
- `baselines/eval-fuzz*.json`, `ssr-fuzz*.json`, `frames-fuzz.json`: re-measure with Rust; the JS legs match the old
  counts.
- The repository root's `README.md` and `docs/HANDOFF.md` (outside `frontend/`, not edited here) still state rc.21
  numbers: 12 upstream tsc diagnostics, fuzz 179 + 21, plan/eval/SSR 85 + 15, the S-store-8 note.

## Frames tests timing

The browser frames tests (`slices/tracker-frames.test.ts`, `plan/frames.test.ts`, the placement fuzz) failed
intermittently after the move, the native T and N legs included. Cause: **(a), a race in the harness's step detection**
(`frames/harness.ts` `settle`), not nondeterminism in Solid main. It is present at the old pins too. This machine's load
exposes it: a shared 20-core host at load average 17–54 while the other agents worked. The old baseline (147–149/149)
was measured under less load.

**The race.** A step ended after five quiet 20 ms page turns: frame, frames seen and request count unchanged, nothing in
transit inside the proxy. Two kinds of page work were invisible to that test:

1. A response the proxy had just released, still on its way to the page. Instrumented runs (page timestamps of fetch,
   response, body and frame mutations, drained after each step) caught failing steps where the released response
   reached the page 5 ms and 102 ms *after* settle had ended. The step had recorded the frame from before the response:
   `step 15: frame "…Assigned #3 to me", expected "…Could not assign #2"`, and `step 9: open#2 is not a held request`
   (the response's follow-up requests came after the step).
2. Modules Solid imports lazily. The server-function client `import()`s `@solidjs/web/serialization/decode` (and through
   it seroval's chunks) when it first decodes a response, and the frames client loads its tiers the same way. With only
   (1) fixed, the remaining failures were all step 15. The harness server's log shows `decode.js`, seroval and
   `validator.js` served 73–93 ms before settle ended: the graph was still loading when the step was recorded.

**The fix** (`frames/harness.ts`): settle first requires that nothing is in flight or queued, then the same five quiet
turns.
- Every fetch the page issued has reached the proxy: the prelude counts issued fetches, the proxy counts received ones.
- No request is in transit in the proxy (as before).
- Every released response has reached the page in full: the prelude reads a clone of each response to its end.
- The page has no pending timer of at most 1 s, no pending idle callback and no pending dynamic import. The prelude
  counts timers and idle callbacks. Every `import(x)` in a served module is rewritten, through oxc's AST, to
  `__framesImport(x, import.meta.url)`: the same import, resolved against the same module, counted until it settles.
  G4 still checks the modules as served by Solid's dist.

Nothing compared changed: the same frames, frames seen, requests, host logs, DOM and wire records. There are no retries
and no longer sleeps. A page that never settles still fails ("the page did not settle").

**Rates** (Chrome, `RUST_*` set as the gate does, load average per run in parentheses where recorded):

| Run | Original harness | Fixed harness |
| --- | --- | --- |
| `slices/tracker-frames.test.ts` alone ×20, new pins | 6/20 runs fail (8 test failures) | 0/20 (load 11–26) |
| tracker-frames + `plan/frames.test.ts` + `ssr/*.test.ts` ×10, new pins | 7/10 runs fail (20 test failures) | 0/10 (load 17–33) |
| placement fuzz 1–100 `--jobs 4 --rust` ×3, new pins | extra divergent seeds in 1 of 3 runs (17, 21) | only seed 19, the listed one, in 3 of 3 |
| tracker-frames alone, CPU throttled ×4 and ×8 (`FRAMES_CPU_THROTTLE`), load 10–36 | 4/4 runs fail | 0/4 |
| full suite (149 tests) | 3 and 5 failures (lead's two runs) | 149/149 (load 25) |
| old pins (rc.21 / fdbcad92 frontend), tracker-frames alone ×20 | 15/20 runs fail | — |
| old pins, the three-file combination ×10 | 4/10 runs fail (18 test failures) | 9/10; the one failure is an ssr-async server-leg timeout (load 25), no frames test (load 25–43) |
| old pins, placement fuzz ×3 | 1, 7 and about 25 extra divergent seeds | — |

Fixing only (1) gave the new pins 0/20 alone and 0/10 combined at first. Later, under load 18–34, the combination failed
in 2 of 10 runs, all at step 15. The old pins under load 27–54 failed in 6 of 10. Both are cause (2), which the final
fix covers. The old-pin rows ran the old frontend copy against its rc.21 build and old rust-solid binaries, with the
same harness changes applied.

**Regression in 0a483dd, and its fix.** The first version of the fix made placement fuzz seeds 11, 33 and 42 invalid
("the page did not settle") on every run. My before/after fuzz comparison listed only divergent seeds, so it missed them.
On each of those seeds a step ends with six held responses unreleased. Chromium opens at most 6 HTTP/1.1 connections
per host, and a held request keeps its connection, so the page's next fetch (seeds 11, 42: 8 issued, 7 received) and the
module request of a dynamic import (seed 33: two `import('@solidjs/web/serialization/decode')` pending, every request
Playwright saw already served) wait inside the browser until a deliver step frees a connection. `settle` counted them
as in flight and waited for them forever. In the old harness they were invisible; they are part of the real page's
behavior and cannot change the frame before the next deliver.

`settle` now knows the connection limit (`CONNECTIONS = 6`, Chromium's `max_sockets_per_group`). While every
connection is taken by a request in the proxy or held unreleased (`starved`), nothing else can be in flight to the
harness. An unsent fetch and a pending dynamic import are then not waited for. Once a deliver step frees a connection
they are sent, and that step's settle waits for them as before. Otherwise both are waited for, as in 0a483dd.
Everything else is unchanged: released responses received in full, short timers, idle callbacks, then the quiet turns.
One case still rests on the quiet turns: while starved, an import whose modules have all arrived and are only being
evaluated, which needs no network and completes in the page's own tasks.

Verified at HEAD: placement fuzz 1–100 `--jobs 4 --rust` ×3 gives 50 agree, 42 client-only, 7 refused, divergent
[19], 0 invalid, R = N 93, and `checkFramesFuzz` against the baseline reports nothing, each time (load 12–13).
`slices/tracker-frames.test.ts` alone ×10: 10/10 each (load 10–20). The three-file combination ×5: 31/31 each (load
18–34).

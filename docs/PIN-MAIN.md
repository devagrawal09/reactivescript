# Moving the pins to ReactiveScript main and Solid main

Branch `pin-main`, 2026-11-24. The solid-model line moved from ReactiveScript `fdbcad92` + Solid `2105ffb8`
(2.0.0-rc.21) to:

| | Pin | |
| --- | --- | --- |
| ReactiveScript | `e650b85154c53912fa779c9badef73c1e2998b87` | solidjs/reactivescript `main`, 179 commits on |
| Solid | `30e7805eb1bbd9e2601d0252558e91d2547e96f4` | solidjs/solid `main` (2.0.3+), that commit's `ref/SOLID_NEXT`, 266 commits on |

This file is the index: what changed upstream, what changed here, what was re-recorded and why, and what is refused or
left open. The evidence per item is in three longer notes:

- [`frontend/docs/PIN-MAIN-FRONTEND.md`](../frontend/docs/PIN-MAIN-FRONTEND.md): the JS legs, baselines, refusals.
- [`rust-solid/docs/PIN-MAIN-ENGINE.md`](../rust-solid/docs/PIN-MAIN-ENGINE.md): the Rust engine ported to Solid main.
- [`rust-solid/docs/PIN-MAIN-RENDER.md`](../rust-solid/docs/PIN-MAIN-RENDER.md): the Rust renderer, plan consumer, SSR
  and Frames server.

## Setup

`scripts/setup.sh` and `frontend/pins.json` carry the new pins. `RX_REPO` is now `solidjs/reactivescript`; `RX_REPO`
and `SOLID_REPO` can be set to a local clone (`RX_REPO=/path/to/reactivescript sh scripts/setup.sh`). Solid still
builds with pnpm 11.1.1 (its `packageManager`). On a machine with no `chromium` on PATH the gate needs
`CHROMIUM=/usr/bin/google-chrome` (the browser tests hang without one).

## The language

RX guesses are written `guess x := v` (upstream c9177e3, #47); `optimistic` is no longer a keyword. Only the keyword
moved: the AST statement is still `k: "optimistic"`. Every `.rx` source, generator and fixture here uses `guess`
(`frontend/`, `apps/eval-todo/src/*.rx`, the Rust fixtures that embed RX text). The TSX fuzz's optimistic source was
named `guess`; it is `hunch` now.

Upstream surface that is new at `e650b85` and **refused by name** by the plan builders (and so by `createEval`), not
ported: a guess on a writable `:=` signal or store (d3cab00, "Guesses over writables"), a guessed source that is also
written plainly, spread attributes, object rest (`omit`), destructuring of a value that is not a name or a path, and
`.d.rx` library declarations (MO-10). The table with each diagnostic is in PIN-MAIN-FRONTEND.md, "Refused". `else if`
and destructuring over a name or path are parse-level sugar and work; a test checks their plans equal the hand-written
ones byte for byte. The checker's new codes (`GUESS_WHILE_LOADING`, `GUESS_ON_DEFERRED`, `CATCH_NOT_ON_AWAIT`,
`STALE_CAPTURE`, `ARGUMENT_COUNT`, `UNBOUND` for `props` of `component C()`) pass through unchanged; they only refuse
more.

So the eval checker accepts upstream main's `guess` on a question source (`source shown = db.list; … guess shown :=
…`), which is what the eval-todo snippets use. It does **not** yet accept main's newest form, a guess on a plain
writable: that is refused with a `PLAN` diagnostic, where upstream's language server accepts it.

## What Solid main changed, and what followed it here

| Solid change | Effect | Followed by |
| --- | --- | --- |
| #4730 (96ffcf7b): a `<Show>` with JSX children compiles to a ternary in production builds | host-op order, one id slot fewer on the server (tracker rows `_hk=7000` → `6000`) | `plan/solid-plan.ts`, the Rust plan consumer and server renderer, `fuzz/plan-diff.mjs`'s oracle; PLAN-V2.md "Construction order" states the rule |
| #5017 (b9475d74): delegated events add a capture `resetDelegatedEvent` listener | +1 host-log entry per container and event type | Rust renderer; recorded lengths 363→364, 295→296, 453→454, 34→35, 399→400 |
| #5112 (842144cc): numeric text reaches the renderer as a string | `createTextNode("2")`, not `2` | Rust renderer; the tracker number-hole test now asserts the two spellings give one log |
| #5043: the hydration bootstrap script | Frames documents | Rust frames server |
| #5152: `insert` tracks a rerun flag | renderer effect reruns | Rust renderer |
| engine refactor (#5137, #5140) and fixes (#4687 … #5161; 138 commits in `packages/signals`) | scheduler, lanes, guesses, async, boundaries, stores | the Rust engine, ported file by file from main; PIN-MAIN-ENGINE.md lists each |
| seroval 1.8 | module paths the frames harness served | `frontend/frames/harness.ts` reads them from Solid's checkout |

Rust-vs-Solid agreement with the Rust port unchanged, against Solid main, seeds 1–1000: slice1 950, slice2a 520,
slice2b 412, slice2c 714, render 420, strings 793, boundaries 356. After the port every valid program agrees again
(numbers below).

## Gates at the new pins

Frontend, `cd frontend && CHROMIUM=/usr/bin/google-chrome npm run verify:subset` (this machine, final HEAD):

| Step | rc.21 baseline | at the new pins |
| --- | --- | --- |
| pins, Rust build, `npm run check` | 0 package, 12 upstream diagnostics | 0 package, **40** upstream (re-recorded, below) |
| tests | 149 (147–149 passing; frames timing flakes) | **149 of 149** (after the frames harness fix, below) |
| TSX fuzz 0–199 | 179 agree + 21 listed | **184 + 16 listed** (re-recorded) |
| plan fuzz 1–100 | 85 agree, 15 refused | **30 agree, 55 listed upstream, 15 refused** (re-recorded; next section) |
| eval fuzz 1–100 | 85 agree, 15 refused | the same |
| SSR fuzz 1–100 | 85 agree, 15 refused, 0 HTML/hydration | the same |
| plan fuzz v2.1 1–100 | 84 agree, 16 refused | **73 agree, 11 listed upstream, 16 refused** (re-recorded) |
| eval fuzz v2.1 1–100 | 84 agree, 16 refused | the same |
| SSR fuzz v2.1 1–100 | 84 agree, 16 refused | the same |
| placement fuzz 1–100 | 50 agree, 42 client-only, 7 refused, seed 19 | the same, 0 invalid, R = N 93/93 |

`Result: PASS`. One caveat on how that run was made: in the single-command run Chrome itself aborted during the SSR fuzz
step ("D-Bus connection was disconnected", after the machine's session restarted), which left that step incomplete and
every other step green; the step was rerun alone into the same output directory (85 agree, 15 refused, 0 HTML or
hydration failures) and `report.ts` then passes. An earlier complete single-command run had the SSR fuzz green in
place.

### Frames tests timing

At the new pins the browser frames tests failed often (tracker-frames alone: 6 of 20 runs; with other browser tests
beside it: 7 of 10), on the native twin too. The cause was the harness, not Solid: a step ended after five quiet 20 ms
turns, which could pass while a released response was still on its way to the page, or while a module Solid imports
lazily on its first decode was still loading; the old frame was recorded. The same race fails as often at the old pins
on this machine under the same load (15 of 20 runs); the old 147–149 baseline was measured on a quieter one.
`frames/harness.ts` `settle` now waits for every issued fetch to reach the proxy, every released response to reach
the page in full, and no short timer, idle callback or dynamic import to be pending, and then for the same quiet
turns. What is compared did not change, there are no retries, and a page that never settles still fails (0a483dd).

That first fix broke placement fuzz seeds 11, 33 and 42 ("the page did not settle", deterministically): on those a
step ends with six held responses, Chrome's limit of connections per host, so the page's next fetch or lazy import
cannot leave the browser until a later step releases one, and `settle` waited for it forever. `settle` now knows the
limit: with all six connections held nothing else can be in flight, and the step that frees one waits for what goes
out then (63b593e). After it: tracker-frames alone 10 of 10 runs, the three-file combination 5 of 5, the placement
fuzz the baseline exactly on three runs. Evidence: PIN-MAIN-FRONTEND.md, "Frames tests timing".

Rust, `rust-solid/`: `cargo test` 175 passed; `cargo fmt --all -- --check`, `cargo clippy --all-targets -- -D
warnings` and `git diff --check` clean; scenario frames unchanged (tracker 13, like `["0","1","0","1","1"]` on v1 and
v2, tracker-async 18); `plan-diff` 454/454, 35/35, 400/400 (was 453, 34, 399: #5017). `node --test
dashboard/test.mjs` 3/3.

Rust fuzz modes, seeds 1–1000 (`node fuzz/run.mjs MODE --seeds 1000 --start 1`), each `summary.json` byte-identical to
the one now recorded (rerun on the merged branch, all seven `cmp`-identical):

| Mode | rc.21 | Solid main | Recorded summary |
| --- | --- | --- | --- |
| `--slice1` | 1000 | 1000 | unchanged |
| `--slice2a --no-reduce` | 991 (8 invalid, 629 fails closed) | 996 (4 invalid) | re-recorded |
| `--slice2b` | 1000 | 1000 | unchanged |
| `--slice2c --no-reduce` | 999 (493 invalid) | 1000 | re-recorded |
| `--render` | 993 (7 invalid) | 993 (7 invalid) | unchanged |
| `--strings` | 1000 | 1000 | unchanged |
| `--boundaries --no-reduce` | 985 (15 invalid) | 988 (12 invalid) | re-recorded |

Long frontend runs with the Rust leg, seeds 1–1000: plan fuzz 306 agree, 563 upstream (RX only), 131 refused, 0 Rust
differences; eval fuzz 869 agree, 131 refused; SSR fuzz `--dev` 869 agree, 0 HTML or hydration failures (summary
byte-identical to rc.21's); SSR fuzz v2.1 878 agree, 0 stream/HTML/hydration differences; plan fuzz v2.1 736 agree, 141
upstream, 122 refused, **1 divergent (seed 419: Solid's own Show lowering changes the frames, below)**, 0 Rust differences; eval fuzz v2.1 878
agree, 122 refused.

## Re-recorded, and why

Nothing was re-recorded to hide a difference between a leg we own and native Solid. Each item names the upstream
change; the evidence is in the note linked.

| What | Change | Why | Evidence |
| --- | --- | --- | --- |
| `baselines/upstream-tsc.txt` | 12 → 40 upstream strict diagnostics | upstream 0b30229 (MO-10): `check.ts` imports `Shape` from two modules; tsc on upstream's files alone gives the same 28 | FRONTEND, "Upstream strict tsc baseline" |
| `baselines/fuzz-upstream.json`, smoke list `[14, 17]` → `[14]` | 21 → 16 interpreter-only seeds | upstream f51bb5e fixed five | FRONTEND, "TSX fuzz" |
| `baselines/plan-fuzz.json`, `plan-fuzz-async.json` | 85/0/15 → 30/55/15; 84/0/16 → 73/11/16 | Solid #4730 against upstream's emit shape | next section |
| host-log lengths in slice tests, `plan-diff` | +1 each | Solid #5017 | FRONTEND, "Delegated events" |
| tracker number-hole test | asserts equality now | Solid #5112 | FRONTEND |
| SSR tracker keys, `ssr` and `ssr-async` corpora, `tests/ssr.rs` | keys after a Show | Solid #4730 | RENDER, "Re-recorded fixtures" |
| `render-units.json`, the three plan oracles | strings, the reset listener | #5112, #5017 | RENDER |
| plan-fuzz, plan-fuzz-async, eval, eval-async corpora (Rust fixtures) | native's logs; 5 async scenarios | #4730, #5017, #5112, #5094 | RENDER |
| frames corpus (`--max 12`; seed set changed) | every document | #5043, #4730 | RENDER |
| slice2a, slice2c, boundaries summaries (and held-out 2b) | which programs Solid itself cannot run | #4717, #4729, #4785, #4908, #5008, #5101, #5161, bisected per seed | ENGINE, "Re-recorded summaries" |
| 16 engine unit traces | regenerated by their own tools | per trace | ENGINE, "Test fixtures re-generated" |
| `pins.json` `upstreamBaseline` | test 135/0 (S-store-8 passes), ssr 127/1/7 | measured | FRONTEND, "Upstream runners" |
| eval slice fixtures, saved plans | `guess` spelling | upstream #47 | FRONTEND |

Not re-measured at Solid main, so still rc.21's and **outside the verified claims** until rerun: the held-out ranges
(1001–3000) of the plan, eval, SSR, render and placement fuzz; the placement fuzz 1–1000 summary (one run, under load:
447 agree, 405 client-only, 109 refused, 39 divergent, R = N on 886 of 891; not byte-reproducible).

## The plan fuzz baseline: 85 agree → 30 agree + 55 upstream

This is not a loosened check. "upstream" is never counted as agreement, and the class has an exact probe.

**1. Every leg we own still equals native Solid on all 55** (seeds 1–100, run `.out/verify2`, from each seed's saved
`traces.json`; the native leg is Solid's production build of the TSX twin):

| Leg | Equal to native, full trace (frames and host log) |
| --- | --- |
| the plan on `plan/solid-plan.ts` | 55 of 55 |
| Rust (`plan-trace`) | 55 of 55 |
| `createEval` (the eval fuzz splits the same 85 programs: static twin, createEval, plan, Rust) | 85 of 85, 0 divergent |
| compiled RX (upstream's compiler) | 0 of 55 on the host log; **55 of 55 on the frames**; same number of log entries (17302 in total on both) |

So only upstream's own leg differs, and only in the order of host operations: what the user sees is the same on every
step. The v2.1 fuzz is the same picture on its 11: plan 11/11, Rust 11/11, RX frames 11/11. On seeds 1–1000 Rust
equals native on all 869 accepted programs.

**2. Root cause: one, and it is not our harness.**

- Solid 96ffcf7b (#4730, 2026-11-09, after the old pin): the production compiler lowers a `<Show>` "that needs no
  component" to a memo of `!!when` and a ternary. `packages/compiler/src/shared/lower_show.rs` keeps the component for,
  among others, "a callback that is not one identifier param with a JSX body".
- Upstream's `ref/compile/emit.ts` (`case "mif"`, unchanged since 8d72ba8, 2026-10-24) writes every RX `if` as
  `<Show when={c} fallback={(() => { … })()}>{(__item) => { const __o = __rt.owner(); return …; }}</Show>`: a
  block-bodied callback. The compiler keeps it as `createComponent(Show, …)`.
- The TSX twin's `<Show when fallback>children</Show>` is lowered. A ternary and a Show component create their nodes
  in a different order, hence classes such as `createTextNode-createElement`.
- We compile RX through upstream's own `compileModules` and `lowerViews` (`#rx/compile/emit.ts`, `#rx/compile/jsx.ts`),
  with the options upstream passes (no `dev`, so `lowerShow` defaults on). Nothing in how the fork invokes upstream is
  stale. At the old pin the compiler lowered nothing, so the two shapes gave one log.

Minimal repro, `cd frontend && node --experimental-strip-types --conditions=browser scripts/show-repro.ts`:

```rx
source open := true;
<p onClick={() => { open := false }}>{if open { <b>yes</b> } else { <i>no</i> }}</p>
```

```
RX emit, compiled as upstream does      : Show component
TSX twin, default (prod)                : ternary (lowered)
TSX twin, lowerShow: false              : Show component
TSX twin, dev: true                     : Show component
upstream shape by hand (callback child) : Show component
same, child without the callback        : ternary (lowered)
```

**The probe** (`plan/fuzz/run.ts`, `UPSTREAM_RX_SHOW`): when compiled RX alone differs, native's TSX is compiled again
with `lowerShow: false`, the only change, and replayed on the same scenario. The program is classed upstream only if
compiled RX equals that trace exactly (alone, or with the two older probes), and that trace shows production native's
frames; a native whose frames change with the lowering is a Solid bug (`NATIVE_SHOW_FRAMES`). Anything else is
`divergent` and fails the gate. The baseline lists the 55 (and 11) seeds; `report.ts` fails on an unlisted one, on a missing one, and on any
other class. The check on RX is as strict as before; what it is compared with on these programs is native without the
optimisation.

**Is it an upstream bug?** No: nothing observable differs, and upstream's own runners (frames, not host logs) pass. It
is an optimisation upstream's emitted shape opts out of. What it costs here: compiled RX is no longer op-for-op native
on any program with an `if` in its view (55 of 85 at v2).

Draft note for upstream (not filed):

> **emit: an `if` in a view always compiles to a `<Show>` component; Solid's production compiler can no longer lower it**
>
> Since solidjs/solid#4730 the compiler turns `<Show when={c} fallback={f}>{children}</Show>` into a memo and a
> ternary in production builds, unless (among other cases) the child is a callback that is not one identifier
> parameter with a JSX body. `ref/compile/emit.ts` writes every `mif` as
> `<Show when={…} fallback={(() => {…})()}>{(__item) => { const __o = __rt.owner(); return <>…</>; }}</Show>`, so
> compiled .rx keeps the component (its props object and two extra memos) where the same view written in TSX does not.
> Repro: `source open := true; <p>{if open { <b>yes</b> } else { <i>no</i> }}</p>`, `compileModules` + `lowerViews(…,
> "universal")`: the output has `createComponent(Show, …)`; the TSX twin compiles to `_c$() ? … : …`. Frames are
> identical; host operations happen in a different order. Possible change: when a branch declares nothing and does not
> narrow its condition, emit JSX children (or an expression-bodied `(__item) => <>…</>`), and keep the block-bodied
> callback only where the region needs its own declarations or `__rt.owner()`.

## The upstream strict tsc baseline: 12 → 40

`npm run check` type-checks this package strictly; upstream's `.ts` sources come along because they are imported as
source, and their diagnostics are compared with `baselines/upstream-tsc.txt`. 88c9484 re-recorded it from 12 to 40.
The 12 old ones are unchanged. The 28 new ones, by file and code:

| File | Code | Count | What |
| --- | --- | --- | --- |
| `ref/src/check.ts` | TS2300 | 2 | Duplicate identifier `Shape` (the two imports) |
| `ref/src/check.ts` | TS2339 | 15 | `roots`, `closesP`, `a`, `form`, `childrenAt` do not exist on type `Shape` (3 each) |
| `ref/src/check.ts` | TS2322 | 5 | `Shape` of one module not assignable to the other's; `Set<string>[]` to `string[]` |
| `ref/src/check.ts` | TS2345 | 1 | parse's `Shape` passed where content's is expected |
| `ref/src/check.ts` | TS2353 | 1 | `roots` not a known property of parse's `Shape` |
| `ref/src/check.ts` | TS7006 | 2 | parameters `r`, `t` implicitly `any` (callbacks over the mistyped value) |
| `ref/src/signature.ts` | TS2322, TS2345 | 1 + 1 | the same two `Shape`s across `signature.ts` and `check.ts` |

All 28 are upstream's own, and one line causes them. Upstream 0b30229 (MO-10, 2026-11-13) added `Shape` to
`import type { JsDecl, Shape } from "./parse.ts"` in `ref/src/check.ts` (line 8), where line 9 already imports
`type Shape` from `./content.ts`: two different types under one name. Node's type stripping erases both, so upstream
runs; tsc reports the duplicate and then every use of either.

Not ours: tsc run in upstream's own checkout on those two files alone, with no file, import or tsconfig of this
package, gives the same 28, and gives them without `--strict` too:

```sh
cd reactivescript/ref
node ../../frontend/node_modules/typescript/bin/tsc --noEmit --module nodenext --moduleResolution nodenext \
  --target esnext --allowImportingTsExtensions --skipLibCheck --types node \
  --typeRoots ../../frontend/node_modules/@types src/check.ts src/signature.ts   # 28 errors; the same 28 with --strict
```

Sorted and with positions dropped, that output equals the baseline's 28 new lines except for the checkout's path inside
three messages (`import("…/ref/src/content")`), which `scripts/check-types.ts` now strips so the baseline is the same
on every machine. Upstream has no tsconfig and no tsc step (`ref/package.json`'s `types` script is its own runner), so
it does not see them. Nothing to fix here; the fix upstream is to alias one import (`type Shape as ContentShape`).

## Open, refused or left out

- **A guess on a writable signal or store** (upstream d3cab00): refused by the plan builders and `createEval`, as are
  spreads, object rest, non-path destructuring and `.d.rx` libraries. Not in any verified claim.
- **Plan fuzz v2.1 seed 419** (outside the gate's 1–100): a Solid bug, not RX. Native built with its Shows kept shows
  other frames than production native, and compiled RX follows the component (class `NATIVE_SHOW_FRAMES`). The plan
  and Rust legs equal native. Minimal repro and details: `frontend/docs/UPSTREAM-ISSUES.md`.
- **Held-out fuzz ranges and the placement fuzz 1–1000 summary**: not re-measured (above).
- **Engine paths not ported**, all fail closed (panic) and unreached by any gate range: parked frame flight adoption,
  chained stores / `deep()` / accessor keys / `ownKeys` traps, the dormant-node sweep, `swapHook`, ref-callback
  serving, `onFlush`'s trailing flush (ENGINE, "Not ported").


## eval-todo

`apps/eval-todo/src/todo.rx` and `inventory.rx` guess with `guess x := v`. `npm test` 24/24 (the `@eval` / `@bind`
header checks among them), `npx tsc -p .` has no errors under `client/` or `src/`, `npm run build` passes. Checked in
Chrome on port 4191: todos (a typed add shows "(saving…)" then lands, toggle, and with "fail every request" a toggle,
a delete and an add each roll back with their message) and inventory (search, category filter, quantity sort, column
toggle, validation message, add, row toggle, edit and save, a failed delete rolls back); no console errors.

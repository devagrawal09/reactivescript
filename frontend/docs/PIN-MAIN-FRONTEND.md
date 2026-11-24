# Moving the frontend to ReactiveScript main e650b85 and Solid main 30e7805e

From ReactiveScript fdbcad92 + Solid 2105ffb8 (2.0.0-rc.21) to ReactiveScript e650b85 + Solid 30e7805eb (the commit
e650b85's `ref/SOLID_NEXT` names). Branch `pin-main`. Each re-recorded artifact below says what changed upstream, what
changed here, and the evidence. Expected numbers that involve the Rust legs are not re-recorded here: the Rust port is
being moved in other branches, and those numbers are re-measured after it lands.

## Re-recorded

### Upstream strict tsc baseline: 12 → 40 (`baselines/upstream-tsc.txt`)

- Upstream: MO-10 (`0b30229`, ".d.rx libraries") added `export type Shape` to `ref/src/parse.ts`; `ref/src/content.ts`
  already exported another `Shape` (SV-7d, `f3c6771`), and `check.ts` now imports both (`import type { JsDecl, Shape }
  from "./parse.ts"` and `type Shape` from `./content.ts`). Upstream runs its sources with `--experimental-strip-types`
  and has no tsc step, so this never fails there.
- Here: the 28 new lines (2 TS2300 "Duplicate identifier 'Shape'" and their consequences, in `check.ts` and
  `signature.ts`) are recorded; the 12 old ones are all still present. `scripts/check-types.ts` now also strips this
  checkout's absolute path from a diagnostic (two of the new ones print `import("/…/frontend/upstream/ref/src/…")`
  types), so the baseline is the same on every machine.
- Evidence: tsc with the package's options on only `upstream/ref/src/check.ts` and `signature.ts` (no frontend file)
  gives exactly those 28 diagnostics. Package diagnostics stay 0.

### TSX fuzz, seeds 0–199: 179 agree + 21 listed → 184 agree + 16 listed (`baselines/fuzz-upstream.json`, `tsx/fuzz.test.ts`)

- Upstream: `f51bb5e` (#33) "interpreter: a functional guess sees the screen; two actions guessing one slot are one
  hold". It changes only the interpreter (`ref/src/runtime.ts`).
- Here: seeds 17, 92, 103, 149 and 199 (all U1, a handler's write before the action) are no longer interpreter-only
  differences: all five legs agree. They are removed from the listed seeds; the smoke test's exact list on seeds 0–19
  becomes `[14]`. No new seed appeared; the 16 remaining are the same class (`upstream: interpreter vs compiled`).
- Evidence: the pre-move frontend (`70edf62`) run against archived upstream trees: seeds 17, 92, 103, 149, 199 are
  interpreter-only at fdbcad9, `c746908^`, `c746908` and `f51bb5e^`, and agree at `f51bb5e`; seeds 14 and 40 stay
  interpreter-only throughout.

## Fixed here (no expectation changed)

- `frames/harness.ts`: the browser import map hardcoded the pnpm store folders `seroval@1.7.0` and
  `seroval-plugins@1.7.0_seroval@1.7.0`; Solid main depends on seroval 1.8.1 / seroval-plugins 1.8.0, so every frames
  page 404'd. The folders are now read from `@solidjs/web`'s own `node_modules` links.

## Observed, not changed

- `plan/frames.test.ts` "PL pin PL-3d" failed once (last frame `modeOne open` where `modeOne all` is expected) in one of
  about eight runs of the file, under load; it passed in the seven other runs and alone. The F leg is a handwritten
  native Solid split program, so this is timing in the harness's `settle` (100 ms of stability) or in Solid's frames
  client, not the frontend. Watch for it in gate runs.

## Rust-only failures (left for the Rust branches)

- `slices/tracker-frames.test.ts` "R (rust-solid's frames server) equals N": the document differs only in Solid's
  hydration bootstrap script (main's `_$HY` event capture records `[s,o,n]`, the composed-path target too); J (the JS
  plan split) equals N.

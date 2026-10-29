# reactivescript-tsx: moving-foundation TSX frontend for ReactiveScript

Current direction: **Solid parity, subset first**. Run `npm run verify:subset` for the
counter and component-composition checkpoint. Its scope is in [docs/SUBSET.md](docs/SUBSET.md).
A passing subset is not full-port readiness; `npm run verify:pinned` remains the full gate.

Experimental Oxc TSX frontend that lowers authored Solid-style TSX onto the pinned ReactiveScript `Program` and checker.
Moved out of the original worktree (`/Users/devagr/reactivescript`, `proto/sound-tsx-frontend` @ f3c6771) into its own
package so that upstream can move underneath it. Not a parity claim, not a shared IR, not a Rust frontend.
Accepted/refused forms and semantic limits: [tsx/README.md](tsx/README.md), [tsx/MODULES.md](tsx/MODULES.md),
[tsx/PARITY.md](tsx/PARITY.md). Measured results: [docs/RESULTS.md](docs/RESULTS.md).

## Layout (workspace `/Users/devagr/rx-tsx-refresh`)

| Path | What |
| --- | --- |
| `reactivescript/` | upstream checkout at the pinned commit, unmodified (branch `rx-pin`, push disabled) |
| `reactivescript-patched/` | detached worktree of it at the same commit plus `frontend/patches/` (built by `scripts/apply-patches.sh`); `frontend/upstream` points here |
| `solid-next/` | Solid at upstream's `ref/SOLID_NEXT`, built by upstream's `ref/scripts/solid-next.sh` (Rust 1.97.1) |
| `frontend/` | this package (own git repo, own `package-lock.json`); `upstream -> ../reactivescript-patched` symlink |
| `archive/` | snapshot of the original worktree: tracked patch, untracked tar, checksums, HEAD/index/status |
| `scratch/original-suite-run/` | the original worktree re-materialized from `archive/` and run on the old Solid (coverage baseline) |
| `logs/`, `tools/` | run logs; one-off review tools (baseline classifier, coverage diff) |

Inside `frontend/`: `tsx/` lowering, loader, build, native primitives and all suites; `tsx/rx/` the adapter (the only
code that imports upstream, via the package `imports` map `#rx/* -> ./upstream/ref/*`); `scripts/` workflow;
`baselines/` reviewed expectations; `patches/` upstream patch queue (empty) plus legacy patches as evidence;
`upstream-repros/` handwritten RX reproductions; `docs/`.

## Pins (support only these; no version detection)

`pins.json`: reactivescript `aa85cbde21fc81991aa1fbfab8092b4bffd24ddf`, Solid `ac28157aba6d03b806f0043bce70a87d515e953e`
(= upstream ref/SOLID_NEXT), Node 24.18.0, pnpm 11.20.0, Rust 1.97.1, oxc-parser 0.155.0, TypeScript 6.0.3,
Playwright 1.59.1 (Chromium). `boundary.test.ts` fails if the checkouts drift from the pins.

## Adapter boundary (`tsx/rx/`)

- `ast.ts`: AST types plus constructors for the volatile forms only: `entryView`/`selectEntry` (MO-1c default
  component entry), `serverDecl` (single SF-1 server form). Ordinary expressions are built inline by `lower.ts`.
- `compiler.ts`: parser, checker, module loader, signatures, emitter, view lowering.
- `facts.ts`: canonical semantic facts from the checker's resolved model (ids/lines canonicalized; read modes,
  ordering, writes, calls, regions preserved) for paired TSX/RX comparison.
- `infer.ts`: upstream AC-1b/AC-1c inference, used for the inferred-action decision below.
- `runtime.ts`, `failure.ts`, `string-renderer.ts`: interpreter, compiled runtimes, failure/wire helpers
  (browser-safe split) and runtime file paths: unavoidable private upstream imports.

## Decisions forced by the new upstream

- **Entry:** `export default function App()` lowers to `component App` with `isDefault` and the view `<App/>` (MO-1c).
  `buildTsx(..., { mount })` / `--mount` selects an exported component as that same entry. Other default exports are refused.
- **Server functions:** `serverFunction`/`serverAction` both lower to the single `server` declaration; the authored
  loader/action intent stays frontend bookkeeping and upstream infers io (refusing io in reactive scope).
- **Inferred actions:** upstream infers a plain arrow that writes and awaits as an action and holds writes made
  before an `await`. Solid applies them immediately, so a plain TSX callback with a write before an `await` is refused
  at its authored location. Await-then-write and refresh callbacks are accepted and left to the checker and the
  differential suites. Wrap a callback in `action(...)` for held semantics.
- **Structured `untrack` captures:** `untrack(() => store.path)` returning an object/array lowers to an RX snapshot
  (`peek`), which copies the value; Solid returns the live proxy. Accepted only when nothing can update the captured
  object in place (not a derived store, no write inside the captured path); otherwise refused at the `untrack`.
- **Imports:** the primitives module is now `reactivescript-tsx` (was `reactivescript-ref/tsx`, which named upstream's
  package); same exports, renamed because the package is no longer part of upstream's `ref/`.

## Commands (run in `frontend/`)

| Command | What it runs |
| --- | --- |
| `npm run test:contracts` | fast: boundary/pin/representation contracts, paired counter, contracts suite |
| `npm run check` | strict tsc of this package; upstream's own strict errors compared with `baselines/upstream-tsc.txt` |
| `npm test` / `npm run test:browser` | whole ported suite / Chromium hydration suite |
| `sh scripts/verify-pinned.sh [--rust]` | **READINESS** (default): exit 0 only if pins match, the upstream tree is its commit plus exactly the patch queue, types are clean, every suite and browser test passes, the whole coverage manifest ran, and the upstream runners ran (`--rust`: plus crate, `--lower`, `--project`) and match their pinned summaries. Every step's exit code is recorded and judged; the verdict is `VERDICT: READY` or `VERDICT: NOT READY` |
| `sh scripts/verify-pinned.sh --compare` | **COMPARISON ONLY**: exit 0 when the run reproduces `baselines/observed-failures.json` (an unapproved observation of current failures and coverage gaps); still prints `VERDICT: NOT READY`. Integrity problems fail it too |
| `sh scripts/canary.sh REV --dry-run` | cheap and labelled as such: fetch REV, report SOLID_NEXT and contract-surface/export changes; **runs no build and no tests** |
| `sh scripts/canary.sh REV [--rust] [--compare]` | full rehearsal in a fresh temp dir: clone REV, build its SOLID_NEXT, apply the patch queue (reported separately if it no longer applies), `npm ci`, export this package's committed HEAD, run verify-pinned (readiness, or comparison with `--compare`) in canary mode |

`baselines/coverage-manifest.json` lists every test that must run (the original suite's 513 identities with explicit
renames, the tests added since, and the browser suite). `baselines/observed-failures.json` is an observation, not an
approval; it is written only by hand (`tools/classify-baseline.cjs` in the workspace) and is ignored by readiness.
`tsx/verifier.test.ts` proves that a known failure, a failing upstream runner, missing or truncated results and dropped
coverage cannot yield READY.

## Promotion procedure (moving the pin)

1. `sh scripts/canary.sh <rev> --dry-run` to see SOLID_NEXT and contract-surface changes.
2. `sh scripts/canary.sh <rev> --rust` to run everything in isolation and read `REPORT.md`.
3. Fix adapter breakage in `tsx/rx/` (and lowering only where semantics changed). Re-run the canary until every
   new failure is either fixed or understood.
4. For every remaining failure decide: fix, explicit authored refusal with native evidence, or an upstream issue
   with a handwritten RX repro (and, if narrow, a queued patch). Record decisions in docs/; re-check the patch queue's
   removal conditions.
5. Only then update `pins.json`, check out the new commits in `reactivescript/` and `solid-next/` (rebuild Solid with
   upstream's script), rebuild `reactivescript-patched/` with `scripts/apply-patches.sh`, run `verify-pinned.sh --rust`,
   refresh the observation by hand if needed, and commit pins, observation and docs together. A promotion is READY only
   when readiness mode passes; until then the readiness verdict stays NOT READY.

## Upstream patch policy

See [patches/README.md](patches/README.md) and [docs/PATCHES.md](docs/PATCHES.md). The queue is empty at this pin.
Upstream defects found are in [docs/UPSTREAM-ISSUES.md](docs/UPSTREAM-ISSUES.md) (not filed; filing needs approval).

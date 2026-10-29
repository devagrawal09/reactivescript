# Measured results (2026-10-28)

Stack: reactivescript aa85cbde (unmodified, clean), Solid ac28157 (= ref/SOLID_NEXT, built with Rust 1.97.1),
Node 24.18.0, this package at its committed HEAD. Logs: `/Users/devagr/rx-tsx-refresh/logs/`; run outputs:
`frontend/.out/verify-pinned-3` (full, with upstream and Rust) and `frontend/.out/verify-pinned-4` (final suite).

## Upstream baseline at the pins (unmodified upstream runners, run by verify-pinned.sh --rust)

| Runner | Result |
| --- | --- |
| interpreter (`npm test`) | 104 PASS, 0 FAIL |
| oracle | 104 pass, 0 fail, 0 skip, 0 recorded divergences |
| compiled | 104 pass, 0 fail, 0 skip, 0 recorded divergences |
| types | 144 pass, 0 fail |
| ssr (Chromium) | 97 pass, 0 fail, 7 skip (upstream's own skips) |
| crate (Rust parity) | 305/305 programs agree (AST, diagnostics, signatures, resolved model) |
| crate `--lower` | 176/176 programs lowered alike |
| crate `--project` | 176/176 projections identical |
| `cargo test --release` (compiler/) | 3 passed (run once, baseline only) |

For comparison, the old pin's numbers (from the original worktree, not re-run here) were interpreter 83 and compiled/oracle 83 pass
with 6 recorded divergences each, and SSR 76 pass with 7 baseline skips.

## This package at the pins

- Strict types: 0 diagnostics in this package. Upstream's own sources have 12 strict-mode errors under these
  options (unchanged, `baselines/upstream-tsc.txt`).
- Fast contracts: `boundary.test.ts` 6/6, `paired.test.ts` 3/3 (paired authored counter: equal canonical facts;
  interpreter, compiled and native frames 0/2/4; a peek variant is detected as a fact difference).
- Ported suite (`npm test`): **500 registered, 391 pass, 109 fail, 0 skip, 0 todo**.
- Browser (`npm run test:browser`): **31 registered, 25 pass, 6 fail**.
- Report vs `baselines/known-failures.json`: 0 new failures, 0 known failures passing, 0 known failures not run.

### Original suite, reproduced

The original worktree was re-materialized from `archive/` (f3c6771 plus the tracked patch and untracked files) in
`scratch/original-suite-run/` and run against the old Solid checkout (2a0da2f, read-only, still clean): **513
registered, 510 pass, 3 fail**, the same three known failures as recorded before the migration.

| Original known failure | Now |
| --- | --- |
| structured optimistic roots roll back across suspended actions | **passes** (no frontend change targeted it; consistent with Solid ac28157's optimistic-store fix) |
| same-setup previous accessors passed into later-mounted owners | still fails, interpreter leg |
| async structured keyed replacements retain rows / suppress obsolete answers | still fails, now at the native Solid leg |

### Coverage reconciliation (513 original vs 500 registered)

`tools/coverage-diff.cjs` compares test identities (file + name + occurrence):

- 24 original identities are not registered now: 22 are `async-handlers.test.ts` subtests ("compiled/interpreted
  handwritten RX", "… authored TSX") whose parent test now stops before registering them, because upstream refuses the
  handwritten RX program (HELD_WRITE / UNCAUGHT_ACTION_FAILURE, AC-1b/AC-1c) or the TSX form is refused by the
  inferred-action decision. The parents are in the baseline, so the gap is visible, not hidden. The other 2 are
  `lower.test.ts` tests renamed for deliberate decisions: "rejects default export …" became "rejects non-component
  default export …" (MO-1c), and "async block handlers retain sequential writes …" became the pre-await-refusal version.
- 11 identities are new: 6 boundary contracts, 3 paired-counter tests, the 2 renamed tests.
- Every other file registers the same tests as the original (513 − 24 + 11 = 500).

Two load-time breakages were found by this reconciliation and fixed: `snapshot-core.test.ts` failed to import
(`ErrVal`/`PENDING` missing from the adapter; 1 → 22 tests), and `derived-stores.test.ts` lost 8 subtests to an
unmigrated RX entry (18 → 26).

### Failure classification (115 = 109 suite + 6 browser; `baselines/known-failures.json`)

| Category | Count | Meaning |
| --- | --- | --- |
| legacy core regression (patch not carried) | 18 | raw-AST/RX core regressions for the old runtime.ts/rt.ts/emit.ts patches (PATCHES.md) |
| reference interpreter divergence | 19 | interpreter leg differs while compiled/native agree; old interpreter fixes not carried |
| upstream defect (not patched) | 11 | aliased error-class identity (UPSTREAM-ISSUES.md #1, handwritten RX repro) |
| upstream semantic change (AC-1b/AC-1c) | 9 | inferred actions hold pre-await writes; TSX refuses those by decision |
| upstream behavior change (cause unconfirmed) | 8 | callbacks now return a Promise where native Solid returns synchronously; not yet traced |
| upstream rule change | 6 | AC-1d STALE_OWN_READ, IO-2 io server fn in reactive scope, SF-1 single server form |
| parent of failing subtests | 14 | fail only because listed subtests fail |
| adapter/API breakage | 3 | tests drive the removed compiled `app.serverFn`; upstream now has `serverRef`/`serverCall`; not ported |
| paired behavior mismatch | 3 | compiled frames differ from expectation |
| native behavior change | 2 | native Solid leg differs at ac28157 |
| UNREVIEWED | 22 | not investigated yet (async-handlers interpreted legs, browser server-loader/factory hydration, contracts, lower/features cases) |

Categories come from hand-written rules in `tools/classify-baseline.cjs` applied to the failure text, plus file-level
knowledge recorded there. They are a triage, not proofs: "UNREVIEWED" and "cause unconfirmed" entries are open work.

## Not run / not covered

## Canary rehearsal (executed)

`sh scripts/canary.sh main` (full mode; `main` = aa85cbde at the time, 0 commits past the pin) ran in a fresh temp
directory (`$TMPDIR/rx-canary.Pkx1kk`): cloned reactivescript, cloned and built Solid ac28157 with upstream's script
(Rust compiler included), `npm ci` in ref and in an export of this package's committed HEAD, then verify-pinned in
canary mode. Exit 0. Report: suite 500/391/109, browser 31/25/6, strict types 0 package diagnostics; upstream
interpreter 104/0, oracle 104/0, compiled 104/0, types 144/0, SSR 97/0/7 (all matching pins); 0 new failures, 0 known
failures passing, 0 not run. The pinned workspace, pins and baselines were not modified. `--rust` was not used for
this canary run (the Rust checks ran in verify-pinned-3). `canary.sh main --dry-run` also ran and reported no change.

- No Rust route for TSX: the crate consumes RX source, and the frontend produces `Program` objects (there is no RX
  printer), so crate parity covers upstream only. No reference-only fix is claimed as Rust coverage.
- The 12 upstream strict-mode type errors are reported, not fixed.
- Server-function HTTP transport, arbitrary npm execution and full Solid/RX parity remain out of scope.

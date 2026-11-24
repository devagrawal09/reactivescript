# Verified subset

The contract is native Solid behavior, checked against handwritten RX and both RX backends. The tested fixtures
are a small boundary, not proof for arbitrary combinations of Solid features.

## Kept evidence

- Boundary: pins, import isolation, entry/model contracts, async guidance and refusals.
- Paired counter: canonical facts and exact native/compiled/interpreted frames.
- Composition: live direct/memo props, direct and forwarded callbacks, later-declared components.
- Tracker: stores, filter/map/findIndex, Show/For, optimistic claims, actions, success/failure.
- Stale writes: unchanged STALE_WRITE_BACK refusal and functional-setter repair on every backend.
- Fuzzer: deterministic TSX/RX, five backends, exact facts/frames; 200 seeds in the gate.
- Yield: all yield/*.test.ts tests, including TSX twins, plain-value createOptimistic and parameterized callbacks.
- Verifier: missing, duplicate, renamed, failed, skipped and incomplete runs fail.

Exact test identities are in baselines/subset-tests.json. Each must run once and pass; unlisted tests also fail.
There is no legacy failure waiver or comparison mode.

## TSX boundary

Accepted: named module-level components; inline props types; scalar/record/array values; literal signal/store seeds;
synchronous memos; optimistic values (plain or accessor form); functional setters; draft assignments; synchronous
handlers; synchronous generator actions with yield and try/catch; JSX/fragments; Show/For; map/filter/findIndex.
Callback props may carry typed parameters. External JS functions use .d.rx declarations. Eval sites
(`createEval` from `reactivescript-tsx/eval`, RX `eval`) are an element child or a typed value, and run as plans only
(docs/EVAL.md). The module loader stays
shared with yield and handwritten RX tests; arbitrary RX syntax is not necessarily supported as authored TSX.
Builds target the universal renderer only.

Plan v2.1's **async tier** (plan/docs/PLAN-V2.md, "v2.1: async data") is opt-in: `loadTsxModules(…, { async: true })`,
which a format-2.1 scenario and `emit.ts --schema 2.1` select. It accepts an async memo over a declared host
(`createMemo(() => host(…))`), `<Loading fallback>`, `<Errored fallback={(err) => …}>`, `isPending(() => e)`,
`latest(() => e)`, `refresh(memo)` and `affects(memo)`, and refuses Loading's `on`, Errored's `reset` and reading the
error. Without the opt-in, everything below is refused as before.

Removed forms fail at the authored location with **outside the verified subset: <construct>**. This includes source
contexts (withdrawn upstream O-4 / RG-7c), server functions/memos/actions, effects and cleanups, previous values,
projections, deferred values, async memos/stores, general setup helpers/constants, contexts, Loading/Errored,
refresh/pending/latest probes and cross-module TSX/RX component imports.

Specific semantic refusals remain:

- Async callbacks: issue #20; action(function* () { ... yield request(); ... }) opts into held action semantics.
  It is not a semantics-preserving rewrite. Async actions must use a synchronous generator.
- createEffect: upstream uses per-input value comparison (EF-2); effects are outside this subset.
- Object/array createSignal: RX structured sources have store semantics; use createStore.
- STALE_WRITE_BACK: upstream's checker diagnostic, not a rewrite or suppressed error.

## Gates and limits

npm run verify:subset runs pins, types, every kept test and fuzz seeds 0–199. Only reviewed interpreter-only fuzz
seeds in baselines/fuzz-upstream.json are informational; new ones fail until reviewed. They remain visible, so
passing is not agreement of all five backends. See docs/FUZZ.md U1/U2.

scripts/verify-pinned.sh --rust adds upstream interpreter, oracle, compiled, types, SSR and Rust parity/unit tests.
Every requested runner's nonzero exit fails it. At e650b85 / Solid 30e7805e, upstream's ssr runner fails one case
on the recorded machine ("Frames [hydrated late]", a 404), so the full gate is red even when the frontend gate is
green (at fdbcad92 / rc.21 it was S-store-8 in the interpreter, which passes since upstream c746908).

Upstream RX surface added between fdbcad92 and e650b85 that the plan builders do not port is refused by name
(plan/surface.ts, plan/resolve-v2.ts; docs/PIN-MAIN-FRONTEND.md, "Refused"): a guess on a writable signal or store
and a guessed source also written plainly (07 decision 21), spread attributes, object rest (`omit`), destructuring of
a value that is not a name or path, and .d.rx library declarations (MO-10). `else if` and destructuring over a name
or path are parse-level sugar: their plans are their hand-written expansions' byte for byte. The TSX frontend refuses
destructuring and spreads as before (outside the verified subset).

History: the broad 573-test port had 96 failures at the old pin. It was removed, not fixed or relabeled as passing.
V8 coverage of kept tests and 200 fuzz seeds helped locate unused lowering paths; defensive validation for retained
forms remains. Browser tests and server patch 0001 were removed with their unsupported scope.

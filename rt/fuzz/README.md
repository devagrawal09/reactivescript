# Differential fuzzer (JS vs JS)

Ported from reactivescript `origin/solid-model` at `f5418ad67f9d48159ca4f74ebb9564e789cfd2e7` (`rust-solid/fuzz/`). Generators are unchanged. The harness no longer builds or talks to a Rust driver. Each program runs in two fresh workers: a reference Solid and a variant. Logs are compared with `JSON.stringify`.

Reference: `/home/lucifer/work/solidjs/store-proto-base` (`@solidjs/signals` 2.0.3, `packages/signals/dist/prod/index.js`). For `--render`, `packages/{solid,universal,web}/dist`, worker `execArgv: ['--conditions=browser']`.

Variant: `--variant <index.js>` (signals modes) or `--variant-root <checkout>` (`--render`). Default is the reference, which must agree.

A program invalid on the reference (`oracle-halted`, `oracle-nonscalar`, `oracle-timeout`, `oracle-error`) is invalid, not a difference. A program valid on the reference where the variant errors, times out, halts, or the logs differ is a difference. The reducer still runs on the first difference of each class unless `--no-reduce`.

`--slice0` is strict (integer domain). `--slice0c` is strict `'slice2c'`. Other strict flags match the source harness.

## Commands

From this directory. Reference vs reference:

```
node run.mjs --seeds 1000 --no-reduce
node run.mjs --slice0 --seeds 1000 --no-reduce
node run.mjs --slice0c --seeds 1000 --no-reduce
node run.mjs --slice1 --seeds 1000 --no-reduce
node run.mjs --slice2a --seeds 1000 --no-reduce
node run.mjs --slice2b --seeds 1000 --no-reduce
node run.mjs --slice2c --seeds 1000 --no-reduce
node run.mjs --strings --seeds 1000 --no-reduce
node run.mjs --boundaries --seeds 1000 --no-reduce
node run.mjs --render --seeds 1000 --no-reduce
```

Sabotage (variant only), 200 seeds:

```
node run.mjs --slice2c --sabotage drop-row --seeds 200 --no-reduce
```

Kinds: `stale-read`, `skip-cleanup`, `no-equals`, `effect-order`, `flush-twice`, `drop-row`, `store-stale`.

Also: `--start`, `--timeout-ms` (default 1500), `--replay PATH`, `--out DIR`. Summaries land in `logs/`, the first failure of each difference class in `failures/`.

## Executor vs Solid 2.0.3

No call site needed a rename or a new argument. Checked against `packages/signals/src/index.ts`, `signals.ts`, `store/index.ts`, `boundaries.ts` and the 2.0.3 prod build:

- `createSignal(value, {equals})`, `createOptimistic`, `createMemo(fn, {lazy, equals, loadingValue})` — same options.
- `createEffect(compute, {effect, error}, {defer})` and `createRenderEffect(compute, effect, {defer})` — bundle is still `{effect, error}`. The error arm is still `(err, cleanup)`; the fuzzer still does not call `cleanup` (already true on rc.21).
- `isPending` / `latest` take a function. The executor already passes an accessor or a thunk. No change.
- `refresh` still keys off `$REFRESH` on the accessor. `action`, `reconcile`, `mapArray`, `createStore`, `createOptimisticStore`, `createLoadingBoundary`, `createErrorBoundary`, `affects`, `$TARGET`, `verdict`, `NotReadyError`, `flush`, `createRoot`, `onCleanup`, `untrack` — same calls.

Invalids below are Solid hangs, out-of-domain values, or the recording host throwing. Not API drift. Generators were not edited.

## Reference vs reference (1000 seeds, start 1, timeout 1500ms)

Differences are 0 in every mode.

| mode | seeds | valid | invalid | differences | programs/s |
| --- | --- | --- | --- | --- | --- |
| default | 1000 | 994 | oracle-timeout 6 | 0 | 5.60 |
| slice0 | 1000 | 1000 | — | 0 | 6.29 |
| slice0c | 1000 | 1000 | — | 0 | 5.78 |
| slice1 | 1000 | 1000 | — | 0 | 6.44 |
| slice2a | 1000 | 996 | oracle-nonscalar 4 | 0 | 6.75 |
| slice2b | 1000 | 1000 | — | 0 | 8.94 |
| slice2c | 1000 | 1000 | — | 0 | 9.29 |
| strings | 1000 | 1000 | — | 0 | 8.51 |
| boundaries | 1000 | 988 | oracle-timeout 11, oracle-nonscalar 1 | 0 | 7.51 |
| render | 1000 | 993 | oracle-error 7 | 0 | 9.14 |

Invalid causes (reference only; variant not run):

- default timeout: hang. Seed 71 still at op 22 after 5s. Same class as the rc.21 teardown/refresh hangs.
- slice2a nonscalar: effect error arm got a plain `{}` (rejection through a second async memo; `e.message` is undefined, logged as null). Seed 52. Strict string domain rejects it. Not a renamed API.
- boundaries timeout: hang. Seed 21 stuck at op 18. Errored-pending hang class.
- boundaries nonscalar: effect value is NaN. Seed 294, `["effect","E0^1.L2^3.v9", NaN, null]`. Generator arithmetic on an undefined window read. Strict checker is right.
- render error: recording host throws. Seed 269, all 7 are this:

```
Error: NotFoundError
    at removeNode (rt/fuzz/universal.mjs:62:112)
    at reconcileArrays (packages/universal/dist/universal.js:190:16)
    at insertExpression (packages/universal/dist/universal.js:103:18)
```

`removeNode` throws when the node is not a child of that parent. Same host contract as the original fuzzer. Reference throws, so the program is invalid, not a difference.

All modes run on Solid 2.0.3. None left unported.

## Sabotage (200 seeds)

Differences out of 200. A blank cell is 0. "n/a" means the mode never calls that export (wrapping it cannot change a trace).

| mode | stale-read | skip-cleanup | no-equals | effect-order | flush-twice | drop-row | store-stale |
| --- | --- | --- | --- | --- | --- | --- | --- |
| default | 39 | 0 (under 5 onCleanup) | 55 | 183 | 38 | n/a | n/a |
| slice0 | 22 | 56 | 146 | 172 | 143 | n/a | n/a |
| slice0c | 0 | 156 | n/a | 115 | 136 | 153 | 78 |
| slice1 | 23 | n/a | n/a | n/a (render effects only) | 79 | n/a | n/a |
| slice2a | 7 | 0 | n/a | 122 | 14 | n/a | n/a |
| slice2b | 5 | 0 | n/a | 97 | 33 | n/a | 56 |
| slice2c | 6 | 181 | n/a | 80 | 58 | 191 | 48 |
| strings | 22 | 114 | n/a | 63 | 40 | 128 | 0 |
| boundaries | 0 | 35 | n/a | 71 | 10 | n/a | n/a |
| render | 0 | n/a | n/a | n/a | 26 | n/a | n/a |

Every mode is killed by at least one kind that touches what it runs. `flush-twice` is the one that kills `--render` and `--slice1`. `store-stale` wraps `createStore` / `createOptimisticStore` and kills slice2b/2c/slice0c; strings' tracker does not reach a visible 9th setter drop (0/200). `stale-read` is wrapped on render's `createSignal` but the 40th read did not change the host log (0/200).

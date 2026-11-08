# Renderer fuzz (`--render`): artifacts and tools

What is compared, the program language, results and deviations: [../RENDERER.md](../RENDERER.md).

| file | what |
| --- | --- |
| `port/summary-1-1000.json` | `node fuzz/run.mjs --render --seeds 1000`: 993/1000, 7 invalid (`oracle-error`: the shared-node removal), every valid program agrees |
| `port/summary-1001-3000.json` | `node fuzz/run.mjs --render --start 1001 --seeds 2000 --no-reduce` (held out): 1979/2000, 21 invalid (the same case), every valid program agrees |
| `port/fail-269.json` | the first invalid program, with the oracle's error (`NotFoundError` from `reconcileArrays`) |
| `port/solid-bug-shared-node.mjs` (+`.txt`) | the suspected `@solidjs/universal` issue on Solid's API alone: `node --conditions=browser docs/render-fuzz/port/solid-bug-shared-node.mjs` |
| `port/byte-gate.txt` | the gate reruns: `--slice1`/`--slice2a`/`--slice2b`/`--slice2c` over 1-1000 and 1001-3000, each summary `cmp`-identical to the recorded one |
| `tools/unit-programs.mjs` (+`.json`) | the hand-written renderer programs of `crates/runtime/tests/render.rs` |
| `tools/unit-expectations.mjs` | records Solid's logs for them into `crates/runtime/tests/fixtures/render-units.json` |
| `tools/cov-run.mjs`, `tools/cov-worker.mjs`, `tools/cov-report.mjs` | V8 coverage of Solid's dist files by the generated programs (one worker per program), and the never-run segments of a file |

Reproduce (repository root, Node 24):

```sh
node fuzz/run.mjs --render --seeds 1000 --out out/render-1000
node fuzz/run.mjs --render --start 1001 --seeds 2000 --no-reduce --out out/render-heldout
node docs/render-fuzz/tools/unit-programs.mjs > docs/render-fuzz/tools/unit-programs.json
node docs/render-fuzz/tools/unit-expectations.mjs > crates/runtime/tests/fixtures/render-units.json
NODE_V8_COVERAGE=out/cov node docs/render-fuzz/tools/cov-run.mjs 1 1000
node docs/render-fuzz/tools/cov-report.mjs out/cov universal/dist/universal.js 1-236
```

# Slice-1 exact-trace fuzz evidence

Oracle: sibling `solid-next`, pinned `2105ffb8ca2fced55f5fac0763177fc93f97c2c2`, rc.21 production signals build, through the existing isolated worker oracle. Seeds 1–1000. Default 1500 ms per comparison. Full expected and actual traces are compared without filtering; reducers preserve the first differing event-kind pair.

## Parity runtime: structural scheduler port (`crates/runtime/src/slice1/`)

- Seeds 1–1000: **1000/1000 agree**, 0 diverge, 0 invalid.
- Held-out seeds 1001–3000: **2000/2000 agree**, 0 invalid.

The generator, worker oracle, comparator and expected logs are unchanged. Exact full traces are compared; nothing is filtered, dropped or reordered.

There are no first-difference classes, so there are no new reduced cases. `parity/` holds:

- `summary-1-1000.json` and `summary-1001-3000.json`: `fuzz/run.mjs` summaries, with coverage counts.
- `replay-reduced-scalar-actions-compute-read.logs.json` and `replay-reduced-scalar-actions-compute-effect_cleanup.logs.json`: the two reduced cases from `2752ca0`, replayed with exact native/Rust traces. Both now agree. They include the staged-truth compute the old slice lacked.
- `probe.json`: the private out-of-distribution probe (4600 programs). It is not an official score.
- `tools/`: the coverage, call-map and probe scripts behind [../SLICE1-PARITY.md](../SLICE1-PARITY.md).

```sh
node fuzz/run.mjs --slice1 --seeds 1000 --out out/recheck
node fuzz/run.mjs --slice1 --start 1001 --seeds 2000 --out out/recheck-heldout
node fuzz/run.mjs --slice1 --replay docs/slice1-fuzz/final/reduced-scalar-actions-compute-read.json
node fuzz/run.mjs --slice1 --replay docs/slice1-fuzz/final/reduced-scalar-actions-compute-effect_cleanup.json
```

All four exit 0.

## Previous runtime: 2752ca0 (historical)

**7/1000 agree (0.7%); 993 diverge; 0 invalid or timed-out programs.**

Coverage: 2000 signal creations, 1000 render effects, 3000 actions, 6040 flushes, 18000 reads, 2029 outside-action writes, 1515 rejects, 1485 resolves. Action-slice writes are also exercised and are nested within the action records. No stores, lists, async memos, custom equality, owner operations, or pending probes are generated.

| First differing events (native / Rust) | Seeds | Reduced explanation |
| --- | ---: | --- |
| compute / read | 105 | A held ordinary write causes a speculative computation in Solid even though the read still serves the committed value. Rust parks the write without that computation. `final/reduced-scalar-actions-compute-read.json` (7 ops). |
| compute / effect_cleanup | 888 | Solid computes staged truth, then the optimistic presentation before callbacks. Rust computes only the presentation. Example: initial `s=2,o=1`, action stages `s=3,o=7`; both apply 9, but Solid also records a compute whose previous result is 4. `final/reduced-scalar-actions-compute-effect_cleanup.json` (5 ops). |

These are first-difference classes, not proof that later trace entries agree. The two reduced cases share the larger missing mechanism: separate speculative truth/lane computation and held callback queues. Do not read 0.7% as frame-only agreement or omit computes to raise the score.

Each reduced file has a `.logs.json` partner with exact native/Rust traces. `fail-1.json` and `fail-2.json` retain full original cases. Every original failure is also retained locally in `out/slice1-verified/`.

These artifacts describe the `2752ca0` runtime. Against the parity runtime, the replays agree and exit 0.

## Initial runtime: 3911d2e

`initial/` records the initial 1000-seed run: 5 agree, 995 diverge, 0 invalid. All four first-difference classes have class-preserving reduced inputs, exact traces and an original seed:

- compute/read: 105, seed 1.
- compute/effect_cleanup: 866, seed 2.
- effect/effect: 22, seed 27. A fresh equal write wrongly acquired a hold in Rust, so a later ordinary write stayed parked and skipped a visible intermediate value (native 9 versus Rust 2 in the reduced case). Fixed by the source's equality gate before fresh queueing.
- compute/action: 2, seed 634. A no-op held/commit combination omitted Solid's compute passes before action completion. No longer a first-difference class after the equality fix; the broader missing speculative-pass mechanism remains.

The equality fix also preserves Solid's important exception: a write to an **already-held** node joins its hold before equality. This is tested separately. Initial artifacts describe the historical runtime and need not produce the same first divergence on the final runtime. The initial four class counts are not added to the final counts.

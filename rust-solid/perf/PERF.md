# rust-solid performance: benchmark suite and optimizations

rust-solid is the Rust port of Solid 2 on branch `solid-model` of devagrawal09/reactivescript. This round widened the benchmark to 48 workloads plus 5 composition workloads, added a check for ops that slow down the longer an app runs, and optimized against both. Behaviour is unchanged: every fuzzer and differential check gives the same numbers as `docs/HANDOFF.md`, and every workload's final frame is identical before and after.

A second round (Nov 15, "Node table round" below) frees disposed nodes and reuses their slots, and shrinks every node from 760 to 408 bytes. It makes the js-framework-benchmark creates 2 to 4 times faster by wall clock and keeps long-running apps' memory flat.

A third round (Nov 16, "Allocation round" below) cuts trips to the memory allocator: function values own their bodies, templates build into one list, and the test host shares its strings. Instructions drop 6.1% across the suite (mount −28%, jfb-run −20%), jfb-run takes 4.9 ms against Solid JS's 23.6 ms, and peak memory is lower on every workload.

The work is on the `handoff/` branches listed below. No PR is open.

## Branches and commits

`rust-solid-perf`, on top of `solid-model` (f5418ad):

| commit | what |
|---|---|
| 657d35b | perf: reapply the eleven earlier bench fixes onto solid-model (v1) |
| de02420 | fix: a store draft's undefined constructor creates a plain array (found by the suite) |
| e8f71f8, df59a2f, fb3d8ab, f4e0063 | bench: the workload suite driver, steps for sized data / host appends / rejections, keep the harness's lookups and `timed_ops` out of the timed region |
| bbcc9fc | perf: rows share their handlers' steps and texts' expressions instead of cloning them per row (v2) |
| bd905b3 | perf: boundaries drop deleted readers at the seam |
| 27e65b5 | perf: an app indexes its request log by host |
| 2e46b6c | perf: look flights up by name in a map (now) |
| 48115c2 | perf: a mounted plan frees disposed nodes and reuses their slots (node table round) |
| 55adff6 | fix: keep a freed slot while anything still names its node |
| 8ac6816 | perf: a node shrinks from 760 to 408 bytes |
| 5543ec6 | bench: the suite prints peak memory with ARENAS=1 |
| 5d48fe9 | perf: freeing skips finished transactions and sorts nothing (node) |
| 9a04506 | perf: function values own their bodies; templates take one buffer |
| 1693091 | perf: fewer allocations per row and per mount |
| 0de48f8 | perf: no binding clone per read; dropping an app breaks the host cycle |
| 8f3676d | fix: `App::mount` keeps taking a `Plan`; benchmarks mount a shared one (alloc) |

`bench-base` is `solid-model` plus only the bench driver, for the base column. `perf-compose` is `plan-v2-composition` with `rust-solid-perf` merged in (last merge 21c5eb3); its composition workloads are in their own table. The node table round is merged into it as 44c37ca, the allocation round as 6a19d38 and 232cc66 (the template merge rebuilt for v2.3 attributes).

Files here (`rust-solid/perf/`; read `HANDOFF.md` first):
- Branches on origin: `handoff/rust-solid-perf-r1` (round 1, 2e46b6c), `handoff/rust-solid-perf-r2-node-table` (5d48fe9), `handoff/rust-solid-perf-r3-allocation` (round 3 plus this folder), `handoff/rust-solid-bench-base` (6528df1), `handoff/rust-solid-perf-compose` (232cc66).
- `bench/`: `run.mjs` (wall and instructions), `growth.mjs` (slow-over-time check), `memory.mjs` (memory over time), `table.mjs` and `perf-table.mjs` (tables), `cov.mjs` (coverage), `check.mjs`, `solid-js.mjs` (the Solid JS driver), `workloads.mjs` (workload generator), `groups.json`.
- `scripts/gate.sh`: the correctness gate. `scripts/gate-front.sh`: its plan and eval fuzzers alone.
- `results/all.jsonl`: every number below, one row per workload, runtime, version and kind (`ir`, `wall`, `growth`, `memory`).

## Method

- **Instructions per op (primary).** `valgrind --tool=callgrind --collect-atstart=no --toggle-collect='*timed*'` on a release build, counting only inside the suite's timed region, divided by the reps. Deterministic, so a 1% change is real.
- **Wall clock (secondary).** Median of the suite's own timing on this cloud VM. Expect 10 to 20% run-to-run noise; small wall differences mean nothing. Solid JS is the same workload driven through `solid-js` 2 in Node (`solid-js.mjs`); each run checks that both runtimes end on the same frame hash.
- **Exact.** js-framework-benchmark keyed, ported in-process to Exact's runner (`exact/runner/examples/jfb.rs`, untracked bench glue in Dev's fork, not committed), with the same row data and the same ops and warmups. Its counter, fanout, select, filter and mount numbers come from Exact's own bench of the same shape, not the same plan, so read them as rough.
- **Slow-over-time check.** For each workload, instructions for the first R reps against the next 2R (R even, about 10 ms of work). A ratio over 1 means state that grows with use: a leak, tombstones, a list never trimmed. A fixed rep count hides these.
- **Correctness gate** (`scripts/gate.sh`): cargo test, the three plan-diff fixtures, the seven runtime fuzz modes and plan/eval fuzz (sync and async), 1,000 seeds each.

- **Memory check** (`memory.mjs`). Live nodes, node slots and the process's peak memory after R reps and after 10R.

Versions: **base** = solid-model + bench driver; **v1** = the eleven fixes reapplied; **v2** = + shared row steps; **now** = + the three slow-over-time fixes (2e46b6c); **node** = + the node table round (5d48fe9).

## Results

Ir is instructions per op. Lower is better. "now vs base" compares instructions. These tables stop at **now** (2e46b6c); the node table round has its own section after them.

### Signals and memos

| workload | base Ir | v1 Ir | v2 Ir | now Ir | now vs base | now wall | Solid JS wall | Exact wall | Exact Ir |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| counter | 20k | 19k | 18k | 18k | −6% | 1.2 µs | 2.7 µs | 2.6 µs |  |
| chain | 2.16M | 1.94M | 1.94M | 1.94M | −10% | 134 µs | 257 µs |  |  |
| diamond | 625k | 552k | 552k | 552k | −12% | 32.6 µs | 75 µs |  |  |
| fanin | 597k | 477k | 477k | 477k | −20% | 32.1 µs | 46.8 µs |  |  |
| fanout | 5.66M | 5.09M | 5.06M | 5.06M | −11% | 525 µs | 692 µs | 464 µs |  |
| memo-equal | 18k | 17k | 17k | 16k | −7% | 1.1 µs | 3.6 µs |  |  |
| same-write | 15k | 15k | 14k | 14k | −7% | 1.4 µs | 3.7 µs |  |  |
| scalars | 155.51M | 11.47M | 11.16M | 11.16M | −93% | 2445 µs | 3681 µs |  |  |
| roots | 50k | 46k | 43k | 43k | −15% | 5.2 µs | 28.2 µs |  |  |

### Control flow

| workload | base Ir | v1 Ir | v2 Ir | now Ir | now vs base | now wall | Solid JS wall | Exact wall | Exact Ir |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| branch-flip | 3.15M | 2.79M | 2.79M | 2.79M | −11% | 337 µs | 383 µs |  |  |
| branch-stale | 16k | 16k | 15k | 15k | −7% | 0.9 µs | 3.2 µs |  |  |
| nested-flow | 45.30M | 7.80M | 7.59M | 7.43M | −84% | 1240 µs | 1577 µs |  |  |
| rows-show | 13.62M | 12.01M | 11.52M | 11.52M | −15% | 2767 µs | 3871 µs |  |  |
| affects | 1.36M | 894k | 858k | 783k | −42% | 73.1 µs | 217 µs |  |  |

### Lists (js-framework-benchmark, 1,000 rows)

| workload | base Ir | v1 Ir | v2 Ir | now Ir | now vs base | now wall | Solid JS wall | Exact wall | Exact Ir |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| jfb-run | 67.42M | 46.21M | 42.36M | 42.35M | −37% | 19.8 ms | 19.7 ms | 24.6 ms | 277.67M |
| jfb-replace | 165.83M | 49.99M | 46.12M | 46.12M | −72% | 23.0 ms | 21.2 ms | 32.2 ms | 330.39M |
| jfb-update | 1.44M | 1.23M | 1.23M | 1.23M | −14% | 109 µs | 143 µs | 347 µs | 3.23M |
| jfb-select | 4.80M | 3.05M | 3.05M | 3.05M | −36% | 355 µs | 1023 µs | 464 µs | 3.50M |
| jfb-swap | 20.94M | 3.97M | 3.97M | 3.97M | −81% | 255 µs | 649 µs | 1000 µs | 7.56M |
| jfb-remove | 11.27M | 6.14M | 6.14M | 6.15M | −45% | 383 µs | 1392 µs | 661 µs | 7.03M |
| jfb-runlots | 631.09M | 436.65M | 397.99M | 397.84M | −37% | 72.3 ms | 190.1 ms | 363.3 ms | 2.85G |
| jfb-add | 101.60M | 53.29M | 49.45M | 49.45M | −51% | 7051 µs | 21.1 ms | 29.3 ms | 291.42M |
| jfb-clear | 2.16M | 1.92M | 1.92M | 1.92M | −11% | 896 µs | 1772 µs | 4514 µs | 50.93M |

### Lists (10 rows)

| workload | base Ir | v1 Ir | v2 Ir | now Ir | now vs base | now wall | Solid JS wall | Exact wall | Exact Ir |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| jfb10-run | 623k | 470k | 432k | 434k | −30% | 44.9 µs | 136 µs |  |  |
| jfb10-replace | 681k | 514k | 476k | 476k | −30% | 45.2 µs | 152 µs |  |  |
| jfb10-update | 16k | 15k | 15k | 15k | −8% | 1.1 µs | 4.1 µs |  |  |
| jfb10-select | 78k | 62k | 59k | 59k | −25% | 5.5 µs | 9.6 µs |  |  |
| jfb10-swap | 90k | 74k | 74k | 74k | −18% | 5.9 µs | 13.2 µs |  |  |
| jfb10-remove | 157k | 145k | 143k | 143k | −9% | 6.1 µs | 19.2 µs |  |  |
| jfb10-add | 700k | 525k | 487k | 487k | −30% | 49.6 µs | 211 µs |  |  |
| jfb10-clear | 40k | 38k | 38k | 38k | −4% | 3.6 µs | 10.4 µs |  |  |

### Large lists

| workload | base Ir | v1 Ir | v2 Ir | now Ir | now vs base | now wall | Solid JS wall | Exact wall | Exact Ir |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| select | 6.83M | 3.81M | 3.81M | 3.81M | −44% | 609 µs | 756 µs | 282 µs |  |
| select-100k | 456.29M | 301.04M | 301.14M | 301.14M | −34% | 93.8 ms | 71.3 ms |  |  |
| filter | 46.64M | 7.84M | 7.69M | 7.69M | −84% | 1542 µs | 1541 µs | 1213 µs |  |

### Stores

| workload | base Ir | v1 Ir | v2 Ir | now Ir | now vs base | now wall | Solid JS wall | Exact wall | Exact Ir |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| store-deep | 45k | 42k | 41k | 41k | −9% | 4.4 µs | 15.3 µs |  |  |
| store-push | 7.44M | 3.96M | 3.95M | 3.97M | −47% | 296 µs | 640 µs |  |  |
| form | 27k | 23k | 21k | 21k | −20% | 2.7 µs | 6.3 µs |  |  |

### Async

| workload | base Ir | v1 Ir | v2 Ir | now Ir | now vs base | now wall | Solid JS wall | Exact wall | Exact Ir |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| async-action | 4.32M | 2.62M | 2.63M | 2.55M | −41% | 366 µs | 645 µs |  |  |
| async-memo | 1.46M | 1.00M | 967k | 755k | −48% | 96.5 µs | 160 µs |  |  |
| async-overlap | 7.67M | 4.27M | 4.27M | 4.07M | −47% | 430 µs | 1624 µs |  |  |
| held-write | 4.35M | 2.66M | 2.66M | 2.58M | −41% | 323 µs | 619 µs |  |  |
| refresh | 1.29M | 830k | 795k | 762k | −41% | 87.2 µs | 250 µs |  |  |

### Boundaries

| workload | base Ir | v1 Ir | v2 Ir | now Ir | now vs base | now wall | Solid JS wall | Exact wall | Exact Ir |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| errored | 907k | 801k | 784k | 437k | −52% | 55.7 µs | 164 µs |  |  |
| row-boundaries | 2.06M | 2.02M | 2.01M | 863k | −58% | 58.7 µs | 200 µs |  |  |

### App-shaped

| workload | base Ir | v1 Ir | v2 Ir | now Ir | now vs base | now wall | Solid JS wall | Exact wall | Exact Ir |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| chat-send | 2.40M | 1.76M | 1.76M | 1.72M | −28% | 207 µs | 451 µs |  |  |
| chat-stream | 27k | 22k | 22k | 22k | −19% | 1.8 µs | 5.7 µs |  |  |
| dashboard | 27.60M | 10.42M | 10.26M | 10.26M | −63% | 1390 µs | 1915 µs |  |  |

### Mount

| workload | base Ir | v1 Ir | v2 Ir | now Ir | now vs base | now wall | Solid JS wall | Exact wall | Exact Ir |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| mount | 59.15M | 28.96M | 28.74M | 28.74M | −51% | 5334 µs | 5995 µs | 2303 µs |  |

### Composition (perf-compose)

Base has no composition support, so these start at v1. Now is within 1% of v2 on every one; the fixes this round don't touch the composition paths.

| workload | v1 Ir | v2 Ir | now Ir | now wall |
|---|---:|---:|---:|---:|
| compose-callback | 6.23M | 6.19M | 6.24M | 1335 µs |
| compose-children | 3.25M | 3.11M | 3.14M | 431 µs |
| compose-deep | 1.26M | 1.26M | 1.25M | 95 µs |
| compose-mount | 74.28M | 67.88M | 67.45M | 6860 µs |
| compose-select | 3.11M | 3.09M | 3.12M | 440 µs |

## Allocation round (Nov 16)

**What changed.** Fewer trips to the memory allocator, mostly when rows and components are created.

1. **A function value owns its body** (9a04506). Every function the runtime makes (an accessor, an event handler, a child getter) used to go into one table that was never cleaned, keyed by a number. Now the value holds its body itself, in one allocation, and frees it when the last copy goes away, the way a JS closure is garbage collected. Making one is one allocation instead of three, and calling one is a pointer read instead of a hash lookup.
2. **A template is one flat list** (9a04506). Building an element used to make a small tree of helper records per element, each with two lists. Now one list per template holds every node it creates, sized up front.
3. **Fewer strings per row** (1693091). The test host keeps one copy of each tag and prop name and shares it across nodes. Fixed property names (`"length"`, `"_$$click"` and the like) are made once per thread. Numbers become text on the stack, not through a formatter.
4. **Reads borrow instead of copy** (0de48f8). Reading a name in a plan cloned its whole binding first; now it is matched in place.
5. **A leak this exposed is fixed** (0de48f8). Once functions own their bodies, an app forms a loop: closures hold the app's context, the context holds the host, and the host's nodes hold the closures. Before, the never-cleaned table hid this. Dropping an app now clears the host's nodes first. With it, jfb-run peaks at 45 MB at both 2 and 8 remounts (the node table round: 50 → 55 MB).
6. **Harness:** the suite mounts one shared plan per rep instead of copying it (8f3676d, `App::mount_shared`). The Solid JS driver never copied it, so this removes a cost only the Rust side paid. `App::mount` still takes a `Plan`.

Every workload's final frame and full op trace are identical to the node table round's (all 48, and the 5 composition workloads).

### Wall clock

Alternating runs of node (the last round) and alloc, 5 each, median of the suite's own medians, idle machine. Solid JS was re-timed in the same session. This container is slower than the one the node round ran on (node jfb-run 8.4 ms here, 6.9 ms there), so compare within a row.

| workload | node | alloc | change | Solid JS |
|---|---:|---:|---:|---:|
| jfb-run | 8,384 µs | 4,901 µs | −42% | 23,633 µs |
| jfb-replace | 7,029 µs | 5,051 µs | −28% | 27,461 µs |
| jfb-clear | 324 µs | 315 µs | −3% | 1,885 µs |
| jfb-add | 7,469 µs | 6,445 µs | −14% | 25,743 µs |
| jfb-runlots | 112,234 µs | 93,556 µs | −17% | 252,729 µs |
| jfb-update | 136 µs | 136 µs | 0% | 242 µs |
| jfb-swap | 367 µs | 347 µs | −6% | 842 µs |
| jfb-remove | 540 µs | 527 µs | −2% | 2,507 µs |
| select-100k | 77,600 µs | 53,441 µs | −31% | 94,162 µs |
| mount | 4,797 µs | 3,618 µs | −25% | 6,585 µs |
| rows-show | 2,105 µs | 1,936 µs | −8% | |
| nested-flow | 1,045 µs | 914 µs | −13% | |
| scalars | 2,411 µs | 2,033 µs | −16% | |
| select | 472 µs | 404 µs | −14% | |
| fanout | 657 µs | 605 µs | −8% | |
| roots | 5.1 µs | 4.2 µs | −18% | |
| jfb10-add | 91 µs | 81 µs | −11% | |
| jfb10-clear | 5.8 µs | 5.8 µs | 0% | |
| affects | 96 µs | 90 µs | −6% (9 runs) | |
| diamond | 48 µs | 54 µs | +5 to +11% | |
| fanin | 46 µs | 48 µs | +4% (9 runs) | |

diamond and fanin are 50 µs memo graphs whose instruction counts don't move (+0.5%, −0.4%). Their wall times swing 10% between runs of the same binary, and the slowdown was already there before the last two commits. Most likely code layout; not chased.

### Instructions

Geomean over the 48 workloads: −6.1% against node. 34 drop more than 1%, 13 are within 1%, one rises more:

| workload | node Ir | alloc Ir | change |
|---|---:|---:|---:|
| mount | 28.50M | 20.59M | −27.8% |
| jfb-run | 41.68M | 33.33M | −20.0% |
| jfb10-run | 440K | 352K | −20.0% |
| jfb-runlots | 393.4M | 318.0M | −19.2% |
| roots | 42.6K | 34.7K | −18.4% |
| jfb-replace | 45.93M | 37.60M | −18.1% |
| jfb-add | 49.14M | 41.62M | −15.3% |
| nested-flow | 7.55M | 6.87M | −9.0% |
| scalars | 11.39M | 10.68M | −6.2% |
| select-100k | 309.9M | 308.1M | −0.6% |
| jfb-clear | 2.30M | 2.33M | +1.4% |

jfb-clear (+1.4%), chain (+0.8%) and jfb-update (+0.1%) now free function bodies the old table kept forever, which costs a little in the allocator. Composition (perf-compose): mount −18.7%, children −2.4%, deep −2.1%, callback 0%, select +0.3%.

### Memory

Peak memory after 10R reps, same R as the node round's table. Lower everywhere; live nodes are unchanged.

| workload | node peak | alloc peak |
|---|---:|---:|
| affects | 81 MB | 65 MB |
| async-memo | 59 MB | 48 MB |
| refresh | 69 MB | 54 MB |
| errored | 49 MB | 40 MB |
| scalars | 47 MB | 33 MB |
| filter | 25 MB | 22 MB |
| nested-flow | 26 MB | 23 MB |
| rows-show | 34 MB | 30 MB |
| dashboard | 27 MB | 25 MB |
| select-100k | 319 MB | 314 MB |
| jfb-run | 56 MB | 45 MB |
| jfb-add | 69 MB | 52 MB |
| jfb-clear | 55 MB | 45 MB |
| jfb-runlots | 144 MB | 129 MB |

Slow-over-time is unchanged: every workload's ratio is within 0.03 of the node round's (mount 0.984 → 0.956, jfb-run 1.018 → 1.023).

### What's still allocated per row

From profiles: the closures each `insert` makes (Solid's own design, the same in JS), the suite's own data building (row labels, objects), the node table growing during a mount (about 4.5% of mount), and plan name lookups by string.

## Node table round (Nov 15)

**What changed.** Every reactive node lives in one table and is named by its position in it. Before, a disposed node's slot was never used again, so the table only grew. Now:

1. **Freed slots are reused** (48115c2, 55adff6, 5d48fe9). At the end of each flush, a disposed node is freed if nothing in the runtime can still reach it: no live node reads it or is read by it, and no queue, pending async step, open transaction, boundary or running action still names it. A later node takes the slot. JS gets the same effect from its garbage collector. Only a mounted plan turns this on (`collect_disposed`); a caller that keeps its own node handles is unchanged.
2. **Each node is smaller** (8ac6816): 760 to 408 bytes, and each dependency link 72 to 40. Fields most nodes never set (the async and transaction state, the parked-frame lists) move behind one pointer that stays empty until first written, and node references are 4-byte indices instead of 16-byte options.

**How freeing is kept safe.** A build flag (`--cfg node_check`) makes a freed slot never reused and any touch of one panic. Every fuzzer ran against that build. It caught four ways a node could be freed while something still named it: an effect queued in a transaction, a node disposed twice in one flush, an effect held by a loading boundary, and a signal written by an action still running. All are fixed, and the full gate passes on both builds (below).

### Wall clock

Alternating runs of now and node, 5 each, median of the suite's own medians, idle machine. Solid JS is from the main tables.

| workload | now | node | change | Solid JS |
|---|---:|---:|---:|---:|
| jfb-run | 20,153 µs | 6,885 µs | −66% | 19,685 µs |
| jfb-replace | 22,172 µs | 4,999 µs | −77% | 21,155 µs |
| jfb-clear | 840 µs | 361 µs | −57% | 1,772 µs |
| jfb-add | 7,639 µs | 5,671 µs | −26% | 21,082 µs |
| jfb-runlots | 78,429 µs | 83,925 µs | +7% (noise) | 190,103 µs |
| select-100k | 100,684 µs | 67,357 µs | −33% | 71,298 µs |
| mount | 5,521 µs | 4,551 µs | −18% | 5,995 µs |
| rows-show | 2,684 µs | 2,313 µs | −14% | |
| nested-flow | 1,239 µs | 931 µs | −25% | |
| scalars | 2,547 µs | 2,052 µs | −19% | |
| select | 576 µs | 466 µs | −19% | |
| fanout | 764 µs | 638 µs | −16% | |
| affects | 75 µs | 64 µs | −14% | |
| diamond | 34 µs | 33 µs | −2% | |
| jfb10-add | 54 µs | 61 µs | +13% | |
| jfb10-clear | 3.6 µs | 4.0 µs | +11% | |

Most of the jfb gain is from reuse alone: in a separate three-way check, jfb-run went from 21.4 ms to 5.2–6.0 ms with reuse only, and to 4.7–5.1 ms with the smaller nodes too. The instruction counts below barely move, so the old time went to memory: each rep of a create workload remounts, and a table that only grows keeps touching memory the process has never used. The kernel has to hand over and zero fresh pages, which instruction counts don't see. jfb10-add and jfb10-clear (10 rows) pay for freeing with nothing to win back.

### Instructions

Geomean over the 48 workloads: +2.1% against now. 6 workloads drop (jfb-run −1.6%, jfb-runlots −1.1%, mount −1.0%), 16 are within 1%, 18 rise 1 to 3%, and these rise more:

| workload | now Ir | node Ir | change | why |
|---|---:|---:|---:|---|
| jfb-clear | 1.92M | 2.30M | +20% | freeing 1,000 rows' nodes, which before were dropped on the floor |
| jfb10-clear | 38.1K | 45.1K | +18% | the same, for 10 rows |
| jfb10-add | 487K | 536K | +10% | a reused slot is written over in place (copying the new node in) |
| refresh | 762K | 799K | +4.8% | checking what a flush may free |
| affects, async-memo | 783K, 755K | 817K, 788K | +4.3% | the same |
| rows-show | 11.52M | 11.93M | +3.6% | the smaller node: reads of the rarely used fields go through one pointer |
| chat-send | 1.72M | 1.78M | +3.3% | the same |

The 1 to 3% group is mostly the smaller node's extra pointer step in `recompute`. On wall clock that is outweighed by fitting more nodes in cache. Composition (perf-compose 44c37ca): callback +2.4%, children +1.6%, deep +4.4%, mount −1.1%, select +2.3%.

One problem the full suite caught on the way: the first version kept every finished transaction's nodes pinned, so affects, async-memo and refresh ran 7 to 10 times slower as their list of nodes waiting to be freed grew and was sorted each flush. 5d48fe9 pins only transactions that something can still reach, and replaces the sorts with two marker bits.

### Memory

Peak memory after 10R reps (R from the slow-over-time check), and live nodes after R and 10R. Live nodes weren't counted before this round.

| workload | 10R | now peak | node peak | live nodes R → 10R (node) |
|---|---:|---:|---:|---:|
| affects | 1,380 | 201 MB | 81 MB | 113 → 113 |
| async-memo | 1,040 | 149 MB | 59 MB | 113 → 113 |
| refresh | 1,160 | 170 MB | 69 MB | 230 → 1,274 |
| errored | 1,800 | 114 MB | 49 MB | 56 → 56 |
| scalars | 60 | 151 MB | 47 MB | 2,006 → 2,006 |
| filter | 80 | 104 MB | 25 MB | 5,009 → 5,009 |
| nested-flow | 100 | 81 MB | 26 MB | 2,211 → 2,211 |
| rows-show | 40 | 71 MB | 34 MB | 7,009 → 7,009 |
| dashboard | 80 | 63 MB | 27 MB | 4,019 → 8,019 |
| select-100k | 20 | 421 MB | 319 MB | 300,009 → 300,009 |
| jfb-run | 20 | 116 MB | 56 MB | (remounts) |
| jfb-runlots | 20 | 167 MB | 144 MB | (remounts) |

Live nodes are flat everywhere but refresh (one node per two reps, held by a flight that is never removed) and the ones that grow by design (dashboard, chat-send, store-push). What still grows in the others is outside the node table: the renderer's host nodes (affects reaches 138K of them at 10R, about 28 MB), and the transaction, flight, set and function tables. Four workloads can't run 10R reps (async-action, async-overlap, held-write, store-deep run out of scripted steps) and are left out.

### Slow-over-time on node

Unchanged from the table below except: jfb-run 1.042 → 1.018, jfb-replace 1.038 → 1.016, nested-flow 1.057 → 0.997, errored 1.023 → 1.041, dashboard 1.318 → 1.418 (R is 8, so noise as noted), chat-send 1.255 → 1.300 (grows by design).

## Where rust-solid stands

- **Against Solid JS, after the allocation round:** re-timed in one session on the ten workloads Solid JS has numbers for, rust-solid wins all ten: jfb-run 4.9 vs 23.6 ms, jfb-replace 5.1 vs 27.5 ms, select-100k 53 vs 94 ms, mount 3.6 vs 6.6 ms, jfb-runlots 94 vs 253 ms.
- **Against Solid JS, after the node table round:** the two workloads it lost before now win: select-100k 67 vs 71 ms, jfb-replace 5.0 vs 21.2 ms. jfb-run is 6.9 vs 19.7 ms. Only the 16 workloads in the node table's wall table were re-timed; the rest are as below.
- **Against Solid JS, before it (now):** faster on 44 of 48 workloads by wall clock, often 2 to 4 times (roots 5×, jfb-remove 3.6×, async-overlap 3.8×, row-boundaries 3.4×). Level on jfb-run and filter. Slower on **select-100k** (94 vs 71 ms) and slightly on **jfb-replace** (23.0 vs 21.2 ms, inside noise). Both are dominated by creating or diffing very many rows, which is where the node table below costs most.
- **Against Exact:** faster on every js-framework-benchmark op, by 1.2× (run) to 5× (runlots, clear), and on counter. Exact is faster on fanout (464 vs 525 µs), select (282 vs 609 µs), filter (1.2 vs 1.5 ms) and mount (2.3 vs 5.3 ms), on its own bench of those shapes.

## Slow-over-time check

Workloads off 1.0 by more than 3% at either version. All others are flat (0.99 to 1.01).

| workload | reps R | before (v2) | now |
|---|---:|---:|---:|
| affects | 64 | 1.626 | 1.001 |
| async-memo | 110 | 1.405 | 1.002 |
| async-overlap | 24 | 0.997 | 0.943 |
| chat-send | 42 | 1.255 | 1.255 |
| chat-stream | 200 | 1.064 | 1.064 |
| dashboard | 8 | 1.405 | 1.405 |
| errored | 162 | 2.754 | 1.02 |
| held-write | 32 | 1.002 | 0.97 |
| jfb-replace | 2 | 1.038 | 1.038 |
| jfb-run | 2 | 1.042 | 1.042 |
| refresh | 80 | 1.297 | 0.994 |
| row-boundaries | 26 | 2.807 | 0.996 |
| store-push | 36 | 1.057 | 1.057 |

The four that grew because of a real bug are fixed:
- **row-boundaries, errored:** an error boundary kept every reader it had ever had, deleted ones as empty slots, and walked them all on each change. Boundaries now drop deleted readers at the boundary seam (the outermost point, where nothing is iterating). row-boundaries went from 409 to 59 µs wall.
- **affects, async-memo, refresh:** the app's request log was a flat list searched front to back, and flights (pending async values) were found by comparing names one by one. Both are now maps.

The rest grow by design:
- **chat-send, chat-stream, store-push:** each rep appends to the list or the text, so the next rep has more to show. Solid JS grows the same way.
- **dashboard:** steps through ten thresholds, so its ratio is noise unless R is a multiple of ten (R is 8 here).
- **jfb-run, jfb-replace (+4%):** the node table never reused slots, so each run added 1,000 rows of new nodes. With reuse (node) they are at +1.8% and +1.6%.

## Coverage

`bench/cov.mjs` compares the functions the workloads reach with the ones a reference run reaches (cargo test plus the fuzz corpora replayed). The workloads reach 465 of the 551 functions the reference runs. The 86 they miss are 1.58% of the reference's instructions.

By area:

| area | covered by | gaps |
|---|---|---|
| signals, memos | counter, chain, diamond, fanin, fanout, memo-equal, same-write, scalars, roots | none of note |
| control flow | branch-flip, branch-stale, nested-flow, rows-show, affects | nested `flatten` and nested dynamic expressions (the `'2` recursive copies) |
| lists | 17 jfb ops at 1,000 and 10 rows, select, select-100k, filter | nested arrays (`normalize'2`) |
| stores | store-deep, store-push, form | |
| async | async-action, async-memo, async-overlap, held-write, refresh | loading components |
| boundaries | errored, row-boundaries | nested boundaries, component-level error boundaries |
| app-shaped | chat-send, chat-stream, dashboard | |
| mount, roots | mount, roots | teardown (dropping a whole runtime, `cleanup`) |
| composition | compose-callback, -children, -deep, -mount, -select | |

The largest single miss is cloning a plan's steps (0.29%), which happens when a plan is lowered more than once; no workload remounts a plan.

## Correctness gate

On 2e46b6c, all identical to `docs/HANDOFF.md`. On the node table round's last commit (5d48fe9) every row is identical again, twice: once on a normal build and once with `--cfg node_check` (a freed slot is never reused and touching one panics). cargo test is 177 there (186 on perf-compose 44c37ca, whose composition plan-fuzz also gives 149 / 151 / 0 on both builds).

| check | result |
|---|---|
| cargo test | 176 pass (185 on perf-compose) |
| plan-diff fixtures | tracker 453/453, like 34/34, tracker-async 399/399 entries agree |
| slice1 | 1000/1000 |
| slice2a | 991/1000 (8 oracle non-scalar, 1 known rust panic at seed 629) |
| slice2b | 1000/1000 |
| slice2c | 999/1000 (oracle halted at 493) |
| render | 993/1000 (7 oracle errors) |
| strings | 1000/1000 |
| boundaries | 985/1000 (15 oracle timeouts) |
| plan-fuzz | 861 agree, 8 upstream, 131 refused, 0 divergent |
| plan-fuzz --async | 878 agree, 122 refused, 0 divergent |
| eval-fuzz | 869 agree, 131 refused, 0 divergent |
| eval-fuzz --async | 878 agree, 122 refused, 0 divergent |
| composition plan-fuzz (perf-compose, 300 seeds) | 149 agree, 151 upstream, 0 divergent |

After the allocation round (8f3676d) every row is identical again on both builds, cargo test 177; perf-compose 232cc66 gives 186 tests and composition plan-fuzz 149 / 151 / 0 on both builds.

Skipped: the frames tests that need Chromium. No browser is installed here and none was installed.

## What's left, and what it's worth

In rough order of value. Estimates come from profiles, not from trying the change.

1. **Node table: done** (Node table round). Left from it: the renderer's host nodes are never freed (about 200 bytes each; affects holds 138K after 1,380 reps). Freeing them needs to know when no value or closure still holds a host handle. The transaction, flight and set tables also only grow (refresh keeps one node per two reps through its flights). And the smaller node costs 1 to 3% instructions in `recompute`; a fast path for nodes with no async state would win that back.
2. **Allocation: done in part** (Allocation round). The function table no longer grows. What is left per row is `Universal::insert`'s closures (Solid's own design), the node table growing during a mount (about 4.5% of mount; a capacity hint from the plan would remove it), and plan name lookups by string.
3. **`recompute` has a flat per-node cost** (3.5% of jfb-run) that doesn't depend on what changed.
4. **Mount re-lowers the plan** each time it mounts, and hashes names with SipHash. A cached lowered plan and the existing fast hasher would help mount (5.3 ms, Exact 2.3 ms) and compose-mount.
5. **The `sets` arena grows forever,** like the node table but smaller. Same fix shape.
6. **Plan v2 has no append step,** so every append workload rebuilds its list from the host value. A schema change, not a runtime fix.
7. **Coverage gaps** above: a teardown workload, nested arrays, nested boundaries, a remount workload.

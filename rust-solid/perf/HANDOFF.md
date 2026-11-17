# rust-solid performance work: handoff

This explains the rust-solid performance work end to end, so someone can pick it up cold. `PERF.md` next to this file holds every number and table. This file tells you what was done, how far to trust it, how to rerun it and what is still open.

## The goal

rust-solid is the Rust port of Solid 2's reactive runtime, on branch `solid-model`. The aim was to:

1. Build a benchmark suite that covers the kinds of work real apps do, so a slow path can't hide.
2. Make rust-solid faster against that suite.
3. Keep its behaviour exactly identical to Solid 2. Every change has to pass the same differential fuzzers, which run random programs on both runtimes and compare every step.

## The branches

All of these are on origin. No PR is open.

| branch | what it is |
|---|---|
| `handoff/rust-solid-perf-r1` | Round 1: the benchmark suite, bench fixes, and the first optimizations (head 2e46b6c) |
| `handoff/rust-solid-perf-r2-node-table` | Round 2 on top: freed nodes are reused and every node is smaller (head 5d48fe9) |
| `handoff/rust-solid-perf-r3-allocation` | Round 3 on top: fewer memory allocations, plus this `rust-solid/perf/` folder |
| `handoff/rust-solid-bench-base` | `solid-model` plus only the benchmark driver, for "before" numbers (head 6528df1) |
| `handoff/rust-solid-perf-compose` | `plan-v2-composition` with every round merged in, for the composition workloads (head 232cc66) |

The three `rust-solid-perf` branches stack: r2 contains r1, and r3 contains r2. `handoff/rust-solid-perf-compose` also carries the commits of `plan-v2-composition` and the React Compiler frontend prototype it was built on. Those are pushed only as part of that branch.

## What was done

### The benchmark suite

There are 48 workloads plus 5 composition workloads. Each one is a small app (a plan) and an operation that is repeated and timed. They cover:

- signals and memos;
- control flow (Show, For, Switch);
- js-framework-benchmark at 1,000 rows and at 10 rows;
- a 100,000-row list;
- stores;
- async work;
- error and loading boundaries;
- app-shaped screens (a dashboard, a form, a chat);
- mounting;
- composition: components, props, children and callbacks.

The same workload file runs on rust-solid and on real Solid 2 in Node. Each run checks that both end on the same screen.

Each workload is measured four ways:

- **Instructions per operation (the main number).** This is a count of CPU instructions, measured under valgrind. It doesn't change from run to run, so a 1% change is real.
- **Wall clock time.** This is noisy on a cloud machine: expect 10 to 20% swings.
- **A slow-over-time check.** Does an operation get more expensive the longer the app runs? This catches leaks.
- **Peak memory.** Measured after R and after 10R repetitions.

### Round 1 (benchmark plus fixes)

Writing the suite found one real mismatch with Solid: a store list filter. It is fixed. Round 1 then made three fixes for things that got slower over time, and made rows share their handler and text descriptions instead of copying them.

Result: by wall clock, rust-solid was faster than Solid JS on 44 of the 48 workloads, often 2 to 4 times.

### Round 2 (node table)

Every reactive value (a signal, a memo, an effect) is a "node" kept in one big table. Two changes:

- **Freed slots are reused.** Before, a disposed node's slot was never used again, so the table only grew. Now a node is freed once nothing can reach it, and a new node reuses the slot. JS gets the same effect from its garbage collector.
- **Each node is smaller,** 760 bytes down to 408. Rarely used fields moved into a side record that is only created when needed.

Result: the list-creating benchmarks got 2 to 4 times faster by wall clock (jfb-run 20.2 to 6.9 ms; Solid JS 19.7 ms). Memory stays flat in long-running apps. Instructions rose 2.1% overall, from the extra pointer step to the moved fields.

**Safety net for this round.** A build flag, `--cfg node_check`, makes a freed slot never reused and makes any later touch of it crash loudly. All the fuzzers ran on that build too. It caught four ways a node could be freed while still in use, and all four are fixed.

### Round 3 (allocation)

These changes cut how often the code asks the memory allocator for space:

- **A function value owns its code.** Before, every function the runtime made (an event handler, a getter) went into a table that was never cleaned. Now each value holds its own code and frees it when the last copy goes away.
- **A template is built into one flat list,** instead of a small tree of helper records per element.
- **The test host shares names.** It keeps one copy of each tag and property name instead of a new string per row.
- **A reference cycle is broken.** Owning functions created a loop: function → app context → host → host nodes → function. Dropping an app now clears the host's nodes first, so everything is freed.
- **Harness change.** The benchmark mounts one shared plan instead of copying it every repetition. The JS side never copied it.

Result:

- Instructions are down 6.1% across the suite: mount −28%, jfb-run −20%.
- jfb-run takes 4.9 ms (Solid JS 23.6 ms, timed in the same session), select-100k 53 ms (Solid JS 94), and mount 3.6 ms (Solid JS 6.6).
- Peak memory is lower on every workload.

## What was tested, and what wasn't

Tested on the final commit of each round, on both a normal build and the `node_check` build:

- `cargo test`: 177 tests pass (186 on the compose branch).
- The three plan-diff fixtures (tracker, like, tracker-async) agree entry for entry.
- The seven runtime fuzz modes, 1,000 seeds each, match the baseline in `docs/HANDOFF.md` exactly (slice1, slice2a/b/c, render, strings, boundaries).
- plan-fuzz and eval-fuzz, sync and async, 1,000 seeds each: 0 divergent.
- The composition plan-fuzz on the compose branch, 300 seeds: 149 agree, 151 upstream, 0 divergent.
- For every workload, the final screen and the full log of operations on the host are identical before and after each round.

Known and not caused by this work:

- slice2a has one Rust panic at seed 629. It was in the baseline before any of this work.
- The other "invalid" fuzz cases come from the JS reference runner timing out or erroring, not from rust-solid.

Not tested:

- **The frames tests.** They need Chromium, and no browser is installed in the environment this ran in.
- **Wall clock on a real desktop.** All timings come from a cloud VM. They are paired, alternating runs, but still noisy.
- **diamond and fanin,** two tiny 50 µs memo workloads. They read 4 to 11% slower by wall clock in round 3, while their instruction counts didn't move. This is most likely code layout, and it was not chased.
- **The Exact comparison** (in PERF.md) is rough for anything but the js-framework-benchmark ops, because Exact's numbers come from its own bench of a similar shape.
- **Four workloads** can't run 10× their repetitions for the memory check: async-action, async-overlap, held-write and store-deep. They run out of scripted steps.

## How to run it

You need Rust (stable), Node 24 and valgrind. `solid-js.mjs` loads Solid from `solid-next/packages/*/dist` and the composition builder from `frontend/`, so build solid-next and run `npm install` in `frontend/` first.

```sh
# Build the benchmark runner
cd rust-solid
cargo build --release --example suite
BIN=target/release/examples/suite

# Write the workload files (53 JSON files)
node perf/bench/workloads.mjs /tmp/wl

# One workload: wall clock, instruction mode, or full trace
$BIN /tmp/wl/jfb-run.json wall
$BIN /tmp/wl/jfb-run.json trace

# Instructions per op (divide "Collected" by the reps)
valgrind --tool=callgrind --callgrind-out-file=/dev/null --collect-atstart=no \
  --toggle-collect='*timed*' $BIN /tmp/wl/jfb-run.json ir

# The same workload on real Solid 2 in Node
node --conditions=browser perf/bench/solid-js.mjs /tmp/wl/jfb-run.json wall

# Everything: wall + instructions for all workloads, plus Solid JS wall
node --conditions=browser perf/bench/run.mjs /tmp/wl $BIN out.jsonl --js

# rust-solid's host log must equal Solid's, step for step
node --conditions=browser perf/bench/check.mjs /tmp/wl $BIN

# Slow-over-time and memory checks (WALL.jsonl from run.mjs picks the reps)
node --conditions=browser perf/bench/growth.mjs /tmp/wl $BIN out.jsonl growth.jsonl
node perf/bench/memory.mjs /tmp/wl $BIN out.jsonl memory.jsonl
```

The five `compose-*` workloads need the suite built on `handoff/rust-solid-perf-compose`, because only that branch reads plan v2.3.

The correctness gate runs cargo test, plan-diff, every fuzzer and the frontend fuzzers. It takes 30 to 40 minutes, or less with `quick` (300 seeds per fuzzer):

```sh
sh rust-solid/perf/scripts/gate.sh /tmp/gate            # normal build
RUSTFLAGS="--cfg node_check" sh rust-solid/perf/scripts/gate.sh /tmp/gate-nc
```

Compare its `gate.log` with the "Correctness gate" table in PERF.md. Every row should be identical.

`perf/results/all.jsonl` has every number in PERF.md, one row per workload, runtime, version and kind.

## Open decision

**Which cost to work on in round 4.** The options:

1. **Recompute (recommended).** Add a fast path for nodes with no async work when they re-run. It runs in every workload and would win back the 1 to 3% that round 2's smaller nodes cost.
2. **Mount.** Size the node table from the plan before mounting, and look up names without strings. Mount is 3.6 ms; Exact does 2.3 ms on its own bench.
3. **Free the test host's nodes** when nothing holds them. This only helps memory in long-running apps, and only in the test host.
4. **Stop here.**

My recommendation is recompute, because it speeds up every kind of workload, not only lists or mounting.

## Next steps after that

- Whatever round 4 is, rerun the full workload set, the gate on both builds, and the memory and slow-over-time checks. Then add a section to PERF.md like the round 2 and 3 sections.
- The transaction, flight and set tables still only grow; `refresh` keeps one node per two repetitions through its flights. The same fix as round 2's would apply.
- Plan v2 has no "append" step, so every append workload rebuilds its list. That is a plan schema change, not a runtime fix.
- Workloads still missing: a teardown, nested arrays, nested boundaries and a remount loop.
- If this should go upstream, it needs a PR against `solid-model` (none is open). Rounds 2 and 3 change `App::mount`'s internals but not its signature, and add `App::mount_shared` for benchmarks.

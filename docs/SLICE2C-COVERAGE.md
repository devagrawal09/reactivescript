# Slice 2c (tier C): lists, Show and children in computations. Fuzz mode, baseline, Solid coverage delta

**Port status:** the tier-C paths below are ported (`crates/runtime/src/slice1/map.rs`, the owner/frame machinery, shallow stores, and the driver's tier-C ops). `--slice2c` 1–1000: 999/1000 (every valid program; 493 invalid), 1001–3000: 1998/2000 (2723, 2907 invalid). Results and the call map to Rust are in [SLICE1.md](SLICE1.md); runs in [slice2c-fuzz/port](slice2c-fuzz/port/). The text below is the pre-port baseline.

Reference: Solid `2105ffb8` (rc.21). Sources: `packages/signals/src/` and solid-js `packages/solid/src/client/flow.ts` (For, Show), read-only. The design is tier C of [SLICE2B-DESIGN.md](SLICE2B-DESIGN.md). The port is `crates/runtime/src/slice1/` at slices 1 + 2a + 2b, untouched here. The method is the one in [SLICE2B-COVERAGE.md](SLICE2B-COVERAGE.md): every program runs in a fresh worker, for the oracle and for coverage alike. Artifacts and scripts are in [slice2c-fuzz/](slice2c-fuzz/).

## Handoff summary

- **Mode.** `node fuzz/run.mjs --slice2c --seeds N [--start S] --out DIR [--no-reduce]` runs `fuzz/generate-slice2c.mjs` on `slice1-driver`. The worker oracle runs in strict mode `'slice2c'`, and traces are compared whole and exactly.
- **Baseline** (the port as copied: `147d971` plus the uncommitted 2a and 2b tiers):
  - Seeds 1–1000: **0/1000**. 999 programs fail as `rust-panic`, and 1 is invalid (seed 493).
  - Held-out seeds 1001–3000: **0/2000**. 1998 fail as `rust-panic`, and 2 are invalid (seeds 2723 and 2907).
  - Every family scores 0. The first panic of each program is one of these:
    - `slice1-driver.rs:899` "operation outside the slice-1 driver" on `list` (618 programs), `show` (236) or `owner` (125);
    - `store.rs:1890` "shallow stores are not ported" (21).
  - The reduced case is 2 ops: a signal, then a `list`.
- **Invalid seeds.** There are three, and all are one suspected Solid bug family (section 8). An optimistic store's array hands mapArray an `undefined` row, and the program's key function `x => x.id` throws.
  - **493** (`list-opt-store`, `oracle-halted`): `has` and `get` disagree. `i in list` is false while `list[i]` is a row below `length`, so mapArray's `newItems.slice(0)` keeps a hole.
  - **2723** and **2907** (held out, `oracle-error`): overlapping pending move, remove and push guesses compose into a view with `undefined` elements, and every reader sees it.
  - Each has an op-level repro, and two have repros that use only Solid's API. None was reported upstream.
- **Gates are unchanged, and their summaries are byte-identical** to the recorded ones:
  - `--slice1` 1–1000: 1000/1000.
  - `--slice2a` 1–1000: 991/1000. That is 8 `oracle-nonscalar` and `rust-panic` 629.
  - `--slice2b` 1–1000: 1000/1000.

  The byte gate compares old and new `solid.mjs`/`worker.mjs` result messages. It gives identical results on `--slice1` 1–3000, `--slice2a` 1–3000 and `--slice2b` 1–3000. On M1 1–2000 there are two exceptions, both the same in both oracles:
  - seed 1193 differs only in the oracle's own frame paths;
  - 14 seeds time out in both oracles, the same 14 recorded in `docs/results`.
- **Coverage delta** against `--slice2b` 1–1000, collected with fresh workers on both sides:
  - 61 Solid functions gain lines, and 31 of them run for the first time: **630 new TS code lines**.
  - By file: `map.ts` 436, `core/scheduler.ts` 52, `core/core.ts` 42, `store/store.ts` 38, `core/owner.ts` 25, `store/types.ts` 13, `core/effect.ts` 10, and 14 in the other files.
  - The 999 valid programs alone give **599 lines**. The other 31 lines are run only by invalid seed 493's halt (`haltReactivity`, `notifyHalted`, `escalate`, the error arm of `notifyEffectStatus`, and a few scheduler and lane lines). They are an oracle path, not a port target.
  - Against `--slice2a` ∪ `--slice2b` it is 611 lines.
  - **Method finding.** Line counts here are computed per coverage file and then summed (`cov-lines.mjs`). `docs/slice2a-fuzz/tools/delta.mjs`, used for SLICE2B-COVERAGE.md, sums block ranges across files first. V8 omits a nested block whose count equals its parent's, so summing ranges first can undercount. Here it gives 623 lines instead of 630, and it moves lines between files (section 5).
- **`slice1/` cut sites now reached** (section 7):
  - the whole of `map.ts`, which has no Rust module;
  - `onCleanup` disposal lists (`owner.rs:2`): 998 programs;
  - parked child frames and `parkChildren` (`core.rs:106`): 172 seeds; die-on-spot: 79;
  - zombies (`core.rs:14`, `scheduler.rs:319`): deferred in 121 seeds; zombies re-run at commit (scheduler.ts:1157-1164) in 8;
  - `holdFrame` over children (`scheduler.rs:4`): 121 seeds;
  - the parked frame retired at commit (`scheduler.rs:627`): 135 seeds; at a lane seam: 105;
  - `removalStagedBy` (`scheduler.rs:189`): 6 seeds;
  - CONFIG_SYNC (`core.rs:3-7`): every Show, 301 seeds;
  - a parked frame dying with its owner (`owner.rs:73`): 3 seeds;
  - a lane dissolve retiring a frame (lanes.ts:676): 2 seeds;
  - shallow stores (`store.rs`): 21 seeds;
  - in the driver: `list`, `show`, `owner`, `dispose`, memo/effect `children`, and the new expressions and event shapes.
- **Tracker anchor.** `trackerDemoC()` is the demo script with Show + For. All **8 frames match `EXPECTED`** of `frontend/tsx/demo.test.ts`.

## 1. The `--slice2c` mode

### Oracle (`fuzz/solid.mjs`): what is implemented

Every new branch is reached only through a new op name, a new op field (`children`, `cleanup`) or a new expression or edit form. The legacy lines are textually unchanged. The `memo` and `effect` cases gain a prefix branch, and `enc`/`lg` gain a `{f}` arm for labelled functions; only tier-C ops create labels.

**Ops and their Solid calls:**

- **`list`.**
  - It calls `S.mapArray(() => each, map, opts)` (map.ts:67-108).
  - **Arity.** `map` is built with arity 2 when `index` is set, `(item, index) => body(item, index)`, and with arity 1 otherwise. map.ts:79 reads `map.length > 1`.
  - **`opts.keyed`**: `true`, `false`, a field name (`x => x[name]`), or `{expr}` (a key function evaluating `expr` with `elem` = the item).
  - **`opts.fallback`.** When `fallback` is set, it logs `fallback` and registers a cleanup. When it is a children list, it also builds them, and it returns `-serial`.
  - **`lazy: true` is For** (flow.ts:83-111). The owner is captured when the op runs. `list = () => (mapped ??= runWithOwner(owner, make))()`, and the options are `{keyed: props.keyed}` (`undefined` for identity), with `fallback` only when given. The accessor is labelled `{f: id}`.
- **The mapper body (row events).**
  - It logs `["row", L, serial, item|null, index|null]`. The item is `null` when it is an accessor; the index is logged only when it is a number.
  - It registers `onCleanup` → `["cleanup", "L#s"]`.
  - It builds the row children under the row's owner, with context `{row: {item, index, up}, scope}`. The row's value is the serial.
- **`show`** (flow.ts:192-263):
  - `conditionValue = createMemo(() => when)` (no options, as prod);
  - `condition = createMemo(conditionValue, {equals: (a,b) => !a === !b, sync: true})` (`keyed: true`: `condition = conditionValue`);
  - the outer `createMemo(() => {...}, {sync: true})`. It logs `["branch", B, pass, 0|1]`, builds `yes` or `no` and returns the pass number or the last list child's accessor. Element children are built directly in the pass, as a JSX children getter is (createComponent untracks only the component call; building them reads nothing). Function children (`fn: true`) run under `untrack` and receive the narrowed accessor `() => { (verdict && shown === run) || condition() || throw "Stale read from <Show>."; return conditionValue() }`. With `keyed`, they receive the raw value.
- **`memo`/`effect` with `children`/`cleanup`.** After the `compute` log, the pass builds its children under `untrack` (a component call) and registers `onCleanup` → `["cleanup", "m@pass"]`; then it evaluates `expr`. `optimistic`, `flight`, `loading`, `owner`, `render` and `defer` keep their legacy meaning.
- **Children** (`row`, `yes`, `no`, `fallback`, `children`). Child ids are prefixed by the row or pass (`L#3.e0`, `B@2.L#1.t`, `m@4.c0`):
  - `{effect, expr, render, defer}`: render or user effect. The user-effect error callback logs `e.message`, or `String(e)` for a thrown string.
  - `{memo, expr}`.
  - `{list}` and `{show}`, nested.
  - `{cleanup}`.
  - `{read, label}`: a read in the pass body itself, not wrapped in `observed()`, so a throw (an Error or a NotReadyError) aborts the mapper pass (#2903).
  - Memos, lists and Shows register in the pass's `scope` and are read with `local`.
- **Expressions:**
  - `item`/`index`, with `up` for enclosing rows; an accessor is called, which is a row-signal read;
  - `call`, which calls a function value;
  - `local`;
  - `concat`, an index loop over each item (`get length`, `get i`), with `null` items skipped;
  - `reverse`: `get length`, then `get i` from the end.
- **Store edit `moveKey: {key, is, to: 0|-1}`.** It does an explicit find by key, then shift-remove and shift-insert at the front or the back. A miss logs `miss`. It is safe at any length, unlike `move`, which the tier-B generator kept out of actions.
- **Value encoding.** A labelled list or For accessor logs as `{f: label}`. In 1–1000 no program logs one, because Show values are always read through `call`.

**Deviations from the design, with reasons:**

1. **Show's outer memo gets `{sync: true}`**, as flow.ts does; the design's sketch omits it. Element children are built without `untrack`, as flow.ts does. The design's sketch untracks them; it is equivalent here, because building them reads nothing.
2. **`local` and per-pass scopes replace the design's `nodes.set('L#3.m0')`.** Top-level ops cannot name a dynamic row id; `local` reads siblings in the same row or pass.
3. **The `{read}` child replaces the design's "row effect with `fail`" for the abort path.** An effect's error never leaves the mapper, so it cannot abort the pass.
4. **`concat`/`reverse`/`moveKey` are additions.** They allow reorder and insert guesses through updaters, and moves under pending actions, at unknown lengths.
5. **Function-child Show (`fn`) and keyed Show are implemented**, which the design did not mention. The narrowed accessor reads `S.verdict` (a live binding).
6. **Mode flag `--slice2c`**, not `--gen tierC`. `worker.mjs` gains strict `'slice2c'`.
7. **Not implemented:** `repeat`/`Repeat`, `Switch`/`Match`, `children()`, boundaries.

### Strict worker (`fuzz/worker.mjs`, `workerData.strict === 'slice2c'`)

This is the `'slice2b'` rule over the tier-B value domain, plus:

- `{f: string}` as a value;
- the events `row` [str, int, value, int|null], `fallback` [str, int] and `branch` [str, int, 0|1].

Anything else is `oracle-nonscalar`, and a reactivity halt is `oracle-halted`. The other modes' code paths are unchanged (byte gate below).

### Harness (`fuzz/run.mjs`, additive, behind `--slice2c`)

- `--slice2c` selects `slice1-driver`, `generateSlice2c` and `slice2cFamily(seed)`, with `workerData: {strict: 'slice2c'}`.
- The reducer keeps the failure class, as the other slice modes do. It uses `valid2c`: valid2b's rules, with list and Show ids as readable nodes, every expression position walked (`each`, `keyed.expr`, `when`, children recursively, `concat` items), `item`/`index` only where a row is in scope and `local` only inside a row or child pass.

### Generator (`fuzz/generate-slice2c.mjs`)

- It uses Mulberry32. A program is a pure function of its seed, checked over 1–3000.
- Programs have 18–52 ops (median 33).
- The family is `W[seed mod 23]`, chosen without the RNG.
- Render effects never read a node that can fail.

| family (weight) | program | seeds in 1–1000 | ops min/med/max |
| --- | --- | ---: | --- |
| `list-ints` (3) | signal `xs`, an int array (values 0–5, with duplicates); one list with keying identity 50%, `keyed:false` 30% or key fn `mod 3` 20%; arity 2 at 50%; fallback none/plain/with children; row render/user effects, row memos read through `local`, cleanups. Writes come from insert/remove/move/swap/reverse/dup/clear/same-content/rotate/replace edits, 30% two per turn. Actions write `xs` in their slices (held). 10%: a row-body read of an async memo (NotReadyError, abort and retry). 8%: a row-body read that fails for one value. | 131 | 22/35/49 |
| `list-store` (3) | a list over `st.list` (identity, `"id"` key, `keyed:false`); row effects over fields, plain copies and the index. Edits: fields, keyed fields, push, insert, remove, move, row replacement (same id or new), setter-returned filter, reconcile by id or by position. Once an action has edited the store, only keyed and whole-list edits are used. Keyed edits, push, `removeKey` and `moveKey` inside actions. 10%: a shallow store whose root is the row array (`shallowView`); 10% of the other programs put `shallow` on a store whose list is nested. | 132 | 18/30/40 |
| `list-lanes` (3) | a list over optimistic memo `shown`: over store rows (60%) or over an int-array signal. Claims guess through updaters (edit a row, filter it out, move it to the front with `concat`, `reverse`, insert a row at either end), yield `claim:K#c`, then write truth (the yielded value, a removal, a push) or nothing, and catch into `status`. 1–4 overlapping claims. Half the programs put the list under owner `lo`; 8% of those dispose it mid-action. | 132 | 23/34/47 |
| `list-opt-store` (3) | a list over an optimistic store's rows (key `id`, 25% positional). Claims guess `moveKey` front/back, `removeKey`, push, a field edit, move+edit, or (6%) a setter-returned reversed list while other claims are pending. Slice 2 writes truth into the same store. Mainline `t` edits and `moveKey`s run between claims. | 132 | 22/31/41 |
| `list-show` (3) | Show over `len(xs)`, `f`, optimistic `of`, `f + of` or a mix; 20% function children, 20% keyed. Its yes branch is a For over `xs` (random keying and arity), plus effects, a memo and a cleanup; its no branch has an effect and a cleanup. `body` = `call(read B)`. A memo builds children (an effect, optionally a memo with a reader and a nested list) and a cleanup; 30% an effect builds them too; 50% an optimistic or plain memo with a child. Writes and actions over `xs`/`f`/`of`/`s` flip the condition and the list under holds (slice writes) and lanes (optimistic guesses). 30%: an async memo `q:<s mod 3>` read in the branch, a child pass and (a third) the condition. 50%: the Show, `body`, `m`, its reader and `ec` live under owner `so`, which a fifth of those dispose mid-action. | 129 | 27/37/52 |
| `list-nested` (2) | store rows `{id, a, tags:[ints]}`; each row maps `item.tags` with a nested list (any keying) whose rows read the outer row through `up: 1`; the nested list's value is read through `local`. Edits: tag push/remove/move/set/replace, row field, row insert/remove/replace. | 86 | 21/29/37 |
| `list-bulk` (2) | an int list of 66–100 distinct values (identity, arity 1, no row children). Edits: rotations of ≤32, swaps (mostly within ±32), small displacements, removals, full replaces (the probe miss), a duplicate inside a run (the decline), growth, reverse. | 86 | 19/30/41 |
| `tracker` (4) | `frontend/tsx/fixtures/demo/tracker.tsx` with Show + For: store `issues`, optimistic `shown`, `mode`/`status`, `visible`/`unassigned` (native 50%). Render effects `hm` (filter text) and `hu` (open count). Show `B` when `visible().length > 0` (1/0; 25% the raw length). Its yes branch is For `L` over `visible` (identity, arity 1) whose rows have IssueRow's two text inserts (`t`, `a`); the fallback is static. `body` = `call(read B)` (the Show insert), and `foot` (status). Claims as in the demo. | 172 | 29/39/50 |

**Tracker anchor.** [slice2c-fuzz/tools/tracker-demo.mjs](slice2c-fuzz/tools/tracker-demo.mjs) runs `trackerDemoC()`, the demo `SCRIPT` as one program, in a strict worker (126 events). It runs each prefix in a fresh worker. From the last applied values of `hm`, `hu`, `body`, the current pass's row effects `B@p.L#s.t/.a` and `foot`, it renders the frame. **8/8 frames match** ([slice2c-fuzz/tracker-demo.txt](slice2c-fuzz/tracker-demo.txt)). This is a structural check of the encoding, not a parity score.

## 2. Validity, and what the traces contain

These figures are for seeds 1–1000, each in a fresh strict worker ([slice2c-fuzz/tools/workers.mjs](slice2c-fuzz/tools/workers.mjs)).

- **Seeds 1–1000:** 999 valid and 1 invalid (493).
- **Held out (1001–3000):** 1998 valid and 2 invalid (2723, 2907).

**Op counts** (`summary-1-1000.json`):

| op | count | op | count |
| --- | ---: | --- | ---: |
| `list` | 699 | `show` | 301 |
| `memo` | 950 | `effect` | 2181 |
| `owner` | 125 | `dispose` | 4 |
| `store` | 593 | `store_set` | 2686 |
| `write` | 3571 | `action` | 2936 |
| `resolve` | 2721 | `reject` | 383 |
| `flush` | 7697 | `drain` | 1224 |
| `read` | 4008 | `latest` | 1225 |
| `pending` | 682 | | |

**Events.** Trace length has median 148 and max 763.

| event | count | programs |
| --- | ---: | ---: |
| `row`, int item | 15909 | 309 |
| `row`, accessor item (`null`) | 3004 | 410 |
| `row`, store proxy item | 2093 | 333 |
| `row`, raw object item (guessed rows) | 844 | 195 |
| `fallback` | 163 | 86 |
| `branch` 1 / 0 | 388 / 176 | 287 / 136 |
| `cleanup` | 25295 | 998 |
| `update` | 1587 | 304 |
| `miss` | 384 | 164 |
| `caught` | 303 | 219 |
| effect `error` (failing row reads, async) | 52 | 9 |
| `read`/`latest` → `{error}` | 24 | 15 |
| `pending` → `true` | 49 | 42 |

**Equivalence check.** For seeds 1–1000, traces from the TS source copy in fresh workers (`cov-workers.mjs`) and from dist/prod in strict workers are identical for 999 seeds. Seed 493 halts, and only the strict worker turns that into `invalid`.

## 3. Baseline

| run | agree | invalid | failure classes |
| --- | ---: | ---: | --- |
| `--slice1` 1–1000 (gate) | 1000/1000 | 0 | — |
| `--slice2a` 1–1000 (gate) | 991/1000 | 8 | `oracle-nonscalar` 8 (first 225), `rust-panic` 1 (629) |
| `--slice2b` 1–1000 (gate) | 1000/1000 | 0 | — |
| **`--slice2c` 1–1000** | **0/1000** | 1 | `rust-panic` 999 (first seed 1), `oracle-halted` 1 (493) |
| `--slice2c` 1001–3000 | 0/2000 | 2 | `rust-panic` 1998, `oracle-error` 2 (2723, 2907) |

Every family is 0 of its seeds. The first panic of each of seeds 1–1000 (all 1000, including 493) is:

| first panic | programs |
| --- | ---: |
| `slice1-driver.rs:899` operation outside the slice-1 driver: `list` | 618 |
| same: `show` | 236 |
| same: `owner` (the legacy `owner` op; `slice1-driver` has no `owner`/`dispose`) | 125 |
| `store.rs:1890` shallow stores are not ported | 21 |

The reduced case of the `rust-panic` class is 2 ops, `signal` and `list` ([slice2c-fuzz/reduced-rust-panic.json](slice2c-fuzz/reduced-rust-panic.json)). To run tier C, the driver needs:

- the ops `list`, `show`, `owner`, `dispose`, and `memo`/`effect` with `children`/`cleanup`;
- the child kinds;
- the expressions `item`, `index`, `call`, `local`, `concat` and `reverse`;
- the `moveKey` edit;
- the events `row`, `fallback` and `branch`;
- the `{f}` value.

Below the driver, it needs `mapArray` and the owner and frame machinery of section 7.

## 4. Gates and byte gate

- **Fuzz gates** (summaries in `slice2c-fuzz/gate-*-summary-1-1000.json`). `cmp` shows them byte-identical to the recorded ones:
  - `docs/slice1-fuzz/parity/summary-1-1000.json`;
  - `docs/slice2a-fuzz/port/summary-1-1000.json` (`--no-reduce`);
  - `docs/slice2b-fuzz/port/summary-1-1000.json`.
- **Byte gate** ([slice2c-fuzz/tools/gate.mjs](slice2c-fuzz/tools/gate.mjs)). This is the 2b gate plus a `slice2b` mode with `workerData {strict: 'slice2b'}` and a list of timeouts. The old oracle is `rust-tierb`'s `fuzz/solid.mjs` and `worker.mjs`, which are byte-identical to this worktree's files before the change (`out/gate-old/`). Each program runs in fresh workers, and the whole result message is compared. Results are in [slice2c-fuzz/byte-gate.txt](slice2c-fuzz/byte-gate.txt):

| generator | seeds | identical | different | note |
| --- | --- | ---: | ---: | --- |
| `--slice1` | 1–3000 | 3000 | 0 | |
| M1 | 1–2000 | 1999 | 0 | 1193 `oracle-error` in both, differing only in the oracle's frame path. 14 seeds (71, 569, …, 1955) time out in both oracles, so their traces are not compared; `docs/results/final-2000.json` records the same 14 timeouts. |
| `--slice2a` | 1–3000 | 3000 | 0 | including the 24 `oracle-nonscalar` details |
| `--slice2b` | 1–3000 | 3000 | 0 | including 1430's `oracle-error` |

## 5. Coverage method and delta

1. **Source copy.** `out/solid-src` is a copy of `signals/src` with `fixctor` applied. It is identical to `rust-tierb/out/solid-src`, and it runs with the parity `register.mjs`/`hooks.mjs` and prod flags.
2. **Collection.** [cov-workers.mjs](slice2c-fuzz/tools/cov-workers.mjs) runs every program in its own worker under `NODE_V8_COVERAGE`. This gives 2001 files per run, about 0.8 GB. **[cov-merge.mjs](slice2c-fuzz/tools/cov-merge.mjs)** folds a run into one file, summing counts per block range (only `/solid-src/` scripts) so that `delta.mjs` fits in 8 GB.
   - **Check of the merge.** On a 100-file subset, `delta.mjs` (raw vs merged and merged vs raw) gives 0 new lines both ways, and `lines.mjs` gives identical counts on map.ts, `parkChildren` and `holdFrame`.
3. **Delta, per-file line method (primary).** [cov-lines.mjs](slice2c-fuzz/tools/cov-lines.mjs) computes each coverage file's line counts from that file alone, using delta.mjs's rule (the innermost range wins; a line's count is the count at its first non-blank character), and sums them over files. [delta-lines.mjs](slice2c-fuzz/tools/delta-lines.mjs) lists the lines executed in the new run and never in the base, grouped by the innermost executed function, and gives per-file totals. Outputs:
   - base `--slice2b`: [coverage-delta-lines.txt](slice2c-fuzz/coverage-delta-lines.txt);
   - base `--slice2a` ∪ `--slice2b`: [coverage-delta-lines-vs-2a2b.txt](slice2c-fuzz/coverage-delta-lines-vs-2a2b.txt);
   - the 999 valid programs only (seed 493's coverage rerun separately and left out): [coverage-delta-lines-valid-only.txt](slice2c-fuzz/coverage-delta-lines-valid-only.txt);
   - the lines only seed 493 runs: [coverage-delta-lines-493-only.txt](slice2c-fuzz/coverage-delta-lines-493-only.txt).
4. **Delta, delta.mjs method (for comparison with SLICE2B-COVERAGE.md).** `delta.mjs` sums block ranges over all files before computing lines: [coverage-delta.txt](slice2c-fuzz/coverage-delta.txt) and [coverage-delta-vs-2a2b.txt](slice2c-fuzz/coverage-delta-vs-2a2b.txt), with per-file totals from [delta-by-file.mjs](slice2c-fuzz/tools/delta-by-file.mjs).
   - **The problem with summing first.** V8 omits a nested block whose count equals its parent's. A block that one worker ran (so V8 omitted it) and another never ran (so V8 reported it as 0) then sums to 0, and its lines look unexecuted.
   - **The effect here:** 623 lines instead of 630. In the union, `core/lanes.ts` even gains a line against the larger base (4 vs 3), which is impossible for a correct count. The same caveat applies to the 1964 lines in SLICE2B-COVERAGE.md.
5. **Per-op attribution.** [perop.mjs](slice2c-fuzz/tools/perop.mjs) is the 2b tool, with each program in a fresh worker, plus tier-C classes: `list:<identity|index|keyfn>[+arity2][+fallback][+for][+nested]`, `show[+fn][+keyed]` and `memo`/`effect` `+children`. Base `--slice2b` → [perop-report.txt](slice2c-fuzz/perop-report.txt). `NEW` means never called in `--slice2b`.
6. **Site marks.** [marks.mjs](slice2c-fuzz/tools/marks.mjs) is the 2b marks plus tier-C marks (map.ts paths, parked frames, holdFrame, zombies, sync arm, promoted writes), and takes the mode as an argument. Each program runs in a fresh worker. Output: [marks-1-1000.txt](slice2c-fuzz/marks-1-1000.txt) for `--slice2c` and [marks-slice2b-1-1000.txt](slice2c-fuzz/marks-slice2b-1-1000.txt) for `--slice2b`, with the same marks.

**Delta by file** (seeds 1–1000, fresh workers, per-file line method; the delta.mjs-method figure is in the last column):

| file | functions with new lines (vs 2b) | never called in 2b | new code lines vs 2b | vs 2b, valid programs only | vs 2a ∪ 2b | vs 2b, delta.mjs method |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| map.ts | 13 | 13 | 436 | 436 | 436 | 436 |
| core/scheduler.ts | 12 | 6 | 52 | 31 | 52 | 52 |
| core/core.ts | 11 | 3 | 42 | 42 | 31 | 43 |
| store/store.ts | 10 | 2 | 38 | 38 | 38 | 34 |
| core/owner.ts | 4 | 2 | 25 | 25 | 25 | 25 |
| store/types.ts | 2 | 2 | 13 | 13 | 13 | 9 |
| core/effect.ts | 2 | 1 | 10 | 0 | 10 | 6 |
| core/verdict.ts | 1 | 0 | 5 | 5 | 0 | 8 |
| signals.ts | 1 | 1 | 3 | 3 | 3 | 3 |
| core/async.ts | 2 | 1 | 3 | 3 | 0 | 3 |
| core/lanes.ts | 2 | 0 | 2 | 2 | 2 | 3 |
| core/heap.ts | 1 | 0 | 1 | 1 | 1 | 1 |
| **total** | **61** | **31** | **630** | **599** | **611** | **623** |

The 31 lines that only invalid seed 493 runs are `haltReactivity` (scheduler.ts:805-842), `notifyHalted` (857-866), `escalate` (effect.ts:179-184), `notifyEffectStatus` 142-145, `schedule` 779-781 and `notify` 1224 ([coverage-delta-lines-493-only.txt](slice2c-fuzz/coverage-delta-lines-493-only.txt)). They are not a port target. The full function list is in the appendix.

## 6. Call map per new operation

The calls follow Solid's order. Lines are rc.21 TS lines. Counts are whole-run calls over seeds 1–1000 in fresh workers; per-op averages are in `perop-report.txt`.

### `list` (mapArray, non-lazy): creation

1. `mapArray` map.ts:67-108:
   - `keyFn = typeof keyed === "function"`; `indexes = map.length > 1`;
   - `createOwner()` (owner.ts:381) is `data._owner`, a root child of the current owner;
   - `_rows = keyFn || keyed === false ? [] : undefined`; `_indexes = indexes && keyed !== false ? [] : undefined`;
   - `computed(updateKeyedMap.bind(data))`, with CONFIG_AUTO_DISPOSE cleared; `accessor(node)` (signals.ts:140).
2. The first pass, `updateKeyedMap` map.ts:403-702 (8218 calls):
   - It sets `_owner._parentComputed = getOwner()` (the map computed).
   - It calls `this._list()`, the oracle's `each` (tracked).
   - It reads `newItems[$TRACK]`; on a store array this is the container node.
   - It calls `shallowView?.(newItems[$TARGET])`: store.ts:2623-2627, the hook `installShallowView` installs (8218 calls). It returns the backing only for a shallow store whose target is the array (`serveShallow` store.ts:1492, 353 calls).
   - It reads `newLen = newItems.length`, then `runWithOwner(_owner, …)`.
3. Then come the paths:
   - **Empty** (`newLen === 0`): dispose all rows (`_owner.dispose(false)`, 236 marks), then the fallback: `runWithOwner(createOwner(), fallback)` (163).
   - **Create-all** (`_len === 0`; 1823 marks / 978 seeds): `runWithOwner(createOwner(), mapper)` per row. The mapper is one of four closures (map.ts:431-452), chosen by `_rows`/`_byIndex`/`_indexes`:
     - identity, arity 1: `map(item)` (17136 calls);
     - identity, arity 2: `signal(j, pureOptions)` and `map(item, accessor(index))`;
     - `keyed:false`: `signal(newItems[j], {ownedWrite})` and `map(accessor(row), j)`;
     - key fn: row signal and an optional index signal, then `map(accessor(row), accessor(index)|undefined)`.

     On a throw, the created owners are disposed and the error is rethrown (117 marks / 19 seeds). Otherwise the pass commits: the previous fallback owner is disposed, and `_items = newItems.slice(0)`.
   - **On a store proxy**, `slice` is `Array.prototype.slice`: `get constructor`, then `has i`/`get i` per index. With an observer, the `has` trap subscribes presence nodes, so the map computed subscribes them. This is the read sequence behind invalid seed 493.
4. **Inside the mapper (the oracle body).**
   - `onCleanup` (signals.ts:99) → `cleanup` (owner.ts:338) on the row owner (25426 calls).
   - The children: effects, memos and nested lists created under the row owner. `setupComputedNode` (core.ts:1590-1616) takes `_parentComputed` as the parent computed of a node created under a root (new line 1594). Row effects' first runs are queued as usual.

### `list` (lazy, For)

The op creates only the closure. The first `list()` call (the `body` render effect via `call(read B)`, or a probe) runs `runWithOwner(owner, make)` under the owner captured in the creating pass: for a For inside Show, the Show's outer memo. Then it continues as above. The mapArray nodes therefore become children of the outer memo, which is what later parks them.

### List updates (`write xs`, `store_set`, resolve/reject, flush, drain)

The map computed re-runs (`recompute`) → `updateKeyedMap`:

1. **Prefix skip**: `===`, or `compare` (map.ts:827) with `_rows`. In row modes, `writeRow` (400-401) writes each prefix row; `setSignal` only on a change (2310 marks).
2. **Suffix count.**
3. **"No structural change"** (`start === newLen && _len === newLen`): `_items = newItems.slice(0)`, and the same mapped array is returned (924 marks).
4. **Small-move probe and `trySmallMove`/`commitSmallMove`** (map.ts:150-302). Only with `newLen <= _len`, a window over 64, no row or index signals (`list-bulk`):
   - probe 388, try 316, commit 141 (69 seeds);
   - the duplicate decline: 2 seeds (133, 822).
5. **`stageRemoval`** (312-342) for a shrinking pass: pure 945, not pure 303.
6. **The keyed-map path** (`newIndices`/`newIndicesNext` chains; 3743 marks):
   - created rows go into the window stage (9891 marks);
   - on an abort, only the created owners are disposed and the error is rethrown (14 marks / 3 seeds: 92, 830, 920, the failing-row variant).
7. **`commitWindow`** (350-397):
   - grow 1498, shrink 1248;
   - survivors' `writeRow`, and the index `setSignal` (2453 marks);
   - then `_mappings`, `_len`, `_items = newItems.slice(0)`, and the removed owners disposed. Disposal runs `disposeChildren`/`runDisposal` (owner.ts:95/212) over the row owner: effects' cleanups, then the row's `cleanup` entries in registration order.

Row signals are written with a plain `setSignal`, inside the map computed's pass: CARVE 2, map.ts:535. `notePromotedWrite` (core.ts:2624) is called for these writes (4024 calls), but it always returns early (`globalQueue._running`); the promoted arm (mark `promoted-write`) is 0.

### `show`

1. **Creation.**
   - `computed(() => when)`.
   - `computed(conditionValue, {equals, sync})`. CONFIG_SYNC takes recompute's prod fast arm (core.ts:620-623: `value = el._fn(value)`, with no async-shape probe). Mark `sync-fast-arm`: 1176 / 301 seeds, which is every Show.
   - The outer `computed(…, {sync})`.
2. **The outer pass** builds the branch's children, which are owned by the outer memo.
3. **A re-run of the outer memo** (condition flip; with `keyed`, any change) goes through recompute's frame step (core.ts:509-524):
   - **CONFIG_STAGED** (the previous pass still awaiting its commit): its children die on the spot, `disposeChildren` (227 marks / 79 seeds).
   - **Otherwise `parkChildren`** (core.ts:1436-1444; 651 calls / 172 seeds): `markDisposal` (owner.ts:46, which flags the subtree REACTIVE_ZOMBIE) moves `_firstChild`/`_disposal` to `_x._pendingFirstChild`/`_pendingDisposal`.
4. **What happens to the parked frame (zombies):**
   - The commit retires it with `GlobalQueue._dispose(c, false, true)` (scheduler.ts:1555-1559; 424 / 135 seeds), or a lane seam does (lanes.ts:896-898; 222 / 105), or a dissolve of an unshown lane (lanes.ts:676; 2 seeds: 13, 910), or its owner's death (owner.ts:103-108; 3 seeds: 83, 612, 635).
   - While parked, a zombie dirtied by a write is deferred, `deferZombie` (scheduler.ts:608; 698 / 121 seeds), from `GlobalQueue._update` (core.ts:213). In a lane frame it is cancelled (`laneFrameMember` core.ts:229, new lines 221-223; 45 / 36 seeds).
   - At a park, the deferred zombies are sorted (scheduler.ts:1066; the CONFIG_VERDICT recompute arm is never taken).
   - At a commit, the survivors re-run (scheduler.ts:1157-1164; 11 / 8 seeds).
5. **Under a hold**, the staged outer pass's frame is held: `holdFrame` (scheduler.ts:644-653) puts each child computed on the transaction, `holdNode` (960 marks / 121 seeds; `holdFrame` itself also runs in `--slice2b`, over empty frames).
6. **A zombie whose removal the judged transaction stages** is not on screen for it: `removalStagedBy` (scheduler.ts:586-592; 44 calls / 6 seeds: 37, 311, 612, 910, 957). This needs an async memo pending under the hold, the `list-show` async variant.
7. **Children born in a lane pass** go through `bornInto` and `creatorPass` (core.ts:1406/1416); new line 1418, and recompute 410-411.

### `memo`/`effect` with `children`

These take the same frame path as Show's outer memo: every re-run parks or disposes the previous pass's children and its `_disposal`, which holds the pass cleanup, `["cleanup", "m@k"]`. A user effect is no EFFECT_TRACKED, so it parks too.

### Row events under actions and lanes (`list-lanes`, `list-opt-store`, `tracker`)

- The map computed re-runs in a lane pass (`shown`'s guess), or inside a held transaction. Rows created in such a pass are born into the lane or the hold (`bornInto` 1202 calls / 222 seeds).
- Reverts re-create rows when the lane dissolves (`reverted` 981 marks / 467 seeds).
- Optimistic store rows moved or removed under pending claims go through tier B's `notifyOptimisticWrites`/`LaneView` and `optimisticHas` (3882 / 132 seeds). `linkLanes` runs when one map pass reads two actions' guesses (138 / 82 seeds).

### `owner`, `dispose`, teardown

- `owner` (legacy op, new to the 2-series generators): `createRoot`, with `onCleanup(dispose)` under the parent.
- `dispose` and the final root disposal: `disposeChildren` over lists, rows, Shows and parked frames (`disposeChildren` 54140 calls, `runDisposal` 54134).

## 7. `slice1/` cut sites: reached or not

Seeds 1–1000, from `marks-1-1000.txt` and `marks-slice2b-1-1000.txt` (fresh workers):

| cut site in `crates/runtime/src/` | Solid | `--slice2b` | `--slice2c` (hits / seeds, first seeds) |
| --- | --- | --- | --- |
| no `map` module at all (mapArray, For) | map.ts | 0 | every path above: create-all 978 seeds, keyed path 881, small move 83 (commit 69), abort 3 |
| `slice1-driver.rs:899`: `list`, `show`, `owner`, `dispose` ops | — | — | first panic in 979 programs |
| `owner.rs:2` "Not ported: `onCleanup` disposal lists" (`owner.rs:114` `runDisposal`: no lists) | owner.ts:338-344, 212-238; signals.ts:99 | 0 | `cleanup` 25426 calls; cleanup events in 998 programs |
| `core.rs:106` "Child frames (`disposeChildren`/`parkChildren`): no computed owns children" | core.ts:509-524, 1436-1444 | 0 | parkChildren 651 / 172 (12, 13, 14, 21, 22); die-on-spot 227 / 79 |
| `core.rs:14` `update`: "no tracked effects or zombies" | core.ts:201-224 (213, 220-223) | 0 | deferZombie 698 / 121 (12, 13, 14, 35, 36); lane-frame cancel 45 / 36 |
| `owner.rs:66`/`:73` "`zombie` frames are not ported" | owner.ts:95-130 (zombie arm) | 20 hits / 14 seeds (empty frames) | 651 / 172; a parked frame dying with its owner 3 (83, 612, 635) |
| `scheduler.rs:4` "`holdFrame` children (no computed owns children)" | scheduler.ts:644-653 | holdFrame runs, holds 0 nodes | holds a child 960 / 121 (13, 14, 21, 35, 36) |
| `scheduler.rs:319` "`deferredZombies`: none" (park) | scheduler.ts:1064-1072 | 0 | zombies present at parks: 236 sort-comparator calls (the CONFIG_VERDICT recompute arm never taken) |
| zombie survivors re-run at commit (`deferredZombies`, scheduler.rs commit) | scheduler.ts:1157-1164 | 0 | 11 / 8 (37, 82, 520, 587, 702) |
| `scheduler.rs:627` "The parked frame this commit retires: none here" | scheduler.ts:1552-1559 | 0 | 424 / 135 (12, 13, 14, 35, 36) |
| lanes.rs dissolve / laneSeam frame retire | lanes.ts:676-677, 897-898 | 0 | dissolve 2 (13, 910); laneSeam 222 / 105 |
| `scheduler.rs:189` "`removalStagedBy` is not reached" | scheduler.ts:577-592 | 0 | 44 / 6 (37, 311, 612, 910, 957) |
| `core.rs:3-7` "CONFIG_SYNC" not ported | core.ts:620-623 | 0 | 1176 / 301 (every Show) |
| `core.rs:3-7` "promoted writes inside computations" | core.ts:2624-2628 | 0 | called 4024, promoted arm 0: not reached |
| `store.rs:1890` (and the other "shallow stores are not ported" sites) | store.ts:1492-1496; map.ts:415 | 0 | shallowView 117 / 13; first panic in 21 programs |
| `_parentComputed` (computeds under a row owner) | core.ts:1592-1594 | 0 | every list program |
| tier-B cut sites: `take` (`lanes.rs:264`), `kept`, staged error as lane value (`core.rs:924`) | lanes.ts, truth.ts | 22 / 21 / 5 seeds | **0**: tier C adds no pressure there |
| staged errors (stageError / commit) | async.ts:225-256 | 9 / 6 seeds | 9 / 8 (`list-ints` failing-row variant) |
| reawaken a dormant memo (`core.rs:630`), dormant sweep (`core.rs:911`), CONFIG_VERDICT readers (`verdict.rs:48/56/127`), `observeFlight` (`core.rs:866`), NotReady of a loading node (`async.rs:489`), `creatorReads` (lanes.ts:313, verdict lanes) | | 0 | 0 |

## 8. Invalid seeds: a suspected Solid bug family (optimistic array views with holes)

All three invalid seeds are `list-opt-store` programs whose list uses `keyed: "id"`. Solid hands the key function `undefined`, and `x => x.id` throws a TypeError inside `updateKeyedMap`. That makes `oracle-error`, or `oracle-halted` when the throw reaches the render effect reading the list. The comparator never counts them, and nothing special-cases them. The Rust port must not imitate the throw.

1. **Seed 493: `has` and `get` disagree.**
   - Reduced to 11 ops: [slice2c-fuzz/repro-493-optimistic-hole.json](slice2c-fuzz/repro-493-optimistic-hole.json). On Solid's API alone: [solid-bug-optimistic-hole.mjs](slice2c-fuzz/solid-bug-optimistic-hole.mjs) ([output](slice2c-fuzz/solid-bug-optimistic-hole.txt)).
   - The state: an optimistic store `{list:[2, 3]}` (key `id`). Action c0 guesses a no-op removal and stays pending. Action c1 guesses a reversed list through a setter-returned replacement, and lands. Action c2 guesses a push of row 6. Action c3 guesses "row 2 to the front", and lands first.
   - During c3's landing pass, `list.length` is 3 and `list[2]` is row 6, but `2 in list` is false. mapArray's `_items = newItems.slice(0)` uses HasProperty, so it stores a hole, and the next pass calls the key function on it.
   - c0 and c1 are both required.
   - The classification races: `oracle-halted` vs `oracle-error`, depending on whether reportError's uncaught worker error or the result message arrives first. The last run recorded `oracle-halted`.
2. **Seed 2723: a steady-state hole.**
   - Reduced to 8 ops: [repro-2723-optimistic-hole.json](slice2c-fuzz/repro-2723-optimistic-hole.json); API-only: [solid-bug-optimistic-hole-2.mjs](slice2c-fuzz/solid-bug-optimistic-hole-2.mjs) ([output](slice2c-fuzz/solid-bug-optimistic-hole-2.txt)).
   - The state: `{list:[1, 2, 3]}` (key `id`). Action A guesses "row 2 to the front" and "remove row 3", and stays pending. Then a flush. Action B guesses "remove row 2", then a second setter call that finds no row 2 and writes nothing; it stays pending. Then a flush.
   - The view becomes `[undefined]`, length 1, where `[row 1]` is expected. Every reader sees it.
   - Dropping B's no-op second call removes the hole.
3. **Seed 2907: the positional (key `null`) form.**
   - Reduced to 9 ops: [repro-2907-optimistic-hole.json](slice2c-fuzz/repro-2907-optimistic-hole.json).
   - Pending removals of both rows, then a pending push of row 6, give `[undefined, row 6]` where `[row 6]` is expected.

None of the 999 valid programs in 1–1000 contains a visible hole. I checked for `null` row items in identity-keyed optimistic lists and for `null` entries in logged row arrays. Not reported upstream.

## 9. Gaps (what tier C does not reach)

- **Verdict machinery.** CONFIG_VERDICT readers, `creatorReads` (verdict lanes), the park-time zombie verdict recompute (scheduler.ts:1068-1072) and the Show accessor's `verdict && shown === run` arm need tracked `latest`/`isPending` inside computations; that is not in the op language. These sites are also cut in the port (`verdict.rs`).
- **Promoted writes** (core.ts:2624-2628 past the early return) need a write inside a recompute that runs outside a flush.
- **`take`/`kept`/staged-lane-error** stay tier-B territory (0 here). `--slice2b` reaches them.
- **The `{f}` value is never logged**, because Show values are always read through `call`.
- **`repeat`/`Repeat`, `Switch`/`Match`, `children()`, boundaries, hydration** are not in the op language.
- **Thin sites:**
  - a parked frame dying with its owner: 3 seeds;
  - dissolve-retire: 2;
  - `removalStagedBy`: 6;
  - zombie re-run at commit: 8;
  - small-move duplicate decline: 2;
  - abort #2903: 3.

  The seeds are listed in `marks-1-1000.txt`, and `out/solid-mark/one.mjs FILE` replays one program with its marks.

## 10. Artifacts ([slice2c-fuzz/](slice2c-fuzz/))

| file | content |
| --- | --- |
| `summary-1-1000.json`, `summary-1001-3000.json` | the `--slice2c` baseline runs |
| `reduced-rust-panic.json` (+`.logs.json`) | the class-preserving reduction of `rust-panic` (2 ops) |
| `reduced-oracle-halted.json` (+`.logs.json`) | `run.mjs`'s reduction of seed 493 (11 ops) |
| `invalid-seeds.json` | the three invalid seeds, with class, cause and repros |
| `repro-493/2723/2907-optimistic-hole.json`, `solid-bug-optimistic-hole{,-2}.mjs` (+`.txt`) | op-level and API-only repros (section 8) |
| `gate-slice1/2a/2b-summary-1-1000.json` | gate reruns, byte-identical to the recorded summaries |
| `byte-gate.txt` | `tools/gate.mjs` output, including the M1 timeout list |
| `coverage-delta-lines*.txt` | `delta-lines.mjs` output (per-file line method): vs 2b, vs 2a ∪ 2b, valid programs only, seed-493-only |
| `coverage-delta.txt`, `coverage-delta-vs-2a2b.txt` | `delta.mjs` output (ranges summed first; for comparison with SLICE2B-COVERAGE.md) |
| `perop-report.txt` | per-op classes (fresh workers), base `--slice2b` |
| `marks-1-1000.txt`, `marks-slice2b-1-1000.txt` | site marks (fresh workers) |
| `tracker-demo.txt` | the demo's 8 frames from the oracle (Show + For) |
| `tools/` | `workers.mjs`, `cov-workers.mjs`, `cov-lines.mjs`, `delta-lines.mjs`, `cov-merge.mjs`, `delta-by-file.mjs`, `perop.mjs`, `marks.mjs`, `gate.mjs`, `tracker-demo.mjs`, `oracle-one.mjs` (one program in a fresh worker, with halts and throws), `bug-reduce.mjs` (the 2b tool, plus list/show ids and action step references) |

Reproduce from the repository root with Node 24 (`nix shell nixpkgs#nodejs_24 -c …`):

```sh
T=docs/slice2c-fuzz/tools D=docs/slice2a-fuzz/tools P=docs/slice1-fuzz/parity/tools
node fuzz/run.mjs --slice2c --seeds 1000 --out out/s2c/run-1000
node fuzz/run.mjs --slice2c --start 1001 --seeds 2000 --no-reduce --out out/s2c/run-heldout
node fuzz/run.mjs --slice1 --seeds 1000 --out out/s2c/gate-slice1            # cmp with docs/slice1-fuzz/parity/summary-1-1000.json
node fuzz/run.mjs --slice2a --seeds 1000 --no-reduce --out out/s2c/gate-slice2a  # cmp with docs/slice2a-fuzz/port/summary-1-1000.json
node fuzz/run.mjs --slice2b --seeds 1000 --out out/s2c/gate-slice2b            # cmp with docs/slice2b-fuzz/port/summary-1-1000.json
mkdir -p out/gate-old && cp ../rust-tierb/fuzz/solid.mjs ../rust-tierb/fuzz/worker.mjs out/gate-old/
SOLID_SIGNALS_URL=file://$PWD/../solid-next/packages/signals/dist/prod/index.js node $T/gate.mjs slice1 1 3000   # m1 1 2000, slice2a 1 3000, slice2b 1 3000
cp -r ../solid-next/packages/signals/src out/solid-src && node $P/fixctor.mjs out/solid-src/{reveal.ts,store/utils.ts,store/store.ts,core/error.ts}
node $T/workers.mjs 1 1000 out/s2c/w-1000.txt 4
NODE_V8_COVERAGE=$PWD/out/s2c/cov/w-2b node $T/cov-workers.mjs slice2b 1 1000 4 && node $T/cov-merge.mjs out/s2c/cov/w-2b out/s2c/cov/m-2b
NODE_V8_COVERAGE=$PWD/out/s2c/cov/w-2c node $T/cov-workers.mjs slice2c 1 1000 4 out/s2c/ts-workers-2c.txt && node $T/cov-merge.mjs out/s2c/cov/w-2c out/s2c/cov/m-2c
node $T/cov-lines.mjs out/s2c/cov/w-2b out/s2c/cov/l-2b.json; node $T/cov-lines.mjs out/s2c/cov/w-2c out/s2c/cov/l-2c.json
node $T/delta-lines.mjs out/s2c/cov/l-2b.json out/s2c/cov/l-2c.json          # primary
node --max-old-space-size=5000 $D/delta.mjs out/s2c/cov/m-2b out/s2c/cov/m-2c > out/s2c/coverage-delta.txt && node $T/delta-by-file.mjs out/s2c/coverage-delta.txt
node $T/perop.mjs slice2c 1 1000 out/s2c/wperop-2c.json; node $T/perop.mjs slice2b 1 1000 out/s2c/wperop-2b.json; node $D/perop-report.mjs out/s2c/wperop-2b.json out/s2c/wperop-2c.json
node $T/marks.mjs slice2c 1 1000 out/s2c/marks-2c.json; node $T/marks.mjs slice2b 1 1000 out/s2c/marks-2b.json
node $T/tracker-demo.mjs; node docs/slice2c-fuzz/solid-bug-optimistic-hole.mjs; node docs/slice2c-fuzz/solid-bug-optimistic-hole-2.mjs
```

## Appendix: functions with new coverage (base `--slice2b` 1–1000, fresh workers, per-file line method: `coverage-delta-lines.txt`)

Columns:

- **kind:** `new` means never called in `--slice2b`; `branches` means called before, with new lines now. Rows with 0 lines are functions that run for the first time, but whose lines are owned by an enclosing function.
- **calls 2b → 2c:** whole-run calls over seeds 1–1000 each.
- **new lines:** the TS lines that are new, and how many there are.

| kind | Solid function | calls 2b → 2c | new lines | n |
| --- | --- | --- | --- | ---: |
| new | `signals.ts:99-128` onCleanup | 0 → 25426 | 100,127-128 | 3 |
| new | `map.ts:67-108` mapArray | 0 → 1709 | 68-78,87-108 | 33 |
| new | `map.ts:150-219` trySmallMove | 0 → 316 | 150-178,180-219 | 69 |
| new | `map.ts:228-302` commitSmallMove | 0 → 218 | 228-254,261-270,272-296,298-302 | 67 |
| new | `map.ts:312-342` stageRemoval | 0 → 1248 | 312-342 | 31 |
| new | `map.ts:350-397` commitWindow | 0 → 4674 | 350-367,370-397 | 46 |
| new | `map.ts:400-401` writeRow | 0 → 7756 | 401 | 1 |
| new | `map.ts:403-702` updateKeyedMap | 0 → 8218 | 403,410-412,415-416,701-702 | 8 |
| new | `map.ts:418-699` (anonymous) | 0 → 8218 | 418-420,424-426,429-430,443,455-465,468-474,476-480,482-490,493-509,512-513,538-546,550-557,562-565,574-579,585-591,593,609-613,617-621,624-625,628-636,641-656,659-671,677-681,683-686,690,698-699 | 157 |
| new | `map.ts:431-434` (anonymous) | 0 → 1593 | 431-434 | 4 |
| new | `map.ts:435-442` mapper._rows.item | 0 → 1417 | 435-442 | 8 |
| new | `map.ts:444-448` mapper._rows.item | 0 → 1710 | 444-448 | 5 |
| new | `map.ts:449-452` mapper | 0 → 17136 | 449-452 | 4 |
| new | `map.ts:827-829` compare | 0 → 3022 | 827-829 | 3 |
| branches | `core/verdict.ts:450-700` verdictValue | 34070 → 9028 | 634-638 | 5 |
| branches | `core/core.ts:201-224` GlobalQueue._update | 32695 → 31805 | 221-223 | 3 |
| new | `core/core.ts:229-236` laneFrameMember | 0 → 70 | 229-236 | 8 |
| branches | `core/core.ts:364-1090` recompute | 39820 → 57334 | 411-412,621-624,729-730,935,960,965,973-974 | 13 |
| branches | `core/core.ts:1342-1399` frameRead | 26042 → 13351 | 1369 | 1 |
| branches | `core/core.ts:1406-1412` bornInto | 6024 → 1202 | 1409-1410 | 2 |
| branches | `core/core.ts:1416-1420` creatorPass | 6029 → 9781 | 1418 | 1 |
| new | `core/core.ts:1436-1444` parkChildren | 0 → 651 | 1436-1444 | 9 |
| branches | `core/core.ts:1590-1616` setupComputedNode | 7113 → 26259 | 1594 | 1 |
| branches | `core/core.ts:1984-1992` unflushedValue | 233 → 285 | 1986 | 1 |
| branches | `core/core.ts:2090-2104` servesStaged | 3337 → 297 | 2095 | 1 |
| new | `core/core.ts:2624-2628` notePromotedWrite | 0 → 4024 | 2625,2628 | 2 |
| new | `core/owner.ts:46-53` markDisposal | 0 → 3718 | 47-53 | 7 |
| branches | `core/owner.ts:95-202` disposeChildren | 13969 → 54140 | 109 | 1 |
| branches | `core/owner.ts:212-238` runDisposal | 13957 → 54134 | 221-222,225-226,231-237 | 11 |
| new | `core/owner.ts:338-344` cleanup | 0 → 25426 | 339-344 | 6 |
| branches | `core/async.ts:595-683` asyncWrite | 1305 → 131 | 657-658 | 2 |
| new | `core/async.ts:652-652` (anonymous) | 0 → 91 | 652 | 1 |
| branches | `core/effect.ts:123-174` notifyEffectStatus | 13164 → 25481 | 142-145 | 4 |
| new | `core/effect.ts:179-184` escalate | 0 → 1 | 179-184 | 6 |
| branches | `core/scheduler.ts:516-568` blockedBy | 21101 → 11428 | 539-540 | 2 |
| new | `core/scheduler.ts:586-592` removalStagedBy | 0 → 44 | 586-592 | 7 |
| new | `core/scheduler.ts:608-612` deferZombie | 0 → 698 | 609-612 | 4 |
| branches | `core/scheduler.ts:644-653` holdFrame | 7069 → 10524 | 646-652 | 7 |
| branches | `core/scheduler.ts:777-787` schedule | 60757 → 63904 | 779-781 | 3 |
| new | `core/scheduler.ts:805-842` haltReactivity | 0 → 1 | 806-807,809-811,839-842 | 9 |
| new | `core/scheduler.ts:857-866` notifyHalted | 0 → 8 | 857-861,864-866 | 8 |
| branches | `core/scheduler.ts:981-1168` settle | 16552 → 13015 | 1068-1071,1161-1164 | 8 |
| new | `core/scheduler.ts:1066-1066` (anonymous) | 0 → 236 | — | 0 |
| new | `core/scheduler.ts:1160-1160` (anonymous) | 0 → 25 | 1160 | 1 |
| branches | `core/scheduler.ts:1199-1225` notify | 10294 → 22393 | 1224 | 1 |
| branches | `core/scheduler.ts:1235-1289` reruns | 10772 → 7424 | 1281 | 1 |
| branches | `core/scheduler.ts:1489-1560` commitPendingNode | 28975 → 31141 | 1559 | 1 |
| new | `store/types.ts:127-137` markRawOne | 0 → 227 | 128-130,134-137 | 7 |
| new | `store/types.ts:139-145` markRawIngest | 0 → 32 | 140-145 | 6 |
| branches | `core/lanes.ts:554-695` dissolveLane | 1822 → 1446 | 677 | 1 |
| branches | `core/lanes.ts:872-902` laneSeam | 10551 → 6275 | 898 | 1 |
| branches | `store/store.ts:308-328` releaseSlot | 23436 → 15547 | 312-313 | 2 |
| branches | `store/store.ts:529-541` notifyContainer | 133 → 1348 | 535-540 | 6 |
| branches | `store/store.ts:984-1049` foldTarget | 6029 → 2967 | 1036-1037 | 2 |
| branches | `store/store.ts:1157-1309` notifyWrites | 12758 → 10122 | 1290-1291,1302-1304,1306-1308 | 8 |
| branches | `store/store.ts:1322-1330` arrayStructureChanged | 133 → 1457 | 1329 | 1 |
| new | `store/store.ts:1492-1496` serveShallow | 0 → 353 | 1492-1493,1495-1496 | 4 |
| branches | `store/store.ts:2088-2262` get | 308747 → 201045 | 2100-2102,2106-2110 | 8 |
| branches | `store/store.ts:2509-2574` storeSetter | 10074 → 5054 | 2558 | 1 |
| branches | `store/store.ts:2576-2615` createStore | 751 → 461 | 2594-2596 | 3 |
| new | `store/store.ts:2623-2627` (anonymous) | 0 → 8218 | 2625-2627 | 3 |
| branches | `core/heap.ts:37-53` actualInsertIntoHeap | 32704 → 32244 | 41 | 1 |

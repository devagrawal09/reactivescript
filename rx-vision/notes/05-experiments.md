# 05 — Experiments and design branches

Scope: the store compiler prototypes (`proto/store-*`), the runtime-wide "ladder" round that came after them, and the fork-only design branches (`solid-model`, `rc-frontend`, `rc-ladder`, `plan-v2-composition`, `project-dashboard`, `project-docs`, `tsx-frontend-demo`, `pr21-*`) plus the `claude/project-thread-*` branches that aren't merged. rust-solid internals and eval are covered in other files.

Sources: local branches and worktrees, `origin/*` read with `git show`, `store-proto-bench/results/*.md`, and the session transcript `/tmp/rx-review/sessions/store-compiler-design.txt` (11-23 → 11-24).

---

## 0. How the branches are laid out

- **Fork-only orphan histories.** `solid-model`, `rc-frontend`, `rc-ladder`, `plan-v2-composition` (each also has a `handoff/…` twin at the same SHA), `project-docs` and `project-dashboard` have **no merge base with `main`**. They are separate repos that happen to live on `devagrawal09/reactivescript`. They were developed in a Tembo sandbox, pinned to RX `fdbcad92` and Solid rc.21 (`2105ffb8`), and pushed with `tembo commit`. The handoff says not to merge them into each other.
- **PR #21 lineage.** `tsx-frontend-demo` (`cc1e6e9`, 11-06) is PR #21's head. `pr21-v1-archive` (10-29) and `pr21-v2-archive` (10-31) are earlier versions. They are built on old RX main (`b7870129` / `aa85cbde`).
- **Store prototypes.** These are on current RX main `e650b85`, Solid `30e7805eb`. There are 9 `proto/store-*` branches in both repos, plus `proto/store-bench`, the harness repo. All are pushed to the forks: Solid to `devagrawal09/solid`, RX to `devagrawal09/reactivescript`.
- **Upstream `claude/project-thread-*`.** These are threads in Ryan's repo, not experiments from Dev. See §6.

---

## 1. Store compiler prototypes (most recent work, 11-23 → 11-24)

### Goal
Dev asked whether RX could compile to a smaller, faster store than Solid's proxy store, keeping the same semantics: "replace proxies with .get/.set". Then: "subtracting from the runtime, not adding". RX's spec (CP-4a, `spec/11-compiler.md`) forbids the runtime adding behaviour beyond Solid. Removing or specialising Solid's own code is allowed. A Fable orchestrator ran the work, with Grok subagents doing the grunt work.

### Physical layout
| variant | Solid worktree (`~/work/solidjs/`) | RX worktree | Solid diff | RX diff |
|---|---|---|---|---|
| baseline | `store-proto-base` | `rx-store-proto-base` | none (= main `30e7805eb`) | none (`ref/package.json` only, uncommitted) |
| **A** core/proxy split | `store-proto-core` | `rx-store-proto-core` | 7 files +209/−61 | `emit.ts`, new `store-ops.ts`, rt*.ts (~160 lines) |
| B plainData | `store-proto-plain` | `rx-store-proto-plain` | 4 files +167/−11 | runtimes only (~18 lines each) |
| A+B | `store-proto-both` | `rx-store-proto-both` | A + B | A + B |
| 1 features | `store-proto-features` | `rx-store-proto-features` | 7 files +273/−105 | 8 files +138/−27 (new `features.ts`, `features-check.ts`) |
| 2 writes | `store-proto-writes` | `rx-store-proto-writes` | 2 files +31/−4 | +9/−3 |
| 3 sitecache | `store-proto-sitecache` | `rx-store-proto-sitecache` | 2 files +69/−2 | +35/−11 |
| 4 slots | `store-proto-slots` | `rx-store-proto-slots` | 6 files +68/−9 | +18/−7 |
| combined 1+2+3 | `store-proto-combined` | `rx-store-proto-combined` | 7 files +372/−110 | 10 files +181/−40 |

- The `store-proto-*` dirs are worktrees of `~/work/active/research/solidjs`, a Solid clone.
- `store-proto-bench` is its own git repo on branch `proto/store-bench`, with one commit, `16376f6`. It holds:
  - the harnesses: `rx-bench.ts`, `rx-run.mjs`, `solid-bench.mjs`, `solid-run.mjs`, `sizes.mjs`, `rx-bundle.ts`;
  - the differential fuzz, `fuzz/fuzz.mjs`, with shrinkers;
  - patches, including `slots-upfront.diff`, the rejected design;
  - results, logs and the bench programs `rows/deep/keyed/optimistic/counter.rx`.
- Only the TS reference emitter (`ref/compile/emit.ts`) changed. **The Rust compiler (`compiler/`) is untouched**, so on every prototype branch `crate --lower` no longer matches the TS emitter.

### Round 1: A vs B
- **A, core/proxy split.** The store's trap bodies are already functions of the target, so A makes them callable without the `Proxy`. A proxy is now created lazily, only when a value leaves RX code. New exports: `storeGet/Has/Keys/Set/Delete/Proxy` and `isStoreTarget`, and `mapArray` accepts a list target. The RX emitter lowers member reads to `__rt.get` / `__rt.val` on targets, and `__rt.out` converts back to a proxy at an escape.
- **B, a `plainData` store option.** It skips the accessor probe and the descriptor scan, and uses a specialised get trap.
- **Profile:** about 59% of a baseline tracked read is Proxy dispatch, 13% the trap body, 17% core `read`. That is why A wins and B alone is noise.
- **Semantics:** signals passes 7253 on both the proxy path and the target path (`SOLID_STORE_VIA_TARGET=1`). solid passes 941. web passes 2033/2221/788. RX passes 135/135/135/181. The fuzz found 0 differences over 3000 seeds, and sabotage fails, as it should.
- **Results:** A cuts reads 20–63% and RX ops 15–31%. Memory is 2–6% lower. Bundles are **about 1.4% bigger**. Removing the proxy does not shrink anything, because the target path reuses the same trap code.

### Round 2: four compiler-driven ideas on top of A
Dev asked "can the compiler take on more work so it can use a smaller runtime", then "actually I want all 4".

| | baseline | A | 1 features | 2 writes | 3 sitecache | 4 slots | combined |
|---|---:|---:|---:|---:|---:|---:|---:|
| store entry gzip | 17577 | 17670 | 14774 | 17769 | 17677 | 17726 | 14877 |
| RX counter app gzip | 51946 | +1.3% | **−16.4%** | +1.5% | +1.7% | +1.6% | −16.3% |
| RX rows app | 54946 | +1.4% | **−14.1%** | +1.5% | +1.8% | +1.7% | −13.6% |
| RX keyed list | 54338 | +1.4% | −8.0% | +1.5% | +1.8% | +1.7% | −7.5% |
| RX optimistic app | 54324 | +1.4% | +0.4% | +1.5% | +1.7% | +1.7% | +0.9% |
| tracked read (Solid) | 1.00 | 0.77 | **0.50** | 0.78 | 0.83 | 0.86 | 0.54 |
| deep read | 1.00 | 0.68 | 0.58 | 0.68 | 0.51 | 0.73 | **0.42** |
| 100 leaf writes | 1.00 | 0.75 | 0.67 | 0.72 | 0.70 | 0.74 | **0.60** |
| RX create 10k | 1.00 | 0.88 | **0.77** | 0.84 | 0.92 | 0.84 | 0.77 |
| RX deep leaf write | 1.00 | 0.94 | 0.84 | 0.89 | 0.81 | 0.86 | **0.75** |
| heap B/row @100k | 1712 | 1633 | 1632 | 1632 | 1712 | **1504** | 1712 |
| fuzz vs baseline | — | 0/1500 | 0/9000 | 0/3000 | 0/4500 | **167/4500** | 0/7500 |

Latest raw tables are `results/rx-2026-11-24T02-02-58-117Z.md`, `solid-2026-11-24T01-51-43-776Z.md` and `sizes-…md`. Frame hashes agree across every variant. Noise is about ±5–10%, because a fuzz was running on another core during the runs.

**What each idea found:**
1. **Feature switches.** These are pure subtraction and the clear winner.
   - **Solid side:** six build defines (`__SOLID_STORE_{ACCESSORS,GUARDS,SHALLOW,FAMILIES,OPTIMISTIC,DELETE}__`) across about 100 gate sites. They ship in a new `dist/select` tier behind a `store-select` export condition. Default builds are byte-identical to A.
   - **RX side:** a manifest pass in `emit.ts` decides each switch per program. It is conservative: anything it can't rule out stays on.
   - **RX-only `stores` entry:** drops the store entirely when a program has no structured values. Most of the app-level size win comes from this.
   - **Speed:** pruning also speeds reads. A control build that is bundled but not pruned matches A.
   - **Gaps:** there is no proxy-layer switch, because the emitter has no types to prove a store never escapes. An app with guesses keeps every feature.
2. **Direct-path writes (`storeWrite`).**
   - Within noise of A. A profile shows the setter scope is about 10% of a write; the rest is scheduler and flush.
   - Shape-generated root compare and keyed reconcile were **not built**, and that is reported as a finding: Solid's diff already walks only nodes that exist, and keyed reconcile time goes to raw→target registration and GC.
   - One fuzz scare (143 seeds) turned out to be a harness asymmetry. It did expose that `storeWrite`'s error wasn't the native one, which is fixed.
3. **Read-site caches (`storeSite` / `storeGetAt`).**
   - They help deep fixed paths and RX select-1k (0.85). They do nothing in row loops.
   - The sites eat A's memory saving.
   - Routing the whole suite through sites caught a real stale-value bug, which is fixed.
   - Sites are not shared across reads. A shared site is safe (it was fuzzed) but needs a proof that both reads reach the same object.
4. **Fixed-shape slots.** Explicitly *not* a subtraction.
   - The briefed design (nodes made up front) fails 27 Solid store tests. Solid relies on "a key nobody read has no node".
   - The lazy version saves 12% memory, but **effect order changes in 167 of 4500 fuzz seeds**. The order is all that changes: nodes are walked in shape order instead of creation order. That breaks parity, so slots were dropped.

**Recommendation (orchestrator, endorsed in session):** take **A plus feature switches** to Ryan first. Offer site caches only as an opt-in for deep fixed paths. Drop writes as a standalone item, and drop slots.

**Open questions for Ryan:**
- whether seven new exports plus the `mapArray` target input is acceptable surface;
- whether a possible ~5% proxy-path cost is acceptable;
- whether he wants switches as build defines or as hook registrations (like `optHooks`).

### Round 3 (started, stalled): the runtime-wide ladder
The design conversation widened in four steps:

1. **Scalar replacement.** Dev asked "can the compiler not make `user_address_city` a signal". The answer: only for records with a fixed shape that are not in a list, not aliased, don't escape and aren't fetched. Flattening is slots done at compile time, so it inherits slots' two failure modes.
2. **A shape ladder.** Step 0: no store. Step 1: flat signals. Step 2: a lite store. Step 3: the full store with switches.
3. **An async ladder.** A0 sync-only, A1 sync actions, A2 held writes, A3 `pending?`/`latest` probes, A4 optimistic, A5 derived/questions. Holds are contagious, so A0 has to check every writer of a store.
4. **The whole Solid runtime is on the plate.** Dev: "not just async stores but async signals as well".
   - The structure: pick the scheduler tier **per program**, because async is contagious. Pick the node implementation **per node** within that scheduler.
   - Low steps are **separate implementations built from Solid primitives**, and must match by fuzz.
   - High steps are **switches on Solid's code**, and match by construction.
   - rust-solid's tiered fuzzers (`--slice1/2a/2b/2c/render/boundaries`) are the evidence that a separate implementation can match trace for trace. Porting them to current Solid is a workstream.

**The brief:** eight parallel workstreams:
- a size map
- a sync-only core
- the lite store and flat signals
- owner-free regions
- new switches for A2/A3 and for non-store areas
- compiler tier analysis
- porting the solid-model fuzzers
- a corpus of realistic apps

Dev also changed the rule to "push `proto/*` as it's done".

**First steering result** (`store-proto-bench/rt/tiers-scan.ts`), over 175 existing programs:

| step | share |
|---|---:|
| A0 | 13% |
| A1 | 4% |
| A2 | 3% |
| A3 | 3% |
| A4 | 2% |
| A5 | 75% |

The orchestrator therefore timeboxed the sync core and moved weight to switches. That corpus is mostly async conformance tests, so it is skewed toward async.

**Current state on disk:**
- Only `rt-proto-tiers` exists: a Solid worktree on `proto/rt-tiers`, at the `proto/store-features` head, with no new commits.
- There are no `rx-rt-proto-*` worktrees, no `rt/results/` and no `corpus/`.
- The round was interrupted (machine reboots wiped `/tmp` twice during the store rounds) and hasn't produced anything yet.

---

## 2. `solid-model` (fork, orphan, 55 commits, last 11-11): the base thesis

**Goal:** "Solid is a semantic model plus a conformance suite."
- Syntaxes (TSX, RX, solid-yield generators, later React), runtimes (Solid JS, a Rust port), renderers and client/server placement are all plugins.
- A plugin is accepted only where it is identical to native Solid 2. Everything else gets a typed refusal.
- The plugins are connected by **plans**: a JSON IR (v1 → v2 → v2.1 async → v2.2 frames → v2.3 composition).

**Status (gates are exact counts):**

| slice | what it covers | result |
|---|---|---|
| frontend gate | | 149/149 |
| rust-solid `cargo test` | | 175 |
| 1, like button | TSX, RX and yield give the same frames on Solid, compiled RX and Rust | Rust scheduler fuzz 1000/1000, up from 7/1000 once it became a structural port |
| 2, issue tracker | 13 frames | byte-identical plans from the 3 syntaxes, host log 453/453; plan fuzz 0 divergent over 1–3000 |
| 3, live `eval(code, {...})` | | built and fuzzed |
| 5, SSR | Rust `renderToString` / `renderToStream` | byte-identical to Solid, including a seroval port; hydrates in Chromium |
| v2.1 async tier | `Loading`/`Errored`, `isPending`, `latest`, `refresh`, `affects` | |
| 6, Frames | infers server components from an all-client app (rules PL-1..9) | Rust frames server byte-equal to Solid's |
| 4, native window | | not started |

**Findings:**
- 11 suspected Solid rc.21 bugs, drafted in `docs/scratch/solid-rc21-issues.md` with repros. None filed, and none rerun on current Solid.
- Plain `git push` doesn't work in the sandbox. Commits only land via `tembo commit`.

**Where it's going:** the base for rc-frontend, rc-ladder and plan-v2-composition. In the store session, Dev's orchestrator planned to reuse its fuzzers as conformance tests for a tiered JS runtime. That makes solid-model the oracle for the runtime ladder, not just for Rust.

---

## 3. `rc-frontend` → `rc-ladder` (fork, 11-14 → 11-17)

### rc-frontend (`2da4a45`, +2033 lines over solid-model)
**What it is:** React Compiler as a fourth frontend.
- `.react.tsx` is lowered onto the RX AST, then to plan v2. React Compiler's rule errors gate it, and its "placed" names decide what is reactive.
- A differential fuzz compares React 19 with the compiler, React 19 without it, and the JS plan runner.
- **Fuzz on seeds 1–200:** 77 agree, 120 refused, 3 batched, 0 differences.
- **Intended difference:** React batches every transition, while Solid merges only overlapping ones. Dev calls this a feature, so the fuzz labels it `batched`.

So it is not a "TSX checked by RX" (that was PR #21 and the `frontend/tsx` work). It is **React code checked and run by RX semantics on Solid**.

### rc-ladder (`383035a`, +2607 lines)
**What it adds:** a fallback ladder, modelled on React Compiler's bail-outs:
- **precise:** what already lowered exactly;
- **snapshot:** a read after a handler's own write sees the render's value, which matches RX rule W-4;
- **coarse:** render lets are folded, unread state dropped, refs become signals, contexts without a provider use their default;
- **island:** a marked plan node holding Babel-compiled JS, run by a hook shim with one Solid signal per island. Rust refuses it with `NEEDS_JS_HOST`;
- **refuse.**

**Results:**
- Base family: 77 → 132 agree. Ladder family: 4 → 112 agree. Still 0 differences.
- Fuzz seed 183 found a soundness hole: a plain write that a pending action also writes. `REACT_HELD_PLAIN_WRITE` was widened to close it, so about 7 programs that used to be accepted are now refused on purpose.
- **Real code, the t3code survey (1,641 components):** 0 components reach snapshot or coarse, 0 islands as built, and at most 10 islands in theory. Props, child components and custom hooks block everything.

**Open decision:** rebase onto `plan-v2-composition`, then rerun the t3code survey before picking the next level:
- multi-module islands,
- async in islands,
- or an effect node in plan v2.

---

## 4. `plan-v2-composition` (fork, `f31e134`, 11-17)

**Goal:** real React components (t3code as the test bed) should lower to a plan and run identically on Solid, the JS plan runtime and rust-solid.

**What plan v2.3 adds:**
- element `attrs`;
- component sites with value, handler, action and forward props;
- `{kind:'children'}`;
- a top-level `components` list.

It is opt-in through `compose`, and plans without a v2.3 form are byte-identical to before. Value props are getters, following Solid's universal compiler semantics.

**Results:**
- Composition plan fuzz on seeds 1–300: 149 agree, 151 `UPSTREAM_RX_COMPOSE`, 0 divergent. The 151 are seeds where upstream compiled RX differs on components.
- React composition fuzz: 200/200.

**t3code survey:** 26 accepted, up from 0. Another 612 (37%) are blocked only by forms v2.3 doesn't lower yet. 876 (53%) would have no semantic blocker once the frontend gaps are filled. The top first-refusals:

| first refusal | components |
|---|---:|
| imports from non-`.d.rx` modules | 548 |
| prop defaults | 133 |
| components from other modules | 117 |
| rest props | 68 |

**Gaps:**
- The Rust SSR renderer refuses v2.3.
- Frames (v2.2) isn't unified with composition.
- The Chromium frames tests weren't run.

**Next, as the user recommended:** follow the app's imports, then prop defaults, then rest props. Then rebase `rc-ladder` onto this branch.

---

## 5. `project-dashboard` and `project-docs` (fork, 11-06 → 11-08)

These are tooling and handoff branches, not experiments.

- **`project-dashboard`** is a local, read-only status page.
  - Node built-ins only, with `server.mjs` on 127.0.0.1:4173.
  - It collects git and GitHub state, runs gates in place on clean worktrees, and caches results per SHA.
  - `notes.json` is the narrative state: goal, milestones, findings, decisions, next.
  - Its paths are hard-coded to the Mac (`/Users/devagr/rx-tsx-refresh`), so it went stale after the move to the Tembo sandbox. A copy was later folded into `solid-model/dashboard/`.
- **`project-docs`** is the 11-08 handoff plus `scratch/` research notes:
  - slice 1 Solid scheduler traces;
  - a compiler architecture review;
  - drafts of issue #33 (interpreter vs compiler writes around pending actions) and of PR #21.

  It is superseded by `solid-model/docs/`, which carries the same `scratch/` tree.

**What they show about how Dev works:**
- planner and designer only, with all implementation done by background agents;
- an independent verifier for every result;
- two decisions asked at a time;
- vertical slices;
- never publish without an OK.

## 5b. `tsx-frontend-demo` / `pr21-v1-archive` / `pr21-v2-archive`

PR #21 to Ryan's repo, in three versions:
- `pr21-v1-archive`, 10-29: an experimental Solid 2 TSX frontend in `tsx-frontend/`.
- `pr21-v2-archive`, 10-31: async refusal, the tracker, the optimistic list.
- `tsx-frontend-demo`, 11-06, the current head: verified TSX and yield frontends on clean RX main.

All three are titled "Demo (not for merge)". As of the last handoff, PR #21 is an open draft with no review. Issue #20 (an explicit form for async callbacks) was closed as not planned, so the frontend still refuses async callbacks.

---

## 6. `claude/project-thread-*` (upstream, not merged)

These are threads in Ryan's repo, not experiments from Dev. They matter here because they move the language surface that the experiments target.

| branch | what it holds |
|---|---|
| `2sdg89` | renames `optimistic` → `guess`; clears errors with `onFlush` |
| `2sdg89-equation-guess` | a guess over an equation (`createOptimistic(fn)`, `createOptimisticStore(fn, seed)`) |
| `2sdg89-destructuring` | RG-4b rest patterns |
| `rtxj3o-lockfile` | lockfile only |
| `t6465s` | eval rounds 11–12: `GUESS_BEFORE_SHOWN` / `GUESS_WHILE_LOADING` prototypes, fuzz `--others` / `--tear`, Solid #4821–4828 repros |
| `xp2irv`, 11-24 | `.rx` eval rerun on Solid main `30e7805eb`; guide notes |

Most of this content is already on main in some form, apparently squash-merged under other commits: `GUESS_WHILE_LOADING` is in `spec/06-stores.md`, and destructuring rest is in `spec/07-surface.md`. The branch refs remain unmerged. `origin/claude/project-thread-t6465s` (the fork copy) has no commits beyond upstream main.

---

## Open threads

- **Runtime ladder round is stalled.** Only `rt-proto-tiers` exists (no commits). Size map, sync core, lite store, owner-free, async switches (A2/A3), tier analysis, fuzzer port and corpus are all unstarted on disk.
- **Typed emission in the Rust compiler** is the stated next unlock. It would let non-store reads skip `__rt.val`/`get`, make the proxy-layer switch provable, let memos carry targets, and let slot or flat shapes be emitted statically. All the store work so far lives only in the TS reference emitter.
- **Package for Ryan:** A + feature switches. The asks are seven exports, a `mapArray` target input, a `dist/select` tier and six defines. Still unanswered: whether the ~5% proxy-path cost is real, which needs Solid's CodSpeed benches and its `scripts/size` gate; neither has run.
- **Write path:** a write's cost is in the scheduler, the pending-backing clone and the fold, not the setter. Nobody has attacked it yet.
- **Unmeasured:** a real DOM js-framework-benchmark run (only the string renderer was used), and per-op allocation, because Node here has no allocated-bytes counter.
- **The fork's design branches are stuck on rc.21 / RX `fdbcad92`.** Before any of it is useful against current main, it needs:
  - repinning;
  - rebasing `rc-ladder` onto `plan-v2-composition`;
  - rerunning and filing the 11 rc.21 bug repros;
  - running the Chromium frames tests.
- **Corpus bias:** tier statistics come from async-heavy conformance tests. Realistic apps (the corpus workstream) are needed before deciding sync-core vs switches.
- **Unchecked contracts:** a program that breaks a switched-off feature (or B's `plainData`) fails silently. There is no dev-mode assertion.

## My read of the intent

Every experiment follows the same pattern: **Solid 2's semantics are the fixed point, and everything else is a swappable plugin, proven equal by differential fuzz.**

- **The solid-model and React branches** apply that on the *input* side: more syntaxes (TSX, yield, React) lowered onto RX's checker. Anything that can't be proven identical gets a typed refusal or a marked fallback.
- **rust-solid and Frames** apply it on the *execution* side: other runtimes and other placements (server components inferred from client code).
- **The store and runtime ladder** turns it inward. The checker already knows each program's reads, writes, async and escapes, so the compiler should pick the *smallest Solid runtime that is provably equivalent*. That is either Solid's own code with branches deleted, or a smaller implementation built from Solid primitives and fuzzed against the full one.

The bar Dev holds is strict:
- "subtraction, not addition";
- behaviour exact down to effect order (slots were dropped for that alone);
- everything framed as something Ryan could take upstream into Solid itself, not RX-private magic.

The longer arc reads like **"RX as the proof that a statically checked Solid can be smaller and faster than hand-written Solid"**. In that story, the TSX and React frontends are the adoption path for existing code, and the size and perf wins are the payoff that makes the static checking worth having.

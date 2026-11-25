# ReactiveScript: the big picture

Pieced together 2026-11-24 from: upstream `solidjs/reactivescript` main (`e650b85`, 408 commits since 10-21), every PR and issue there, the fork's orphan design branches (`solid-model`, `rc-frontend`, `rc-ladder`, `plan-v2-composition`, rust-solid perf rounds, `eval-demo`/`eval-todo`), the store/runtime prototypes (`proto/store-*`, `rt-proto-tiers`), the adjacent Solid worktrees, and the local opencode sessions. Detailed notes per slice are in `notes/01..06`.

---

## 1. The vision in one paragraph

**Solid 2.0's reactive semantics are the fixed point. Everything else (the syntax you write, the checker, the runtime that runs it, where it runs, how big it is) is a plugin that is accepted only where it is provably identical to native Solid, and refused with a named reason where it is not.**

ReactiveScript is the first and most complete expression of that: a small language where Solid's rules are grammar and compile errors ("the compiler refuses, the way Rust refuses a borrow"), checked statically, compiled to plain Solid with nothing added at run time. But the work as a whole goes past "a nicer syntax for Solid":

- **on the way in:** other syntaxes (Solid TSX, generator/yield, React via React Compiler) lower onto the same resolved model and checker;
- **in the middle:** a spec plus ~135 executable scenarios plus an oracle make Solid 2.0's semantics *specified*, not just implemented;
- **on the way out:** because the checker knows every program's reads, writes, async and escapes, the compiler can pick the **smallest Solid runtime that is provably equivalent**: delete store features a program never uses, skip proxies, choose a sync-only scheduler, or run on a Rust port of Solid;
- **placement:** SSR, server functions, and Frames (server components inferred from an all-client app) are the same model run in a different place;
- **the proof, at every seam:** differential fuzzing against native Solid, trace for trace, byte for byte, with typed refusals instead of tolerances;
- **the proof, at the human/AI level:** preregistered evals showing that agents (especially small models) write fewer async bugs in `.rx` than in React and others;
- **the payoff for Solid itself:** ~95 upstream issues found, most fixed before 2.0 shipped. RX became Solid 2.0's de facto conformance suite and highest-yield bug source.

The rule that holds it together, stated across handoffs: *subtraction, not addition; one way to do a thing; never loosen a check to get green; everything framed so Ryan could take it upstream.*

---

## 2. The shape of the system

```
          syntaxes (input plugins)
   .rx ── Solid TSX ── yield ── React (RC)          ← PR #21, solid-model, rc-frontend/ladder
     \        |         |        /
      ▼       ▼         ▼       ▼
     resolved model (CP-6)  ──►  checker: sources/equations/actions,
     plans IR (v1…v2.3)          holds, regions, rows, failures, types (TSX projection)
                │
     ┌──────────┼───────────────────────────────┐
     ▼          ▼                               ▼
  runtime tier  Solid JS (pruned / tiered)    rust-solid (scheduler, stores,
  selection     store switches, proxy-free    renderer, SSR, Frames server)
  (per program, read paths                    2–5× faster on list work
   per node)
     │
     ▼
  placement: client / SSR stream + hydrate / server fn / Frames / live eval(code)
     │
     ▼
  proof: oracle on real Solid · differential fuzz per leg · AI eval rounds
     │
     ▼
  feedback: DV records → solidjs/solid issues → fixes → repin → rerun
```

---

## 3. Every dimension: where it is, what's in flight, where it leads

### 3.1 Language and semantics
- **Now:** sources (`:=`), equations (`=`), effects, actions (explicit and inferred), guesses/holds (`guess`, `refresh`, `affects`, `latest`, `pending?`, `loading`/`errored` regions), stores with path writes and `key`, modules that own state and export actions, `server fn`, scoped `<style>`, types via TSX projection. About 40 compile-time diagnostics, every one with a rule id and a fix page.
- **Trend:** each eval round moves another async race class from runtime to compile time (`HELD_WRITE`, `STALE_WRITE_BACK`, `UNGUARDED_SNAPSHOT`, `LOADING_ON_OUTSIDE_HOLD`, `GUESS_WHILE_LOADING`, `STALE_CAPTURE`, `CATCH_NOT_ON_AWAIT`). Each is gated on evidence, and one (`FOREIGN_FAILURE`) was withdrawn because the data argued against it.
- **Open:** hold coupling (#75, #76, #77) is the first real challenge to the #20 ruling. An unread equation lowered to an eager `createMemo` contradicts E-3. Other gaps: ownership escape through action args (#37/O-4a), arity across modules (AC-1f), `01-scopes` still unwritten, `02-core` still DRAFT with stale tables, and a pile of "taken by default, veto here" items.
- **Logical conclusion:** a closed core (scopes, core, holds ruled) where RX's spec and Solid's `RULES-FUNDAMENTALS` are the same document, and the canonical server-data shape the guide converged on (question source → keyed store → guesses on the answer → re-ask) becomes rules, not advice. Signatures (`.d.rx`) carry more (params, `retains`), and more rules get stated as TS types.

### 3.2 Correctness proof and the Solid upstream loop
- **Now:** five runners (interpreter, oracle on real Solid, compiled, SSR in Chromium, types) over every scenario. Disagreements become `DV-n` records with plain-Solid repros. Zero recorded divergences was reached at rc.19 and is kept as a gate. Solid is pinned to main `30e7805eb`. Still open upstream: #5092, #5117, #5118, #5174.
- **Logical conclusion:** the oracle and repros run in Solid's own CI, and "0 divergences" is a Solid release gate, not just an RX one. RX is how Solid's semantics are written down.

### 3.3 AI-writability
- **Now:** 15+ eval rounds, preregistered from round 4. On the familiar task (desk9) .rx is best of six arms at both tiers (Opus 0.00, Haiku 1.50 vs React 3.17 / 9.00). On the held-out board task it was second worst (Opus 6.33, Haiku 25.17 vs React 0.67 / 3.00). Traced cause: agents carried over a bookkeeping shape the checker allows. The #94 rerun on fixed Solid halves board Opus (3.67), but board Haiku is still ~19.
- **Logical conclusion:** the claim is "raises the floor for small models on *unseen* apps". Getting there needs fresh held-out tasks (board is now tuned on), a same-day rerun of every arm, and checks that refuse the bookkeeping shapes the language exists to replace. Runtime `eval` (below) extends the thesis from "agents write .rx files" to "agents emit checked .rx into a live app".

### 3.4 Compiler and performance
- **Now:** the TS reference (`ref/`) is the spec; the Rust crate (`rxc`, ~14k lines, built on Solid's `compile_program` seam) is the product, kept byte-equal by `ref/crate.ts`. **Drift:** the crate pins Solid rc.21 while ref pins main, and no CI check enforces equality. Product builds leak harness code (`__rt.reg` #80, `__B.*` #74), and there are silent miscompiles (#73 `"\n"`, #78 type imports).
- **In flight (store compiler, 11-23/24):**
  - What won: proxy-free read paths (A) plus build-time feature switches (1). App bundles came out 8–16% smaller and tracked reads 2× faster, with 0 fuzz differences.
  - What lost: slots were dropped (effect order changed in 167 of 4,500 seeds), writes were noise, and site caches are opt-in only.
  - All of it is in the TS emitter only; the Rust crate is untouched.
- **Stalled:** the runtime-wide ladder (sync-only core, lite store, flat signals, owner-free regions, async tiers A0–A5). Eight workstreams were planned; only an empty `rt-proto-tiers` worktree exists. The first scan says 75% of programs land on the top async tier, but the corpus is skewed toward async tests.
- **Logical conclusion:** "a statically checked Solid compiles to a *smaller and faster* Solid than you'd write by hand, with exact semantics." The checker pays for itself at run time. The next unlock is typed emission in the Rust crate, which makes proxy-layer and tier choices provable.

### 3.5 Runtimes: rust-solid
- **Now (fork, `solid-model`):** a Rust port of Solid 2's scheduler, async, stores, universal renderer, SSR (`renderToString`/`renderToStream` byte-identical), and a Frames server. After three perf rounds it is 2–5× faster than Solid JS on list work (jfb 1k rows 4.9 vs 23.6 ms), with fuzz parity unchanged. The move to Solid main is half done: JS legs clean, 15 of 149 tests failing on the Rust side, uncommitted edits in the engine worktree.
- **Logical conclusion:** Solid without Node (native or embedded hosts, server rendering in Rust) as just another conformance-checked runtime. The open decision is whether it becomes an RX *target* (rxc → plan → native) or stays research.

### 3.6 Frontends and adoption: Solid beyond `.rx`
- **Now:**
  - The PR #21 demo lowers Solid TSX and yield onto RX's checker. `rc-frontend` adds React via React Compiler.
  - `rc-ladder` falls back from precise to snapshot, coarse, island, then refuse.
  - Plan v2.3 adds composition (props, children). On t3code (1,641 components): 0 → 26 accepted. The blockers are cross-module imports (548), prop defaults (133), components from other modules (117) and rest props (68).
- **Logical conclusion:** two products on one core:
  1. `.rx` for new code, the strictest and most AI-friendly.
  2. *Checked Solid TSX* (and eventually React code moved onto Solid) for existing code. Same rules, a typed refusal where it can't prove equivalence.

  This is the adoption path. Today it lives only on fork orphan branches pinned to rc.21.

### 3.7 Placement: server, Frames, live eval
- **Now:** SSR is "the client's mount, streamed". `server fn` has the call site decide query vs mutation. Frames infers server components from client code (rules PL-1..9).
  - Runtime `eval(code, {bindings})` runs checked .rx strings inside a live app, with read-only bindings and typed refusals. It was fuzzed with 0 divergences on 3,000 seeds.
  - The `eval-todo` demo includes a self-editing editor. Its `FINDINGS.md` lists 20 gaps in the plan-v2 subset (no `if` in handlers, no sort, no components…).
  - The eval RFC is drafted and unposted.
- **Logical conclusion:** generated UI. A model writes a widget against a typed interface, the checker accepts or refuses it at run time, and it runs with exact Solid semantics. That is the AI thesis at run time. Partial hydration and request-scoped dev SSR are the server's next steps.

### 3.8 Tooling and DX
- **Now:**
  - npm `@reactivescript/*` 0.3.1 (compiler with 6 native targets plus wasm, runtime, language server).
  - A Volar-based LSP running the crate as wasm (~1 ms per file), plus `rx-tsc`.
  - The VS Code extension on Marketplace and Open VSX; a tree-sitter grammar.
  - Vite support through `@solidjs/vite-plugin`'s built-in frontend.
  - The reactivescript.dev landing page.
- **In flight:** Zed (#92), playground with `.rx` ↔ Solid primitives side by side plus a Solid→.rx converter (#70), HMR (#68), parser hang fix (#91), failed-build fix (#95).
- **Logical conclusion:** the playground ("every word is a Solid primitive, see it") becomes the main teaching surface. The LSP moves to a TS 7.1 content mapper (#82), because Volar has no future on tsgo. RX diagnostics and the runtime's bin-R attribution show up in one place: editor plus devtools.

### 3.9 Ecosystem and distribution
- **Now:** use any Solid library through `.d.rx` (MO-10, 0.3.0). Real component-library authors are filing issues (#73–#84).
- **Next:** components and router factories (#69, MO-11), which unblock the routed template (solidjs/templates#347). Libraries shipping `.rx` source through node_modules (#83). Compile-time CSS (#81), where it's still open whether that's a goal or scoped `<style>` is the answer.
- **Logical conclusion:** an RX tier for component libraries (Kobalte- or TanStack-Form-style headless widgets), which is also how #37's ownership rules get priced.

### 3.10 Observability and devtools (adjacent, Solid core)
- **Now:** `openView` (draft solidjs/solid#5089), the devtools History panel (unpushed), and a lazy attribution engine. RX's spec/99 already sorts Solid's diagnostic codes into three bins: grammar makes it unwritable (U), the static checker catches it (S), and the runtime attribution reports it (R).
- **Logical conclusion:** the devtools are the run-time half of RX's diagnostics story, under the same code names. RX's static graph could give the History panel real names and structure. These two lines have never been joined.

### 3.11 Process (how the work gets done)
- Agent-written under direction: 293 of 408 upstream commits are Claude's, plus Tembo sandbox orchestrators on the fork.
- Handoff branches carry fresh-session briefs.
- Numbers are labelled measured / spike / estimate.
- Gates are exact counts.
- Preregistration for evals, and reversals reported as plainly as wins.
- **Weak spots:**
  - orphan fork branches drift (all on rc.21 / RX `fdbcad92`);
  - `/tmp` wipes cost a round;
  - the local agent profile knows almost nothing about RX.

---

## 4. How we got here (5 weeks)

| when | era |
|---|---|
| 10-21 → 10-25 | Spec-first. Solid's own scenarios ported, an oracle on rc.16, the checker, compiler, SSR, server fn, styles, types. |
| 10-26 → 10-27 | Ryan rules on every default. First batch of DVs filed and mostly fixed the same day. Rust crate (#1 → CP-6), LSP, VS Code, runtime package. **0 divergences at rc.19.** |
| 10-27 → 11-08 | Eval rounds drive the language: inferred actions, STALE_WRITE_BACK, R-8, CN-3e. Two rounds reversed against .rx. Aligned with Solid #4695. Fork side: `solid-model`, rust-solid slice 1 (1000/1000 trace parity), PR #21 frontends. |
| 11-09 → 11-13 | Moved to the solidjs org. 0.1.0, 0.2.0, 0.3.0, 0.3.1: `guess`, destructuring, MO-10 libraries, site. Fork side: rust-solid SSR and Frames, React frontend, ladder, plan v2.3, perf rounds 1–3. |
| 11-14 → 11-23 | Round 15 (publication round: desk9 win, board loss), board probes, ~30 Solid bugs, Solid 2.0 ships, repins to main. Community tooling arrives (tree-sitter, Zed, playground, HMR, router). |
| 11-23 → now | Store compiler round (A + switches wins). Runtime ladder planned. pin-main move of the fork. Runtime eval demos. |

---

## 5. Roadmap

### Now: hygiene, this week
1. **Marketplace publishing:** switch to the Entra OIDC identity before the **12-01** PAT retirement, or the next extension release silently skips the Marketplace.
2. **Re-sync the crate's Solid pin** to `ref/SOLID_NEXT`, run `crate --lower/--project`, and add a CI check that the two pins are equal.
3. **Fix the silent miscompiles:** #73 and #74. Fix #78, and gate the harness-only `__rt.reg` out of app builds (#80).
4. **Merge the small community fixes:** #91 (parser hang) and #95 (Vite reusing a failed build).
5. **Fix the site's install line:** drop the stale `@next` tags.

### Next: 0.4.0 and closing loops (weeks)
- **0.4.0 on Solid 2.0.x:** the breaking `CATCH_NOT_ON_AWAIT`, plus ARGUMENT_COUNT, STALE_CAPTURE and guesses over writables.
- **Rulings on hold coupling (#75–77):** lazy memos vs E-3, and per-field provision.
- **Land the community features:** MO-11 / router (#69), HMR (#68), Zed (#92), and the playground (#70) deployed at reactivescript.dev.
- **The `UPSTREAM_RX_SHOW` finding:** make RX `if` lower to a shape Solid's prod ternary rewrite applies to, so compiled .rx builds the page in the same order as hand-written Solid.
- **Eval:**
  - settle #94 with a same-day rerun of the other arms;
  - commission the outside review of PREREG-15;
  - write round 16's PREREG on new held-out tasks.
- **Store compiler:**
  - package A + switches for Ryan (7 exports, `dist/select`, 6 defines);
  - run Solid's CodSpeed and size gates to price the ~5% proxy-path cost.
- **Spec cleanup:** write `01-scopes`, close `02-core`, fix stale cross-references, and make `ref/` enforce what `rxc` already does (R-8, CN-3d).

### Later: the thesis milestones (months)
- **"Smaller and faster than hand-written Solid":** typed emission in the Rust crate; the runtime ladder (sync core / lite store / async tiers) built on a realistic app corpus; fuzz parity throughout.
- **"Checked Solid for existing code":** consolidate PR #21, `rc-*` and `plan-v2-composition` onto current main; follow imports, prop defaults and rest props; rerun the t3code survey; ship a TSX checker frontend.
- **"Solid is a model plus a conformance suite":** decide where `solid-model` lives (RX repo, Solid repo, or a new one); bring the rust-solid pin-main move back to ~1000/1000; re-triage the 11 rc.21 suspected bugs on main; put the oracle in Solid CI.
- **"Floor-raising for small models, on unseen apps":** two or more held-out tasks, containerized isolation, a frozen guide, and bookkeeping-shape checks.
- **Library tier:** node_modules `.rx` (#83), the TS 7.1 content mapper (#82), the compile-time CSS answer (#81), and close O-4a by porting a headless widget (#37).

### Horizon: logical conclusions
- RX's spec is how Solid's semantics are written down. "0 divergences" is a Solid release gate.
- Runtime choice is a compiler output: per program and per node, JS or Rust, client or server or Frames, all proven equal.
- Generated UI: models emit checked .rx at run time against typed interfaces (`eval`), refused or accepted instantly, running with exact Solid semantics.
- One diagnostics vocabulary from grammar to checker to runtime attribution to devtools, mapped back to source.
- Several syntaxes, one meaning: .rx for agents and new code, checked TSX for existing Solid, and React code moved onto Solid when it can be proven equal.

---

## 6. Tensions and risks worth naming

- **The board gap:** the language may be best on tasks the guide was tuned on, and not yet on unseen ones. This is the claim most at risk.
- **Where the work lives:** the fork's orphan branches (solid-model, rust-solid, frontends, plans) carry the widest vision but share no history with main, sit on rc.21, and have no PRs. They are the vision's biggest single point of drift.
- **Three implementations to keep equal:** the ref, crate and runtime (plus emitter prototypes) already disagree (Solid pin drift; store work in the TS emitter only).
- **Generality vs real code:** 26 of 1,641 t3code components accepted. The refuse-unless-proven bar is right, but adoption depends on how fast that number climbs.
- **Hold semantics surprising users:** #75–77 are what real library authors hit first.
- **The name `eval`:** it means both the AI benchmark and the runtime feature. Rename one before the RFC goes public.

---

## 7. Decisions waiting on you

1. Where `solid-model` (plans, frontends, rust-solid) graduates: RX repo, Solid repo, or its own.
2. Is rust-solid an RX *target*, or conformance and perf research?
3. The eval RFC: scalar-only value eval, `preserve` on swap, and whether to send it to Ryan privately first.
4. Plan v2.3 next steps: imports → prop defaults → rest props, then rebase `rc-ladder`.
5. Restart the runtime ladder (needs a realistic corpus first), or ship A + switches to Ryan first.
6. The rust-solid perf round 4 (recompute fast path), or stop at parity.
7. Loose ends:
   - the nested-lane fix sits uncommitted in `pr-nested-lane` (you had said go);
   - the History panel is unpushed;
   - #5089 is waiting on Ryan;
   - 7 merged fork branches are waiting to be deleted.

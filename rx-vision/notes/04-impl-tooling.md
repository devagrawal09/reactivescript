# 04 — Implementation, tooling, distribution

Snapshot 2026-11-24. Repo `solidjs/reactivescript` at main `e650b85` (local `main` = `upstream/main`; Dev's fork `origin/main` is stale, so "ahead 245" is meaningless). Read-only review, nothing built or run.

## 1. Architecture: three implementations, one source of truth

ReactiveScript has three layers. The rule from `compiler/README.md` decides where a change lands: **"`ref/` stays the specification: a change of behaviour lands there first (with its scenario), then here, and `ref/crate.ts` keeps the two equal."**

### `ref/`: the TypeScript reference (executable spec)
- `ref/src/`: parse, modules, check (spec/08), signature (`.d.rx`, MO-9), model (CP-6), plus `runtime.ts`, an interpreter of the spec's own semantics (frames, regions, holds, lanes). About 4.5k lines of TS.
- Five runners over the same `scenarios/*.md`:
  - **interpreter**: the spec semantics.
  - **oracle**: lowered onto real Solid by interpretation (`ref/oracle/`).
  - **compiled**: `compile/emit.ts` to JS, then Solid's compiler to a string-tree universal renderer.
  - **ssr**: server build streamed to Chromium and hydrated.
  - **types**: TSX projection checked by `tsc` (spec/13).
- Solid comes from **source**, from Solid's `main` (`next` is gone, #87). It is pinned in `ref/SOLID_NEXT` (now `30e7805eb`, solid-js 2.0.3-era) and built by `ref/scripts/solid-next.sh` into `../solid-next`. Pin moves are frequent: 3 in the last 4 days (#90, #93). Each one usually comes with a repro for a Solid bug that RX found (solid#5090, #5095, #5104, #5146).
- Status in the README (2026-10-26): every scenario passes all five runners, with recorded Solid divergences (`spec/05-holds.md §Divergences`). Upstream counts measured at e650b85 (from the pin-main doc): test 135/0, oracle and compiled 135/0, types 181, ssr 127 pass / **1 fail** / 7 skip. The fail is "Frames [hydrated late] … 404" and was not investigated.

### `compiler/`: the Rust production compiler (`rxc`, crate `reactivescript` 0.3.1)
- Spec/11 ruling (2026-10-24): a **separate Rust crate on top of Solid's `solidjs-compiler`**, not a front end inside `@solidjs/compiler`. Checks are whole-program (CP-2) and Solid's `transform()` is one module in, one out.
- A module-for-module port of `ref/`: `parse.rs` (2.3k), `check.rs` (4.6k), `signature.rs`, `model.rs`, `emit.rs` (2k), `awaits.rs`, `project.rs` (TSX projection plus `.rx` mappings), `spans.rs`, `content.rs`, `infer.rs`. About 14k lines of Rust.
- **The seam (CP-1c/1d):** the crate builds an `oxc_ast::Program` (never text, CP-3) and calls `solidjs-compiler::compile_program`. Scoped styles go through `compile_style`. Both entries were additive asks of Solid. Decision 5: the program carries the *lowered* layout's spans, because Solid's SSR props hoisting reads source order. `.rx` positions come from a side map. Source maps are by line.
- **Build outputs:**
  - `rxc` CLI: check, `check --json`, project, model, compile, app, serve, conform.
  - Node-API cdylib (`src/node.rs`): the npm package, built for 5 native platforms plus `wasm32-wasip1-threads` for StackBlitz, musl and Windows ARM.
  - `wasm32-unknown-unknown` (`src/wasm.rs`): a C ABI over linear memory that answers `serve.rs` requests. The language server loads it.

### `runtime/` (`@reactivescript/runtime` 0.3.1)
- `createApp` plus the `__rt` helpers (CP-4b names). The source **is** `ref/compile/rt-web.ts` / `rt-server.ts`, transpiled by esbuild. The runtime every scenario runs on is the one that ships.
- Browser and server builds are picked by export condition, as `@solidjs/web` does it. Peers: solid-js, @solidjs/web, @solidjs/signals `^2.0.0-rc.23`.
- Not done yet: the server `stream` takes no real request (placeholder), so there is no framework request handling.

### Keeping them in agreement
- **CP-5, `ref/crate.ts`** (`npm --prefix ref run crate`). On every program in `scenarios/` and `examples/`, both sides must give identical AST, diagnostics (same message text), printed `.d.rx` and model. Flags add more checks:
  - `--lower`: identical JS for universal, dom and ssr, plus source-map checks.
  - `--project`: identical TSX, every mapping joining the same text.
  - `RX_CRATE=1`: the compiled, ssr and types runners run on the crate's output.
- Decision 4: the crate matches beyond verdicts. It keeps insertion order so the diff can be byte for byte. That is why the ports look like line-by-line transliterations.
- **⚠ Pin drift.** `compiler/Cargo.toml` pins `solidjs-compiler` at **`2105ffb8` (rc.21)**. `ref/SOLID_NEXT` is **`30e7805eb`**. CP-7 and the README both say they must be equal, and no workflow or `crate.ts` check enforces it (grep finds nothing). The last Cargo.toml change was the 0.3.1 release (2026-11-13). Since then Solid main changed `<Show>` lowering (#4730, ternary in prod), delegated-event capture listeners (#5017) and numeric text (#5112). So `crate -- --lower` at the current ref pin is probably not green, and the shipped 0.3.1 compiles against rc.21 output shapes. Needs a pin bump and a CI assertion.

## 2. Toolchain / DX status

| piece | where | state |
|---|---|---|
| Vite integration | `compiler/vite.mjs`, loaded by `@solidjs/vite-plugin`'s built-in `.rx` frontend (solid-vite-plugin#471, in 3.0.0-next.57) | Works. An entry finds itself, deps are served as `?rx-dep`, a module two programs share is one module. Solid's lazy, refresh and server-fn passes run after. **Gaps:** HMR of `.rx` deps is untested and reloads the page (PR #68). Dev SSR needs a request-scoped app. `test/vite.mjs` needs a local solid-vite-plugin checkout and **no workflow runs it** (noted in PR #95). |
| Language server | `tooling/rx-language-server` (`@reactivescript/language-server` 0.3.1) | Volar over the TSX projection (TY-1c). TS answers hover, definition, references, rename, completion and type errors through mappings. The crate's diagnostics are a second service. Runs the crate as wasm in process, about 1 ms per file. `$RXC` can swap in native `rxc serve`. Needs a tsconfig with `jsx: preserve` and `jsxImportSource: @solidjs/web`. |
| `rx-tsc` | same package, `bin/tsc.js` | Volar's tsc runner (as `vue-tsc`) for CI. Prints crate diagnostics after TS's. |
| VS Code / Cursor | `tooling/vscode-rx` | TextMate grammar (TS grammar plus RX injections, scoped `<style>` as CSS, rx fences in Markdown) and the bundled server. One `.vsix` for all platforms. **Published**: VS Marketplace `solidjs.reactivescript` (last update 2026-11-13) and Open VSX (0.1.1 through 0.3.1). |
| tree-sitter | `tooling/tree-sitter-rx` 0.1.0 (#88, merged 11-20) | Extends tree-sitter-typescript's TSX. Custom scanner for RX newline and `:=` rules. "`parse.rs` is right, this follows." Has `parse:repo` (no ERROR nodes on tracked `.rx`). Own CI workflow. Not published to npm or crates. |
| Zed | PR #92, `tooling/zed-rx` | Open. Wraps the tree-sitter grammar plus the npm language server, with highlights, outline, indents and injections. |
| Neovim / Helix | LS README | Manual `vim.lsp.config` snippet. No packaged plugin. |
| Syntax preview | `tooling/syntax-preview` | Shiki render of every example through the TextMate grammar, for eyeballing highlighting. |
| Playground | PR #70 (`site/playground`) | Open, WIP, not deployed. Shows `.rx` next to the same program in raw Solid 2 primitives, plus diagnostics, all from the wasm build. Needs `app_with` (a reader instead of the disk), a `serve` `app` request, `emit::view_jsx` over `oxc_codegen`, and `analyze {project:false}`. It found the parser hang that PR #91 fixes. |
| Agent-facing | `rxc check --json` (CP-8d), guide shipped in the npm package (`prepack` copies `guide/`) | Diagnostics carry rule ids. Decision 9 makes a diagnostic's range its line's. Per-node narrowing has not been done. |

Editor-recovery note: CP-8e's recovering parse is what the LS and the playground both hit. PR #91 (one guard in `parse_block`) is a real hang fix of 8 to 27 s per keystroke and is small. It should land first.

## 3. Distribution status

- **npm org `@reactivescript`**, released in lockstep at 0.1.0, 0.2.0, 0.3.0 and 0.3.1 (0.3.1 on 2026-11-13):
  - `compiler`, plus 6 platform packages (darwin x64/arm64, linux x64/arm64 gnu, win32 x64 msvc, wasm32-wasi);
  - `runtime`;
  - `language-server`.
- **Release mechanics:** a version bump merged to main, with the `RELEASES` repo variable set to `on`. Workflows `compiler.yml`, `runtime.yml`, `editor.yml` and `tree-sitter.yml` publish through npm trusted publishing (OIDC) from the `release` environment. Tags are `compiler-v*`, `runtime-v*`, `language-server-v*`, `vscode-v*`. `optionalDependencies` on platform packages are written at publish time, never committed (this avoids lockfile churn).
- **VS Marketplace:** RELEASING.md warns that the Azure DevOps global PAT (`VSCE_PAT`) **retires 2026-12-01**, a week from now. If the release env still uses the PAT rather than the Entra OIDC identity, the next extension release will silently skip Marketplace. That one-time switch is time-boxed.
- **Unreleased on main:** `CATCH_NOT_ON_AWAIT` (breaking), `ARGUMENT_COUNT`, keyed-guess merge fixes (#50, #51), the async guide fixes, #65 and #66 (per-module stylesheets, typed entry default export, the rx-tsc `.d.rx` crash), and the tree-sitter grammar. That is enough for a 0.4.0, and it should wait for the Solid pin bump.
- **Site, reactivescript.dev:** a static `site/index.html` (233 lines, no build) served as Cloudflare Worker static assets (`wrangler.toml`, Workers Builds with root `site`). It is live (HTTP 200). Sections: shape errors, props, async, like-button, races refused, "every word is a Solid primitive", libraries, install, learn more.
  - Install line: `npm i solid-js@next @solidjs/web@next @solidjs/signals@next …`. **Stale.** solid-js `latest` is now 2.0.3 and `next` is rc.23 (older). `@solidjs/vite-plugin`'s `next` tag is 3.0.0-next.35, *older* than the next.57 that `.rx` needs (`latest` is 3.0.1). Drop `@next` from every package.
  - PR #72 (colored error cards) is cosmetic. PR #70 would add `/playground`.
- **Downstream:** solidjs/templates#347 (`solid-v2/with-reactivescript`) exists. A routed version is blocked on MO-11 (PR #69).

## 4. rust-solid: what it is and what it found

**What it is.** A Rust port of **Solid 2's runtime**: the `@solidjs/signals` scheduler and transitions, async memos, stores, lists, Loading/Errored boundaries, `affects`, the `@solidjs/universal` renderer, the `@solidjs/web` server renderer (`renderToString` and `renderToStream` with a ported event loop and seroval), and a "frames" server (server functions and components). It is **not** an RX compile target in the shipping toolchain. It lives in a separate project, **`solid-model`**, on Dev's fork (`devagrawal09/reactivescript`). That branch has **no merge base with main**: an unrelated history that pins RX and Solid as gitignored sibling checkouts.

**The thesis** (`docs/HANDOFF.md`): *"Solid" is a semantic model plus a conformance suite.* Syntaxes (Solid TSX, RX, solid-yield generators, a React Compiler prototype), runtimes (Solid JS, rust-solid), renderers and client/server placement are plugins. Each is accepted only where it is identical to native Solid 2.
- Programs travel as **plans**: a JSON IR, versions v1 through v2.3 (v2.1 async, v2.2 frames and DOM input, v2.3 composition).
- Frontends lower TSX and yield onto **RX's AST and checker**. Refused shapes get a diagnostic.
- Differential fuzzers compare every leg trace for trace and byte for byte.
- Three levels are kept apart: syntax recognized, verified subset, full readiness (never claimed).

**Branch map**

| branch | what |
|---|---|
| `origin/rust-solid-main` (11-06) | First spike: Rc graph, flights, coroutine actions. 1148/2000 exact (57%). All 667 action programs failed. "M1 incomplete." |
| `origin/rust-solid-slice1` (11-08) | Structural port of Solid's scheduler paths. Exact-trace fuzz went from 7/1000 to **1000/1000**. Adds async, stores, lists, universal renderer, tracker. |
| `solid-model` (on fork; consolidated 11-08 to 11-11) | Everything: tiers 2a-2c, boundaries, SSR (slice 5), frames (slice 6), eval. Gate: `cargo test` 175, frontend `verify:subset` 149/149. 1000-seed fuzz results: slice1 1000/1000, 2b 1000/1000, 2c 999, render 993, boundaries 985 (15 are reference hangs), plan 861 agree with 0 divergent, eval 869, SSR 869 with 0 HTML or hydration failures, frames 454 agree / 31 divergent (suspected Solid issues 8-11). |
| `handoff/rust-solid-bench-base` | solid-model plus only the bench driver, for "before" numbers. |
| `handoff/rust-solid-perf-r1` (11-15) | 48 workloads plus 5 composition workloads. Found one real mismatch (a store list filter) and fixed it. Fixed slow-over-time leaks. Rows share their steps. |
| `…-r2-node-table` | Freed node slots are reused. A node shrinks from 760 to 408 bytes. A `--cfg node_check` build caught 4 use-after-free paths, all fixed. |
| `…-r3-allocation` (11-17) | Function values own their bodies, flat templates, interned host strings, an app→host Rc cycle broken. Adds `rust-solid/perf/{HANDOFF,PERF}.md`. |
| `handoff/rust-solid-perf-compose` | `plan-v2-composition` (v2.3) plus all rounds plus the React Compiler frontend prototype. |
| worktrees `pin-main`, `pin-main-rust-engine`, `pin-main-rust-render` (11-23/24, local) | Moving solid-model from RX `fdbcad92` + Solid rc.21 to **RX `e650b85` + Solid main `30e7805e`**. pin-main moves the JS legs (done, documented in `frontend/docs/PIN-MAIN-FRONTEND.md`). rust-engine ports truth, guesses, lanes, scheduler and verdict to main's two-value guess model; `--slice1` is 1000/1000 against main, store hooks are still pending, and there are uncommitted edits. rust-render ports events, numeric text, Show lowering and SSR bootstrap; frames are re-recorded with R = N again. |

**Perf findings** (r3, `perf/PERF.md`; instructions under callgrind are the main number, wall clock is from a noisy cloud VM; Solid JS is the same workload in Node):

| workload | rust-solid (wall) | Solid JS (wall) |
|---|---|---|
| jfb-run (1k rows) | 4.9 ms | 23.6 ms |
| jfb-runlots | 94 ms | 253 ms |
| select-100k | 53 ms | 94 ms |
| mount | 3.6 ms | 6.6 ms |

- Instructions dropped 6.1% across the suite in r3 (mount −28%, jfb-run −20%). From base to r1 the cuts were up to −93% on pathological cases (scalars, nested-flow).
- Round 1 was already faster than Solid JS on 44 of 48 workloads by wall clock, often 2 to 4×.
- Peak memory went down on every workload. Long-running memory is flat.
- Against "Exact" (another Rust framework, js-framework-benchmark keyed): rust-solid wins most jfb ops by wall and by Ir. Exact wins mount (2.3 ms vs 3.6 ms).
- Every round kept every fuzzer at the baseline, with identical final frames and host op traces.

Caveats from the handoff:
- Frames tests were not rerun in the perf rounds (no Chromium there).
- diamond and fanin are 4 to 11% slower by wall in r3 with flat Ir (code layout).
- Transaction, flight and set tables still only grow.
- Plan v2 has no "append" step.
- **No PR is open.**

The open decision is round 4: recompute fast path (recommended), mount, host frees, or stop.

**State at the new pin** (PIN-MAIN-FRONTEND.md): JS legs are clean, but **15 of 149 suite tests fail on the Rust leg only**, and every accepted plan, eval and SSR fuzz seed currently differs on Rust until the two Rust branches land. A new upstream class, `UPSTREAM_RX_SHOW` (55 of 100 plan-fuzz seeds), comes from `ref/compile/emit.ts` writing RX `if` as `<Show>` with a block-bodied child. Solid's new ternary lowering never applies to that shape, so compiled RX differs from native prod Solid on construction order. That is a finding about **main's emitter**, not about rust-solid, and it applies to `compiler/emit.rs` too.

**What it means for the RX roadmap:**
1. RX already serves as the checker and IR for *other* Solid syntaxes (TSX, yield), and PR #21 demos the TSX frontend. That opens a "checked Solid TSX" product path beside the `.rx` language.
2. A conformance-grade Rust Solid runtime exists, with SSR. It enables native or embedded hosts, server rendering without Node, and perf headroom of about 2 to 5× on list-heavy work.
3. It is a fork-side research line pinned by hand. Nothing in main consumes plans. Merging it upstream needs a decision on where "Solid model" lives (RX repo, Solid repo, or its own).

## 5. Open PRs and issues, grouped

**Merge-ready bug fixes (small):**
- #91 parser hang on an unclosed block.
- #95 Vite reusing a failed build (fixes #84).

**Compiler correctness bugs (no PR yet):**
- #73: `"\n"` becomes `"n"` in string literals. A silent miscompile. Top priority.
- #74: a JS import named like a prelude fn (`fetch`, `map`, …) binds to `__B.<name>`. Silent.
- #78: a type-only import from JS becomes a value import, so the bundle fails with `MISSING_EXPORT`. Needs `import type` elision. TY-4 touches this.
- #79: `ref={eq.f}` is an untracked memo read in setup, so Solid dev warns `STRICT_READ_UNTRACKED`.
- #80: `__rt.reg` (a CP-4c harness-only helper) is emitted in app builds, and the registry grows on every mount. Gate it behind a conformance flag.

**Semantics questions surfaced by users building a component library (spec, not tooling):**
- #75: object provision couples its fields.
- #76: an unread equation over two sources makes a write wait on an action (E-3 vs `createMemo`).
- #77: guide gap on the same "what waits" behaviour.
- #37: O-4a.
All of these concern hold scope versus Solid's transition entanglement. Route them to the semantics slice.

**Ecosystem and interop features:**
- #69 MO-11: components declared in `.d.rx` and router factories. Unblocks `@solidjs/router` 2.0 and the routed template. Large, +1.3k.
- #83: bare `.rx` specifiers through node_modules, so libraries can ship `.rx` source. The natural next step after MO-10c.
- #81: StyleX and other compile-time CSS can't see `.rx`. Two causes: a pre-plugin ordering problem, and top-level bindings living inside the module factory (MO-1b). This one is architectural.
- #82: a TypeScript 7.1 content mapper. TS 7 (Go) and tsrs have no Volar-style plugin API, so the Volar LS and rx-tsc are a dead end there. The mapper can reuse `project.rs` mappings directly.

**DX:**
- #68: HMR for dependency components. Stacked on #66, needs solid-vite-plugin#539, adds `runtime/hot`.
- #70: playground.
- #92: Zed.
- #72: site cosmetics.

**Research / eval:** #94 eval rerun at the new Solid pin, and #21 (TSX frontend demo, not for merge).

## 6. Logical next steps (ordered)

1. **Re-sync the Solid pin in the crate.** Bump `solidjs-compiler` to `ref/SOLID_NEXT` (and Oxc if Solid's moved). Run `crate -- --lower`, `--project` and `RX_CRATE=1` runners. Add a CI check that fails when Cargo's rev ≠ `SOLID_NEXT`. Decide whether RX `if` should lower to a shape Solid's ternary rewrite accepts (the `UPSTREAM_RX_SHOW` finding), in ref first and then the crate.
2. **Fix the silent miscompiles:** #73, #74, #78, #80, #79. Each lands in ref first with a scenario, then the crate. Merge #91 and #95. Cut **0.4.0** with the breaking `CATCH_NOT_ON_AWAIT`.
3. **Release hygiene:**
   - Switch Marketplace publishing to the Entra OIDC identity before 2026-12-01.
   - Fix the site install line (no `@next`; solid-js 2.0.x; vite-plugin ≥ the version with `.rx` built in).
   - Bump runtime peers to `^2.0.0`.
   - Run `compiler/test/vite.mjs` in CI once the vite plugin is on npm.
4. **Unblock real apps:** MO-11 (#69) plus the routed template. Node_modules `.rx` resolution (#83). Runtime server `stream(request)` and a request-scoped app for dev SSR. HMR (#68).
5. **Editor reach:** merge Zed (#92), publish tree-sitter-rx (npm and crates), then prototype a TS 7.1 content mapper (#82) as the long-term replacement for the Volar dependency.
6. **Playground** (#70) on reactivescript.dev, with "see the Solid primitives" as the teaching hook. It shares the wasm build with the LS.
7. **rust-solid:** finish the pin-main Rust branches (store hooks; bring the 15 Rust-leg failures to 0; re-record baselines). Then choose: round-4 perf (recompute fast path), or write up the conformance-suite thesis and decide where plans and rust-solid live upstream.

## Open threads

- Is the Cargo `solidjs-compiler` rc.21 pin vs `SOLID_NEXT` main drift intentional (waiting on an Oxc bump?) or an oversight? Is `crate --lower` green today?
- Should RX `if` lowering change so Solid's prod `<Show>`→ternary rewrite applies (UPSTREAM_RX_SHOW)? Otherwise compiled `.rx` differs from hand-written Solid in construction order and hydration-key layout.
- Who owns the `release` environment, and has the Entra/OIDC Marketplace identity been set up before the 12-01 PAT retirement?
- Is `__rt.reg` (#80) needed outside conformance runs? A flag or separate build of the emitter would also shrink output.
- StyleX (#81) collides with MO-1b's "a dependency is a factory over the app". Is a top-level static-binding escape hatch (hoisted out of the factory) acceptable in the spec?
- Long-term LS strategy: Volar plus TS 6 JS API, or a TS 7.1 content mapper (#82)? Both can be fed from `project.rs`.
- Where does the "Solid model" (plans, TSX/yield frontends, rust-solid) live if it graduates: this repo, solidjs/solid, or a new repo? Today it has no shared history with main and rides on Dev's fork only.
- Is rust-solid meant to become an RX *target* (rxc → plan → native host), or does it stay a conformance and perf research artifact? Nothing on main produces plans yet.
- The upstream `ssr` runner fail at e650b85 ("Frames hydrated late … 404") is uninvestigated. Is it a real regression or a machine quirk?
- Semantics issues #75, #76, #77 are what external users hit first. Should they gate 0.4.0 alongside the tooling fixes?

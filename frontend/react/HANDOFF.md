# Handoff: React frontend and its fallback ladder

Branch `rc-ladder` (also `handoff/rc-ladder`). It has three commits on top of `solid-model` f5418ad:

1. `feat(frontend): React Compiler as a fourth frontend (prototype)`: `.react.tsx` becomes a plan v2, using React Compiler's errors and IR.
2. `test(frontend): count batched transitions as intended in the React fuzz`.
3. `feat(react): fallback ladder for refused React components`.

A fourth commit adds this file. For the repo-wide setup and the rules every agent follows, read `docs/HANDOFF.md` first. This file covers only `frontend/react/` and the island runtime.

## Goal

Take ordinary React 19 components (`.react.tsx`) and run them on Solid 2 through plan v2, with the same frames React shows.

The first commit accepted only what lowers exactly. Everything else got a typed refusal, which covered most real code.

The ladder turns refusals into slower acceptance, falling back from level to level, the way React Compiler bails out but still runs a component:

| Level | Plan | What it takes |
| --- | --- | --- |
| precise | pure plan v2 | what the first commit already lowered |
| snapshot | pure plan v2 | A read after the handler's own write sees the render's value; RX rule W-4 gives the same, so the checker's STALE_OWN_READ is accepted for plain handlers. Updaters and ref writes are composed onto the pending write. An inline action that writes before its await, or reads state after it, is hoisted to a declared action whose post-await reads are snapshotted at the click. |
| coarse | pure plan v2 | A render `let` reassigned by ifs is folded into one derived value. A state never read is dropped. A lazy or computed initial state is folded into its seed. A `useRef` that only handlers touch becomes a signal. `useContext` with no provider becomes the context's default value. |
| island | one marked node holding JS | A component still refused is compiled with Babel and kept whole as `{kind:'island', component, module, imports, reasons}`. |
| refuse | none | what is left |

Three design rules hold throughout:

1. A plan with no island is pure data, exactly as before.
2. An island is explicitly marked in the plan.
3. A runner with no JS host refuses it. rust-solid's `validate` and `App::mount` return an error starting with `NEEDS_JS_HOST`.

Not every refusal can become an island. These never do:

- React Compiler's own rules-of-React errors;
- "not a component";
- an entry component that takes props;
- async transitions and `useOptimistic`, because React's own scheduling of pending work isn't in the shim.

`ladderOf(set)` reports one entry per fallback, with these fields:

- `level`;
- `replaces`: the refusal code it replaced;
- `line`;
- `detail`;
- `by`: `"rc"` when React Compiler's IR decided it (unread values, placed lets, a ref the render never touches), `"frontend"` when the frontend's own syntax check decided it.

## Where the code is

- `frontend/react/lower.ts`: the lowering, the precise, snapshot and coarse levels, `ladderOf` and `reactPlan`.
  - `loadReactModules` falls back to an island when the entry is refused.
  - `reactPlan` returns the island plan or the normal plan.
- `frontend/react/island.ts`: decides whether a refusal can be an island (`islandFor`) and compiles the module. Imports from `react` must be shimmed hooks. Any other import must be a function declared in the module's `.d.rx`, and becomes a host.
- `frontend/plan/island.ts`: the hook shim, run inside the JS plan runner.
  - Each island has one Solid signal. A state change bumps it, and the whole island re-renders as a component tree.
  - The output is reconciled by key into the renderer's nodes.
  - Effects run after the commit, children first, comparing deps.
  - A component that sets its own state during render re-runs, up to 25 times.
  - Contexts use a provider stack.
  - `startTransition` is synchronous only.
- `frontend/plan/solid-plan.ts`: mounts a `kind:'island'` view through the shim. `tsx/test-renderer.ts` gained `removeNode`.
- `frontend/plan/emit.ts`: `.react.tsx` goes through `reactPlan`.
- `rust-solid/crates/runtime/src/plan_v2.rs`: `View::Island`, `islands(plan)` and the `NEEDS_JS_HOST` refusal. `ssr/plan.rs` has a matching arm. The test is `rust-solid/crates/runtime/tests/island.rs`.
- `frontend/react/fuzz.ts`: the differential fuzzer. `generate(seed, ladder)` makes a program, and `compare(source, scenario)` runs it on:
  - React 19 with React Compiler;
  - React 19 without React Compiler;
  - the plan in the JS runner.
- `frontend/react/react.test.ts`: the specs. There is one row per refusal and one row per ladder form; each ladder row asserts the level, then that `compare` agrees with React.

## Two behaviours to know before changing anything

**Batching is intended.** React batches every transition and holds all of them until every pending one finishes. Solid merges transitions only when they overlap. The fuzz labels a first difference that happens when a request settles while another is open as `batched`, not as a difference. This was decided on purpose, so don't "fix" it.

**A plain write that an action also writes stays refused.** If an action is pending (it holds a write or awaits) and writes state `x`, and a plain handler also writes `x`, React commits the plain write at once but Solid holds it until the action settles. The third commit widened `REACT_HELD_PLAIN_WRITE` to cover this. It was a soundness hole in the first commit, found by ladder seed 183. About 7 base programs that the first commit accepted are now refused on purpose.

## What was tested

Run from `frontend/`, after `scripts/setup.sh`, with Node 24 (`nix shell nixpkgs#nodejs_24 -c ...`). React and Babel are in `frontend/react/package.json`; run `npm ci` in `frontend/react/` once.

```sh
node --experimental-strip-types --conditions=browser --conditions=development --test react/react.test.ts
node --experimental-strip-types --conditions=browser --conditions=development react/fuzz.ts 1 200           # base family
node --experimental-strip-types --conditions=browser --conditions=development react/fuzz.ts 1 200 --ladder  # ladder family
cd ../rust-solid && cargo test
```

The fuzz takes about 2 minutes per family.

- **`react/react.test.ts`:** 36 pass, including the first commit's 22.
- **Fuzz, seeds 1..200:** checked frame by frame against React 19, with and without React Compiler. 0 differences in either family.

  | Family | Before the ladder | After |
  | --- | --- | --- |
  | base | 77 agree, 3 batched, 120 refused | 132 agree (70 precise, 62 snapshot), 3 batched, 65 refused |
  | ladder (effects, refs, contexts, custom hooks, child components, lets, lazy state, `&&` on numbers) | 4 agree, 196 refused | 112 agree (3 precise, 8 snapshot, 40 coarse, 61 island), 3 batched, 85 refused |

  What stays refused:
  - base: `REACT_HELD_PLAIN_WRITE` 46, `REACT_OPTIMISTIC_BASE_WRITE` 19;
  - ladder: `REACT_SYNTAX` 37, `REACT_EFFECT` 14 and `REACT_FALSY_RENDER` 7 (each would be an island but has an async transition), `REACT_HELD_PLAIN_WRITE` 17, `REACT_OPTIMISTIC_BASE_WRITE` 10.
- **Fallback entries by who decided them, both families:**
  - snapshot: 116, all by the frontend;
  - coarse: 39 by React Compiler's IR, 29 by the frontend;
  - island: 61, all by the frontend.
- **`cargo test` in `rust-solid`:** passes, including `tests/island.rs`.
- **Full frontend suite (`npm test`):** 125 pass. The 25 failures are all the browser legs of `plan/frames.test.ts` and `slices/tracker-frames.test.ts`. Those legs need `chromium`, which the sandbox didn't have. The two files then hung until the run's time limit. They don't touch the React frontend, but they have **not** been run with this branch.

What was **not** tested:

- the Rust `plan-trace` leg on the snapshot and coarse plans (only the JS plan runner);
- island render cost on anything larger than the fuzz programs;
- real-world code. A separate survey of t3code's web app (1,641 components) gives:
  - snapshot and coarse: 0 components, because props (1,435), child components (1,324), custom hooks (498) and library hooks (151) block them;
  - island, as built: 0 components, because an island must be the entry file's default export with no props and import only hosts;
  - island, upper bound: 10 components.

### Island cost

Average plan size per accepted program:

| Level | Plan JSON |
| --- | --- |
| precise | 1.8 KB |
| snapshot | 1.9 KB |
| coarse | 2.3 KB |
| island | 1.3 KB (about 1 KB of it is the compiled module) |

An island is smaller but opaque: Rust, SSR and the checker can't see into it. At runtime, every change re-renders the whole island with no React Compiler memo cache.

## Gaps

- React's async scheduling is still refused: `REACT_URGENT_WRITE`, `REACT_OPTIMISTIC_BASE_WRITE`, `REACT_HELD_PLAIN_WRITE`, and islands with async transitions or `useOptimistic`.
- Effects only run in islands. Plan v2 has no effect node.
- Custom hooks are not inlined. They become islands.
- Library hooks are still refused.
- The coarse level uses React Compiler's scope deps and mutation and aliasing facts only as a gate, not to shape memos.
- Islands need a JS host. rust-solid only refuses them.

## Open decisions (waiting on Dev)

1. **Rebase onto plan v2 composition.** The `plan-v2-composition` branch adds attributes, props, child components and a top-level `components` list (plan v2.3, opt-in with `compose`). It sits on the first commit here and changes the same files:
   - `plan/types.ts`, `plan/resolve-v2.ts`, `plan/solid-plan.ts`;
   - `react/lower.ts`;
   - `plan_v2.rs`, `ssr/plan.rs`.

   **Recommendation:** rebase this branch onto it before any new ladder work. The island view becomes one more `View` variant beside `component`. Expect conflicts in `lower.ts` and the plan runners, but not in the semantics.
2. **What the ladder takes on next.** The options are:
   - **multi-module islands:** bundle a subtree with its local imports and pass props in;
   - **async in islands:** model React's own transition scheduling in the shim;
   - **an effect node in plan v2:** effects as data, so effect programs stay off islands and Rust can run them.

   Before composition, only multi-module islands moved t3code. **Recommendation:** after the rebase, rerun the t3code survey with composition and the ladder together, then pick. Composition should take most of the props and child-component blockers. That leaves custom and library hooks, which multi-module islands cover. If effects turn out to block many components, the effect node is next.

## Next steps

1. Rebase onto `plan-v2-composition`. Then rerun `react/react.test.ts`, both fuzz families and `cargo test`.
2. Rerun the t3code survey over composition plus the ladder, and record per-level counts.
3. Build whichever next level Dev picks.
4. Run the full frontend suite where Chromium is available, so the Frames tests run against this branch.

# Handoff: React Compiler as a ReactiveScript frontend

Branch `handoff/rc-frontend` (same commits as `rc-frontend`), three commits plus this file on top of `solid-model`
f5418ad. Read `docs/HANDOFF.md` first for the Solid model, plan v2 and the fuzzers this builds on.

## Goal
Let a React 19 component be written as-is and lowered onto ReactiveScript's RX AST, then to plan v2, the same plan the
TSX, `.rx` and yield frontends produce. A component is accepted only when it behaves exactly like it does on React 19.
Anything else gets a typed refusal that says why. React Compiler (`babel-plugin-react-compiler` 1.0.0) is used as the
front end: its diagnostics decide what is safe and its IR names the values the lowering places.

## What is here
| file | what it does |
|---|---|
| `react/lower.ts` | `lowerReact(source, file)`: `.react.tsx` -> RX AST, or throws `ReactRefusal` with a `RefusalCode`. Also `compilerFacts`, `loadReactModules`. |
| `react/run-react.ts` | `runReact(path, scenario, opts)`: renders a component on React 19 (with or without React Compiler) through a slice scenario and records frames. `prune` drops steps React can't take; `pending` records open requests per step. |
| `react/fuzz.ts` | React-vs-plan differential fuzzer. Each seed generates a component, lowers it, and compares React frames (compiled and not) with the plan leg (`plan/solid-plan.ts`). Outcomes: agree, refused, batched, disagree. Each seed runs in a child process. |
| `react/react.test.ts` | 22 `node:test` specs: plan equality, React frames, 16 refusal specs, fuzz seeds 1..12, batched seed 63. |
| `react/survey.ts`, `survey-report.ts`, `survey-extra.ts` | Run the frontend over every component of a real React app and map each blocker to a rung of the fallback ladder. Measurement only. |
| `slices/like/like.react.tsx`, `slices/tracker/tracker.react.tsx` | React twins of the like and tracker slices. |
| `plan/emit.ts` | Now accepts `.react.tsx`. |

`react/` has its own `package.json` and `node_modules` so React's pins don't move the frontend package.

### What the lowering accepts
Scalar and object `useState`, derived values in render, synchronous `onClick` handlers, `useOptimistic` with plain
setters, async actions inside `startTransition`, immutable spread updates of a list row (lowered to a path write; the
row id must be a view key), plain updaters `x => f(x)` (lowered to `x := f(x)`, since plan v2 has no functional plain
writes), boolean holes in JSX (render nothing, as React does).

### Refusal codes
`REACT_COMPILER` (React Compiler bailed out), `REACT_NOT_COMPONENT`, `REACT_UNDECIDED` (a value the compiler IR does not
place, e.g. `let` in render or an unused state the compiler drops), `REACT_EFFECT`, `REACT_HOOK` (any other hook),
`REACT_SET_STATE_IN_RENDER`, `REACT_STALE_READ` (render value read after an await), `REACT_URGENT_WRITE` (setState after
an await outside a transition), `REACT_OPTIMISTIC_BASE_WRITE`, `REACT_OPTIMISTIC_OUTSIDE_ACTION`, `REACT_FALSY_RENDER`
(non-boolean `&&` in JSX), `REACT_LAZY_STATE`, `REACT_PROPS` (entry component takes props), `REACT_SYNTAX` (anything
plan v2 can't express, mostly attributes other than parameterless event handlers). The RX checker adds
`STALE_OWN_READ` (read after own write in a handler) and `HELD_WRITE` (write before an await in an inline action).

## React 19 vs Solid 2 (native Solid and the plan agree in every case)
1. **Batching, intended.** React holds every transition until all pending ones finish; Solid merges transitions only
   when they overlap. Dev (Nov 14): "a feature not a bug", a strict upgrade for React apps. The fuzzer counts a first
   difference at a request settling while another is open as `batched`, not as a difference.
2. **A plain write to a `useOptimistic` base while an action is pending.** React commits it at once and rebases the
   optimistic updates on it. Solid shows the first such write, then entangles the state with the action, so the next
   write waits until the action ends (it is held, not lost) and the optimistic value is not rebased. It is the same
   merging, but a plain click waiting on a request is something a React app would notice, so
   `REACT_OPTIMISTIC_BASE_WRITE` refuses it.

## What was tested
- `like.react.tsx` and `tracker.react.tsx` lower to plans byte-identical to `plan/like.plan-v2.json` and
  `plan/tracker.plan.json`.
- React 19 renders the like (5 frames) and tracker (13 frames) scenarios exactly as Solid does, with and without React
  Compiler.
- 22 specs in `react/react.test.ts` pass (re-run Nov 17). `plan.test.ts` and `yield/paired.test.ts` still pass.
- Fuzz seeds 1..200: 77 agree, 120 refused, 3 batched, 0 unexplained differences.
- t3code survey (`apps/web/src` at 3dc54f43): 1,641 components in 589 files, none accepted today. Details below.

## What was not tested
- The Rust plan leg (rust-solid) was not run on React-produced plans; only the JS plan leg.
- The fuzzer covers only its generator's subset: scalar state, derived values, sync handlers and one optional async
  action with `useOptimistic`. No objects or lists in generated programs, no props, no child components.
- No real app component is accepted, so nothing from a real app has been compared with React.
- The survey's collect-all detectors are syntactic. Stale reads count any render-scope name read after an await,
  including stable ones; custom-hook numbers are an upper bound because their bodies aren't checked.
- Only React 19.2.0, React Compiler 1.0.0 and Solid rc.21 (the `solid-model` pins).

## How to run
Node 24 with type stripping. In this sandbox, prefix commands with `nix shell nixpkgs#nodejs_24 -c`.

```sh
# once, from the repo root: pins, links and frontend deps (see docs/HANDOFF.md), then React's own deps
sh scripts/setup.sh
cd frontend/react && npm ci && cd ..

# tests (from frontend/)
node --experimental-strip-types --conditions=browser --test react/react.test.ts

# fuzz seeds FIRST..LAST
node --experimental-strip-types --conditions=browser react/fuzz.ts 1 200

# emit a plan for a React component
node --experimental-strip-types --conditions=browser plan/emit.ts --schema 2 slices/like/like.react.tsx

# survey a React app's components
node --experimental-strip-types --conditions=browser react/survey.ts /path/to/app/src components.json
node --experimental-strip-types --conditions=browser react/survey-report.ts components.json
node --experimental-strip-types --conditions=browser react/survey-extra.ts components.json
```

## t3code survey results
First refusal today: `REACT_PROPS` 901, `REACT_SYNTAX` 630, `REACT_HOOK` 72, `REACT_COMPILER` 29, `REACT_NOT_COMPONENT` 8,
`REACT_UNDECIDED` 1.

| blocker (collect-all) | components | rung that could accept it |
|---|---|---|
| attributes other than `onClick`/`key` | 98% | gap in plan v2 itself |
| props | 90% | frontend gap |
| child components | 83% | frontend gap |
| custom hooks | 32% | island, or inlining |
| control flow in render | 25% | gap |
| refs | 12% | island |
| library hooks (26 distinct) | 10% | island + shim |
| effects | 10% | island |
| stale read after await | 9% | snapshot |
| setState after await outside a transition | 7% | island |

- With frontend and plan gaps filled: precise 1%, + snapshot 1%, + coarse 1%, + islands 100%.
- Props and child components alone would unlock 55%; with in-repo custom hooks inlined, up to 71%.
- 29% need a real island (effects, refs, context, `use()`, library hooks, compiler bailouts).
- All 29 compiler bailouts are React Compiler's own unsupported syntax (e.g. value blocks inside try/catch), not rule
  breaks.

## Open decisions for Dev
1. **What to build next.** My recommendation: **props and child components in this frontend**, since that is the single
   biggest unlock (55% of t3code) and needs no new semantics. Plan v2 composition (attributes, props, child components)
   is being built separately (local branch `plan-v2-composition`, not pushed yet); this frontend should target it once
   it lands. Alternatives: inline
   in-repo custom hooks (up to 71%), or start marking islands.
2. **Keep `REACT_OPTIMISTIC_BASE_WRITE`?** My recommendation: keep refusing until there is a way to make a plain write
   to an optimistic base not wait on the action. Accepting it would let a plain click visibly lag behind a request.
3. **Upstream or not.** This is a prototype on Dev's fork. Nothing here has gone to `solidjs/reactivescript`. My
   recommendation: wait until real components are accepted before proposing it upstream.

## Next steps
1. Lower props and child components onto plan v2 composition (`plan-v2-composition`), then rerun the t3code
   survey to measure the real unlock.
2. Lower attributes other than event handlers once plan v2 supports them.
3. Extend the fuzz generator to objects, lists, props and child components as each lands.
4. Run React-produced plans through the Rust plan leg (rust-solid) as well as the JS one.
5. Read-after-write in handlers and held writes in inline actions could be lowered (by snapshotting reads and by
   declaring the action) instead of refused.
6. The fallback ladder (snapshot, coarse memo, islands) is prototyped separately on local branch `rc-ladder`, which
   builds on this one and is not pushed yet.

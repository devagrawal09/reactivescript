# Handoff: plan v2.3 composition and the React Compiler frontend

Updated 2026-11-17. Everything here is on branch `handoff/plan-v2-composition`, which is also pushed as `plan-v2-composition`, of `devagrawal09/reactivescript`. Both branches sit on `solid-model` at f5418ad. Read `docs/HANDOFF.md` first for the Solid model as a whole (thesis, frontends, rust-solid, how the work is checked). This file covers only the four commits on top.

## Goal

Real React components (t3code's web app is the test bed) should lower to plan v2 and run identically on native Solid 2, the JS plan runtime and rust-solid. Two steps get there:

1. **React Compiler as a fourth frontend.** React source goes through React Compiler, which acts as a gate. Its rule errors refuse a component, and its "placed" names decide which values are reactive. The source is then lowered by syntax onto the RX AST, so it reaches the same checker and plan as TSX and `.rx`.
2. **Plan v2.3, composition.** Plan v2 could not express element attributes, props or child components, so no real component lowered. v2.3 adds them as pure data.

The Solid-model constraints still hold:

- Plans stay pure data.
- Every plan node runs in both the JS runtime and rust-solid, or fails in Rust with a typed error.
- A program is accepted only where it behaves exactly like native Solid 2.

## Commits

| Commit | What it does |
| --- | --- |
| `feat(frontend): React Compiler as a fourth frontend (prototype)` | `frontend/react/`: lowering, the React 19 runner, the differential fuzz and the tests. |
| `test(frontend): count batched transitions as intended in the React fuzz` | React batches every transition and Solid merges only overlapping ones. The differences this causes are classed as intended, not divergent. |
| `chore(frontend): survey the React frontend over an app's components` | `frontend/react/survey*.ts`: runs the frontend over every component of an app and counts what blocks it. |
| `feat(plan): v2.3 composition (attributes, components, props, children)` | Schema, builder, JS runtime, rust-solid, the three frontends, tests, fuzz and survey. |

## What plan v2.3 adds

The full spec is in `frontend/plan/docs/PLAN-V2.md`, under "v2.3: composition".

- **Version.** `version` is 2.3 exactly when a v2.3 form occurs. v2.1 forms are allowed inside a 2.3 plan. A plan with no v2.3 form is byte-identical to before.
- **Element attributes.** `attrs: [{name, value} | {name, steps}]`, in source order. An element with attrs has `events: []`, and its handlers sit among the attrs. An element with handlers only keeps v2's `events`.
- **Component site.** `{kind:'component', name, props: PropArg[], children?: View[]}`. A PropArg is one of:
  - `{name, value}`, a value prop;
  - `{name, handler:{params, steps}}`, a callback;
  - `{name, action}`, an action passed by name;
  - `{name, forward}`, a function prop passed on.
- **Inside a component.**
  - `{kind:'children'}` is a view.
  - `{op:'prop', name}` reads a prop.
  - `{op:'call', prop, args}` is a step that calls a function prop.
- **Top-level components.**
  - Shape: `components: [{name, props:[{name, kind:'value'|'function'|'children'}], sources, memos, actions, markup}]`.
  - The list holds only components the entry reaches, in declaration order.
  - It is omitted when empty, because Rust refuses an empty list.
- **Opt-in.** A `compose` option on `resolvePlanV2`, `loadTsxModules` and the React frontend.

Semantics follow Solid 2's universal compiler:

- Static attributes are set at creation, then each element gets one effect for its dynamic attributes.
- A value prop is a getter over the site's expression, so a component reads it reactively and never copies it.

Where each piece lives:

- **Builder:** `frontend/plan/resolve-v2.ts`.
- **Types:** `frontend/plan/types.ts`.
- **JS runtime:** `frontend/plan/solid-plan.ts`.
- **Rust runtime:** `rust-solid/crates/runtime/src/plan_v2.rs`.
- **Rust server renderer:** `rust-solid/crates/runtime/src/ssr/plan.rs`. It refuses v2.3 with "plan v2.3 (composition) is not ported to the server renderer".
- **Frontends:** `frontend/tsx/{lower,modules,subset}.ts` and `frontend/react/lower.ts`.

Refusals:

- **The builder** refuses:
  - recursive components;
  - a site that omits a prop the component reads;
  - (without `compose`) a second component.
- **Rust's `validate`** refuses:
  - a version mismatch;
  - a read of an undeclared prop;
  - a call of a prop that is not a function;
  - an unknown component;
  - children in a component that does not read them.

## The React frontend

The frontend only lowers what it can prove behaves the same on React 19 and Solid 2.

- **Gate.** React Compiler's rule errors refuse a component. Its scope placement decides what is reactive. Unused derived consts come out undecided and are refused (`REACT_UNDECIDED`).
- **Accepted:**
  - `useState`, `useMemo` and `useCallback`;
  - handlers and actions;
  - `&&` and ternaries that render;
  - `.map` over arrays;
  - the module's own components with props and children;
  - DOM attribute names mapped to their HTML names (`className` to `class`, `tabIndex` to `tabindex`, and so on).
- **Refused** with typed codes:
  - `REACT_COMPONENT_IMPORTED` (library or cross-module components);
  - `REACT_SYNTAX` (style objects, a setter passed as a callback, rest and spread props, prop defaults, imports from non-`.d.rx` modules);
  - `REACT_HOOK`;
  - `REACT_COMPILER`;
  - `REACT_LAZY_STATE`;
  - snapshot cases (`STALE_OWN_READ`, `OPTIMISTIC_BASE_WRITE`, `HELD_WRITE`).
- **Batching.** React batches every transition, while Solid merges only overlapping ones. Dev calls this a feature, not a bug. The fuzz counts it as "batched", not divergent.

## What was tested

| Check | Result |
| --- | --- |
| Composition plan fuzz, seeds 1..300, native Solid vs JS plan vs rust-solid | 149 agree, 151 upstream (compiled RX differs on components: `UPSTREAM_RX_COMPOSE`), 0 divergent, 0 refused |
| React composition fuzz, seeds 1..200 | 200 agree. The React plan equals the TSX twin's plan, and frames equal React 19 with the compiler on and off |
| React fuzz (no composition), seeds 1..200 | 77 agree, 120 refused (74 stale own read, 19 optimistic base write, 27 held write), 3 batched. Unchanged by v2.3 |
| Frontend suite without the frames tests | 163 tests, 160 pass, 0 fail, 3 skipped (they need the Rust env below, and pass with it) |
| New spec tests | `plan/compose.test.ts` (9), `plan/plan-fuzz.test.ts` (+2), `react/react.test.ts` (+10), `rust-solid/.../tests/plan_v23.rs` (9) |
| `cargo test` (rust-solid) | all pass |
| Type check | 0 package diagnostics, 12 upstream (same as the solid-model baseline) |

**Not tested:**

- **Chromium frames tests.** `plan/frames.test.ts` pins (PL) need Chromium, which was not installed. The additivity, refusal and TSX-boundary tests in that file pass.
- **Plan v2.2 frames builder.** It was not changed and not unified with v2.3, so a Frames program that uses composition is not covered.
- **Rust server renderer.** It refuses v2.3, so SSR of composed plans is untested by design.
- **Real apps.** Only the survey (below) ran over a real app. No t3code component has been run end to end in a browser.

## How to run

Node 24 with strip-types. The sandbox used `nix shell nixpkgs#nodejs_24 -c ...`. Set up the frontend once with `sh scripts/setup.sh`, which builds the pinned Solid and the compiler.

```sh
cd frontend
# whole suite (frames tests need Chromium)
npm test
# composition tests only
node --experimental-strip-types --no-warnings --conditions=browser --test plan/compose.test.ts react/react.test.ts
# plan fuzz, composition family, with the Rust leg
(cd ../rust-solid && cargo build --bin plan-trace --bin scenario)
node --experimental-strip-types --no-warnings --conditions=browser scripts/plan-fuzz.ts 1 300 --compose
# React fuzz: composition family, then the plain one
node --experimental-strip-types --no-warnings --conditions=browser react/fuzz.ts 1 200 --compose
node --experimental-strip-types --no-warnings --conditions=browser react/fuzz.ts 1 200
# type check
npm run check
```

Notes on the commands:

- **Rust-env tests.** Set `RUST_SCENARIO=<repo>/rust-solid/target/debug/scenario`, `RUST_PLAN_V2=1` and `RUST_PLAN_TRACE` for the plan-fuzz tests.
- **Stale trace binary.** Rebuild the debug `plan-trace` binary before fuzzing. A stale one fails with "unknown field attrs".
- **Survey.** Run `react/survey.ts` over a checkout of t3code's `apps/web/src`, then `react/survey-report.ts` on its JSON.

## t3code survey

`apps/web/src` at 3dc54f43 has 1,641 components in 589 files.

- **Accepted:** 26 (0 before v2.3).
- **Blocked only by forms v2.3 does not lower:** 612 (37%). These are imported components, prop patterns, spreads, object attributes and event arguments.
- **With every frontend gap filled:** 876 (53%) would have no semantic blocker. The rest need snapshot, coarse or island tiers from the fallback ladder.

First refusals today:

| Refusal | Components |
| --- | --- |
| Imports from non-`.d.rx` modules ("hosts are imported by name") | 548 |
| Prop defaults | 133 |
| Non-array builtins | 102 |
| Components from another module | 117 |
| try/catch value blocks in React Compiler | 71 |
| Rest props | 68 |

All blockers, collecting every one each component has:

| Blocker | Components |
| --- | --- |
| Imported component | 1,210 (74%) |
| Custom hook | 520 |
| Attribute spread | 516 |
| Render control | 408 |
| Props pattern | 394 |
| Ref | 256 |

## Open decisions for Dev (with recommendations)

1. **Imports from other modules (values and components).** This is the biggest blocker.
   - **Recommendation:** follow the app's own module graph. Same-app constants and pure functions inline as plan expressions. Same-app components join `components` as if they were local. A library component becomes a marked island node, which Rust refuses with its typed "needs JS host" error.
   - **Why:** this keeps plans pure data and unblocks most of the 548 + 117 without inventing a module system in the plan.
2. **Prop defaults.**
   - **Recommendation:** add an optional `default` expression to `{op:'prop'}`, which is Solid's `mergeProps` default semantics. It is small, and both runtimes can run it.
3. **Rest props and spreads.**
   - **Recommendation:** do rest props first, as a `{name, forward}`-style "pass the rest" PropArg that lists the excluded names, which is Solid's `splitProps`. Host attribute spreads (516 components) come second. They need a dynamic attribute set, which is a larger runtime change in Rust.
4. **v2.2 and v2.3 prop shapes.**
   - v2.2 (Frames) types props as `{name, type}` and v2.3 uses `{name, kind}`.
   - **Recommendation:** unify on v2.3's `kind` plus an optional wire `type`, once Frames needs function props or children.

## Next steps

1. Get Dev's answer on 1–3, then build imports, then prop defaults, then rest props, and rerun the survey after each.
2. Fallback ladder (a separate branch, `rc-ladder`): rebase it on this branch. It also touches `resolve-v2.ts`, `solid-plan.ts`, `plan_v2.rs` and `react/lower.ts`. The schema above is what it must follow.
3. Run the Chromium frames tests where a browser exists.
4. Port v2.3 to the Rust server renderer.

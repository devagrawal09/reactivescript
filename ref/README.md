# ref — reference interpreter

TypeScript. Runs programs in the abstract syntax of `spec/02-core.md §1` and
produces frame sequences; `scenarios/*.md` are its test cases (parsed from the
Program and Frames sections).

Why TypeScript and not OCaml: it runs in the playground later, and it can
import `@solidjs/signals` to diff the interpreter against the real runtime on
the same scenario.

Phases:
1. core: sources, equations, `pre`, `peek`, effects, instants (02-core §4)
2. regions: if/for as scoped sub-programs with disposal (03)
3. holds: the two-version store, probes, lanes, boundaries (05) — diff against
   Solid's own `SCENARIOS.md`

Phase 1 is checked against `scenarios/` only; runtime diffing against
`@solidjs/signals` begins in phase 3, where divergences are expected and
recorded.

Status: phase 3 (holds) running alongside phase 1. `node --experimental-strip-types ref/run.ts [filter]`
runs `scenarios/S-*.md`; S-core-1, S-region-1..6 and S-hold-1..5 and twenty-five ports of Solid's SCENARIOS (S-solid-*) pass
(per-change membership with served reads and joining, loading/errored
boundaries, `on` re-arm, probes/lanes, lane holds, superseded flights).

Findings so far (each is now a rule): demand propagates through cut nodes
(E-3/E-8); `pre` is a delayed input (C-2); dependencies are per object
identity, per key, not per root path (ST-2); cleanups run in the observe
phase (O-2); E-10 is a call-site diagnostic, not a body rejection; rule errors propagate, never become error values.

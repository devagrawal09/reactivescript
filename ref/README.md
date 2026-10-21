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

Not started.

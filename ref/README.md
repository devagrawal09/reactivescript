# ref — reference interpreter

TypeScript. Runs programs in the abstract syntax of `spec/02-core.md §1` and
produces frame sequences; `scenarios/*.md` are its test cases (parsed from the
Program and Frames sections).

Why TypeScript and not OCaml: it runs in the playground later, and it can
import `@solidjs/signals` to diff the interpreter against the real runtime on
the same scenario.

Three runners over the same scenarios (`cd ref && npm install` once):

| runner | what it runs | command |
| --- | --- | --- |
| interpreter | `src/runtime.ts`, the spec's own semantics | `node --experimental-strip-types ref/run.ts` |
| oracle | `oracle/lower.ts`, the program lowered onto Solid by interpretation | `npm --prefix ref run oracle` |
| compiled | `compile/emit.ts`, the program compiled to a JS module over Solid | `npm --prefix ref run compiled` |

Checker: `ref/src/check.ts` (spec/08) runs before the interpreter; a
program with any diagnostic does not run. `node --experimental-strip-types
ref/check.ts [--signature] file.rx…` prints diagnostics for files and the
`.rx` modules they import (spec/09), and with `--signature` each module's
signature.

Phases:
1. core: sources, equations, `pre`, `peek`, effects, instants (02-core §4)
2. regions: if/for as scoped sub-programs with disposal (03)
3. holds: the two-version store, probes, lanes, boundaries (05) — diff against
   Solid's own `SCENARIOS.md`

Runtime diffing against the real Solid 2.0 is `ref/oracle/` (see its README):
the same scenarios lowered onto `solid-js` + `@solidjs/universal`; divergences
are recorded per scenario and listed in `spec/05-holds.md §Divergences`.

Status: phase 3 (holds) plus 06 (`action`, inline `action { }`,
`optimistic`, `refresh`, `affects`, `source x = e`, per-key pending,
`draft`, `key`, streams as repeated landings). `node --experimental-strip-types ref/run.ts [filter]`
runs `scenarios/S-*.md`; S-core-1, S-region-1..6, S-hold-1..5, S-store-1..5, S-surface-1, S-app-todo/users/signup
and thirty-eight ports of Solid's SCENARIOS (S-solid-*) pass — every scenario
not behind portals, two roots, imperative probes, draft/key/yield or S-39
(per-change membership with served reads and joining, loading/errored
boundaries, `on` re-arm, probes/lanes, lane holds, superseded flights,
action holds with revert, guesses with correction and provenance, quiet
re-asks, declared pending). Not modelled yet: `until`, a `yield` body form,
optimistic path writes, revert of held path writes.

Runs (handlers, apply blocks, action bodies) are frame stacks: a
statement-level `await` suspends the run; `try`/`catch`/`finally`/`throw`
unwind the stack (AC-7), and a rejected flight is thrown at its `await`.

Scenario actions: `handler \`stmts\`` (an imperative run; may call an action,
which suspends at a statement-level `await`), `resolve x v` / `reject x e`
(land equation `x`'s flight), `resolve "key" v` (land the flight for a fetch
key — what an action body awaited, or an obsolete flight, which is inert).

Findings so far (each is now a rule): demand propagates through cut nodes
(E-3/E-8); `pre` is a delayed input (C-2); dependencies are per object
identity, per key, not per root path (ST-2); cleanups run in the observe
phase (O-2); E-10 is a call-site diagnostic, not a body rejection; rule errors propagate, never become error values.
From the example apps (`examples/*.rx`, run as S-app-*): a pending `if`/`for`
control reader reaches boundaries like a pending read (the re-armed
`on(query)` boundary showed the table instead of its fallback); a
lane-opened row set attaches now like a lane-opened branch (D-27 for rows);
functional writes apply to guesses too (W-6); and a real bug — the lane
re-settle marked nodes dirty without telling their subscribers, so a later
landing never reached a reader two edges away (signup: `latest` through a
prop into an `if`).
From 06: a second proposal for a held slot joins its hold (D-8, S-solid-34);
a held lane keeps its change staged (S-solid-33 — the landing stays
uncommitted while `related` is pending); a corrected guess freezes its
readers without holding the change (else the lane holds itself forever);
the body's end corrects against the *settled* truth, at the instant, not
at the statement (S-solid-32: `name := n` after the `await` is the truth
the correction must see); `latest x` answers a standing guess (H-11
corrected against S-solid-33/34); on-screen probes in a held lane keep what
they showed (D-25) — Solid's probe columns are untracked reads.

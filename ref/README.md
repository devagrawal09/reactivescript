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

Status: phase 3 (holds) plus 06 (`action`, inline `action { }`,
`optimistic`, `refresh`, `affects`, `source x = e`, per-key pending,
`draft`, `key`, streams as repeated landings). `node --experimental-strip-types ref/run.ts [filter]`
runs `scenarios/S-*.md`; S-core-1, S-region-1..6, S-hold-1..5, S-store-1..5
and thirty-eight ports of Solid's SCENARIOS (S-solid-*) pass — every scenario
not behind portals, two roots, imperative probes, draft/key/yield or S-39
(per-change membership with served reads and joining, loading/errored
boundaries, `on` re-arm, probes/lanes, lane holds, superseded flights,
action holds with revert, guesses with correction and provenance, quiet
re-asks, declared pending). Not modelled yet: `until`, a `yield` body form,
optimistic path writes, revert of held path writes.

Scenario actions: `handler \`stmts\`` (an imperative run; may call an action,
which suspends at a statement-level `await`), `resolve x v` / `reject x e`
(land equation `x`'s flight), `resolve "key" v` (land the flight for a fetch
key — what an action body awaited, or an obsolete flight, which is inert).

Findings so far (each is now a rule): demand propagates through cut nodes
(E-3/E-8); `pre` is a delayed input (C-2); dependencies are per object
identity, per key, not per root path (ST-2); cleanups run in the observe
phase (O-2); E-10 is a call-site diagnostic, not a body rejection; rule errors propagate, never become error values.
From 06: a second proposal for a held slot joins its hold (D-8, S-solid-34);
a held lane keeps its change staged (S-solid-33 — the landing stays
uncommitted while `related` is pending); a corrected guess freezes its
readers without holding the change (else the lane holds itself forever);
the body's end corrects against the *settled* truth, at the instant, not
at the statement (S-solid-32: `name := n` after the `await` is the truth
the correction must see); `latest x` answers a standing guess (H-11
corrected against S-solid-33/34); on-screen probes in a held lane keep what
they showed (D-25) — Solid's probe columns are untracked reads.

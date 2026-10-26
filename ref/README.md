# ref — reference interpreter

TypeScript. Runs programs in the abstract syntax of `spec/02-core.md §1` and
produces frame sequences; `scenarios/*.md` are its test cases (parsed from the
Program and Frames sections).

Why TypeScript and not OCaml: it runs in the playground later, and it can
import `@solidjs/signals` to diff the interpreter against the real runtime on
the same scenario.

Solid comes from its `next` branch, built from source at the commit in
`ref/SOLID_NEXT`: `sh ref/scripts/solid-next.sh` checks it out beside this
repository (`../solid-next`), builds `@solidjs/signals`, `solid-js`,
`@solidjs/web`, `@solidjs/universal` and the native `@solidjs/compiler`
(pnpm and a Rust toolchain), and `ref/package.json` links them
(`--latest` moves the pin to `next`'s HEAD). Views are JSX that
`@solidjs/compiler` lowers (`compile/jsx.ts`): `universal` over a string-tree
renderer for the compiled runner, `ssr` and `dom` (hydratable) for the server
runner.

Five runners over the same scenarios (`cd ref && npm install` once):

| runner | what it runs | command |
| --- | --- | --- |
| interpreter | `src/runtime.ts`, the spec's own semantics | `node --experimental-strip-types ref/run.ts` |
| oracle | `oracle/lower.ts`, the program lowered onto Solid by interpretation | `npm --prefix ref run oracle` |
| compiled | `compile/emit.ts`, the program compiled to a JS module whose views Solid's compiler lowers onto a string tree | `npm --prefix ref run compiled` |
| server | the same compiled modules over `compile/rt-server.ts` (Solid's server build), streamed to Chromium and hydrated there over `compile/rt-web.ts` (spec/10) | `npm --prefix ref run ssr` |
| types | each program projected to TSX (`types/project.ts`) and checked by TypeScript with Solid's JSX types; `-- types: CODE` refusals (spec/13) | `npm --prefix ref run types` |

Checker: `ref/src/check.ts` (spec/08) runs before the interpreter; a
program with any diagnostic does not run. `node --experimental-strip-types
ref/check.ts [--signature] file.rx…` prints diagnostics for files and the
`.rx` modules they import (spec/09), and with `--signature` each module's
signature as `.d.rx` text — the text an importer is checked against when
the module's `.rx` is not there (MO-9, `src/signature.ts`).

Phases:
1. core: sources, equations, `pre`, `peek`, effects, instants (02-core §4)
2. regions: if/for as scoped sub-programs with disposal (03)
3. holds: the two-version store, probes, lanes, boundaries (05) — diff against
   Solid's own `SCENARIOS.md`

Runtime diffing against the real Solid 2.0 is `ref/oracle/` (see its README):
the same scenarios lowered onto `solid-js` + `@solidjs/universal`; divergences
are recorded per scenario and listed in `spec/05-holds.md §Divergences`.

Status (2026-10-26): every scenario in `scenarios/` passes the interpreter
(`node --experimental-strip-types ref/run.ts [filter]`), including a port of
every scenario of Solid's `SCENARIOS.md` (S-solid-*) and the example apps
(S-app-*, S-ai-*, S-ai2-*); the oracle, compiled, server and types runners
pass them too, with the divergences each scenario records (Solid bugs,
`spec/05-holds.md §Divergences`). For a program with modules, the
interpreter's runner also checks each module against its imports' printed
`.d.rx` in place of their bodies (09 MO-9). What is not in `ref/` yet is
named where the spec states the rule ("not in `ref/`", "not lowered yet").

Runs (handlers, apply blocks, action bodies) are frame stacks: a
statement-level `await` (with or without a `catch`, 06 AC-1) suspends the run; `try`/`catch`/`finally`/`throw`
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

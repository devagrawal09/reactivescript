# ai2 — the second AI test: the checker in the loop

Three fresh agents each wrote a multi-module app from `spec/` alone, with
the checker (`ref/check.ts`) as their only tool, then predicted its frames
in a scenario before anything ran (2026-10-24). Each `NOTES.md` is the
agent's own log: every checker run, what it changed, what it found ugly,
what the spec left open.

| app | modules | checker runs | diagnostics hit | frames right (spec / Solid) |
| --- | --- | --- | --- | --- |
| `tracker/` | 4 | 4 | a parse error: `component C()` needed a props name | 12/12 · 12/12 |
| `settings/` | 5 | 3 | `NOT_EXPORTED` ×5: `export type` could not be imported | 12/12 · 12/12 |
| `search/` | 4 | 6 (1 needed) | none in its program; `UNHANDLED_FAILURE` on a deliberate probe | 12/12 · 9/12 (DV-8) |

Every frame the agents predicted was right by the spec. Where the runners
disagreed at first, the runners were wrong:

- **interpreter**: an `if` or `for` over a failing value showed nothing
  instead of reaching its `errored` boundary (tracker 10–11, settings 1–7);
  `peek` in a component mounted by a change read the committed state, so a
  draft seeded from data landing in that change got the failure it replaced
  (settings 3+ — E-5 refined to Solid's reading); a first load that failed
  left `pending?` with no verdict and held the instant (search 1–2).
- **oracle and compiler**: an `await` that is not the equation's result
  (`found(await fetchItem(id), id)`) was not lowered — now each is hoisted to
  its own async node, guarded by the conditions that reach it (E-11); a
  keyed equation over a tail `await` lowered to a projection that could not
  carry the flight.
- **Solid**: a keyed projection stops following its memo after its first
  value — later failures are swallowed and re-asks report no `pending?`.
  Reproduced alone: `ref/oracle/repros/dv8-projection.mjs` (DV-8).

What the agents' notes changed in the language: `component C()` with no
props; `export type` importable; a source holds its initializer's failures;
a failure in an imported component is reported at the reader's file and
line as well as the application's; diagnostics carry the markup's line;
AC-1 says plainly that an action with no `await` is an ordinary instant
(all three asked).

Open, for a ruling:

1. **`errored` has no `on(…)`.** A boundary showing a failure stays on it
   until a value replaces it (D-39), so search wraps its pane in
   `for id in [selected] { … }` to get a fresh boundary per selection.
2. **A failure as a message.** settings writes
   `(valid && "") catch (e: NameRequired | NameTooLong) => e.message` to
   show a validation failure next to its field.
3. **A root catch-all hides a pane's leak.** With `errored fallback(e)` at
   the root, a pane that lets `Error` out still checks (R-f-5 asks only that
   *some* boundary above discharges it); search removed its root boundary to
   keep "a failing detail never affects the list" a compile-time fact, and
   gave up catching panics at the root.
4. Two agents wrote the optimistic value again after the `await` (the truth
   after the guess). That is the model (AC-3); it read as repetition to both.

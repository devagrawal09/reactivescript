# The live evaluator on the Rust consumer (slice 3)

The frontend's `docs/EVAL.md` (../frontend) specifies `eval(code, bindings)` / `createEval(() => code, bindings)`:
code that arrives as a string while the program runs, checked against explicit bindings, and run as a plan v2. This
repository has no frontend, so **the host provides the plans**: `plan-trace PLAN SCENARIO EVALS` (and
`plan_v2::App::mount_with`, `scenario::trace_v2_with`) take the host's eval table, one entry per eval request with the
frontend's compiled plan or its refusal.

## Three readiness levels (kept apart)

- **Recognized:** the schema additions below (`View::Eval`, `Expr::Eval`, an evaluated plan's `bindings` and `value`,
  the table), which `validate` and `validate_table` check before anything is built.
- **Verified:** the frontend's eval slice and eval fuzz (`frontend/slices/eval/`, `eval/fuzz/`): on every program
  the frontend accepted, `plan-trace` gives native Solid's frames and full host log for the static twin, entry for
  entry, as code strings change, subtrees are disposed with requests pending, and bound actions run as the enclosing
  plan's. `crates/runtime/tests/eval.rs` replays the slice and a corpus of fuzz programs (`tests/fixtures/eval/`).
- **Not claimed:** error boundaries (the port has no `Errored`, so a refusal fails the run instead of reaching a
  boundary), `preserve`, server placement.

## What is built (mirrors `frontend/plan/solid-plan.ts`)

| plan | built as |
| --- | --- |
| `{ "kind": "eval", code, bindings, interface, syntax, check }` (an element child) | `insert(el, () => createEval(…), marker)`: a zero-length function; `createEval` is `createComponent(Show, { get when() { code }, keyed: true, children: (src) => createComponent(Compiled(src), {}) })`. The keyed Show disposes the subtree when the string changes. |
| `{ "op": "eval", code, bindings, interface, syntax, check, type }` (a memo's value) | in the memo: the code, then the table plan's `value` over the bindings; a value not of `type` fails the run |
| an evaluated plan's `bindings` | `linked`: a context whose names are the evaluated plan's own plus each binding linked to the enclosing plan's `Binding` (signal, store, optimistic, memo); a bound action runs (and is logged) as the enclosing plan's action; a bound host's requests are the enclosing app's (one numbering per host, per mount) |
| a table entry with `refused` | the run fails with `eval refused: CODE (line N): message; …`, the frontend's `EvalRefused` message |
| a code with no entry | the run fails: `no plan in the host's eval table for "…"` |

The request registry, the first fatal error and the started actions are shared by an app and every plan evaluated in
it (`Rc`). `validate` refuses a write, path write or guess to a binding (`BoundRead`/`BoundStore` are never targets),
a call of an unknown bound action, an eval site in a component position, and a value plan with anything but its
expression; `App::mount_with` refuses to mount an evaluated plan directly.

## Tests (`crates/runtime/tests/eval.rs`, 5)

- the slice and the corpus give the static twin's result and log entry for entry;
- a refused program fails with its refusal;
- the fixtures cover markup and value evals, both code syntaxes, read/store/action/host bindings, a renamed binding
  and a code string that changes;
- a code with no table entry fails explicitly;
- the schema refusals (an evaluated plan mounted directly, a binding written, an eval site in a component position, a
  table entry with both or neither of plan and refusal, a typed request with a markup plan).

## Reproduce

```sh
# in ../frontend
nix shell nixpkgs#nodejs_24 -c sh -c '
  node --experimental-strip-types --conditions=browser scripts/eval-slice.ts --rust-fixture ../rust-solid/crates/runtime/tests/fixtures/eval/slice.json
  node --experimental-strip-types --conditions=browser scripts/eval-fuzz-corpus.ts --start 1 --seeds 60 --max 8 --out ../rust-solid/crates/runtime/tests/fixtures/eval
  RUST_SOLID=$PWD/../rust-solid npm run eval-fuzz -- --seeds 1000 --start 1'
# here
cargo test --test eval
```

Results of the eval fuzz are in `docs/eval/` and in `frontend/docs/EVAL.md`.

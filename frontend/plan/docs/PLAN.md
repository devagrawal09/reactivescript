# Slice 1 resolved plan

Schema v2, for the slice-2 tracker, is in [PLAN-V2.md](PLAN-V2.md). The v1 schema below and `like.plan.json` are unchanged. `plan/emit.ts` emits both: v1 for a slice whose scenario is format version 1 (like), v2 for version 2 (the tracker), or as `--schema` says.

This is an executable, deliberately small plan, not a replacement for CP-6. All work is under `plan/`; upstream imports go through `tsx/rx/`. `resolve.ts` runs `checkModules`, rejects diagnostics, and uses its resolved component region, symbol identities/kinds/question flags, computation kinds, reads, writes and call targets. It does not pattern-match names such as `likes` or `save`. It accepts one default component and rejects unsupported expression/statement forms.

## Schema v1

- `sources`: resolved name, `source | optimistic`, seed expression. An optimistic seed is a computation, not an initial-value copy.
- `equations`: resolved name and expression (empty for like).
- `actions`: name and ordered steps: `write`, `optimistic`, `await` a registered host into a local, `try` with body and catch.
- `handlers`: handler name → action.
- `markup`: host elements with event bindings and children; text holes with expressions.
- Expressions: `literal`, resolved `read`, action `local`, updater `current`, `add`. There is no executable JavaScript, source text, or dynamic property access in the plan. `current` is distinct from `read`: an updater composes on an unflushed write/guess.

The Rust consumer currently accepts integer-valued reactive expressions and literal text, not arbitrary RX values or JavaScript numeric coercions. That limitation is independent of the JSON encoding.

## CP-6 gaps: every AST fallback

1. **Entry and declaration association.** CP-6 supplies region and symbol identity, not default-export selection or stable AST-node references. Read the default component, associate its declarations by resolved region + name, and use checker walk order to associate unnamed handlers/readers. No source line enters plan identity.
   *v2: remains. Markup computations are also verified by kind, `at` label and region, not only by order.*
2. **Values and expressions.** CP-6 has dependency facts, not literal values, operators, operand order or expression structure. Read seed/equation/text/action expression trees from the checked RX AST; verify reactive identifiers against the owning computation's resolved reads.
   *v2: remains, with records, arrays, `get`, `length`, `filter`/`map`/`findIndex` lambdas, comparisons, logic and `cond`. Reads are checked against CP-6 in both directions.*
3. **Control flow and ordering.** CP-6 collects reads/writes/calls but does not encode statement order, try boundaries, catch bodies, or await suspension. Read these from the RX statements. Resolve each write target/op and host call against CP-6.
   *v2: remains. Step order, try/catch and await points come from the AST; v2 adds handler `call` steps and refuses `try`, guesses and awaits in plain handlers.*
4. **Locals and updater bindings.** CP-6 omits local constants, handler parameters and updater parameters. Use AST local bindings; canonicalize await temporaries to `$awaitN`; translate an updater's parameter to `current(target)`. The synthetic current read is not falsely claimed to be a CP-6 reactive read.
   *v2: narrowed. The synthetic `current(target)` is gone: an updater is an explicit lambda whose parameter the consumer binds to the shown value. Action parameters, lambda parameters, row items and `$awaitN` still come from the AST.*
5. **Optimistic capability and seed relation.** There is no optimistic-source symbol kind. Use resolved optimistic-write facts to mark the source, and its resolved question/seed computation to check the AST seed expression. A source never optimistically written cannot be inferred as optimistic by this slice.
   *v2: remains, plus a gap of the same kind: CP-6 has no store kind, so `store` is inferred from path-write facts. A store never path-written would be emitted as a `signal`.*
6. **Action/handler linkage.** Named calls use resolved action targets. Plain RX imperative handlers are lowered to an action boundary (as the RX handler compiler does); CP-6 records the handler body but not this runtime wrapper. Handler syntax and inline action nesting come from the AST.
   *v2: narrowed for declared actions. A handler's `call claim(…)` is verified against its CP-6 call fact; only the arguments come from the AST. v2 lifts only AC-1b (inferred) bodies and inline actions into `$action<N>`; other statement handlers stay plain handlers.*
7. **Markup and event layout.** Tags, static text, children, event names and tree order are not CP-6 data. Read them from checked markup; bind the associated resolved handler/read computations.
   *v2: remains for tags, static text, event names and child order. Show/For structure is cross-checked against CP-6 regions and reader computations.*
8. **Text coercion normalization.** TSX/yield explicitly lower a numeric hole as `"" + value`; handwritten RX leaves it as `value`. For this integer-only text boundary these produce the same bytes, so normalize the outer empty-string addition away *only at text holes*. This is not a general add rewrite.
   *v2: remains, plus one normalization of the same kind: adjacent static text nodes are merged (the RX parser splits `" "` + `"open"` where JSX has `" open"`). Both are frame-neutral.*

Gaps v2 adds beyond these eight (PLAN-V2.md has the detail): row-item reads (CP-6 records none for paths through a `for` item), host signatures (from the `.d.rx` file, not CP-6), the `for` key mode (`"identity"` is Solid's default, not a checker fact), and authored local names (plan equality across frontends needs equal lambda, parameter and row names). None of the eight is closed by v2.

These are real missing executable facts, not a claim that CP-6 is already a full IR. The builder uses CP-6 to select and verify semantics, but executable structure still needs the checked AST.

## Run and gate

The plan reads the slice fixtures in `slices/like/`: the authored RX, TSX and yield sources, host declaration and native scenario. `like.plan.json` is emitted, never handwritten.

```sh
node --experimental-strip-types plan/emit.ts slices/like/like.yield.tsx              # v1: like.scenario.json is version 1
node --experimental-strip-types plan/emit.ts slices/tracker/tracker.yield.tsx        # v2: see PLAN-V2.md
RUST_SCENARIO=${RUST_SOLID:-../rust-solid}/target/debug/scenario node --experimental-strip-types --test plan/plan.test.ts   # ../rust-solid, or RUST_SOLID
```

The integration test freshly emits all three plans, compares their full JSON, checks the saved artifact, and runs each through Rust against the exact native scenario strings. There are also negative tests for checker errors and unsupported expressions. The Rust leg is skipped unless `RUST_SCENARIO` points at rust-solid's `scenario` binary; `verify-pinned.sh` sets it from `../rust-solid`, or `RUST_SOLID`.

Type check: `npx tsc -p plan/tsconfig.json` reports no diagnostics in `plan/`, but exits nonzero for existing diagnostics in the pinned upstream checkout. v1 alone reached three, in `compile/emit.ts` (273, 393, 479); since `plan.test.ts` imports the slice runner for the v2 tests, it reaches all 12 in `baselines/upstream-tsc.txt`. Those files are read-only and unchanged.

Observed gate: the four v1 tests pass (the v2 tests in the same file are described in PLAN-V2.md); each frontend produces Rust frames `["0","1","0","1","1"]`, identical to native Solid. The broader scalar signals fuzzer is a separate gate and has known divergences; see rust-solid `docs/SLICE1.md`.

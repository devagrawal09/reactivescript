# Slice 1 resolved plan

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
2. **Values and expressions.** CP-6 has dependency facts, not literal values, operators, operand order or expression structure. Read seed/equation/text/action expression trees from the checked RX AST; verify reactive identifiers against the owning computation's resolved reads.
3. **Control flow and ordering.** CP-6 collects reads/writes/calls but does not encode statement order, try boundaries, catch bodies, or await suspension. Read these from the RX statements. Resolve each write target/op and host call against CP-6.
4. **Locals and updater bindings.** CP-6 omits local constants, handler parameters and updater parameters. Use AST local bindings; canonicalize await temporaries to `$awaitN`; translate an updater's parameter to `current(target)`. The synthetic current read is not falsely claimed to be a CP-6 reactive read.
5. **Optimistic capability and seed relation.** There is no optimistic-source symbol kind. Use resolved optimistic-write facts to mark the source, and its resolved question/seed computation to check the AST seed expression. A source never optimistically written cannot be inferred as optimistic by this slice.
6. **Action/handler linkage.** Named calls use resolved action targets. Plain RX imperative handlers are lowered to an action boundary (as the RX handler compiler does); CP-6 records the handler body but not this runtime wrapper. Handler syntax and inline action nesting come from the AST.
7. **Markup and event layout.** Tags, static text, children, event names and tree order are not CP-6 data. Read them from checked markup; bind the associated resolved handler/read computations.
8. **Text coercion normalization.** TSX/yield explicitly lower a numeric hole as `"" + value`; handwritten RX leaves it as `value`. For this integer-only text boundary these produce the same bytes, so normalize the outer empty-string addition away *only at text holes*. This is not a general add rewrite.

These are real missing executable facts, not a claim that CP-6 is already a full IR. The builder uses CP-6 to select and verify semantics, but executable structure still needs the checked AST.

## Run and gate

`fixtures/` contains sol's authored RX, TSX and yield fixtures, host declaration and native scenario. `like.plan.json` is emitted, never handwritten. Sol's derived `$optimistic` lowering is needed for yield; main initially lacks it. Until that commit lands, use its read-only worktree through the explicit environment override:

```sh
YIELD_FRONTEND=../slice1-js node --experimental-strip-types plan/emit.ts plan/fixtures/like.yield.tsx
YIELD_FRONTEND=../slice1-js RUST_SCENARIO=/Users/devagr/rx-tsx-refresh/rust-solid/target/debug/scenario node --experimental-strip-types --test plan/plan.test.ts
```

After sol's lowering lands, omit `YIELD_FRONTEND`. The override loads only the frontend; checking and plan construction still run here. No implementation is copied or changed in sol's worktree. The integration test freshly emits all three plans, compares their full JSON, checks the saved artifact, and runs each through Rust against the exact native scenario strings. There are also negative tests for checker errors and unsupported expressions.

Observed gate: all four tests pass; each frontend produces Rust frames `["0","1","0","1","1"]`, identical to native Solid. The broader scalar signals fuzzer is a separate gate and has known divergences; see rust-solid `docs/SLICE1.md`.

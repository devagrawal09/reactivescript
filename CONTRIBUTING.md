# Contributing

ReactiveScript is an early-stage language design. The spec is the product;
the reference implementation in `ref/` exists to check it.

## How claims are made

Every behaviour claim is either a numbered rule (`E-n`, `H-n`, `AC-n`, …;
see the README's *Rule IDs*) or a scenario under `scenarios/`
(program → actions → frames → verdict). A change to the language comes
with the rule it adds or amends and at least one scenario that shows it.
`scenarios/TEMPLATE.md` is the starting point for a new one.

Decisions recorded in the spec as *ruled* with a date are settled; please
open an issue rather than a PR to revisit one. Decisions marked *taken by
default* are still open to change.

Semantics follow Solid 2.0 (`solidjs/solid@next`, pinned in
`ref/SOLID_NEXT`). An open question in Solid's
`packages/signals/docs/RULES-FUNDAMENTALS.md` is open here too. Where this
spec diverges from Solid, the divergence is recorded as a `DV-n` in
`spec/05-holds.md` or `spec/10-server.md`.

## Running the suite

Solid is built from its `next` branch at the pinned commit (needs pnpm and a
Rust toolchain):

```sh
sh ref/scripts/solid-next.sh   # checks out and builds ../solid-next
cd ref && npm install
npm test                       # interpreter over every scenario
npm run oracle                 # the same scenarios lowered onto Solid
npm run compiled               # compiled modules
npm run ssr                    # streamed SSR + hydration in Chromium
npm run types                  # TSX projection checked by TypeScript
```

`ref/README.md` describes each runner. Please run the suite before opening a
pull request and note any scenario whose result changed.

## Issues

Bug reports and questions are welcome as GitHub issues. For a semantics
question, a small `.rx` program and the frames you expected is the most
useful form.

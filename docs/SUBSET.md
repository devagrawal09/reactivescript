# Solid-Parity Subset

The contract is native Solid behavior, not RX behavior under TSX syntax. Refuse
forms that cannot be represented faithfully instead of silently changing meaning.

## Current Checkpoint

Run `npm run verify:subset`. It runs the package typecheck, all boundary contracts,
paired-counter tests, and component-composition tests without test-name filtering.
Any failed command fails the checkpoint. The behavioral scope is deliberately
narrow: the authored counter and composition fixtures and their handwritten RX
counterparts.

```tsx
import { createSignal, createMemo } from "solid-js";

export default function Counter() {
  const [count, setCount] = createSignal(0);
  const doubled = createMemo(() => count() * 2);
  return <button onClick={() => setCount(count() + 1)}>{doubled()}</button>;
}
```

Tests require equal canonical checker facts and rendered frames `0`, `2`, `4`
across the RX interpreter, RX compiler, and native Solid universal renderer.
Changed tracked/snapshot reads must remain detectable. This is not a browser DOM
or hydration claim, or proof for every combination of these primitives.

Boundary tests check pins and adapter API contracts. An authored async handler
that writes before awaiting must be rejected: Solid applies that write immediately,
but RX would infer an action that holds it. This does not certify other async forms.

## Component Props And Callbacks

`tsx/composition.test.ts` uses `fixtures/composition.tsx` and `composition.rx`.
The fixture passes a direct signal read, a memo value, and a synchronous callback
through two later-declared child components:

```tsx
// Parent Counter
return <CounterButton direct={count()} value={doubled()}
  onIncrement={() => setCount(count() + 1)} />;

// CounterButton: its own count starts at 10 and must remain independent.
const [count, setCount] = createSignal(10);
const doubled = createMemo(() => incoming.value * 2);
return <Button direct={incoming.direct} value={doubled()} local={count()}
  onIncrement={incoming.onIncrement} />;

// Button
return <button onClick={() => props.onIncrement()}>
  {props.direct}/{props.value}/{props.local}
</button>;
```

Across four clicks the exact frames must be:

```text
0/0/10 -> 1/4/10 -> 2/8/10 -> 3/12/10 -> 4/16/10
```

Variants attach `onClick={props.onIncrement}` directly or forward through
`onIncrement={() => incoming.onIncrement()}`. Each variant compares canonical
TSX/RX facts, checks both programs, and asserts expected frames in the TSX-derived
interpreter, both compiled RX programs, and native Solid's universal renderer.
No callback return-value, argument-forwarding, async, or DOM-event behavior is
claimed by these examples.

These are the two existing composition tests moved unchanged from
`lower.test.ts`, not replacement assertions. The full suite still discovers them,
and the coverage manifest records their new paths. `npm run verify:subset` passes
11 tests with no skips or TODOs; the package typecheck is clean. Upstream's 12
strict-mode diagnostics remain the separately recorded baseline.

## Exclusions

Async behavior, server functions, cross-module error identity, previous values,
stores, owner lifetimes, SSR, and hydration are not certified by this command.
Their existing tests and native assertions remain in the full suites. The full
migration remains NOT READY while those suites fail.

`npm run verify:pinned` remains the full readiness gate. Comparison-only results
do not approve failures. No tests are removed from the full suite or coverage
manifest to make the subset pass.

## Expansion Rule

Require authored TSX, handwritten RX, and native Solid evidence for each addition,
including relevant failure and cleanup ordering. Fix adapter errors first. Backend
defects need minimal reproductions; temporary patches need removal conditions.
If native behavior is unrepresentable, test a specific diagnostic and retain the
native counterexample. Do not weaken assertions, sort effect logs, or add skips.

# Interpreter and compiler disagree on writes around pending actions

On main `fdbcad921c6bc1cae59cbebe9905eeabc480e88f`, the reference interpreter disagrees with compiled RX in these two small programs. Compiled RX matches equivalent native Solid TSX on Solid **2.0.0-rc.21**. No frontend lowering is involved in the RX runs.

## Setup

`./api.d.rx` is a fake external API:

```rx
export fn request(n: number): number
```

The driver uses upstream `Runtime`, `compileModules`/`lowerViews`, and `createApp`. `request(n)` is the harness flight keyed by `request:<n>`, resolved explicitly by each step. Native TSX calls the same flight via `(...args) => app.api("request")(...args).first`. Frames below are the complete rendered text, including button labels.

## U1: handler writes before calling an action

```rx
import { request } from "./api";

export default component App() {
  source n := 0;
  source guess = n;
  action save() {
    optimistic guess := value => value + 1;
    try { await request(1); } catch (error) {}
  }
  <section>
    <button onClick={() => { n := 2; save(); }}>save</button>
    <output>{guess}</output>
  </section>
}

// Steps: mount; click save; resolve request(1) with 0.
```

| Step | Native Solid | Compiled RX | Interpreter |
| --- | --- | --- | --- |
| Mount | `save0` | `save0` | `save0` |
| Click save; request(1) pending | `save1` | `save1` | `save3` |
| Resolve request(1) with 0 | `save2` | `save2` | `save2` |

The interpreter computes the guess using the handler's new input (`2 + 1`); native and compiled use the held screen input (`0 + 1`). Without the optimistic write this smaller signal example agrees, so this is not a claim that every handler/action pair fails.

## U2: a write lands while another action is still pending

```rx
import { request } from "./api";

export default component App() {
  source n := 0;
  source guess = n;
  action save(amount: number) {
    optimistic guess := value => value + amount;
    try {
      let got = await request(amount);
      n := value => value + got;
    } catch (error) {}
  }
  <section>
    <button onClick={() => { save(2); }}>two</button>
    <button onClick={() => { save(3); }}>three</button>
    <output>{n}</output>
  </section>
}

// Steps: mount; click two; click three; resolve request(2) with 5
// while request(3) is still pending; resolve request(3) with 0.
```

| Step | Native Solid | Compiled RX | Interpreter |
| --- | --- | --- | --- |
| Mount | `twothree0` | `twothree0` | `twothree0` |
| Click two | `twothree0` | `twothree0` | `twothree0` |
| Click three; both flights pending | `twothree0` | `twothree0` | `twothree0` |
| Resolve request(2) with 5; request(3) still pending | `twothree0` | `twothree0` | `twothree5` |
| Resolve request(3) with 0 | `twothree5` | `twothree5` | `twothree5` |

Both actions update the same optimistic source. The first action's plain write to `n` becomes visible in the interpreter as soon as that action returns; native and compiled keep it held until the second action also returns. The guess need not be displayed to reproduce this.

## Spec question

**U1 is covered by AC-1** (`spec/06-stores.md`):

> The handler that launches it is the same instant, so the handler's own plain writes — before or after the call — are the action's and are held with it (D-7's same-tick adoption).

`spec/07-surface.md` §5 also explicitly gives `() => { draft := ""; send() }` and says:

> the handler's plain writes are adopted by the action and held with it (AC-1).

This points to the native/compiled result, but could the rule also state which input a functional optimistic updater sees?

**U2 needs clarification on main.** H-2 (`spec/05-holds.md`) says:

> A write to a slot an open change holds is a second proposal: the writer's instant joins that change and reveals with it (Solid D-8; S-solid-34 — the two actions on `id` are one hold).

H-11 says a guess “lives as long as the hold it was made over” and “A path guess's hold is its own action's (per key)”; AC-3 refers to H-11. H-2 suggests holding the shared change, but these sections do not explicitly say how two optimistic writes to the same slot combine their action holds. Do those holds merge, so `n` stays `0` until both actions settle, as native and compiled show? Or should the first write land independently, as the interpreter shows?

## Existing work and coverage

Read-only checks of all upstream issues and PRs found no issue describing these exact sequences. **#31 and #32 are related pending work, not ignored duplicates:** #31 changes guess ownership per (key, hold) and fixes the existing S-store-8 failure; #32 adds H-11's outside-input-under-a-guess rule and S-solid-44. As a supplementary check, each PR head's `runtime.ts` was run in scratch with main's other reference modules: both still showed both mismatches (#31 at `0bfc6ecf3c4d2609abdbc7dcd27589d11f8f466a`, #32 at `d574830164567b08babcead17795ac244b0d3f95`). This was not a full checkout/test of either PR. These repros may still belong as regressions in that work rather than a separate fix.

The clean compiled suite passes **112/112**. The clean interpreter suite is **111 pass, 1 fail** (the existing S-store-8 failure noted in #31), so it would be inaccurate to say every upstream suite is green. Neither suite currently contains these exact sequences. Running them through upstream `runScenario` reports the same U1 instant-1 and U2 instant-3 mismatches.

## How this was found

A differential fuzzer in the Solid TSX frontend demo ([PR #21](https://github.com/ryansolid/reactivescript/pull/21)) compared native Solid, compiled TSX, compiled handwritten RX, and both interpreted forms. The original **500-seed** run found **46/500** interpreter/compiler divergences (26 pre-action-write cases, 20 pending-action cases), with native and compiled RX agreeing. That count is from the original run, not a new 500-seed run on this main commit. The two handwritten programs above were independently rerun on clean main.

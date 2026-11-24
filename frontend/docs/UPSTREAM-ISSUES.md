# Upstream issues relevant to the kept subset

Pin: clean ReactiveScript e650b85154c53912fa779c9badef73c1e2998b87, Solid 30e7805eb (main, solid-js 2.0.3), since
the move from fdbcad92 / rc.21 (docs/PIN-MAIN-FRONTEND.md). These are observations, not waived frontend failures.
Nothing was filed upstream by this work.

## Compiled RX keeps a `<Show>` that native Solid lowers to a ternary (new at e650b85 / Solid main)

Solid main's production compiler lowers a `<Show>` with JSX children to the ternary it renders (solid-next 96ffcf7b,
#4730). Upstream's `ref/compile/emit.ts` writes every RX `if` as `<Show when={…} fallback={(…)()}>{(__item) => { … }}
</Show>`: a callback child with a block body, which the compiler never lowers. Compiled RX therefore keeps the Show
component, and its host log differs from native TSX's in construction order (the branch is created before the hole's
marker); frames are the same. The plan fuzz classifies it with a root-cause probe (`UPSTREAM_RX_SHOW`,
plan/fuzz/run.ts): compiled RX must equal native TSX compiled with `lowerShow: false`, the only change on the native
side, exactly (alone, or with the AC-3 / path probes). Seeds 1–100: 55 of the 85 accepted v2 programs and 11 of the
84 accepted v2.1 programs are this class; the plan legs equal native on all of them. Never counted as agreement.

## Fixed upstream since fdbcad92

- S-store-8 (below) passes: upstream c746908 ("a guess is its own action's, per key (H-11); S-store-8 passes").
- U1 interpreter differences on gate seeds 17, 92, 103, 149, 199: upstream f51bb5e (#33). 16 interpreter-only seeds
  remain on seeds 0–199 (baselines/fuzz-upstream.json).

## S-store-8: upstream's interpreter failed its own scenario (at fdbcad92; fixed in c746908)

The upstream test runner reports 111 pass, 1 fail. S-store-8 instant 4 expects Z-B- but gets Z+B-:
the pending marker remains after the store-path write. The oracle and compiled runners pass all 112 scenarios.
The full pinned gate records test exit 1 and fails; pins.json records the actual 111/1 baseline, not a clean result.
No scenario is excluded and no exit code is ignored.

## Held writes: interpreter differs from compiled RX and native Solid

The fixed 200-seed run has 184 matching cases and 16 interpreter-only differences (179 and 21 at fdbcad92). In those cases, TSX and RX agree
on each backend and compiled RX agrees with native Solid. The interpreter exposes writes the other backends hold:

- U1: calling-handler writes before a pending action.
- U2: writes while another action is already pending.

See docs/FUZZ.md and docs/FUZZ-findings.md for the reduced cases. baselines/fuzz-upstream.json names all 16 current
seeds. The gate reports them; new upstream differences, generator errors, frontend differences or native-versus-
compiled differences fail. The smoke test asserts seed 14 exactly (14 and 17 at fdbcad92). No held-write fix is claimed here.

## Ordinary async callbacks: issue #20

They remain refused, with guidance to use an explicit synchronous generator action only when its held-write
semantics are wanted. This is not a semantics-preserving rewrite. Explicit generator actions remain tested.

## Removed scope

The old broad port's failures are not part of the kept subset. Its source contexts, server helpers, async stores,
effects, browser tests and associated issue catalog were removed, not fixed. Upstream withdrew source contexts
(O-4 / RG-7c, PR #26); use write actions instead. They now receive the general outside-subset refusal.

Patch 0001 (server question keys) still applied at fdbcad92, but was dropped with server-function support.
Its removal is not evidence of an upstream fix. The package now runs against clean upstream with no patches.

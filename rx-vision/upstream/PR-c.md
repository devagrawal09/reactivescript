# Add the ReactiveScript map and dev hot replacement

## What and why

Builds on dev keys. `@reactivescript/map` shows the static program and a live view of changes. It includes an RX app for the map page, read-only MCP queries, layout and diffing, travel, and a fake host and conformance suite. The compiler plans keyed hot replacement; the map can observe it without owning it.

Travel and map-observed HMR state carry-over require [`openView` from solidjs/solid#5089](https://github.com/solidjs/solid/pull/5089). See also [solidjs/solid#5198](https://github.com/solidjs/solid/pull/5198) and [the `openView` discussion](https://github.com/solidjs/solid/pull/5089#issuecomment-7157942022). On stock Solid 2.0, travel reports `unsupported`; map-observed HMR reports that keyed replacement is unsupported and falls back to a full reload. Live inspection still works where dev attribution is available. Exact list travel requires the additional view fixes listed in the README.

## Compatibility

No intended changes to production lowering. The live map and HMR are dev-only. The view and some attribution details depend on experimental Solid APIs and are capability-checked.

## Verification

| Check | Result |
| --- | --- |
| Interpreter, Solid oracle, compiled scenarios | Pass |
| TypeScript projection scenarios | 202 pass |
| Rust tests, Node-API, runtime | Pass |
| Checker and projection parity | 414/414 and 235/235 |
| Lowering parity | 209/239 in each mode; strict runner reports the 30 known mismatches |
| SSR/hydration | 144 pass, 0 fail, 7 skipped in both standard and `RX_DEV=1` runs. `S-sf-1` also passed in isolation in both modes. |
| Map package without `SOLID_VIEW` | Pass with `RXC` set; real-host view tests skipped |
| Map package with `SOLID_VIEW` | Pass, including DOM travel and HMR |
| Stock Solid browser smoke test | Travel returns `unsupported` and the app still responds |

## Questions for Ryan

- Should the map wait for Solid’s view and attribution APIs to stabilize, or ship sooner with travel labeled experimental?
- Which attribution details should be public: flight starts, disposal, store paths, or accessor identity?
- Should the generated page be checked in or built only at package time?

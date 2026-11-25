# Give dev builds stable declaration keys

Stacked on #98; review only the last 5 commits:

- `5b280a5` Key dev declarations and expose their resolved model
- `0c54e01` Hydrate a dev client against non-dev server output
- `81b0c7d` Preserve module keys in non-bundled lowering
- `ad7d6de` Do not allocate foreign observation memos during hydration
- `c700955` Wait for server function frames in the SSR runner

## What and why

Builds on the language fixes. Give dev sources, equations and actions stable keys rooted at the project path. The runtime uses those keys to name Solid nodes and attribute writes, action runs and boundary state. The resolved model adds `key`, view `outline` and `deadTyped`; the Node-API adds `app(…, dev, root)` and `model()`.

Vite adds an optional dev-client registration hook only if `@reactivescript/map/live` resolves from the project. No map implementation or hot replacement is included here. The runtime exports separate development and production builds. Dev boundary tracing uses an ownerless root so it does not consume a Solid hydration ID. The SSR runner also waits for RPC-backed frames instead of assuming that a Solid flush completes the HTTP round trip.

## Compatibility

The Node-API changes are additive. Production compiler output is unchanged from the language branch. Production runtime exports no longer include dev instrumentation or reference-only error stubs; applications can still inject an API.

## Verification

| Check | Result |
| --- | --- |
| Interpreter, Solid oracle, compiled scenarios | Pass |
| TypeScript projection scenarios | 202 pass |
| `rxc app` against the language branch | 84/84 full JSON outputs byte-identical on both example trees |
| `rxc app` against upstream main, using the updated example tree | 84/84 full JSON outputs byte-identical |
| `rxc app` against upstream main, using the original example tree | 66/84 identical; the other 18 reflect the preceding `./api` precedence change |
| Vite and esbuild production bundles | Pass with `@solidjs/vite-plugin` 3.0.1; no `__RX_` or `rx:` |
| Rust tests, Node-API, runtime | Pass |
| Checker and projection parity | 414/414 and 235/235 |
| Lowering parity | 209/239 in each mode; strict runner reports the 30 known mismatches |
| SSR/hydration | 144 pass, 0 fail, 7 skipped in both standard and `RX_DEV=1` runs. `S-sf-1` also passed in isolation in both modes. |

## Questions for Ryan

- Are the key format and project root the right stability contract for diagnostics?
- Should the model outline be considered public or experimental?
- Is development-only live registration at the Vite entry the right place for an optional observer?

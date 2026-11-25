# A small pure prelude

Decision: expose a fixed list of deterministic JS operations, not host
globals in general. The normative list lives in `spec/pure-globals.json`
and is read by both checkers. Namespaces are not first-class values;
qualify a listed member directly. Unlisted operations, clocks, randomness,
DOM and timers stay in imported JS.

# String fuzz (`--strings`): artifacts and tools

String values and the generator: [../RENDERER.md](../RENDERER.md), "Strings"; the op language:
[../OP-LANGUAGE.md](../OP-LANGUAGE.md), "Strings".

| file | what |
| --- | --- |
| `port/summary-1-1000.json` | `node fuzz/run.mjs --strings --seeds 1000`: 1000/1000, 0 invalid |
| `port/summary-1001-3000.json` | `node fuzz/run.mjs --strings --start 1001 --seeds 2000 --no-reduce` (held out): 2000/2000, 0 invalid |
| `tools/unit-programs.mjs` (+`.json`) | the hand-written string programs of `crates/runtime/tests/strings.rs` |
| `tools/unit-expectations.mjs` | records Solid's traces for them into `crates/runtime/tests/fixtures/strings-units.json` |

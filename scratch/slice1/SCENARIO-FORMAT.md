# Scenario format, version 1

A scenario is JSON data, not executable code. It contains no source text and names no runtime APIs.
The fixture key selects a separately stored program; each backend supplies its own program loader.
See `slices/like/like.scenario.json` and `slices/run-js.ts`.

## Schema

The root has these required fields:

- `version`: the integer `1`.
- `name`: a human-readable label.
- `fixture`: a lowercase filename stem (`[a-z][a-z0-9-]*`), relative to the scenario file.
- `host`: an array of signatures. Each has `name`, `parameters` (an ordered array of scalar type names),
  `returns` (a scalar type name), and `async: true`. Version 1 type names are `number`, `string`, and `boolean`.
- `steps`: an ordered array. Every step has `type` and `frame` (a JSON string).

Step fields in addition to `frame`:

| type | required fields | meaning |
| --- | --- | --- |
| `mount` | none | Mount the default entry. Must be first and occur exactly once. |
| `click` | `element`: nonnegative integer | Click that live clickable element, zero-based. |
| `resolve` | `host`: name, `call`: positive integer, `value`: scalar | Resolve that invocation. Value must match the host result type. |
| `reject` | `host`: name, `call`: positive integer, `error`: string | Reject that invocation with an error whose message is this string. |

Element order is depth-first, parent before children, in current child order. Only elements with a click
handler count; the synthetic mount root and text nodes do not count. Recompute the list at each click.
No tag names or markup are needed in the scenario.

## Exact frame text

A frame is the universal test renderer's text, **not HTML**:

1. A text node contributes its exact text.
2. An element contributes the concatenation of its children, in order. Its tag, attributes and handlers
   contribute nothing. There are no separators, indentation, quotes, escaping, or added line breaks.
3. The synthetic mount root follows the same rule. Empty nodes contribute the empty string.
4. Do not trim, normalize whitespace, or escape HTML characters. JSON escaping is only file encoding;
   compare the decoded strings exactly (equivalently, their UTF-8 bytes).
5. This version excludes portals, suspense markers and error fallbacks. A future format must define those
   before using them; do not invent text for them here.

For example, a button containing the number 0 renders `0`, not `<button>0</button>`.
A paragraph with three text pieces `2`, ` items / `, and ` / 0` renders `2 items /  / 0`.
A Rust renderer can reproduce a frame by recursively appending text-node bytes in child order.
Numeric holes in these fixtures are integers, rendered in base ten with no decimal suffix or grouping.

## Host calls and timing

Call numbers are **one-based per host function, per mount**, in invocation order. Every invocation creates a
new pending request, including repeated calls with identical arguments or no arguments (SF-2c). Never key
requests by arguments. Rejecting `save` call 1 does not reject a later `save` call 2. A resolve/reject step
requires that call to exist and still be pending; settling it twice is an error. All issued requests must
be settled by the end. Host argument count/types and resolved value types must match their signatures.

After each step, run the resulting synchronous work and ready continuations until the renderer has
settled, without answering any other pending request. Then compare exactly one frame. The JS runner
drains three event-loop turns and flushes Solid after each. These fixtures have one await per action.
Clicks never wait for a pending host request. Rejection becomes an error at the wait point and enters
the program's catch; it is not an out-of-band renderer failure. An uncaught runtime error fails the run.

## Like slice and JS legs

The like trace is mount → click → reject `save` #1 → click → resolve `save` #2 with 1.
Expected frames, recorded from native Solid: `["0", "1", "0", "1", "1"]`. These are stored in the JSON,
not generated from the other backends. `run-js.ts` checks them after **every** step on native Solid and
compiled RX from TSX, handwritten RX and yield. It injects fresh promises through `createApp({ api })`;
the native fixture imports an app-local host module. The interpreter cannot accept that host injection,
so it is deliberately not a leg in this slice's gate. This is not a claim of interpreter parity.

The yield frontend has no declared-action form and expands `$event` at the button. Therefore the TSX
twin binds an inline generator action, and the RX twin uses the same inferred-action handler. The
optimistic increment, committed source, tracked optimistic base, catch, and host wait are unchanged.
TSX requires a `number` annotation on the local host result. Yield uses `attempt` instead of try/catch, as that syntax requires. Its new synchronous optimistic
body form keeps the tracked dependency on the committed source; a constant seed would not be faithful.

## Second example: upstream S-infer-1

`slices/like/s-infer-1.scenario.json` converts the main confirmation trace from
`upstream/scenarios/S-infer-1.md` at fdbcad92: mount, click, resolve the first `fetch` call with `"yes"`.
Its frames are `"no "`, `"yes "`, `"yes "` (including the trailing spaces). The adjacent RX fixture is the
original Program block, unchanged. The JSON replaces the handler-source row with a click and the
argument-keyed resolution with call number 1. It runs on compiled RX and a cheap native Solid twin.
Solid spells the RX question source as a committed signal plus an optimistic accessor; this second
example checks frames, not equal facts across those different source layouts. Its scalar host signature
is `fetch(string): string` (async). No server wrapper or browser network is involved.

Luna's initial suggestion, S-action-1, also has an array question source and a finally block. S-infer-1
fits this slice more closely: scalar values, one optimistic handler, one wait, and one catch.

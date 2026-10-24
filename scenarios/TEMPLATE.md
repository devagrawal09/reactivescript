# S-<area>-<n> — <one-line name>

Rules exercised: <ids>. Solid scenario mirrored (holds only): S-<n>.

## Program

```
<abstract syntax, 02-core §1>
```

## Frames

| instant | action | frame | effect / probe verdicts |
| ------- | ------ | ----- | ----------------------- |

## Rejected variants

| fragment | rule | verdict |
| -------- | ---- | ------- |

## Mechanics (for writing scenarios)

- `## Program` holds a fenced program, or a line `file: ../examples/x.rx`.
- `## Modules` (09): fences beginning `-- module: ./x.rx` are modules every
  program in the scenario may import; a `file:` program finds its modules
  beside it on disk.
- The frame is the view's text: reader values and text nodes concatenated in
  order, whitespace collapsed to single spaces and trimmed; adjacent elements
  add no separator (write `{" "}` or a text node where one is wanted).
- Rows: `mount`, `handler \`stmts\`` (imperative statements; may call actions
  and read or write any live binding by name, including a region's locals
  while it is live), `resolve x v` / `reject x "msg"` (equation `x`'s current
  flight), `resolve "key" v` (a flight by key — `name:` + arguments formatted
  as values, strings and numbers bare, objects/arrays as JSON; resolving a
  key again is another landing of a stream; a program must not issue two flights with the same key), `(effect)` (the instant an
  apply block's writes opened).
- `| effect |` column: the instant's `log(...)` calls, `;`-separated.
- `## Variant: …` tables replay the base table up to the first listed
  instant, then override; with their own program fence, prefix rows only
  drive state.
- `## Rejected variants`: fences starting `-- reject: RULE` (or `-- warn:
  CODE`), optional `-- handler: stmts` lines.
- `## Divergences`: `- oracle "<table>" instant N: \`frame\` — why` records
  what Solid 2.0 shows where the spec rules otherwise.
- Failures (04 R-f): the prelude's `fetch` and every `./api` import return
  JS promises, which fail with `Error`, so a program that reads one has an
  `errored` above the reader — the ports put one at the root
  (`errored fallback(e) { <p>error: {e.message}</p> } { … }`), which shows
  nothing unless a reader fails. A ported action that awaits wraps its body
  in `try { … } catch {}` (R-f-6): the frames are DV-2's either way. The
  prelude's `fail(msg)` throws synchronously — a panic, not a failure
  (R-f-3).

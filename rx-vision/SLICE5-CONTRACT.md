# Slice 5 contract: warm MCP on the dev server, recording, causes

From round 2 (usability/round2-mcp.md): per-call MCP startup (~1–3 s, outliers 10–25 s) outlasts 150–700 ms flights;
`tail` floods with anonymous records; no cause chain; boundary history missing; `check` ≠ rx-tsc batch; "unobserved" vs
empty is ambiguous; `overview` lists modules no entry reaches.

## 1. The dev server is the MCP server

- `rxMap()` (tooling/rx-map/vite.mjs) serves MCP over **Streamable HTTP** at `/__rx/mcp` (POST JSON-RPC; GET may 405 —
  no server push needed). Same tools/resources as stdio `rx-map mcp`, one shared implementation. The model is kept warm
  in the dev server (rebuilt on `.rx` change via Vite's watcher, not per call). Program entries = the `.rx` entries the
  RX front end actually compiled (it knows them), so starter files nobody imports are excluded.
- Startup log line: `➜ RX MCP: <url>/__rx/mcp` and the config snippet in README (OpenCode `"type": "remote"`, Claude
  Code `.mcp.json` `"type": "http"`).
- stdio `rx-map mcp --dev <url>` stays (CI, no dev server) and proxies live tools to the dev server as today.
- `usability/bin/rxmcp` switches to calling `/__rx/mcp` with curl when `RX_DEV_URL` is set (target: < 150 ms per call).

## 2. Recording

- `record(action: "start"|"stop"|"status", filter?: "semantic"|"all")`. Start = mark; stop = everything since the mark as
  one readable trace: flushes (keyed only by default), flights, runs, held/released, reverts, boundary changes, with
  relative ms. Up to the last 5000 records are kept server-side regardless, so `tail(since)` never misses a short flight
  if the page was connected.
- `tail` defaults to semantic (RX keys only); `filter=all` shows internals.

## 3. Causes and history

- `why(key)` returns a **cause chain**: the change → the flush's origin (interaction/action run, with args) → for
  derived keys, the upstream keyed changes in the same flush (from `order`/graph reach) → flights it started/landed →
  readers now held/pending because of it. Bounded depth, one line per hop, `file:line` each.
- `boundary(key)` includes live history: current state + error, the last N state changes with errors and the
  interaction that caused each (e.g. "Retry click → flight stats start → land → boundary stayed `error`: last error
  'X' from `src/data.rx||stats` still current").
- `state`/`value` distinguish: `unobserved` (no page or never created), `not created yet` (region not mounted),
  `pending (no value yet)`, `value …`, `error …`.

## 4. check parity

- `check` runs the same diagnostic batch as `rx-tsc --noEmit` for `.rx` sources (all diagnostics in one run, same codes
  and positions), plus the TS projection errors. One consistent output format: `file:line:col CODE message`.

## Done when

- A Playwright-driven page + curl to `/__rx/mcp` shows: tools/list < 150 ms warm; `record start` → click → `record
  stop` captures a 150 ms flight; `why` on a derived key prints a multi-hop chain; `boundary` shows a retry history.
- tooling/rx-map `npm test` green; stdio MCP tests still green.

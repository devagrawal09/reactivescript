# Slice 2 contract: read-only MCP (static + live)

Builds on slice 1 (keys `<module>|<scope>|<name>[#n]`, Solid names `rx:<key>`, `@reactivescript/map` with `./graph ./page ./live ./diff`).
If something here can't be met, stop and report. Don't change it on your own.

## Goal

An agent building an `.rx` app can ask structured questions about the program (static) and about the running dev app
(live) over MCP, and get short text answers with keys and `file:line`. Read-only. JSON on request (`format: "json"`).

## 1. Server

- `@reactivescript/map` gains `./mcp` (`mcp.mjs`) and the CLI gains `rx-map mcp [--root <dir>] [--entry <file.rx>...] [--dev <url>]`.
- stdio MCP server, hand-rolled JSON-RPC 2.0 (no new runtime dependency): `initialize`, `notifications/initialized`,
  `ping`, `tools/list`, `tools/call`, `resources/list`, `resources/read`. Protocol version echo per spec.
- Entries: `--entry` given, else every `.rx` under `--root` (default cwd) that no other `.rx` imports (ignore
  `node_modules`, `dist`). The model is rebuilt when any `.rx` file's mtime changes (checked per call; cheap).
- rxc: `RXC` env, else `@reactivescript/compiler`'s Node-API `model(entries, root)` if it exports one, else `rxc` on PATH.
- Dev server: `--dev <url>` or env `RX_DEV_URL`, else try `http://localhost:3000`, `:5173`. Live tools say plainly
  "no dev server / no page connected" when unreachable, never hang (timeout 5s).

## 2. Tools (names are final)

Static (no app needed):
- `check()`: compiler diagnostics for the program (errors/warnings with `file:line:col` and message), "ok" if none.
- `overview()`: modules in dependency order; per module: counts by role, components, boundaries; top-level keys.
- `find(query)`: nodes whose name/key contains query (case-insensitive), `key  kind  file:line`.
- `node(key)`: kind, role, marks (pending/question/io/trust), declaration line text, reads, writes, calls, read-by,
  written-by, enclosing component and boundaries.
- `reach(key, direction: "down"|"up", depth?)`: what a change to key can affect (down) / what can change key (up).
- `boundary(key?)`: for a loading/errored boundary: which nodes can notify it; without key: list all boundaries.
- `diff(ref?)`: behaviour-first diff summary of the working tree vs a git ref (default `HEAD`), as `rx-map --diff`.

Live (dev server + an open page):
- `live_status()`: connected pages, flush count, uptime.
- `tail(since?, limit?)`: recent flush/flight records: `seq  at  key=preview  origin`.
- `value(key)`: current value preview of a keyed node in the page.
- `why(key)`: last change of key: seq, preview, origin (the action/interaction), and the other keys changed in the same
  flush.
- `pending()`: nodes with a request in flight, and since when.

Resources: `rx://graph` (graph JSON), `rx://model` (rxc model JSON).

## 3. Live channel

- `register(graph, opts?)` in `./live` accepts `{ hot }` (Vite's `import.meta.hot`). The slice-1 injected entry code
  becomes `__rxMap(<graph>, { hot: import.meta.hot })` (compiler/vite.mjs, identity branch; one-line change).
- With `hot`, `./live` starts recording immediately on register (not only on `mount`): attribution enabled once,
  ring buffer of the last 2000 records, latest preview per key, open flights. `mount` reuses the same recorder.
- It answers `hot.on("rx:live:request", {id, method, params})` with `hot.send("rx:live:response", {id, result|error})`.
  Methods: `status`, `tail`, `value`, `why`, `pending`.
- Server half: `@reactivescript/map/vite` exports `rxMap()` Vite plugin: `configureServer` adds `/__rx/live`
  (GET status; POST `{method, params}`) that forwards to the newest connected page over `server.ws` and correlates by id
  (copy the pattern of @solidjs/vite-plugin's `/__solid/diagnostics`), 503 with a clear message when no page.
  Also logs `➜ RX live: <url>/__rx/live` in printUrls. Apps add `rxMap()` to `plugins` (one line).
- The MCP live tools call `<dev>/__rx/live`.

## 4. Done when

- `npx @modelcontextprotocol/inspector --cli node <pkg>/rx-map.mjs mcp --root <app> --method tools/list` lists the tools
  and each static tool answers sensibly on the template app and on `examples/notes/main.rx`.
- Against the running template app (dev server + a headless page clicking a button), `tail`, `value`, `why` return the
  changed keys.
- Headless tests for the JSON-RPC layer and the static tools in `npm test`; existing tests still pass.
- README documents setup for agents (opencode/Claude `mcp` config snippet, and the inspector CLI one-liner).

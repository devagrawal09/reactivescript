# Slice 9: reactive coverage (contract v0.4)

v0.5 (ordered error arms): coverage uses model arms and their source lines. The dev trace names the selected arm;
statically dead `_` arms are not paths. The coverage file still uses `rxCoverage: 1`.

v0.4 (slice 8c): named actions' catches became observable via the dev-only `caught` trace record.

v0.3 (2026-11-25, slice 9b `slice9b/coverage`): untyped failures are not paths, listed apart (§1a); an action's own
catches fold into its outcomes, from a new model field `catches` (ref and crate in parity) (§1); `rx-coverage-ignore`
comments (§1b); the coverage file's optional `ignored`/`untyped`/`warnings` (§3); open questions re-stated (Q1, Q2 as
inference, Q4 answered by ignores, view sites later).

v0.2 (2026-11-25, from the implementation): guess outcomes are decided by the run, not by Solid's revert `how`
(§1); the scenario runner's route and per-table attribution (§2).

Branch `slice9/coverage` (worktree `../rx-slice9-cov`, from `rx/integ`). Package `@reactivescript/map`
(`tooling/rx-map`). Builds on TRACE-CONTRACT v0.9 (the records) and the graph of `compiler/graph.mjs` (`buildGraph`
over `rxc model`).

RX is written by agents and reviewed by humans. A reviewer can't read every test, so the question coverage answers is
**which behaviour of the program no test has made happen**. Line coverage can't say it: a `loading` fallback or a
`errored` arm for `NotFound` sits under a boundary that runs on every mount. So coverage here counts **behaviour paths**,
derived from the graph, observed from the trace records a dev build already sends.

## 1. The universe (static, from the graph)

`universe(graph) → Path[]`, deterministic, sorted by id. One graph = one program (or `mergeGraphs` of several).
Keys are the graph's stable keys (`node.key`, `region.key`, SLICE1-CONTRACT §1), never ids or instances.

```ts
interface Path {
  id: string;        // stable, see the table
  kind: "node" | "edge" | "loading" | "errored" | "guess" | "action";
  module: string;    // graph module path, e.g. "src/IssueDetail.rx": where the reviewer goes
  line: number;      // 1-based, in `module`
  label: string;     // the short phrase the report prints, e.g. "errored (e) shows its NotFound fallback"
  target: string;    // the node or region key the path is about
}
```

| kind | one path per | id | observed when (§2) |
| --- | --- | --- | --- |
| `node` | non-site, non-world node of kind `source`, `eq` (incl. `keyed`/`deferred` flavours) | `node:<key>` | a `flush` change (or `step` excluded, see §2) with that key, carrying `preview` or `error`, after the key's first value. The first value of a node is not a change: a node's initial value at mount doesn't cover it. A question's first landing **is** a change (from pending to a value). |
| `edge` | `read` edge with `mode: "tracked"`, `probe: null`, whose `from` and `to` are both `node` paths | `edge:<fromKey>-><toKey>` | `to`'s change (or `to`'s flight `start`) is caused by `from`: a flight `start` whose `cause[].key` has `from`; or one flush where `from` and `to` both change and, when `order` is present, `from` comes before `to`. |
| `loading` | region of kind `loading` | `loading:<regionKey>` | a `boundary` record (or snapshot boundary) for the region with `state: "fallback"`. |
| `errored` | one path for a region without arms; otherwise one path per model arm, omitting a `dead` `_` | `errored:<regionKey>` without arms; `errored:<regionKey>:<Cls>` with arms | A boundary event or snapshot state with `state: "error"` hits the selected `arm`. When `arm` is absent, use the first arm whose class equals the preview's class (text before the first `:`), or `_` if present. With no matching arm, nothing is hit. |
| `guess` | `write` edge with `op: "optimistic"` from an action (or handler) to a source; three outcomes | `guess:<actionKey>-><sourceKey>:confirmed` / `:reverted` / `:superseded` | (v0.2) By the guessing run's outcome, not by the revert's `reason` alone. Solid's `OPTIMISTIC_REVERTED` `how: "superseded"` means "settled to a value not equal under the node's equality", and store rows compare by reference, so a confirmed store guess also sends `revert reason: "superseded"`. `confirmed`: the run ends (`end`) and either no revert of the key arrived in it, or a `superseded` revert arrived at its own settle (followed by an unchanged settling flush / the `end`), or after the `end`. `superseded`: another write or guess of the key replaced it while the run was still open. `reverted`: the run errored, or a non-`superseded` revert. Without run identity on a record, correlation is best effort. |
| `action` | node of kind `action`: `ok`, one `rejected:<Class>` per **declared** escaping error class, and one caught path per model arm except a `dead` `_` | `action:<key>:ok`, `action:<key>:rejected:<Class>`, `action:<key>:caught:<Cls>:<site>` | `run` `end` → ok. `run` `error` whose `error` class (text before `:`) is `<Class>` → rejected. `caught` with the action's `key`, dispatch `site`, and arm `class` → caught. |

Declared error classes of an action: the **declared** rejections of every callee reachable through `call` edges
(through `fn` nodes, not through other actions; see §1a for "declared"), minus the classes the action's own catches
handle. An action with no declared rejects has only `ok`. For a handler site writing a guess, the handler's key stands
in for `<actionKey>`.

(v0.3) **Catches fold into outcomes.** The model lists an action's own catches: the action's computation carries
`catches: [{ classes: string[] | null }]` (a `try … catch (e: A | B)` or an `await … catch (e: A) => …` in its body, in
model order, outer before nested; `null` = a catch-all; present only when non-empty). `buildGraph` copies it onto
the action node (`node.catches`). A class a catch handles has no `rejected:<Class>` path. `<site>` is the zero-based
index in source order among catches with `arms`, including both statement and `await` catches. Repeating a class at
another dispatch site does not cover both. An ordinary catch-all without arms adds no caught path.

The field has no line: a statement carries none in ref's AST (the crate's has spans, but parity holds the model to
what both have). The map finds a catch in the source when it needs one.

### 1a. Untyped failures (v0.3)

A callee's rejections are **declared** when:
- written `.d.rx` (`decl.origin: "written"`): its line has `rejects(A | B)`. `rejects(Error)` written there is
  deliberate: it declares `Error` and is a path like any class;
- generated from a TS module: a `Rejects<…>` brand (`decl.origin: "brand"`, `"Rejects"` in `decl.brands`; the generated
  line then has `rejects(…)`), e.g. `rejects([NotFound], fn)` from `@reactivescript/js`;
- else the import's own `fails A | B` (on the `.rx` import line, MO-11e/R-f-8: it narrows a defaulted fact), for a
  generated or an undeclared import.

Otherwise the callee **defaults** to the checker's conservative `rejects(Error)` (R-f-8): `decl.origin: "default"`, a
written or branded line without `rejects(…)`, or no declaration at all (a JS module with no `.d.rx` and no TS source).
A defaulted callee is an **untyped failure** of the actions reaching it when it can reject at all: it is a JS import
(`kind: "import"`, not an instantiating fn), and its declared result is a `Promise<…>` or the calling module awaits it
(`await name(` in the caller's module source; a plain call into JS is no failure, R-f-2). The model doesn't record
which calls are awaited, so this is read off the source.

An untyped failure is **not a path** and not in the percentage: no test can choose a class nobody declared, and the fix
is a declaration, not a test. It is listed apart, one line per callee:

- `` `load` (src/api.ts:12) can fail with an untyped error — declare `rejects([...], fn)` with @reactivescript/js ``
- for a written `.d.rx`: `` `load` (src/api.d.rx:3) can fail with an untyped error — declare its `rejects(…)` in src/api.d.rx ``

The location is the declaration's: `decl.from` and `decl.at`, the 1-based line `buildGraph` finds in that file (the
`.d.rx` line itself, or the TS module's `export function|const|… name` / `export { name }`); an undeclared import is
located at its `.rx` import line.

### 1b. Ignores (v0.3)

`// rx-coverage-ignore: <reason>` marks the paths of a line as meant to stay uncovered. A trailing comment applies to
its own line, a comment alone on its line to the next line. An optional kind limits it:
`// rx-coverage-ignore errored: a 404 can't reach this page` ignores only that line's `errored` paths. A path's line is
its §1 line: a node's declaration, an edge's reading node, a boundary's head, a write's line for a guess, or the
action's declaration. For an arm path (boundary or action), use the arm's line instead of the head or declaration.

- An ignored path stays in the universe with `ignored: "<reason>"`, out of every count (summary, module and program
  totals, `--min`), out of `uncovered`; the report lists it under "Ignored" as
  `<file:line>  <label> — ignored (<reason>)`; the map draws it neutral (not dimmed, not faint) with `–` and its reason.
- No reason (`// rx-coverage-ignore`, `// rx-coverage-ignore node`), or an unknown kind: a warning naming file:line, not
  honoured. A comment that matches no path: a warning naming file:line.

Read by a source scan keyed by line over `graph.lines` (every non-empty line of every module), not from the model:
a comment is not a fact the checker resolves (the model is resolved facts; adding comments to it would carry trivia
through both checkers' parity for one consumer), and the graph already holds the lines for the map's labels.


What is not in the universe (v0.1): view sites (markup reads, props, handlers, effects): the runtime doesn't name them,
so they can't be observed; `snapshot`/`pre` reads and probes (they never carry a change, by definition); JS imports,
fns, components, contexts, error classes. Module and program totals are sums over these kinds.

Each path's `module`/`line`: node → the node's; edge → the reading node's (`to`) and the edge's `line`; boundary →
the region's module and `head.line` (falls back to the first line inside); guess → the edge's; action → the action's.

## 2. Observing runs: the collector

One core, fed TRACE-CONTRACT messages, used by every host:

```js
import { createCollector, universe } from "@reactivescript/map/coverage";
const c = createCollector({ graphs: [graph], tool: "vitest" });
c.feed(msg);             // any host → view message (flush, flight, boundary, run, caught, revert, held, released, snapshot)
c.begin("test name");    // attribute following hits to this test (optional)
c.end({ failed: false });
c.result();              // a coverage file (§3), this collector's runs only
c.trace(fromSeq?);       // a trace file (§4) of the messages since `begin`
```

The collector ignores `step`/`resume`/`hmr` (travel shows, it doesn't run behaviour) and instance suffixes. It keeps
the last value preview per key, so a flush change whose preview equals the previous one doesn't count as a change.

Hosts:
- **vitest / jsdom**: `@reactivescript/map/coverage/vitest`, a setup file. It `attach()`es to `./live` (the dev build
  registers the graph, as in `npm run dev`), feeds the collector, calls `begin`/`end` around each test (vitest's
  `beforeEach`/`afterEach`, the test's full name), and on the worker's teardown writes
  `<root>/.rx-coverage/run-<pid>-<n>.json`. Opt in with
  `test: { setupFiles: ["@reactivescript/map/coverage/vitest"] }` or the `rxCoverage()` Vite plugin (adds the setup
  file when `vitest` runs with `RX_COVERAGE=1` or `--coverage`-style env). `RX_COVERAGE_DIR` overrides the dir.
- **Browser / Playwright**: `@reactivescript/map/coverage/browser` installs `globalThis.__RX_COVERAGE__ = { begin, end,
  result, trace }` in the page (a dev build; import it in the entry or `page.addInitScript`). Node side:
  `collectBrowserCoverage(page, file)` from `@reactivescript/map/coverage` evaluates `result()` and writes it.
- **Scenario runner**: `node tooling/rx-map/scenarios.mjs [--coverage <file>] [filter]` runs the `scenarios/*.md`
  whose program is a file under `examples/` against the compiled dev build, with the bridge, one collector for the
  run (`begin("<scenario> / <table>")` per table), and writes one coverage file for all of them. (v0.2) It compiles
  with `rxc lower` (`dev: true`, the table's handler rows as `extra`: the Node-API `app()` takes no `extra`), compiles
  handler rows and resolve values with ref's `compileDynamic`, (v0.3) builds its graphs from `rxc model` (was the
  Node-API `model()`: code and graph now come from one `rxc` build), and drives one headless Chromium, a fresh page per
  table. It needs the repo (`ref/`, `rxc`), so it isn't shipped in the package. A wrong frame is reported and the table
  goes on; exit 1 if any table fails, the coverage file is written either way.

## 3. Coverage file

JSON, keys sorted, stable across runs of the same program, mergeable.

```ts
interface CoverageFile {
  rxCoverage: 1;
  modules: string[];                       // graph module paths in the universe
  paths: Record<string, Path>;              // the universe (§1), by id; (v0.3) Path.ignored?: string, the reason (§1b)
  hits: Record<string, { n: number; by: string[] }>;  // only observed paths; `by` ≤ 8 test/scenario names, sorted
  runs: { tool: string; name?: string; tests: number; failed: number; at: string }[];
  // (v0.3) optional, present when non-empty; derived from the graph like `paths`
  untyped?: Record<string, { id: string; callee: string; file?: string; line?: number; fix: "js" | "d.rx";
    actions: string[]; modules: string[] }>;                     // §1a, by the callee's key
  warnings?: Record<string, { module: string; line: number; message: string }>;   // §1b, `ignore:<module>:<line>`
}
```

(v0.3) The additions are optional and keyed, so the version stays 1 and old readers ignore them. `merge` unions
`untyped` (its `actions`/`modules` unioned) and `warnings` like `paths`; `rebase` recomputes both from the graph.

`merge(a, b, …)`: `paths` = union (a path id means the same thing in every file); `hits[id].n` summed, `by` unioned
(sorted, capped at 8); `runs` concatenated. Merge is associative and commutative (up to `runs` order). A hit whose id
isn't in `paths` is kept (a graph changed between runs) and reported as `stale`. `rebase(file, graph)` replaces
`paths` with `universe(graph)` and drops stale hits: the CLI does it when given the program's entry, so a module no
test imports still counts (0 of N).

## 4. Failing test → trace

When a test fails, the vitest setup writes `.rx-coverage/traces/<file>--<test slug>.rxtrace.json`:

```ts
interface TraceFile { rxTrace: 1; test: string; error?: string; graph: Graph; messages: Message[] }
```

`messages` are the host messages from the test's `begin` to its end, in order (TRACE-CONTRACT §2: this is the
"Recording" host of §4). `rx-map trace <file> -o out.html` (or `--open`) writes a map page that replays it: the timeline
holds the recorded flushes, the panel shows runs/boundaries/reverts, no travel (a recording can't show the app). The
failure's message prints the path: `rx trace: .rx-coverage/traces/….rxtrace.json`.

## 5. Outputs

- `rx-map coverage report [files…|dir] [--entry src/main.rx] [--module m] [--kind k] [--json]`: merges, rebases on the
  entry's graph when given, prints a table per module (`covered/total` per kind and all) and a program total, then
  the uncovered paths, one line each, file:line first, worded for a reviewer:
  - `src/IssueDetail.rx:30  no test makes errored (e) show its NotFound fallback`
  - `src/Users.rx:12  no test changes users`
  - `src/Users.rx:14  no test carries a change from page to users`
  - `src/Users.rx:9   no test shows loading on(query)`
  - `src/Users.rx:21  no test sees rename's guess on users reverted`
  - `src/Users.rx:21  no test makes rename reject with NotFound`
  Exit 0; `--min <pct>` exits 1 below that program total.
  (v0.3) Then "Untyped failures (not in the percentage):" (§1a), "Ignored (not in the percentage):" (§1b), and
  `warning: <file:line>  …` lines. `--json` adds `ignored`, `untyped`, `warnings`. `summary()` adds `ignored` and
  `untyped` (counts) beside the kinds.
- `rx-map coverage merge <files…> -o out.json`.
- Map: `rx-map <entry> --coverage <file>` (static) and live mode (the vitest collector's file is re-read on change,
  or the page's own bridge in `?coverage=live`): a **Coverage** layer: uncovered nodes/regions/actions dimmed and
  marked (a hollow dot), covered ones normal; an edge drawn faint when uncovered; each module card shows
  `covered/total`; the panel's selected-name tab lists the paths of that name with ✓/✗ and `by`.
- MCP (`tooling/rx-map/mcp.mjs`): `coverage({ module? })` → per-kind covered/total for the program or a module;
  `uncovered({ kind?, module? })` → the uncovered paths (id, file:line, label), at most 50, most important first
  (errored, action, guess, loading, node, edge). Both read the coverage file at `<root>/.rx-coverage/coverage.json` (or
  `RX_COVERAGE`), rebased on the served program's graph. (v0.3) Both leave ignored paths out; `coverage` adds
  `ignored` (a count) and `untyped: { count, list: [{ callee, file, line, actions, text }] }`.

## 6. Tests

- Unit (`node --test`): universe from fixture graphs (counts per kind, dispatch arms split, dead defaults excluded, action
  rejects from `decl.line`), collector over hand-written message streams for every kind, merge laws, report wording,
  MCP tools.
- Integration: the vitest setup in a template app (`test/shelf-app` or a round-4 repro copy) writes a file with
  nonzero hits; a deliberately failing test writes a trace and `rx-map trace` renders it.
- Scenarios: `scenarios.mjs` on `examples/` produces a coverage file; its report is checked in as
  `tooling/rx-map/test/fixtures/scenario-coverage.txt` (regenerated with `--update`).

## Open questions (v0.3)

1. **Edges are inferred.** Edge cover by co-change in one flush over-credits a node with several changed inputs (a flight
   `start`'s `cause` is exact; a recompute has none). It stays inference until the engine names every recompute's
   causes: rx-vision/solid-asks.md "From reactive coverage" 1.
2. **Guess outcomes are inferred.** Guess `confirmed`/`superseded` is correlated from the run, its reverts and the
   settling flush (§1 v0.2), not reported by Solid: solid-asks.md 2. Typed action catches are now recorded directly.
3. View sites (markup reads, effects, handlers) are out: the runtime doesn't name them. Left for later (effects at
   least could be named).
4. A node's initial value isn't a change: a constant source no test writes is uncovered on purpose. (v0.3) Answered by
   `// rx-coverage-ignore: <reason>` (§1b).
5. (v0.3) Untyped detection reads `await name(` and `fails …` off the source; the model could carry an awaited call's
   resolved rejections per action (the checker's own `stmtsFails`), which would make §1a exact.

# Review 1: RX dev tooling (rx/integ, slice7/hmr, map/cutover) and the two Solid drafts

Read-only review, 2026-11-25. Nothing was edited, committed or pushed; this file is the only output.

## Executive summary

1. **Merging map/cutover: not ready.** It is 18+ commits behind `rx/integ`, its committed `page.mjs` conflicts with integ's and must be rebuilt, and the cut-over conditions in MAP-IN-RX.md (full suite on the merged tree, visual side-by-side) are not evidenced (findings 2, 8).
2. **Merging slice7/hmr: already done.** It landed in `rx/integ` as `f62b713` while this review ran. Fine as an experiment on integ; not ready to go further (findings 5, 6, 7).
3. **Opening `solid-pr-store-guess-record`: nearly ready.** Small fixes first: commit the RX-shape repro, fix one comparator idiom, trim two comments (finding 10).
4. **Opening `solid-pr-list-rewrite-record`: not ready.** It leaves a new call on the production node-creation path, contrary to its own claim, and adds view state to store nodes that AGENTS.md rules out. Raise it on #5089 as a design question instead (finding 3).
5. **Proposing rx/integ upstream: not ready as one piece.** Split it: language fixes, dev keys, then tooling.
6. Top bug: the "lift an equation-only block fn" change makes `rxc check` accept programs `rxc app` refuses (two repros, finding 1).
7. "Production is unchanged" holds for compiler output (I checked 14/14 builds byte-identical to main's `rxc`), but the runtime's dev registry survives in an esbuild production bundle (finding 2).
8. The conformance suite's travel checks compare the host's messages with themselves; only `real-host.mjs` looks at the DOM, and it skips unless `SOLID_VIEW` is set (findings 4, 5).
9. Travel and HMR depend on unmerged Solid #5089 and read Solid private fields; no CI runs `tooling/rx-map` or the ref/crate equality check (findings 5, 7).
10. Not run: `real-host.mjs`, any `npm test`, the Solid suites. Verdicts on those rest on reading the code and the drafts' own result tables.

## What was reviewed

| tree | head | note |
| --- | --- | --- |
| `rx/integ` | `eb94185` at start, `cc21c2c` at the end | moved twice during the review: `f62b713` merged slice7/hmr, `cc21c2c` merged fix/lang-r6. Line numbers are as of `cc21c2c`. |
| `slice7/hmr` | `f097881` | now contained in `rx/integ` |
| `map/cutover` | `dfdebca` | merge base with integ is `23266d9` |
| `solid-guess-record` | `9a6e2ecb5` | off main `5420b4a7c` |
| `solid-list-record` | `fe9840c2a`, `365ab5cb1` | off `feat/signals-view` `24c8f59d8` (#5089) |

`TRACE-CONTRACT.md` also went from v0.6 to v0.7 during the review. Two drift findings I had (the partition rule contradicting `moved.to` in rerun, and `uncarried` missing from the contract) are fixed by v0.7 and are not listed.

Checked and found sound:
- Non-dev compiler output: `rxc app` for every example in `rx-integ/examples` (7 programs, dom and ssr), main's binary (`e650b85`) against integ's, compared by md5 of the whole JSON: 14/14 identical.
- Dev keys follow SLICE1 §1, including `#1` for a second `x` in an `else` branch (`d.rx|App|x`, `d.rx|App|x#1`), and a non-dev build of the same file has no `__rt.key`, `DevLoading` or `DevErrored`.
- `node build.mjs --check` passes in both `rx-integ` and `rx-map-cutover`.
- `/__rx/mcp` checks `Origin` against `Host` and requires `application/json` (`tooling/rx-map/vite.mjs`), so another site cannot call it from the browser.
- `@solidjs/vite-plugin` 3.0.1 as published already forwards `hotUpdate` to a front end, so slice 7 needs no fourth upstream change there.

## Findings

### 1. blocker (compiler, language): a lifted block `fn` passes `check` and then fails to compile

- **Where:** `compiler/src/emit.rs:1314-1327`, `ref/compile/emit.ts:419-429`, `instantiating_fn` in `compiler/src/check.rs:67` (commit `455e73b`).
- **What:** a `fn` whose block body holds only equations is no longer an instantiating fn. Its equations become plain `const`s evaluated per call. Two shapes fall through.
  - A nested `fn` in the body: the crate's loop is `let Decl::Eq { .. } = d else { continue }`, so the nested function is dropped. The ref emitter does emit it (`fns`), so ref and crate also disagree here.
  - An equation with `await`: it is emitted as an ordinary expression, where a non-tail `await` is not lowered.
- **Evidence** (current binary, built 00:13):
  ```
  fn total(xs: number[], k: number) { fn twice(n: number) => n * 2
    base = xs.length
    twice(base) + k }
  $ rxc check a.rx   → a.rx: ok
  $ rxc app a.rx     → {"error":"a.rx: not compiled: unbound twice"}

  fn first(id: number) { rows = await load(id)
    rows }
  $ rxc check b.rx   → b.rx: ok
  $ rxc app b.rx     → {"error":"b.rx: not compiled: `await` outside an equation's result position is not lowered yet"}
  ```
  On main both files are refused by the checker with `SNAPSHOT_ARGUMENT [E-10]`, so this is new.
- **Design problem underneath:** `x = e` in a block `fn` is now a memo if a sibling declaration is a `source` or `effect`, and a per-call local otherwise. Same syntax, two meanings, chosen by a neighbour. That is the "one way to do a thing" rule bent to fix a usability complaint (round 3, item 3).
- **Fix:** make the lift conditional on every declaration being a sync, unkeyed, non-deferred equation, and keep everything else instantiating (the checker then refuses as before). Emit nested value fns in the crate as the ref does. Add both repros as scenarios so `ref/crate.ts --lower` covers them. Put the two-meanings question to a ruling in `spec/` rather than leaving it as a side effect of the emitter.

### 2. major (prod leak): the dev registry reaches production bundles that are not built by Vite

- **Where:** `ref/compile/rt-web.ts:61-64` (`nm`, `key`), `:475-496` (`if (DEV)` block), `compiler/test/vite.mjs:95`.
- **What:** dev code is gated on `DEV` imported from `solid-js` at run time, not on a build-time constant or a separate export condition. It is inert in production, but it is only removed if the bundler folds an imported constant across modules. SLICE1 says "in production builds, `key` is just `(k, f) => f()`" and the done-criterion is "no `rx:` string".
- **Evidence:** the cutover's own page is a minified esbuild bundle over Solid's production dist (`IS_DEV = false`). Counting in `rx-map-cutover/tooling/rx-map/page.mjs`:
  ```
  __RX_NODES__: 1   __RX_BOUNDARIES__: 1   __RX_TRACE__: 1   __RX_HMR__: 4   rx:${ : 1
  ```
  The only test of the claim (`compiler/test/vite.mjs:95`) looks for the strings `rx:` and `@reactivescript/map` in a Vite build. That same test would fail on this bundle.
- **Also in that bundle:** `MISSING_TEST_API` and `jsError`, the harness code VISION §3.4 already lists as a leak (#80).
- **Fix:** ship the runtime with `development` / `production` export conditions (or a `__RX_DEV__` define folded at `runtime/build.mjs`), and assert on `__RX_` as well as `rx:` in a second bundler in the test.

### 3. blocker for opening (Solid, list-rewrite draft): prod is not untouched, and the state it adds is the kind AGENTS.md refuses

- **Where:** `solid-list-record/packages/signals/src/store/store.ts` (`bornFrame`, `readSource`, `nodeValue`, `setViewPinHook`), `core/guesses.ts`, `store/optimistic.ts` (`relist`).
- **Prod claim is wrong.** The draft says "prod folds every branch away, checked in `dist/prod`". The branches fold; the function does not. From the worktree's own `dist/prod/store/store.js`:
  ```js
  function bornFrame(e) {
      e.k;
      return committed(e);
  }
  ... slotSignal(bornFrame(e)[t], slotNodeEquals, ...)      // getNode
  ... slotSignal(t in bornFrame(e), isEqual, ...)           // getHasNode
  ```
  That is an extra call plus a dead property read on every store node creation in production, in code the file's own comments call the "create-floor diet".
- **What a maintainer would push back on:**
  - `vp` is an untyped expando on signal nodes, set by a hook and cleared as a side effect of a read inside `getNode`. AGENTS.md: "a note of what the screen is showing ... a per-node map or list ... A fix that needs one is not a fix. Stop and bring the case to the maintainer."
  - `relist` makes a guess carrier readable again after its action ended. AGENTS.md: "Do not add engine state so that a guess can come back".
  - `guesses.ts` gets an exception in `optimisticWrite` (a pin is written even when the comparator says equal). The draft itself says a structural fix would be better.
  - Three mechanisms in the store's read path for a devtools feature that is itself an unmerged draft.
- **Untested by the draft's own account:** `has`/`in` nodes born under a pin, a keyed optimistic list guessed over across an await, `Object.keys` on a rewritten list under a view.
- **Fix:** do not open it as a PR. Post the root-cause analysis (it is good) on #5089 as "three gaps a view has over store lists, here is a working patch, which layer should own this", with the JSX-and-screen-per-step form AGENTS.md asks for. If it stays in the store, inline `bornFrame` behind `__OBSERVE__` at both call sites so prod is byte-identical, and show the `dist/prod` diff as empty.

### 4. major (conformance): the travel checks cannot fail on a host whose app shows the wrong thing

- **Where:** `tooling/rx-map/conformance.mjs:336-360` ("travel matches replay", "step changes exact"), `:362-400` ("travel commutative"), `:424` ("flushes during viewing kept"), and the host at `tooling/rx-map/live.mjs:864`.
- **What:** the suite rebuilds state from the host's `flush` messages (`reconstruct`) and compares it with the host's `step.changes`. The real host computes `step.changes` as `diffValues(valuesAt(from), valuesAt(to))`, from the same recorded steps, with the same first-change-`prev` rule. Both sides are one algorithm written twice. Nothing reads what the app shows after `view.show(pins)`.
- **Consequences:**
  - A wrong pin set, a list that does not rewind, or a disposed instance's value on screen all pass.
  - "flushes during viewing kept" is `!leaked && tl.steps.length >= stepsNow().length`, which holds whenever the timeline is not shorter than itself. It does not check that the `act()` made while viewing landed.
  - None of the v0.3–v0.6 additions (`snapshot`, `boundary`, `run`, `revert`, `held`, error-as-state, per-instance values) appear in the suite at all (`grep -c` for those words: 0), though §0 says each minor change extends it.
- **The contract leans on this:** "the real host must pass the same conformance suite before it ships".
- **Fix:** give `makeHost` an optional `shown(keys)` that returns what the app displays now (the real host: `inspect`; the fake: its true state), and compare that after every `travel` and `resume`. Move the DOM-per-seq check from `real-host.mjs` into the contract as the arbiter for real hosts.

### 5. major (claims without tests): the only real checks of travel and HMR skip by default, and nothing runs in CI

- **Where:** `tooling/rx-map/test/real-host.mjs:25-27`, `tooling/rx-map/package.json:65`, `.github/workflows/` (compiler, editor, runtime, tree-sitter only).
- **What:**
  - `npm test` ends with `node test/real-host.mjs`, which prints `skip` and exits 0 unless `SOLID_VIEW` points at a built Solid with `openView`. Every HMR assertion slice 7 added (191 lines) lives in that file.
  - No workflow runs `tooling/rx-map` tests, `ref/crate.ts`, or `ref/crate.ts --lower --dev`. "ref and crate kept byte-equal" is a local habit; finding 1 is a case where they already differ.
  - "Byte-equal" in `ref/crate.ts` means equal after esbuild normalisation with comments dropped, which is fine, but say so.
  - `usability/map-in-rx.md` records "(a) travel shows the recorded DOM at every seq fails at seq 10" for both pages at one point. I could not confirm it is green now without running it.
- **Fix:** a CI job that builds the pinned Solid view branch and runs `real-host.mjs` with `SOLID_VIEW` set, failing rather than skipping when it is unset in CI; add `crate.ts`, `--lower`, `--lower --dev` to `compiler.yml`.

### 6. major (HMR, hacks): state carry-over rides on a global and a redefined `untrack`

- **Where:** `ref/compile/rt-web.ts:475-496`, `tooling/rx-map/live.mjs:348-430`, `compiler/vite.mjs:179-188`.
- **What:**
  - In dev, `app.untrack` is replaced: while a key is current and `globalThis.__RX_HMR__.carry` has an unused seed for it, `__rt.untrack(...)` returns the seed and does not run its argument. It works because the source initialiser is the first `untrack` evaluated under `__rt.key`. `__rt.untrack` is also what `peek`, draft seeds and value arguments lower to, so this depends on emission order that no test pins.
  - `__RX_HMR__` is one global for the page. Two programs on one page (the "shared" Vite test shape) share it for the length of a replacement flush; a keyed source created in the other program in that flush takes the seed.
  - A key is carried only when exactly one registration exists (`sourceAt`: `entries.size === 1`). A question source with a hoisted await or a `catch` registers two or more per instance, so it is always "uncarried". Multi-instance components are never carried. Both are reported honestly as `uncarried`, but spec/11 item 12 reads as if carry is the norm.
  - `app.module` clears every module instance on replacement, so a shared module's state is rebuilt for every edit, including edits to an unrelated component.
  - The entry is rewritten with a regex on emitted text (`/^export default function main\(/m`).
  - HMR only exists when `@reactivescript/map` is installed: the planner lives in the devtools package and the compiler front end loads it from the project. Whether an app keeps state on save should not depend on a devtools package.
  - `replaceModule` waits on `while (landing) await …` with no bound; a landing that never finishes blocks every later replacement (they are chained on one promise).
- **Fix:** have the dev lowering pass the initialiser as a thunk (`__rt.source(name, () => init, …)` under a dev flag) so the runtime decides whether to run it; scope the carry to the app instance; move `planHmr` and the carry rules into the compiler package (the map can import them); have the crate emit the hot entry rather than patching text.

### 7. major (upstream fit): the bridge reads Solid private fields and an unmerged API

- **Where:** `tooling/rx-map/live.mjs:65` (`{ transparent: true, _plumbing: true }`), `:405` (`node._fn`, `node._x?._q`), `:1150` (`node._x?._inFlight`), `:1163` (`node._flags & (1 << 6)`), `:1209` (`_host`, `pk`, `u`); `rt-web.ts` takes the node from an accessor with `$REFRESH`.
- **What:** these are engine internals. Solid's own source says the observe artifact mangles `_plumbing`; field names and flag bits are not API. Travel and the HMR transaction need `openView` (#5089, draft) and are exact only with the two local drafts on top. On stock Solid 2.0 travel answers `travel-denied "unsupported"`.
- **Why it matters for (iv):** proposing rx/integ upstream as it stands means proposing a tool whose headline features need three unmerged Solid changes and break on a rename.
- **Fix:** list the reads the bridge needs (flight start, disposed, store path of a leaf, node of an accessor) and ask for them on the attribution records in #5089. Until then, feature-detect each and say which Solid the map supports in the README.

### 8. major (map/cutover): what has to be true before the switch

- **Stale against integ.** Files changed on both sides since the merge base: `tooling/rx-map/page.mjs`, `README.md`. `page.mjs` is generated on both sides and embeds `hmr.mjs`/`fake.mjs`, which slice 7 changed. The merge needs a rebuild and the whole suite rerun, including `real-host.mjs` with the RX page.
- **The committed artifact is not reproducible.** `build.mjs` builds from the local native compiler, `ref/node_modules/solid-js` (a symlink to `solid-next`, built from source at the pin), `runtime/dist` and esbuild, minified, and `npm test` starts with `build.mjs --check` for byte equality. Any change to the compiler, the runtime, the Solid pin or esbuild makes a 451 KB committed file stale. `prepack` needs that whole environment.
- **The page is about one third RX.** `app/*.rx` is 1,237 lines; `app/js/*.js` is about 2,440. 43 `innerHTML` attributes carry most markup that has an icon. The builders I read escape app-supplied text (`lverrHTML`, `tripHTML`, `heldHTML`, `incomingHTML`); `legend.rx:68` interpolates `props.text` unescaped, which is static today.
- **`pure` is doing work it cannot back.** `graphAt` reads a JS array that `putGraph` appends to, and is declared `pure` so an equation can call it. `decisions/draft-updaters.md` already moved `reduce` to `fn`; the same question applies here. This is the unchecked edge of the language and the port leans on it.
- **v0.7 `uncarried` is shown by neither page** (no match in `map.html`, `app/*.rx`, `app/js`, `fake.mjs`).
- **Not evidenced:** the side-by-side review at 1440x900 and 1440x360 that MAP-IN-RX.md makes a condition. `test/shots.mjs` exists; I found no record that the review happened.
- **Fix:** merge integ into cutover, rebuild, rerun everything with `SOLID_VIEW` set, record the visual review, and either stop committing `page.mjs` (build at `prepack`, check in CI) or pin every input it is built from.

### 9. major (travel): a travel request can wait forever

- **Where:** `tooling/rx-map/live.mjs:809-826` (`holding`, `tryQueued`).
- **What:** travel waits while any flight is open, any action runs or any write is held, then retries every 50 ms with no limit and no further message. The round-3 app polls chat every 2 s and presence every 5 s at 150–900 ms latency; under `?slow` (×4) a flight is nearly always open. The view gets `travel-pending` and nothing else. Round-3 browser tester already reported the older form of this ("can't travel to #111: pending").
- **Fix:** after a bound (say 3 s) answer `travel-denied` with reason `pending` and the keys still in flight, which v0.6 allows, so the view can say what it is waiting on.

### 10. minor, fix before opening (Solid, store-guess-record draft)

- **Where:** `solid-guess-record/packages/signals/src/core/attribution.ts` (`guessedKeys`, `mergeKeyed`).
- **The motivating shape is not tested.** All four new tests use `createOptimisticStore(db.fetch, …)`. RX lowers a guessed `:=` source to `createOptimisticStore(() => get(), [])` chained over another store, and the draft's RX repro (`store-guess-gap.test.ts`) is "uncommitted". The sibling draft notes that a chained carrier's `prev`/`value` can be the inner store's live proxy; `guessedKeys` reads `shown[key]` and `now[key]` off those frames. Commit the chained case as a fifth test.
- **Comparator idiom.** `!leaf._equals?.call(leaf, a, b)` throws when `_equals` is `false`, which the type allows (`_equals: false | (…)`) and the store uses for the deep witness:
  ```
  $ node -e 'const leaf={_equals:false}; leaf._equals?.call(leaf,1,2)'
  TypeError: leaf._equals?.call is not a function
  ```
  Leaves in `t.n` use `slotNodeEquals` today, so it is latent. Use the file's own form: `!leaf._equals || !leaf._equals(a, b)`.
- **Retained nodes.** `Watched.keys` keeps strong references to leaf and presence nodes a reader has released, and lists them in the record. The draft says so. A maintainer will ask whether a record should name a node that is no longer in the graph; have the answer ready (it is the node the screen showed the value through).
- **Comment policy.** "A key's node a reader let go once the lift took the key away …" narrates and cites no rule; AGENTS.md wants a short why ending in an F/D/S id.
- **Good as is:** changeset present, public-surface change flagged as its own item, rules cited, no core or store file touched, `attribution.prod.ts` untouched.

### 11. minor (prod output, changelog): behaviour changes ship with one changelog line about the map

- **Where:** `compiler/src/emit.rs` (`real_import`), `ref/compile/rt-web.ts` and `rt-server.ts` (`api`), `CHANGELOG.md`.
- **What:** with main's examples (which have `examples/api.mjs` beside them), 10 of 14 builds differ between main's `rxc` and integ's:
  ```
  < const v$fetchProducts = __rt.api("fetchProducts");
  > import { fetchProducts as w$fetchProducts, … } from "./api";
  > const v$fetchProducts = w$fetchProducts;
  ```
  That is the intended MO-8c change (a real file beside the module wins over the injected API), and integ renamed the example file to keep its own output stable. An app that has `./api.js` and passes `createApp({ api })` changes behaviour on upgrade. The runtime also now throws `MISSING_TEST_API` where it used to make a flight. New errors `DEAD_TYPED_BOUNDARY` and `STYLE_SCOPE`, cooked escapes, JSX whitespace and the fn lift are all user-visible too.
- **Also:** in the crate `real_import` has a `product` clause the ref lacks, so the two differ for product builds, which `crate.ts` does not exercise.
- **Fix:** changelog entries marked breaking for each; a `crate.ts` case for a product-mode relative import.

### 12. minor (dev runtime): smaller items

- **`DevLoading` may shift hydration ids in dev SSR.** The client is compiled dev (`target === "dom"`), the server is not. `traceBoundary` creates a render effect inside the fallback getter on the client only. If that effect takes a child id, fallback content hydrates against different ids in dev. Not verified; there is no dev-hydration test. Worth one.
- **The timeline retains engine nodes.** `raws` holds node references and previous values for up to 2000 steps, so disposed components' nodes and their values stay reachable in dev.
- **One key, many instances.** `inspect` shows the newest instance (`[...entries].at(-1)`); `for` rows and repeated components collapse to one value. Round-3 MCP tester hit this ("duplicate column instances shared one `rows` preview"). The contract says so; the map does not.
- **Inline handlers have no key**, so their runs are not `run` records and `why` falls back to the engine's origin.
- **`DEAD_TYPED_BOUNDARY` is an error, and the model also carries `deadTyped`.** A failure thrown by the inner catch-all's own fallback would still reach the outer typed boundary, so "dead" is slightly too strong for an error. I did not build a repro.

## Suggested order

1. Fix finding 1 (two repros, both small) and add the CI jobs in finding 5. These gate everything else.
2. Runtime dev/prod split (finding 2), then merge integ into cutover and rerun (finding 8).
3. Open the store-guess-record PR after finding 10; take the list-rewrite analysis to #5089 as a question (finding 3).
4. Upstream rx/integ in three PRs: language fixes with changelog, dev keys and `model` additions, then tooling once #5089 settles.

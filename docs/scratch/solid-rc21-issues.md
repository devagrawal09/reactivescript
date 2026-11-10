# Draft: GitHub issues for solidjs/solid against 2.0.0-rc.21 (2105ffb8)

**Status: draft. Nothing here has been filed or posted.** Written 2026-11-08 from the ReactiveScript
rust-solid fuzz artifacts (`rust-solid/docs/*-fuzz/port/` in this repository).

Each `## Issue` section is meant to be pasted as one GitHub issue. The text between the `---` rules
of a section is the issue body. The **Notes for us** block under each section is not for the issue.
It holds our assessment, the evidence behind the pointer, and what we checked upstream.

## Common facts (all sections)

- **Version:** `solid-js` / `@solidjs/signals` / `@solidjs/universal` / `@solidjs/web` `2.0.0-rc.21`. Commit
  `2105ffb8ca2fced55f5fac0763177fc93f97c2c2` ("Merge pull request #4443 from solidjs/changeset-release/next").
  The repros use the built `packages/*/dist` of that commit, read-only at the repository's `solid-next/` (`scripts/setup.sh`; the recorded runs used `/workspace/rx-tsx-refresh/solid-next`).
- **Runtime:** Node v24.11.1 (`nix shell nixpkgs#nodejs_24`), Linux. Each repro was run on the prod build
  (`solid.js`, `@solidjs/signals` `dist/prod`) and on the dev build (`solid.dev.js` with `--conditions=development`).
  Wherever a dev result differs, the section says how.
- **Repros:** each repro is one self-contained ES module that uses only the public API of `solid-js`
  (and `@solidjs/universal` for issue 3). A comment at the top gives the import path. The repros import the
  built package by a path relative to this repository's `solid-next/` checkout, so change the path, or set `SOLID_JS`, before running them elsewhere. The same files,
  their recorded outputs (`out/*.prod.txt`, `out/*.dev.txt`) and `run-all.sh` are in
  [solid-rc21-repros/](solid-rc21-repros/). The outputs quoted below come from those files. Long stack traces are cut where marked `…`.
- **How found (shared paragraph for the issues):**

  > Found by differential fuzzing. We generate random programs over a small op language: signals,
  > optimistic signals/stores, memos, async memos with controllable promises, actions, refresh, `mapArray`,
  > and universal-renderer `insert`. We run each program on Solid 2.0.0-rc.21 and on an independent
  > re-implementation, then compare event traces. When Solid itself throws, halts reactivity, or yields
  > a value the op language cannot produce (an `Error` object or `undefined` where only numbers flow),
  > the program is not counted as an agreement. We set it aside, reduce it (delta debugging) and
  > rewrite it by hand on Solid's public API. That rewrite is the repro below.

## Summary

| # | Title (short) | Package | Our verdict | Fuzz evidence |
|---|---|---|---|---|
| 1 | `take()` of a held optimistic-store slot leaves `CONFIG_HELD` with a null transaction → `TypeError` in `resolveTx` | signals | **likely bug** (high confidence) | `--slice2b` seeds 1430, 4623, 5270, 7335 of 1–8000 |
| 2 | Store arrays expose holes: `i in arr` is false below `length` while `arr[i]` is a row, and `mapArray`'s key function gets `undefined` | signals | **likely bug** (high; 2c may be a separate defect) | `--slice2c` 15 of 1–8000 (493, 2723, 2907, 4857, 5042, 7869, + 9 untriaged) |
| 3 | `@solidjs/universal` `reconcileArrays` removes a node another region took (no liveness check) | universal | **likely bug, low severity** (parity gap with `@solidjs/web`) | `--render` 28 of 1–3000 |
| 4a | A user effect's callback runs with `undefined` (a value its compute never returned) after an error | signals | **likely bug** (high) | `--slice2a` 16 of the 24 `oracle-nonscalar` seeds of 1–3000 |
| 4b | A staged error is served as a value: a memo read returns the `StatusError` object, and a memo gets it as `prev` | signals | **likely bug** (high) | `--slice2a` seed 629 + 7 of the 24 (488, 663, 1778, 1950, 2558, 2583, 2667) |
| 4c | `latest(memo)` returns `undefined` for a held memo whose first answer was an error | signals | **likely bug** (medium-high) | `--slice2a` 873, 2582 |
| 5 | A flush never returns: an error boundary's content pass that calls `isPending` re-derives at every landing, and each pass opens a transaction that lands at once | signals | **likely bug** (high: the prod build hangs, the dev build throws "Potential Infinite Loop Detected") | `--boundaries` 36 of 1–3000 (15 of 1–1000: 21, 90, 141, …) |
| 6 | Streamed hydration: an `<Errored>` over two `<Loading>`s, one failing and the other landing after it, ends differently by when the client hydrates (after the shell: the second boundary's content and no fallback; after the last chunk: the fallback) | web / solid (client hydration) | **suspected** (not triaged, no standalone repro) | frontend SSR fuzz v2.1: the continuation after the last chunk differs from the one after the shell in 16 of 1–1000 (28, 58, 111, …) and 42 of 1001–3000 |
| 7 | A renderToString page, hydrated, does not behave as the same app mounted on the client: a `Show` toggled off and on around `Errored` > `Loading` > `Loading`, after a rejected request, shows nothing | web / solid (client hydration) | **suspected** (not triaged, no standalone repro) | frontend SSR fuzz v2.1: seed 1916 of 1–3000 |

The 4x rows are three separate defects. The 24 `--slice2a` seeds split 16 / 7 / 2, and 873 shows both 4a and 4c.

Upstream check, read-only:
- `/workspace/solid`'s `origin/next` (38e0c493, 2026-10-28) is older than rc.21. No local branch has commits after 2105ffb8.
- `gh search` found no existing issue for any of these.
- `next` on GitHub has moved since rc.21 (2026-11-03). Merged since then: #4682, #4687, #4693, #4717 (2026-11-08, "M1 lane value model"), #4720. Open: #4705, "publish latest errors with their readers".
- **We have not re-run the repros on that newer `next`.** We only fetched these raw files from `next` and read them: `lanes.ts`, `truth.ts`, `effect.ts`, `verdict.ts`, `universal.ts`, `store.ts`. Each section says what that reading shows. Before filing, re-run every repro on current `next`.

---------------------------------------------------------------------------------------------------

## Issue 1

**Title:** `[2.0 / next] Derived optimistic store: re-asking in another action's lane throws "Cannot read properties of null (reading '_into')" (take() of a held slot keeps CONFIG_HELD)`

---

### Environment

`solid-js` 2.0.0-rc.21 (`@solidjs/signals` 2.0.0-rc.21, commit 2105ffb8), Node 24. Prod and dev builds both throw.

### Repro

A derived optimistic store (`createOptimisticStore(fn, [], { key: "id" })`) reads an optimistic signal `page`. The repro has four steps:
1. Action A guesses a row removal and stays pending.
2. A mainline `refresh()` answers beneath that guess.
3. Action B guesses `page`, so the store re-asks in B's lane.
4. B's answer lands, and the flush throws inside Solid.

```js
// solid-js 2.0.0-rc.21 (solidjs/solid@2105ffb8). In an app: import * as S from "solid-js".
// Here the built package is imported by path (override with SOLID_JS=...). Node 24:
//   node 1-take-held.mjs
//   SOLID_JS=.../packages/solid/dist/solid.dev.js node --conditions=development 1-take-held.mjs
const S = await import(process.env.SOLID_JS ?? new URL("../../../solid-next/packages/solid/dist/solid.js", import.meta.url).href);

const flights = new Map();
const flight = id => {
  let f = flights.get(id);
  if (!f) {
    let resolve;
    const promise = new Promise(r => (resolve = r));
    flights.set(id, (f = { promise, resolve }));
  }
  return f;
};
const drain = async () => { for (let i = 0; i < 32; i++) await Promise.resolve(); S.flush(); };

let setPage, list, setList;
const asked = new Map();
S.createRoot(() => {
  let page;
  [page, setPage] = S.createOptimistic(0);
  // A derived optimistic store; each derive run asks a fresh question "list:<page>#<n>".
  [list, setList] = S.createOptimisticStore(
    () => {
      const k = page(), n = (asked.get(k) ?? 0) + 1;
      asked.set(k, n);
      console.log("derive asks", `list:${k}#${n}`);
      return flight(`list:${k}#${n}`).promise;
    },
    [],
    { key: "id" }
  );
  S.createRenderEffect(
    () => { const ids = []; for (let i = 0; i < list.length; i++) ids.push(list[i].id); return ids; },
    ids => console.log("rows", JSON.stringify(ids))
  );
});
flight("list:0#1").resolve([{ id: 2 }, { id: 3 }]);
await drain(); // rows [2,3]

// Action A: optimistically remove row 2, then wait on a save that never settles.
S.action(function* () {
  setList(d => { d.splice(d.findIndex(r => r.id === 2), 1); });
  yield flight("save").promise;
})();
// A mainline refresh; its answer lands beneath A's guess.
S.refresh(list);
await drain();
flight("list:0#2").resolve([{ id: 1 }]);
await drain();

// Action B: guess the derive's input; the store re-asks in B's lane.
S.action(function* () {
  setPage(1);
  yield flight("nav").promise;
})();
flight("list:1#1").resolve([]);
await drain();
console.log("done");
```

### Actual

Prod (`out/1-take-held.prod.txt`):

```
derive asks list:0#1
rows [2,3]
derive asks list:0#2
rows [3]
rows [3]
derive asks list:1#1
[REACTIVITY_HALTED] TypeError: Cannot read properties of null (reading 'eo')
…
[exit code 1]
```

```
TypeError: Cannot read properties of null (reading 'eo')
    at resolveTx (…/signals/dist/prod/core/scheduler.js:246:14)
    at txOf (…/signals/dist/prod/core/scheduler.js:236:21)
    at setSignal (…/signals/dist/prod/core/core.js:1664:43)
    at leafSet (…/signals/dist/prod/store/store.js:986:5)
    at notifyKeyDiff (…/signals/dist/prod/store/store.js:1009:74)
    at applyAdopt (…/signals/dist/prod/store/reconcile.js:182:48)
    at reconcileState (…/signals/dist/prod/store/reconcile.js:59:5)
    at …/signals/dist/prod/store/projection.js:260:45
```

Dev: the same sequence, then `[REACTIVITY_HALTED] … in computed TypeError: Cannot read properties of null (reading '_into')` (`dev-shared.js:1994`, `resolveTx`).
Reactivity is halted and the process exits with code 1. The throw escapes `flush()`.

### Expected

No internal `TypeError`. When B's question (`list:1#1`) is answered, the store shows B's answer in B's lane, or holds it until B settles. Either way the system keeps running.

### Where it seems to come from

`packages/signals/src/core/lanes.ts:174-181`, `take(n, l, d)`:

```ts
n._config &= d ? ~(CONFIG_GUESS | CONFIG_OVERRIDE) : ~CONFIG_GUESS;
if (d) ((x._transaction = null), (x._lane = NOT_PENDING));
```

`GlobalQueue._slotTake` (`store/optimistic.ts:353-374`, the call at line 372) calls this for a store target's other guessed slots, when the store's derive re-asks in another action's lane. With `d` set, it nulls the slot's `_x._transaction` but keeps `CONFIG_HELD`. That flag was set when a landing was held beneath the guess (`laneWrite`, `core/lanes.ts:982-987`, `el._config |= CONFIG_HELD`). The next write to that slot is the re-ask's landing: `reconcile` → `applyAdopt` → `notifyKeyDiff` → `leafSet` → `setSignal`. That write takes the held arm, `if (el._config & CONFIG_HELD) joinFuture(txOf(el))` (`core/core.ts:2727`). `txOf` → `resolveTx(null)` (`core/scheduler.ts:405-417`) then throws. A render effect reading the slot (`read` → `frameRead`) can hit the same null.

The pattern matches the case fixed earlier for lane-taken readers. `tests/fuzz-findings-l2.test.ts:385-392`, F5: "the hold flag outlived the lane stamp and the next pass resolved a null transaction (`txOf` → `resolveTx(null)`)". This is the store-slot variant of it.

### How found

(shared paragraph above) Seeds 1430, 4623, 5270 and 7335 of `--slice2b` 1–8000 all reach this throw. In an instrumented copy of the dist, each throw follows `take(d=true)` on a node that has `CONFIG_HELD` set. The repro above is derived by hand from seed 4623's 12-op reduction and written on the public API.

---

**Notes for us (not for the issue):**
- Verdict: **likely bug**. A public-API program makes Solid throw an internal `TypeError` and halt reactivity. The throw comes from an inconsistent internal state: held, with no transaction. It does not come from a usage error.
- Repro rework: the earlier repro was `docs/slice2b-fuzz/port/solid-bug-take-held.mjs`, from seed 5270. **That program writes the optimistic store before its first answer has landed.** On the dev build it is refused with `[OPTIMISTIC_WRITE_BEFORE_LOAD]` before reaching the bug, so it would be dismissed as misuse. The repro above, from seed 4623, writes only after the store has loaded and throws on both builds.
- Instrumented evidence: `/tmp/rc21/sig` (scratch copy of `dist/prod`) logged `take(d=true) on a node with CONFIG_HELD=true` before the throw.
- Scratch experiment, not a proposed fix: adding `n._config &= ~CONFIG_HELD` to the `d` arm of `take` in a copy of the dist removes the throw, and the render effect then shows `rows []`. Whether the held landing should be kept or dropped there is for the maintainers.
- Upstream `next`, read only: `take` was rewritten by the M1 lane model (#4717), but its `d` arm is still `if (d) x._transaction = null;` with no `CONFIG_HELD` clear. Not re-run there.

---------------------------------------------------------------------------------------------------

## Issue 2

**Title:** `[2.0 / next] Store arrays expose holes below length: \`i in arr\` is false while \`arr[i]\` is a row, so mapArray hands its key function undefined (plain and optimistic stores)`

---

### Environment

`solid-js` 2.0.0-rc.21 (commit 2105ffb8), Node 24. Prod and dev builds give identical output.

### Summary

During a `mapArray` pass a store array can report `length` n and return a row for `arr[i]`, and still answer `i in arr === false`.
- `mapArray` snapshots the list with `newItems.slice(0)`. `Array.prototype.slice` copies only indices where `HasProperty` is true, so the snapshot gets a hole.
- The next pass then hands `undefined` to the key function. A natural `keyed: r => r.id` throws `TypeError: Cannot read properties of undefined (reading 'id')`. Under a render effect, that halts reactivity.

We have three repros. A and B are the has/get mismatch. C is a lasting hole in an optimistic store's view, which may be a separate defect.

### Repro A: plain `createStore` (no optimistic API)

A pending action holds the list: its edit found nothing to edit and wrote nothing. Meanwhile mainline code reconciles and pushes.

```js
// solid-js 2.0.0-rc.21 (solidjs/solid@2105ffb8). In an app: import * as S from "solid-js".
// Here the built package is imported by path (override with SOLID_JS=...). Node 24.
const S = await import(process.env.SOLID_JS ?? new URL("../../../solid-next/packages/solid/dist/solid.js", import.meta.url).href);

const drain = async () => { for (let i = 0; i < 32; i++) await Promise.resolve(); S.flush(); };
const out = [];
let resolve;
const flight = new Promise(r => (resolve = r));

// A PLAIN store (createStore, not optimistic).
const [st, set] = S.createStore({ list: [] });
S.createRoot(() => {
  const rows = S.mapArray(
    () => {
      const l = st.list;
      // What the pass sees, untracked: `i in list` and list[i].id for each index below length.
      S.untrack(() => { const seen = []; for (let i = 0; i < l.length; i++) seen.push(`${i in l}:${l[i]?.id}`); out.push(`pass sees length ${l.length} [${seen}]`); });
      return l;
    },
    item => item().id,
    { keyed: row => { if (row === undefined) { out.push("key function called with undefined"); return undefined; } return row.id; } }
  );
  S.createRenderEffect(() => rows(), v => { out.push("mapped " + JSON.stringify(v)); });
});
set(d => { d.list.unshift({ id: 6 }); });
S.flush();
// An action whose edit finds no row 3 (writes nothing), pending on `flight`.
S.action(function* () {
  set(d => { const r = d.list.find(r => r.id === 3); if (r) r.a = 9; });
  const v = yield flight;
  set(d => { const r = d.list.find(r => r.id === 3); if (r) r.t = v; });
})();
set(S.reconcile({ list: [] }, "id"));
S.flush();
set(d => { d.list.push({ id: 8 }); });
S.flush();
set(S.reconcile({ list: [{ id: 9 }] }, "id"));
resolve(1);
await drain();
console.log(out.join("\n"));
```

Actual (`out/2a-plain-store-hole.prod.txt`):

```
pass sees length 0 []
mapped []
pass sees length 1 [true:6]
mapped [6]
pass sees length 0 []
pass sees length 1 [false:8]
pass sees length 1 [true:9]
key function called with undefined
key function called with undefined
key function called with undefined
mapped [9]
[exit code 0]
```

The 6th line is the mismatch: `length 1 [false:8]` means `0 in list` is false while `list[0].id` is 8. The key function then receives `undefined` three times.

### Repro B: `createOptimisticStore`, overlapping actions

```js
// solid-js 2.0.0-rc.21 (solidjs/solid@2105ffb8). In an app: import * as S from "solid-js".
// Here the built package is imported by path (override with SOLID_JS=...). Node 24.
const S = await import(process.env.SOLID_JS ?? new URL("../../../solid-next/packages/solid/dist/solid.js", import.meta.url).href);

const deferred = () => { let resolve; const promise = new Promise(r => (resolve = r)); return { promise, resolve }; };
const drain = async () => { for (let i = 0; i < 32; i++) await Promise.resolve(); S.flush(); };
const never = new Promise(() => {});
const [store, setStore] = S.createOptimisticStore({ list: [{ id: 2 }, { id: 3 }] });
const indexOf = (l, id) => l.findIndex(r => r.id === id);

const seen = [];
S.createRoot(() => {
  const rows = S.mapArray(
    () => {
      const l = store.list;
      // What the pass sees, untracked: every index below length should be `in` the array.
      S.untrack(() => { for (let i = 0; i < l.length; i++) if (!(i in l)) seen.push(`pass: length ${l.length}, list[${i}] is row ${l[i]?.id}, but (${i} in list) is false`); });
      return l;
    },
    item => item,
    { keyed: row => { if (row === undefined) seen.push("key function called with undefined"); return row?.id; } }
  );
  S.createRenderEffect(() => rows().length, () => {});
});
S.flush();

// c0 (pending forever): guess removing row 4, which does not exist (writes nothing).
S.action(function* () { setStore(d => { const i = indexOf(d.list, 4); if (i >= 0) d.list.splice(i, 1); }); yield never; })();
// c1: guess the reversed list (the setter returns a replacement); its flight settles.
const c1 = deferred();
S.action(function* () { setStore(d => ({ list: [...d.list].reverse() })); yield c1.promise; })();
c1.resolve(); await drain();
// c2: guess a pushed row 6; after its flight, remove row 2.
const c2 = deferred();
S.action(function* () {
  setStore(d => { d.list.push({ id: 6 }); });
  yield c2.promise;
  setStore(d => { const i = indexOf(d.list, 2); if (i >= 0) d.list.splice(i, 1); });
})();
// c3: guess row 2 moved to the front; its flight settles first.
const c3 = deferred();
S.action(function* () { setStore(d => { d.list.unshift(...d.list.splice(indexOf(d.list, 2), 1)); }); yield c3.promise; })();
c3.resolve(); await drain();
c2.resolve(); await drain();
console.log(seen.length ? seen.join("\n") : "not reproduced");
```

Actual (`out/2b-optimistic-has-get.prod.txt`):

```
pass: length 3, list[2] is row 6, but (2 in list) is false
key function called with undefined
key function called with undefined
key function called with undefined
[exit code 0]
```

### Repro C: lasting hole in an optimistic view (no mapArray needed)

```js
// solid-js 2.0.0-rc.21 (solidjs/solid@2105ffb8). In an app: import * as S from "solid-js".
// Here the built package is imported by path (override with SOLID_JS=...). Node 24.
const S = await import(process.env.SOLID_JS ?? new URL("../../../solid-next/packages/solid/dist/solid.js", import.meta.url).href);

const [store, setStore] = S.createOptimisticStore({ list: [{ id: 1 }, { id: 2 }, { id: 3 }] });
const remove = id => d => { const i = d.list.findIndex(r => r.id === id); if (i >= 0) d.list.splice(i, 1); };
const moveToFront = id => d => { const i = d.list.findIndex(r => r.id === id); d.list.unshift(...d.list.splice(i, 1)); };

const views = [];
S.createRoot(() =>
  S.createRenderEffect(
    () => { const l = store.list, ids = []; for (let i = 0; i < l.length; i++) ids.push(l[i] === undefined ? "undefined" : l[i].id); return ids; },
    ids => { views.push(JSON.stringify(ids)); }
  )
);
S.flush();
const never = new Promise(() => {});
// Action A (stays pending): guess "row 2 to the front", then "remove row 3".
S.action(function* () { setStore(moveToFront(2)); setStore(remove(3)); yield never; })();
S.flush();
// Action B (stays pending): guess "remove row 2"; the second call finds no row 2 and writes nothing.
S.action(function* () { setStore(remove(2)); setStore(remove(2)); yield never; })();
S.flush();
console.log("views:", views.join(" -> "));
console.log("now: length", store.list.length, "| 0 in list:", 0 in store.list, "| list[0]:", store.list[0], "| [...list]:", JSON.stringify([...store.list]));
```

Actual (`out/2c-optimistic-lasting-hole.prod.txt`):

```
views: [1,2,3] -> [2,1] -> ["undefined"]
now: length 1 | 0 in list: false | list[0]: undefined | [...list]: [null]
[exit code 0]
```

Expected `views: [1,2,3] -> [2,1] -> [1]`. A makes `[2,1,3]` and then `[2,1]`. B then removes row 2, leaving `[1]`. With a single `setStore(remove(2))` call in B, the view is `[1]` as expected. The second call writes nothing, yet it turns the result into `[undefined]`, and `0 in store.list` is `false`.

### Expected

For every `i < arr.length`, `i in arr` and `arr[i]` agree, during a pass and outside one. `mapArray` never passes `undefined` to its key function for an array without real holes. In C the view is `[1]`.

### Where it seems to come from

- The proxy's `has` trap (`packages/signals/src/store/store.ts:2264-2292`) and `get` trap (`store/store.ts:2088-`) choose their frame differently for an untracked read while a pending action holds the container. When there is no observer and no optimistic override, `has` answers from the backing (`key in src`). `get` answers from what the reader is served.
- `mapArray` snapshots with `slice(0)` (`src/map.ts:296, 498, 563, 683`), so it inherits the disagreement.
- C looks like a composition problem in the optimistic array overlay: two pending arrangement guesses, one of them a no-op setter call. It may be a separate root cause, so it may be better filed as its own issue.

### How found

(shared paragraph above) All 15 invalid programs of `--slice2c` seeds 1–8000 come from this family. The key function `x => x.id` throws inside `updateKeyedMap`. The fuzz harness classes these as `oracle-error`, or as `oracle-halted` when the throw reaches a render effect, depending on timing. A is seed 4857, also 5042 and 7869. B is seed 493. C is seeds 2723 and 2907. Seeds 4081, 4220, 5117, 5138, 5554, 6174, 6888, 6910 and 7645 throw the same `TypeError` and were not triaged between the mechanisms.

---

**Notes for us (not for the issue):**
- Verdict: **likely bug**. These are the same symptoms the rc.10 changelog lists as fixed. `53498dd`: "F5 … the untracked store paths — the `length` view, the `has` trap … still composed the override. `mapArray` … item snapshot came up short or holey and the next pass handed the key function `undefined`". Also F3, and rc.17 `ee4963a`, "a hole at its index". So the maintainers already treat holes as bugs. These cases survived those fixes, and A happens on a **plain** store.
- Bug 1's program shows the same family. While shortening it, `os.map(...)` over the optimistic store skipped an index (the JSON showed `null`). A variant without the refresh answer threw `reading 'id'` from a render effect.
- Pointers are at mechanism level. We did not instrument the traps for A, B or C. The fuzz README's account rests on the logged has/get values the repros print.
- Upstream `next`: not checked beyond fetching `store.ts`. Not re-run.

---------------------------------------------------------------------------------------------------

## Issue 3

**Title:** `[universal] reconcileArrays removes a node that another insert region has taken (no isLive check in the remove arms), so a host removeNode throws`

---

### Environment

`@solidjs/universal` 2.0.0-rc.21 with `solid-js` 2.0.0-rc.21 (commit 2105ffb8), Node 24 with `--conditions=browser`.

### Repro

One element is used in two `insert` regions, the way JSX `const em = <em>shared</em>; <p>{a() ? [em, "x"] : ["y"]}</p><p>{b() ? em : "-"}</p>` would use it. When `b` turns on, the second region moves the node. When `a` turns off, the first region's `reconcileArrays` asks the host to remove that node from `p1`, but it is no longer there.

```js
// @solidjs/universal + solid-js 2.0.0-rc.21 (solidjs/solid@2105ffb8).
// In an app: import { createRenderer } from "@solidjs/universal"; import * as S from "solid-js".
// Here the built packages are imported by path. Run with the browser condition, so that
// @solidjs/universal's own `import "solid-js"` resolves to the client build (Node 24):
//   node --conditions=browser 3-universal-shared-node.mjs
const base = process.env.SOLID_PACKAGES ?? new URL("../../../solid-next/packages/", import.meta.url).href;
const S = await import(base + "solid/dist/solid.js");
const U = await import(base + "universal/dist/universal.js");

// A minimal tree host that, like the DOM, refuses to remove a node from a parent it is not in.
let n = 0;
const mk = (tag, text) => ({ id: n++, tag, text, children: [], parent: null });
const detach = c => { if (c.parent) { c.parent.children.splice(c.parent.children.indexOf(c), 1); c.parent = null; } };
const R = U.createRenderer({
  createElement: t => mk(t),
  createTextNode: v => mk(undefined, v),
  replaceText(node, v) { node.text = v; },
  isTextNode: x => x.tag === undefined,
  setProperty() {},
  insertNode(p, c, a) {
    if (a != null && a.parent !== p) throw new Error("NotFoundError (insertBefore)");
    detach(c);
    const i = a ? p.children.indexOf(a) : p.children.length;
    p.children.splice(i, 0, c);
    c.parent = p;
  },
  removeNode(p, c) {
    console.log(`  host.removeNode(parent #${p.id}, node #${c.id}); the node's parent is #${c.parent?.id ?? null}`);
    if (c.parent !== p) throw new Error("NotFoundError (removeChild)");
    detach(c);
  },
  getParentNode: x => x.parent,
  getFirstChild: x => x.children[0] ?? null,
  getNextSibling: x => (x.parent ? x.parent.children[x.parent.children.indexOf(x) + 1] ?? null : null)
});
const show = x => (x.tag === undefined ? String(x.text) : `<${x.tag}#${x.id}>${x.children.map(show).join("")}</${x.tag}>`);

const [a, setA] = S.createSignal(true), [b, setB] = S.createSignal(false);
const root = mk("root"), shared = mk("em");
R.insertNode(shared, mk(undefined, "shared"));
const p1 = mk("p"), p2 = mk("p");
R.insertNode(root, p1);
R.insertNode(root, p2);
S.createRoot(() => {
  R.insert(p1, () => (a() ? [shared, "x"] : ["y"]));
  R.insert(p2, () => (b() ? shared : "-"));
});
S.flush();
console.log("1", show(root));
setB(true); S.flush(); // p2's region takes the shared node out of p1
console.log("2", show(root));
setA(false); S.flush(); // p1's region drops it from its list
console.log("3", show(root));
```

Actual (`out/3-universal-shared-node.prod.txt`):

```
1 <root#0><p#3><em#1>shared</em>x</p><p#4>-</p></root>
  host.removeNode(parent #4, node #6); the node's parent is #4
2 <root#0><p#3>x</p><p#4><em#1>shared</em></p></root>
  host.removeNode(parent #3, node #1); the node's parent is #4
[REACTIVITY_HALTED] Error: NotFoundError (removeChild)
    at removeNode (file:///workspace/rx-tsx-refresh/docs/scratch/solid-rc21-repros/3-universal-shared-node.mjs:29:31)
    at reconcileArrays (file:///workspace/rx-tsx-refresh/solid-next/packages/universal/dist/universal.js:186:16)
    at insertExpression (file:///workspace/rx-tsx-refresh/solid-next/packages/universal/dist/universal.js:99:18)
    at Object.qe (file:///workspace/rx-tsx-refresh/solid-next/packages/universal/dist/universal.js:74:7)
    …
```

The remove arm for an emptied range has the same problem. Replace the first region with `a() ? [x, shared, y] : [x, y]`, where `x` and `y` are elements (`3b-bulk-removal-arm.mjs`):

```
1 <root#0><p#3><i#5></i><em#1>shared</em><u#6></u></p><p#4>-</p></root>
  host.removeNode(parent #4, node #7); the node's parent is #4
2 <root#0><p#3><i#5></i><u#6></u></p><p#4><em#1>shared</em></p></root>
  host.removeNode(parent #3, node #1); the node's parent is #4
[REACTIVITY_HALTED] Error: NotFoundError (removeChild)
    at removeNode (file:///workspace/rx-tsx-refresh/docs/scratch/solid-rc21-repros/3b-bulk-removal-arm.mjs:29:31)
    at reconcileArrays (…/universal/dist/universal.js:155:44)
```

The dev build gives the same sequence and halts with `[REACTIVITY_HALTED] … in renderer insert Error: NotFoundError (removeChild)`.

### Expected

The same result as `@solidjs/web` on the DOM: nothing throws and the moved node stays where it was moved. The same two programs on `@solidjs/web` + jsdom (`3-dom-comparison.mjs`):

```
map-removal program
1 <p><em>shared</em>x</p><p>-</p>
2 <p>x</p><p><em>shared</em></p>
3 <p>y</p><p><em>shared</em></p>
bulk-removal program
1 <p><i></i><em>shared</em><u></u></p><p>-</p>
2 <p><i></i><u></u></p><p><em>shared</em></p>
3 <p><i></i><u></u></p><p><em>shared</em></p>
[exit code 0]
```

### Where it seems to come from

`packages/universal/src/universal.ts`:
- Line 313, the map-fallback branch: `} else removeNode(parentNode, a[aStart++]);`. No liveness check.
- Lines 273-276, the remove arm: `if (!map || !map.has(a[aStart])) removeNode(parentNode, a[aStart]);`. Also no liveness check.
- The prefix and suffix walks do check: `isLive = n => n && getParentNode(n) === parentNode` (line 251). So does `cleanChildren` (`getParentNode(el) === parent`, line 330).

`@solidjs/web`'s `reconcileArrays` (`packages/web/src/reconcile.ts`) gates every destructive op on ownership:
- line 89: `if ((!map || !map.has(n)) && isLive(n)) n.remove();`
- lines 120-123: an old node that is no longer ours is consumed.

`web/test/runtime/insert.spec.js:623-631` covers "nodes that have been moved out of the slot they were inserted into — by user code, by JSX wrapping, or by an adjacent slot claiming them … The runtime must not throw". Universal has no counterpart in `reconcileArrays`. Its tests only cover a moved mount node at dispose (`universal/test/runtime-insert.spec.js:273`, "does not remove mount nodes that moved to another parent").

### How found

(shared paragraph above) Our renderer fuzz runs `@solidjs/universal` with a recording host that, like the DOM, refuses to remove a node from a parent it is not in. All 28 invalid programs of seeds 1–3000 throw here, at `universal.js:186`, which is `universal.ts:313`. That is 7 of 1–1000 and 21 of 1001–3000. The generator deliberately puts a `let`-bound element, or a memo of one, in two places.

---

**Notes for us (not for the issue):**
- **Is the pattern legitimate?** Honestly, only partly. Rendering one element in two places is unusual and arguably user error: a node can only be in one place, and the second insert moves it. But Solid's DOM runtime **explicitly supports** it. Its reconciler comments and tests name "an adjacent slot claiming them" and require "must not throw", and changelog `8e2446f` describes the slot-ownership design. Universal's own comment at lines 248-250 only covers nodes that replace/swap took out *internally*. So this is a **parity gap with `@solidjs/web`** and a crash where the DOM runtime degrades gracefully. **Likely bug, low severity.** A maintainer could also answer "unsupported in universal". The issue should say plainly that the pattern is unusual.
- The real DOM's `node.remove()` never throws, so `@solidjs/web` line 158 (`a[aStart++].remove()`) is safe in a way universal's `removeNode(parent, node)` contract is not. That difference is why universal needs the explicit check.
- Upstream `next`: `packages/universal/src/universal.ts` is **byte-identical** to rc.21 (checked by diff), so the issue is still present there by inspection.

---------------------------------------------------------------------------------------------------

## Issue 4a

**Title:** `[2.0 / next] createEffect's effect callback is called with undefined (a value compute never returned) when an errored async source is re-asked inside an action`

---

### Environment

`solid-js` 2.0.0-rc.21 (commit 2105ffb8), Node 24. Prod and dev builds give identical output.

### Repro

An async memo whose every answer is the same rejection, so it never has a value. Inside an action, it is re-asked, then the action yields, then it is re-asked again.

```js
// solid-js 2.0.0-rc.21 (solidjs/solid@2105ffb8). In an app: import * as S from "solid-js".
// Here the built package is imported by path (override with SOLID_JS=...). Node 24.
const S = await import(process.env.SOLID_JS ?? new URL("../../../solid-next/packages/solid/dist/solid.js", import.meta.url).href);

const drain = async () => { for (let i = 0; i < 32; i++) await Promise.resolve(); S.flush(); };
const failed = Promise.reject(new Error("failed"));
failed.catch(() => {});

const [s, setS] = S.createSignal(0);
S.createRoot(() => {
  // An async memo whose every answer is the same rejection: it never has a value.
  const a = S.createMemo(() => { s(); return failed; });
  S.createEffect(
    () => { const v = a(); console.log("compute returned", v); return v; },
    {
      effect: v => console.log("effect called with", v),
      error: e => console.log("error handler:", e.message)
    }
  );
});
await drain();

let go;
const gate = new Promise(r => (go = r));
S.action(function* () {
  setS(1); // re-asks (the same rejection)
  yield gate;
  setS(2); // re-asks again
})();
S.flush();
go();
await drain();
console.log("settled");
```

### Actual

```
error handler: failed
effect called with undefined
error handler: failed
settled
[exit code 0]
```

`compute returned …` is never printed: the compute never produced a value. Even so, the `effect` callback runs once with `undefined`, between two error-handler calls.

### Expected

The `effect` callback only ever receives values its compute returned. Here we expect `error handler: failed` (once or twice) and no `effect called with undefined`.

### Where it seems to come from

`packages/signals/src/core/effect.ts`:
1. `notifyEffectStatus` queues a run for the error arm: line 135, `if (this._statusFlags & STATUS_ERROR) queueEffectRun(this);`.
2. Before that run, the action's next write re-asks the memo. The effect's status becomes `STATUS_PENDING | STATUS_UNINITIALIZED`, which is 5 in an instrumented run.
3. `runEffect` only routes to the error arm when `node._statusFlags & STATUS_ERROR` (line 212). Otherwise it falls through to the success arm, `node._effectFn(node._value, node._prevValue)` (line 254), with the never-set `_value`.

The design comment there, and the test `tests/effect-error-phases.test.ts:194-232`, assume the only alternative to "still errored" at run time is "recovered with a value". Here the node is neither.

### How found

(shared paragraph above) In `--slice2a` seeds 1–3000, 16 of the 24 programs that Solid makes invalid are exactly this: an effect is applied with `undefined`. In each one, the instrumented copy shows `runEffect` taking the success arm with status 5 after `queueEffectRun` from `notifyEffectStatus`. Seeds: 225, 339, 427, 683, 704, 873, 1360, 1438, 1637, 1693, 2037, 2215, 2253, 2443, 2762, 2972. In 427, 1637 and 2443 it happens twice.

---

**Notes for us (not for the issue):**
- Verdict: **likely bug, high confidence**. It breaks the basic contract that the effect callback gets compute's value. In a real app, `effect: v => el.textContent = v.name` would throw on `undefined`.
- Controls:
  - If the effect had a value before the error (memo resolves to 0 first), no `undefined` call happens.
  - If the second write is outside the action, or the code drains between the two writes, no `undefined` call happens either.
  - See variants in `/tmp/rc21/v3.mjs` and `v4.mjs`.
- Scratch experiment: returning early from `runEffect` when `STATUS_UNINITIALIZED` is set (after the error arm) removes the `undefined` call. The output becomes `error handler: failed` twice, then `settled`.
- Upstream `next`: `runEffect`'s arms in `effect.ts` are unchanged by inspection (line 212 tests only `STATUS_ERROR`). Not re-run.

---------------------------------------------------------------------------------------------------

## Issue 4b

**Title:** `[2.0 / next] A staged error is served as a value in an optimistic lane: memo() returns the StatusError object (and a memo receives it as prev)`

---

### Environment

`solid-js` 2.0.0-rc.21 (commit 2105ffb8), Node 24. Prod and dev builds give identical output.

### Repro

Memo `m = a() + o()` reads an async memo `a` and an optimistic signal `o`. A pending action guesses `o`. Another action then writes the source of `a` to a value whose request rejects.

```js
// solid-js 2.0.0-rc.21 (solidjs/solid@2105ffb8). In an app: import * as S from "solid-js".
// Here the built package is imported by path (override with SOLID_JS=...). Node 24.
const S = await import(process.env.SOLID_JS ?? new URL("../../../solid-next/packages/solid/dist/solid.js", import.meta.url).href);

const drain = async () => { for (let i = 0; i < 32; i++) await Promise.resolve(); S.flush(); };
const failed = Promise.reject(new Error("failed"));
failed.catch(() => {});
const show = v => (v instanceof Error ? `${v.constructor.name}("${v.message}")` : JSON.stringify(v));

const [s, setS] = S.createSignal(1);
const [o, setO] = S.createOptimistic(2);
let m;
S.createRoot(() => {
  const a = S.createMemo(() => (s() === 3 ? failed : Promise.resolve(s() * 10)));
  m = S.createMemo(() => a() + o());
  S.createEffect(
    () => { const v = m(); console.log("effect compute: m() returned", show(v)); return v + s(); },
    {
      effect: v => console.log("effect called with", show(v)),
      error: e => console.log("error handler:", show(e))
    }
  );
});
await drain();

let go;
const gate = new Promise(r => (go = r));
// Action 1: after `gate`, write s = 3 (a request that rejects).
S.action(function* () { yield gate; setS(3); })();
// Action 2 (pending forever): an optimistic guess o = 6, which m reads.
S.action(function* () { setO(6); yield new Promise(() => {}); })();
await drain();
console.log("-- release action 1");
go();
await drain();
const probe = f => { try { return "returns " + show(f()); } catch (e) { return "throws " + show(e); } };
console.log("m()        ", probe(() => m()));
console.log("latest(m)  ", probe(() => S.latest(m)));
```

### Actual

```
effect compute: m() returned 12
effect called with 13
effect compute: m() returned 16
effect called with 17
-- release action 1
effect compute: m() returned StatusError("failed")
effect called with "Error: failed1"
m()         returns StatusError("failed")
latest(m)   returns StatusError("failed")
[exit code 0]
```

The compute of the user effect reads `m()` and gets the `StatusError` **object** instead of a throw. It computes `"Error: failed1"` (`StatusError + 1`), and the effect callback is called with that string. After the run, `m()` and `latest(m)` still return the error object.

Control: drop action 2, the `setO(6)` guess, and the same program behaves as expected. The effect's error handler gets `Error("failed")`, the callback is not called, and `m()` throws.

A second form shows the error object becoming a memo's `prev` (`4d-error-object-as-prev.mjs`):

```js
// solid-js 2.0.0-rc.21 (solidjs/solid@2105ffb8). In an app: import * as S from "solid-js".
// Here the built package is imported by path (override with SOLID_JS=...). Node 24.
const S = await import(process.env.SOLID_JS ?? new URL("../../../solid-next/packages/solid/dist/solid.js", import.meta.url).href);

const drain = async () => { for (let i = 0; i < 32; i++) await Promise.resolve(); S.flush(); };
const deferred = () => { let resolve, reject; const promise = new Promise((r, j) => { resolve = r; reject = j; }); promise.catch(() => {}); return { promise, resolve, reject }; };
const show = v => (v instanceof Error ? `${v.constructor.name}("${v.message}")` : JSON.stringify(v));

const q = [deferred(), deferred(), deferred()], f0 = deferred();
const [s, setS] = S.createSignal(0);
const [o, setO] = S.createOptimistic(0);
S.createRoot(() => {
  const a = S.createMemo(() => q[s() % 3].promise, { loadingValue: 0 });
  S.createMemo(prev => { console.log("m compute, prev =", show(prev)); return a() + o(); });
});
q[0].resolve(2);
await drain();
// Action 1: guess o = 1 and write s = 5 (request q[2]); after f0, write s = 4 (request q[1]).
S.action(function* () { setO(1); setS(5); yield f0.promise; setS(4); })();
S.flush();
// Action 2 (pending forever): guess o = 2.
S.action(function* () { setO(2); yield new Promise(() => {}); })();
q[2].reject(new Error("failed")); // the request action 1 made rejects
await drain();
f0.resolve();
await drain();
```

```
m compute, prev = undefined
m compute, prev = 0
m compute, prev = 2
m compute, prev = 2
m compute, prev = StatusError("failed")
[exit code 0]
```

### Expected

A rejected source never becomes a value. Reading `m` while its error is staged throws it, or keeps serving the last value until the commit publishes the error. A user effect then goes to its error handler. A memo's `prev` is never an `Error` object.

### Where it seems to come from

Staged errors live in `_pendingValue` with `CONFIG_STAGED_ERROR` (`core/async.ts:219-249`, `stageError`). `stageMark` copies them to readers (`core/verdict.ts:766-786`). The verdict path throws them (`staged()`, `core/verdict.ts:414-416`: `if (el._config & CONFIG_STAGED_ERROR) throw el._pendingValue;`). Two lane paths treat them as values:
- `laneValueOf` (`core/truth.ts:23-24`): `if (!(el._config & CONFIG_GUESS) && el._pendingValue !== NOT_PENDING) return el._pendingValue;` has no `CONFIG_STAGED_ERROR` test. `laneRead` reaches it at `core/lanes.ts:740` (no reader) and `core/lanes.ts:813` (tracked reader). The guard just above it (`core/lanes.ts:737`, `if (!guess && status & STATUS_ERROR) return NOT_PENDING;`, #4106) tests the published `STATUS_ERROR`, not the staged error. This is the effect-compute read in the first repro: the instrumented stack is `laneRead (lanes.js:635)` → `laneValueOf`, with the staged-error bit set.
- `laneSeam` (`core/lanes.ts:891-894`): at a lane's reveal, `x._lane = n._pendingValue; n._pendingValue = NOT_PENDING;` moves a staged error into the lane value slot. `recompute` then hands it to the memo as `prev` (`core/core.ts:590-595`, `el._config & CONFIG_OVERRIDE && el._x!._lane !== NOT_PENDING ? el._x!._lane`). This is the second repro: the instrumented `laneSeam` saw `_pendingValue` an `Error` with `CONFIG_STAGED_ERROR` set, and the next `recompute` took `prev` from `_lane`.

### How found

(shared paragraph above) This is `--slice2a` seed 629 (`4b-seed629.mjs` in our repro folder). There the effect's compute receives the error object, but its error handler runs afterwards, so the string never reaches the effect callback. Seeds 488, 663, 1778, 2583 and 2667 show the read form. Seeds 1950 and 2558 show the `prev` form.

---

**Notes for us (not for the issue):**
- Verdict: **likely bug, high confidence**. Changelog rc.16 `7093b07` (#4106) states the intent: "a read of an errored lane member that is not a written guess throws its error". This is the staged (not yet published) form of that case. rc.20 `2861ab8` (#4364) is a related staged-error fix.
- Seed 629 output (`out/4b-seed629.prod.txt`), last lines: `watch compute: m() = <StatusError: memo-failed> ->  "Error: memo-failed41"`, then `watch error handler <Error: memo-failed>`. That is the "staged error read as a lane value" the Rust port refuses (`core.rs` `served_as_value`).
- The two forms may need separate fixes. A scratch patch that throws in `laneValueOf` fixed the effect read, but top-level `m()` still returned the object (through `_lane`), and seed 629 then threw from inside the action. One guard is not enough.
- Upstream `next`, read only: `truth.ts` now has `latestOf` with the same `_pendingValue` return and no `CONFIG_STAGED_ERROR` test, and `lanes.ts` has no `CONFIG_STAGED_ERROR` reference at all. Open PR #4705, "publish latest errors with their readers", touches errored lane memos and may interact. Not re-run.

---------------------------------------------------------------------------------------------------

## Issue 4c

**Title:** `[2.0 / next] latest(memo) returns undefined for a held memo whose first answer was an error (memo() throws)`

---

### Environment

`solid-js` 2.0.0-rc.21 (commit 2105ffb8), Node 24. Prod and dev builds give identical output.

### Repro

```js
// solid-js 2.0.0-rc.21 (solidjs/solid@2105ffb8). In an app: import * as S from "solid-js".
// Here the built package is imported by path (override with SOLID_JS=...). Node 24.
const S = await import(process.env.SOLID_JS ?? new URL("../../../solid-next/packages/solid/dist/solid.js", import.meta.url).href);

const drain = async () => { for (let i = 0; i < 32; i++) await Promise.resolve(); S.flush(); };
const deferred = () => { let resolve, reject; const promise = new Promise((r, j) => { resolve = r; reject = j; }); promise.catch(() => {}); return { promise, resolve, reject }; };
const show = v => (v instanceof Error ? `${v.constructor.name}("${v.message}")` : v === undefined ? "undefined" : JSON.stringify(v));
const probe = f => { try { return "returns " + show(f()); } catch (e) { return "throws " + show(e); } };

const first = deferred(), done = deferred(), never = new Promise(() => {});
const [o, setO] = S.createOptimistic(0);
let a, m;
S.createRoot(() => {
  a = S.createMemo(() => (o() === 0 ? first.promise : never));
  m = S.createMemo(() => a() + o());
});
// Action 1 guesses o = 1 and waits on `done`.
S.action(function* () { setO(1); yield done.promise; })();
// The memo's first request (o = 0) rejects: it never had a value.
first.reject(new Error("failed"));
await drain();
// Action 2 (pending forever) guesses o = 0 again.
S.action(function* () { setO(0); yield never; })();
S.flush();
done.resolve();
await drain();
console.log("m()        ", probe(() => m()));
console.log("latest(m)  ", probe(() => S.latest(m)));
console.log("a()        ", probe(() => a()));
console.log("latest(a)  ", probe(() => S.latest(a)));
```

### Actual

```
m()         throws StatusError("failed")
latest(m)   returns undefined
a()         throws StatusError("failed")
latest(a)   throws StatusError("failed")
[exit code 0]
```

### Expected

`latest(m)` throws the error, as `m()` does and as `latest(a)` does. It never returns `undefined`, a value `m` never had.

### Where it seems to come from

`packages/signals/src/core/verdict.ts`, `verdictValue`:
1. `const uninitialized = (owner._statusFlags & STATUS_UNINITIALIZED) !== 0;` (line 567).
2. The `CONFIG_HELD` arm (lines 568-629) treats `!uninitialized` as "has a committed value" and ends in `return el._value;` (line 628).
3. Here `m` is `STATUS_ERROR | STATUS_NO_VALUE` (status 10), with config `CONFIG_HELD | CONFIG_STAGED` and no staging. `STATUS_NO_VALUE` (`core/constants.ts:253-256`: "an error that answered a node's first read … it still has no value") replaces `STATUS_UNINITIALIZED`, so the held arm returns `_value`, which is `undefined`.
4. The errored-derivation throw at the end of `verdictValue` (line 697, `if (el._fn && owner._statusFlags & STATUS_ERROR) throw …`) is never reached.

### How found

(shared paragraph above) `--slice2a` seeds 873 and 2582: `latest m` logged `undefined` where the op language allows only a number or an error.

---

**Notes for us (not for the issue):**
- Verdict: **likely bug, medium-high confidence**. Changelog rc.19 `253561e` (#4244) fixed the unheld form: "A memo whose first read rejected stays uninitialized when it is re-asked: an `isPending` pass and `latest()` throw NotReady until a value lands instead of reading `undefined`." This is the held form. The exact expected value (the error, or NotReady) is the maintainers' call. `undefined` is not it.
- Instrumented evidence (`/tmp/rc21/sig`): `verdictValue -> undefined; status 10 config CONFIG_HELD|CONFIG_STAGED pendingIsNOT_PENDING true`, which means the return at line 628.
- Upstream `next`: the held arm still begins `const uninitialized = (owner._statusFlags & STATUS_UNINITIALIZED) !== 0; if (el._config & CONFIG_HELD) { if (!uninitialized) {` (verdict.ts:612-614 there). Not re-run.

---------------------------------------------------------------------------------------------------

## Issue 5

**Title:** `[2.0 / next] A flush never ends: an error boundary whose content calls isPending, over a nested boundary on a pending memo, after an affects() action re-writes`

### Environment

solid-js 2.0.0-rc.21 (`2105ffb8`), prod and dev builds, Node 24.11.1. No DOM: `createErrorBoundary` and `createRenderEffect` from `solid-js`.
The prod build hangs; the dev build throws "Potential Infinite Loop Detected" from the flush loop's guard.

### Repro

`docs/scratch/solid-rc21-repros/5-errored-pending-hang.mjs` (runs the program in a worker; prints `hang` if the last
step has not returned after 20 s, or `threw: …` and exits 1 if the worker throws):

```js
const [s, setS] = S.createSignal(1);
let a;
S.createRoot(() => {
  a = S.createMemo(() => q[s() % 3].promise);          // three deferred promises
  const m = S.createMemo(() => a() + s());
  S.createErrorBoundary(() => {
    const inner = S.createErrorBoundary(() => m() + a(), () => -1);
    S.createRenderEffect(() => inner(), () => {});
    return S.isPending(() => m()) ? 100 : m();
  }, () => -1);
});
S.action(function* () { S.affects(a); yield f0.promise; setS(4); })();
setS(3);
q[0].reject(new Error("load-failed")); await drain();   // drain: 32 microtask turns, then flush()
f0.resolve(1); await drain();                          // never returns (prod) / throws (dev)
```

### Actual

Prod build (`solid.js`, `out/5-errored-pending-hang.prod.txt`): the last `flush()` never returns.

```
rejected the new question; resolving the action
hang: the last step did not return within 20 s
[exit code 0]
```

Dev build (`solid.dev.js`, `--conditions=development`, `out/5-errored-pending-hang.dev.txt`): after 1e5 rounds (about
3.5 s here) the flush loop's guard throws.

```
rejected the new question; resolving the action
threw: Potential Infinite Loop Detected. Kept alive by scheduled work; last staged node: effect
[exit code 1]
```

### Expected

The flush ends (the outer boundary shows its content or its fallback; `isPending` reads `true` until the re-ask lands).

### Where it seems to come from

From a structural port of rc.21 (rust-solid, which hangs the same way, traced with `SLICE1_TRACE=1`): the outer boundary's
children computed is a verdict reader (CONFIG_VERDICT with its own window). Every landing re-derives it (`reruns`). Its
pass builds a new inner boundary and render effect over `m`, whose flight is up. The effect goes pending and opens a new
transaction (`GlobalQueue.notify` → `joinFuture(null)`). Nothing blocks that transaction: the effect is behind the new
boundary's fallback (`hiddenBy`), so `blocked` is false and it lands at the same seam. Its landing re-derives the verdict
reader again. Each round creates one more transaction (they count up without end).

Pointers in rc.21 (`packages/signals/src/core/scheduler.ts`):
- `GlobalQueue.notify`, lines 1199-1225: a pass that went pending outside a lane calls `joinFuture(null)` (line 1220).
- `joinFuture`, lines 421-429: with no flush transaction it creates a new one (`newTransaction(false)`) and schedules.
- `blocked` / `blockedBy`, lines 466-475 and 516-540: a pending render effect holds its transaction only while it is
  `onScreen`; the fresh inner boundary's effect is behind that boundary's fallback, so the transaction is not blocked
  and lands at once.
- `reruns`, line 1235: the landing re-derives the stale verdict reader (the outer boundary's content), which starts the
  next round.
- `flush`, lines 1666-1676: the loop that never exits (prod), and its `__DEV__` guard at 1e5 rounds (dev).

### How found

`node fuzz/run.mjs --boundaries` in rust-solid (an exact-trace fuzzer of Loading/Errored, tracked `isPending`/`latest` and
`affects` against Solid). 15 of seeds 1–1000 and 21 of 1001–3000 time out in Solid. Every one has an `isPending` window
in a boundary's content pass and an `affects` mark. Reduced: rust-solid `docs/boundaries-fuzz/solid-bug-errored-pending-hang.json` (8 ops).

---

**Notes for us (not for the issue):**
- Verdict: **likely bug, high confidence**: no user code loops; `S.flush()` never returns on the prod build, and the
  dev build's own guard calls it a potential infinite loop. Both builds agree that the scheduler, not the program,
  keeps the loop alive.
- The Rust port hangs on all 36 programs too (it is not special-cased); the fuzz counts them `oracle-timeout` (invalid).
- Not re-run on current `next`.

---------------------------------------------------------------------------------------------------

## Issues 6 and 7 (suspected, from slice 5's async SSR oracle)

Found 2026-11-09 by the frontend's SSR fuzz v2.1 (`frontend/scripts/ssr-fuzz.ts --async`, `frontend/ssr/run-async.ts`,
rust-solid `docs/SSR.md`, "Async data and streaming"), which feeds Solid's own `renderToStream` output to Chromium chunk
by chunk and hydrates it with Solid's client (rc.21 dist builds), and hydrates Solid's `renderToString` HTML. Both are
about Solid's own output and client; rust-solid's server output is byte for byte the same and behaves the same. Neither
has a standalone repro yet (each needs a browser page fed a stream).

- **6.** In seed 28 (`section` > `Errored` > [`Loading` > (a scalar memo's readers), `Loading` > `For` rows]): the
  server's answers reject the scalar memo first, then resolve the list. The stream is the shell, a failure fragment for
  the first `Loading` (carrying the `Errored` fallback, `<template id=… e>`), then the second `Loading`'s rows.
  Hydrated after the shell, the final page shows the rows and neither the first boundary's content nor the fallback;
  hydrated after the last chunk, the `Errored` fallback alone. The fallback is the expected outcome (the boundary holds
  an error). Reproduce: `npm run ssr-fuzz -- --async --seeds 1 --start 28 --dev --rust ../rust-solid/target/debug/ssr`
  in `frontend/`; `summary.json`'s notes list `solid-stream-end continuation` for it.
- **7.** In seed 1916 (`div` > `Show when={shown()}` > `Errored` > `Loading` > [`b`, `Loading` > `For`], a toggle and a
  refetch button): native Solid, mounted on the client, shows `ready` and the inner fallback `rows` when the `Show` is
  toggled back on after a rejected re-ask; the same app hydrated from its renderToString HTML shows nothing there.
  Reproduce: the same command with `--start 1916` (status `invalid`, class `oracle-hydration (solid-string)`).

---------------------------------------------------------------------------------------------------

## Reproducing everything

```sh
nix shell nixpkgs#nodejs_24 -c sh docs/scratch/solid-rc21-repros/run-all.sh   # from the repository root
```

This writes `out/<repro>.prod.txt` and `out/<repro>.dev.txt` (the dev runs use `solid.dev.js` and
`--conditions=development`; issue 3 also uses `--conditions=browser`). It also writes `out/3-dom-comparison.prod.txt`. The outputs quoted
above come from the run on 2026-11-08, Node v24.11.1 (issue 5's from 2026-11-10, same Node). Issue 5 takes about 25 s:
its prod run waits out the 20 s timeout.

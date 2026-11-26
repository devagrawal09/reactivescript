# Discussion draft for #5089 (not posted): three gaps a view has over store lists

> Draft for a comment on #5089 (`openView`). **Not posted.** It is a design question with a working patch attached, not a PR.
>
> Patch: branch `fix/view-list-reads-through-pin` (local worktree `<workspace>/solid-list-record`), three commits on `feat/signals-view` @ `24c8f59d8`:
> 1. `fe9840c2a` a view reads a list's unnoded keys through its pinned container
> 2. `365ab5cb1` a view rewinds a list an optimistic store guessed over across an await
> 3. `9986b4dab` keep a view's store branches out of the prod tier
>
> Carried on the RX branch `rx/view-on-30e7805` for the RX time-travel host. Nothing pushed.

---

**Three gaps a view has over store lists: root cause, a working patch, and which layer should own this?**

Time travel over `openView` pins the nodes the attribution engine's `flush` record names, at the value each showed before its first later change. For signals, memos and store properties a reader tracks, that is enough. For **store lists** it isn't, in three ways. Each one is below as a component, with the screen after each step and what `view(k)` shows. The steps are recorded with the time-travel helper in `packages/signals/tests/view-time-travel.ts`.

## Gap 1: rows a list renders untracked read the store's backing, not the pin

```tsx
const [history, setHistory] = createStore<{ label: string }[]>([]);

function History() {
  return (
    <ul>
      <For each={history} keyed={r => r.label}>
        {row => <li>{row().label}</li>}
      </For>
    </ul>
  );
}

// step 0: setHistory(h => [{ label: "a" }, ...h])   screen: a
// step 1: setHistory(h => [{ label: "b" }, ...h])   screen: b a
// step 2: setHistory(h => [{ label: "c" }, ...h])   screen: c b a
```

| view | wanted | #5089 as is |
|---|---|---|
| `view(1)` | b a | c b |
| `view(0)` | a | c |
| `view(-1)` | (empty) | (empty) |

`<For>` reads its rows untracked, so after the three prepends the store has two nodes: `length` and the list's container. The record names exactly those, with the old backing as the container's `prev`. The view pins both. `length` rewinds; each row is read from the store's backing, which is the present. (#5089's own known gap "a keyed `<For>` … reorder does not rewind" is this case.)

The record can't close this: there is no index node to name or to pin, and having the attribution engine create nodes no reader asked for would put graph state in the record's hands.

## Gap 2: a node whose change was never recorded serves the present

```tsx
type Row = { id: string; label: string };
const [truth, setTruth] = createStore<Row[]>([]);
const [source] = createSignal(truth);
const [history, setHistory] = createOptimisticStore(() => source(), [] as Row[]);

const drop = action(function* (id: string) {
  setHistory(h => { h.splice(h.findIndex(r => r.id === id), 1); });  // the guess
  yield save(id);                                                     // the await
  setTruth(t => t.filter(r => r.id !== id));                          // the answer
});

<For each={history} keyed={r => r.id}>{row => <li>{row().label}</li>}</For>

// steps 0–2: prepend a, b, c to truth        screen: a / b a / c b a
// step 3:   drop("b") — the guess shows      screen: c a
// step 4:   the answer lands, equal          screen: c a
```

| view | wanted | #5089 + the gap-1 patch | #5089 + full patch |
|---|---|---|---|
| `view(3)` | c a | c b | c a |
| `view(2)` | c b a | c b | c b a |
| `view(1)` | b a | b a | b a |
| `view(0)` | a | **throws** (a row reads `undefined`) | a |

While the guess shows, `history`'s readers read through its guess carrier, so `truth`'s `length` node loses its readers and is released. At the landing there is no node, so the record names only `truth`'s container. The node is born again afterwards with the present value, and being a node, it beats the pinned container: `length` 2 next to a pinned `[a]`. That's the `undefined` row and the throw. The same action **without** the `await` works: the node keeps its readers and its change is recorded.

A related case: a node born *under* the pin, or during `resume()`'s landing flush, takes the pin as its committed value, because the container's `_value` is the pin. With no store staging to correct it, it keeps that value after resume. Viewing a step during a prepend guess and resuming left `length` at 2 beside a three-row list.

## Gap 3: a pinned guess carrier is never read

Same component. `view(3)` should show the guess (`c a`); it showed the truth at that step (`c b a`, or `c b` with gap 2).

- **The carrier is gone.** The record names `history.$guess` (the store's guess carrier) changing at step 4, and the view pins it at the guess frame. But the optimistic store drops a carrier from its list once its action ends, and reads only consult listed carriers.
- **The pin is judged "equal".** Even relisted, `optimisticWrite` skips the pin. The carrier's comparator judges the frame against its store's **live** backing (for a chained store, the inner store's proxy), which is the present `c a`, not the `c b a` the view pinned the inner store to.

## The patch, and the rules it bends

All of it is observe and dev tiers. **`dist/prod` is byte-identical to `24c8f59d8`** (`diff -r` of a prod build at the base vs at the patch: empty). Every branch is one `__OBSERVE__ && …` test calling a helper only the observe tier references.

- **Gap 1** (`store.ts` `readSource`): with no staging, a key with no node reads the pinned container (`untrack(readNode(k))`) instead of the backing. A setter still composes on the truth beneath (F-10).
- **Gap 2** (`store.ts` `nodeValue`, `viewBornFrame`): a node the view did not pin reads its container's pin, still subscribing to its own node (F-1). A node born under the pin, or at the landing that lifts it, starts from the truth beneath.
- **Gap 3** (`optimistic.ts` `relist`, `guesses.ts` `pinCarrier`): a carrier the view pins is listed again until the pin lifts; the sweep drops it after. The pin is written through `pinCarrier`, which skips the equality check.
- **Plumbing:** one more observe slot, `viewPinHook`, that `view.show` calls for each node it pins. The store marks the containers it pins and passes carriers to the optimistic store (`setOptPin`).

Each of these bends something AGENTS.md says outright, so I'm asking before going further:

1. **`vp`, a per-node note on store containers** ("the view pinned this"), set by the hook and cleared lazily when the container carries nothing. AGENTS.md: "a note of what the screen is showing … a per-node map or list … A fix that needs one is not a fix."
2. **`relist` brings a dropped guess back.** AGENTS.md: "Do not add engine state so that a guess can come back or announce itself." It only happens under a view and the sweep drops it after, but it is a guess coming back.
3. **`pinCarrier` writes a guess the comparator calls equal.** It is a separate observe-only function, not an exception inside `optimisticWrite`, but it is still an exception to "equal is no guess". The structural fix would make a chained carrier compare against its inner store's *shown* frame under a view. That comparator also runs in the normal engine, so I didn't touch it.
4. **Three special cases in the store's read and birth paths** for a devtools feature that is itself a draft.

## Which layer should own this?

1. **The store, as patched.** Works, prod untouched, but it is the state and exceptions above.
2. **The view, with an explicit store API.** Instead of inferring from pinned nodes, the store exposes "serve frame F for target T while this view is open" through `storeTools` (attribution-hooks), and `openView` calls it for each pinned container and carrier. The same three read/birth branches, but driven by the view's own pin set (one `WeakMap` in the store module, cleared by the view at `resume`/`branch`) rather than a mark on nodes. Gap 3's equality problem remains.
3. **The record.** It can't close gaps 1 and 2 without nodes to name. It *could* stop carrying a chained carrier's live proxy as `prev`/`value` (a snapshot instead), which narrows gap 3 to the relisting.
4. **None: document them.** Keep store lists under `<For>` and guessed lists as known limitations of the view, and have devtools render those from recorded values instead of pins.

My preference is (2) if the view stays in core, since it keeps the pin set in one place, the view's. But the rules above are yours to rule on.

## Coverage

- **Tests** (`attribution-view-time-travel.test.ts`; the web `view-time-travel.spec.tsx` known gap becomes a passing test):
  - prepend, append, splice and replace of object rows under `mapArray`;
  - a rewrite made while viewing;
  - the chained optimistic store;
  - a guess across an await: filter (confirmed), prepend (confirmed), append the answer replaces;
  - viewing during and after the hold, then guessing again after resume.
- **Not tested:** `has` / `in` nodes born under a pin; `Object.keys` on a rewritten list under a view; a keyed (`key: "id"`) optimistic list guessed over across an await.

## Results

| | signals suite | `dist/prod` vs `24c8f59d8` | web |
|---|---|---|---|
| patch branch, all three commits | 7311 passed, 1 failed (`attribution-engine-cost` 4.84× vs a 4× cap, with idle timing at 66 ms against the usual 35 ms; passes 3/3 run alone) | `diff -r`: empty | 4 view/attribution specs 65/65, full suite (client/server/hydrate) green, at commit 2 |
| RX branch `rx/view-on-30e7805` @ `b482548f0` (with the store-guess record fix), dist rebuilt with types | 7338 passed, 0 failed | — | 4 specs 65/65; full suite 2040 / 2221 / 788 passed, 0 failed |

On the RX branch, the three RX repros (`undo-list` ×2, `undo-guess`, `store-guess-gap`) pass with the view and flush-record specs: 109/109.

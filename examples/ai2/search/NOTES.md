# NOTES — examples/ai2/search

Modules: `search.rx` (query, results, `setQuery`, `TooShort`), `detail.rx`
(selection, item, `select`, `retry`, `NotFound`), `ui.rx` (components, no
state), `main.rx` (entry). Scenario: `scenarios/S-ai2-search.md`.

## Checker runs

There were 6 runs in total. Runs 2–6 were deliberate: printing signatures, and probing whether the checker enforces failure isolation. None of them was needed to get the program accepted.

| # | program state | diagnostics | did the message alone tell me the fix? | change made |
| - | ------------- | ----------- | -------------------------------------- | ----------- |
| 1 | first draft (with a root `errored fallback(e)` in main.rx) | none (`ok … (+3 modules)`) | — | — |
| 2 | same, `--signature` | none; rows as expected: `results`/`count: pending fails(Error \| TooShort)`, `item: pending fails(Error \| NotFound)` | — | — |
| 3 | probe: detail pane's generic boundary narrowed to `fallback(e: NotFound)` | **none**: accepted | — | Reverted the probe. Concluded the root catch-all hides pane-level gaps (see below), so I removed it from main.rx. |
| 4 | root boundary removed | none | — | — |
| 5 | probe as in run 3, without the root boundary | `UNHANDLED_FAILURE` ×2 (`item.name`, `item.blurb` in `<ItemView>` in `<DetailPane>` can fail with `Error`) | Yes. It names the reader, the component chain and the class, and gives both fixes (`errored fallback(e)` or `catch`). One flaw: the location is `main.rx:3`, the import line of `DetailPane`, not the reader's line in ui.rx. With a deeper tree you'd have to hunt for it. | Reverted the probe. |
| 6 | final | none | — | — |

## What the checker made me write that I think is wrong, redundant or ugly

The checker forced nothing. These are the places where the language or spec pushed the shape:

1. **The root catch-all defeats the failure check.** This is the biggest finding. R-f-5 only asks that *some* boundary above a reader discharges its class. The spec recommends one root `errored` ("an app typically has one", R-f-5, CN-6a), and once it's there every inner discharge becomes optional to the checker. A pane that forgets its own `Error` boundary compiles, and at run time its failure replaces the whole app. Here that would violate "a failing detail must never affect the results list" (run 3 proved it compiles). I chose the checked guarantee over panic coverage, so there is no root boundary, and a panic halts the app. What I'd want is a way to say "this boundary is for panics only" (e.g. `errored panic { … }`) that doesn't discharge failures, or a boundary that can declare isolation for a subtree.
2. **`for id in [selected]` to reset the pane's `errored` per selection.** `id` is unused; the row exists only so each selection gets a fresh region. Without it, H-12 keeps an `errored` on its fallback while the content under it is pending. Selecting item 3 after item 4 was "not found" would then keep showing `item 4 not found` (beside the highlight on item 3) until item 3 lands. `loading on(selected)` can't help: the pending reader is behind the errored fallback, so (as I read H-4/H-6) nothing under the loading is pending for it to catch. H-1 documents `for p in [page]` as the recreation idiom, so it's sanctioned, but it's a workaround. I'd want `errored on(selected)`, or a `keyed`/`with x { … }` region form.
3. **`component X(props: {})` for components with no props.** The grammar requires the parameter. That's harmless noise.
4. **`fn found(it, id) => it == null ? throw NotFound(id) : it`.** I wanted `(await fetchItem(selected)) ?? throw NotFound(selected)`. The grammar sketch puts `throw` at `Expr` level, so I didn't trust it as the right operand of `??` and used a helper. I didn't test the inline form.
5. **`{" "}` between sibling elements.** This is for the frame text, not the checker. The template says adjacent elements add no separator, and it doesn't say whether newline whitespace between elements is a text node. Explicit `{" "}` is correct under either reading because whitespace collapses.
6. **`retry` is an `action` whose body is only `refresh item`.** MO-2b already lets ui.rx `refresh item` directly. I wrapped it so detail.rx owns every way its state changes. That could be read as ceremony.

## Where the spec was ambiguous or silent, and what I assumed

- **Does an action with no `await` hold its change until the flights its writes caused have landed?** AC-1 says "held until the body returns and everything it put in flight has landed". I read "put in flight" as the body's own awaited work, plus a `refresh` it issues. A flight opened by an equation re-deriving from the action's write doesn't count. H-2's "its body is a holder like a pending reader" supports this: a body with no await stops holding when it returns. Under the other reading, `select(4)` (instant 6) would be held until `fetchItem:4` lands, `loading…` would never show (H-5: "possibly never, if that frame is itself held"), and the row highlight would lag the click. Since MO-2a makes `export action` *the* write interface, this matters for every multi-module program. The spec should say.
- **Is an `errored` fallback's error a committed value for verdicts?** At instant 2 I assumed `pending? results` has a verdict (true) because `results`' committed value is the TooShort error. R-9 says there's no verdict only with no committed value, and H-12 says an error is an answer.
- **Do hidden readers count for `loading on(…)` re-arm?** H-6 re-arms "if a reader under it is pending". It's silent on readers that are behind an inner `errored` fallback. This is the reason for workaround 2.
- **Can scenario `handler` rows name exports that main.rx does not import** (`setQuery`, `select`, `retry`)? I assumed yes ("any live binding by name"; each module is a live region per 09). I didn't add unused imports to main.rx for the harness.
- **Does `refresh` work on an equation whose `await` sits inside one arm of a conditional and inside a call argument?** I assumed yes (AC-4: "re-runs an `await` equation for the same inputs"). The checker accepted it.
- **Does `key id` apply when the result is sometimes `[]` from a different arm?** I assumed reconciliation is over whatever array the equation yields.
- **Repeated keys.** "A key is one flight for the program's lifetime." I kept every query and every id unique in the scenario, and didn't re-select an item without `refresh`, because a second `fetchItem(1)` would be a second flight under one key.

## Confidence per predicted frame

| instant | confidence | rule relied on |
| ------- | ---------- | -------------- |
| 0 | high | E-11, RG-1 (empty query mounts nothing) |
| 1 | high | R-f-3 throw arm, R-f-4 typed boundary |
| 2 | medium | H-12: errored stays on fallback while content is pending, so the hint `too short: a` stays. H-4: readers behind the fallback don't hold. H-7/H-9: the probe shows ahead. The verdict-on-an-error assumption above. |
| 3 | high | H-12 (a value replaces the error), H-9 (verdict final at commit) |
| 4 | medium-high | H-6 (disarmed boundary forwards), H-7 (lane readers `latest query`, `pending? results` show ahead) |
| 5 | high | H-2 commit as one frame, ST-4a |
| 6 | medium | Depends on the action-hold reading of AC-1 above. Also H-5 (a fresh armed `loading` catches). |
| 7 | high | `throw` through a lifted `fn` (R-f-2), typed boundary |
| 8 | medium | H-6 `on` re-arm plus RG-2a row replacement giving a fresh `errored`. Depends on the action-hold reading too. |
| 9 | high | R-f-4: a typed boundary passes other classes up |
| 10 | medium-high | AC-4 quiet re-ask; H-12 "the error stays the display through a retry" |
| 11 | high | H-12 recovery |

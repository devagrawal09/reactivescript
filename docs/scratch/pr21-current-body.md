> **Demo, not for merge.** Context for #1 and #20.

Authors write ordinary Solid 2 TSX. A frontend lowers it into the existing RX AST, and the RX checker, interpreter and compiler run on it unchanged. **Accepted TSX must behave exactly as native Solid**; anything RX would interpret differently is refused, never silently rewritten.

## Example: an issue tracker

A store, a filter, derived memos, `Show`/`For`, a child component with a callback prop, and an optimistic action with rollback:

```tsx
import { createSignal, createOptimistic, createStore, createMemo, action, Show, For } from "solid-js";
import { assignIssue } from "./api";

export default function Tracker() {
  const [issues, setIssues] = createStore({
    list: [
      { id: 1, title: "Crash on save", assignee: "" },
      { id: 2, title: "Slow search", assignee: "ana" },
      { id: 3, title: "Typo in footer", assignee: "" },
    ],
  });
  // What the list shows: the stored issues, plus any claim still waiting on the server.
  const [shown, setShown] = createOptimistic(() => issues.list);
  const [mode, setMode] = createSignal("all");
  const [status, setStatus] = createSignal("");

  const visible = createMemo(() =>
    shown().filter((issue) => mode() === "all" || issue.assignee === ""),
  );
  const unassigned = createMemo(() => shown().filter((issue) => issue.assignee === "").length);

  // Show the claim at once; commit the server's answer, or roll back and explain.
  const claim = action(function* (id: number) {
    setShown((list) =>
      list.map((issue) => (issue.id === id ? { id: issue.id, title: issue.title, assignee: "me" } : issue)),
    );
    try {
      const owner: string = yield assignIssue(id);
      setIssues((draft) => {
        draft.list[draft.list.findIndex((issue) => issue.id === id)].assignee = owner;
      });
      setStatus("");
    } catch (error) {
      setStatus("Could not assign #" + id);
    }
  });

  return (
    <section>
      <button onClick={() => setMode(mode() === "all" ? "open" : "all")}>Filter: {mode()}</button>
      <b>{unassigned()} open</b>
      <Show when={visible().length > 0} fallback={<i>Nothing to triage</i>}>
        <For each={visible()}>{(issue) => <IssueRow issue={issue} onAssign={() => claim(issue.id)} />}</For>
      </Show>
      <em>{status()}</em>
    </section>
  );
}

function IssueRow(props: { issue: { id: number; title: string; assignee: string }; onAssign: () => void }) {
  return (
    <p>
      {props.issue.title}: {props.issue.assignee || "nobody"}
      <button onClick={() => props.onAssign()}>take</button>
    </p>
  );
}
```

<details><summary>The same component, handwritten in RX</summary>

```rx
import { assignIssue } from "./api";

export default component Tracker() {
  source issues := {
    list: [
      { id: 1, title: "Crash on save", assignee: "" },
      { id: 2, title: "Slow search", assignee: "ana" },
      { id: 3, title: "Typo in footer", assignee: "" },
    ],
  };
  source shown = issues.list;
  source mode := "all";
  source status := "";

  visible = filter(shown, issue => mode == "all" || issue.assignee == "");
  unassigned = filter(shown, issue => issue.assignee == "").length;

  action claim(id: number) {
    optimistic shown := list => map(list, issue => issue.id == id ? { id: issue.id, title: issue.title, assignee: "me" } : issue);
    try {
      let owner = await assignIssue(id);
      issues.list[indexOf(issues.list, issue => issue.id == id)].assignee := owner;
      status := "";
    } catch (error) {
      status := "Could not assign #" + id;
    }
  }

  <section>
    <button onClick={() => { mode := mode == "all" ? "open" : "all" }}>Filter: {mode}</button>
    <b>{"" + unassigned} open</b>
    {if visible.length > 0 {
      for issue in visible { <IssueRow issue={issue} onAssign={() => { claim(issue.id) }}/> }
    } else { <i>Nothing to triage</i> }}
    <em>{status}</em>
  </section>
}

component IssueRow(props: { issue: { id: number; title: string; assignee: string }; onAssign: action catches(nothing) }) {
  <p>{props.issue.title}: {props.issue.assignee || "nobody"}<button onClick={() => { props.onAssign() }}>take</button></p>
}
```
</details>

`tsx/demo.test.ts` checks that:
- the TSX and the handwritten RX produce **identical checker facts**, and snapshotting `mode` in the RX shows up as a difference;
- **five runs render the same eight frames**: native Solid, compiled TSX, compiled RX, interpreted TSX and interpreted RX.

```text
take #1 → "me" at once → the server answers "dev"
take #2 → "me" → it fails: back to "ana", "Could not assign #2"
filter "open" → take #3 → "Nothing to triage" → it succeeds, status cleared
```

One rough edge: the script never retries an issue. RX's scenario harnesses key requests by their arguments, and the interpreter can't take fresh ones without a core change, so a retry would reuse the earlier rejection. Real RX and Solid code makes a new request (SF-2c).

## Catching a lost update in plain Solid code

```tsx
const like = action(function* () {
  const before = likes();
  try {
    yield save();
    setLikes(before + 1); // refused: STALE_WRITE_BACK
  } catch (error) {}
});
```

Native Solid really does lose the update. Clicking "like and save" and then liking again while the save is in flight renders `0 → 0 → 1 → 1`. The frontend refuses this with RX's check from #18: *"STALE_WRITE_BACK … likes := … after an `await` is computed from likes as it was read before that `await` … write functionally"*. The handwritten RX gets the same error. `setLikes((n) => n + 1)` is accepted and renders `0 → 0 → 1 → 2` on native Solid and every RX backend.

## Refusing instead of changing the meaning

An `async` callback is refused at `async` (#20). In Solid, a write before the `await` takes effect immediately; RX would infer an action that holds it. The diagnostic suggests `action(function* () { … yield … })` and says plainly that this opts into held writes. Plain `createEffect`, object-valued `createSignal`, and a signal named `filter` (which shadows a built-in) are refused the same way.

## What it unlocks

- **RX's checks on existing Solid code**, adopted one file at a time; `.tsx` and `.rx` modules already import each other.
- **Differential fuzzing**: generate TSX and compare native Solid, the RX interpreter and the RX compiler. Hand-written pairs have already found upstream bugs.
- **Checking refactors and codemods**: identical facts before and after a change means reactivity was preserved.
- **An eval arm**: TSX with the RX checker vs `.rx` vs React. Is it the checks or the syntax that drives correctness?
- **Bug checks without new syntax**: RX checks such as #18's `STALE_WRITE_BACK` apply to plain TSX, as shown above.

## Status

| | |
| --- | --- |
| Verified parity subset | `npm run verify:subset`: **26/26** (tracker, stale write-back, counter, composition, boundary contracts) |
| Port of the full original prototype suite | **Not ready**: 96 failures (472/568 in the last full run, before the 4 stale-write tests were added), with one proposed core fix (`patches/0001`, not applied here); classified in `docs/RESULTS.md` |
| Footprint | Separate package; only `tsx/rx/` imports RX internals; no AST, syntax or inference changes; based on current `main` (`8518fa1`), Solid rc.20 |

Setup and commands: `tsx-frontend/README.md` → *Running it*.

## Questions

1. Is "lower into the existing AST, refuse whatever doesn't match the host" a reasonable way to explore other frontends?
2. #20: should ordinary async callbacks get an explicit form, or should TSX keep refusing them?


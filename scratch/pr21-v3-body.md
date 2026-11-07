> **Demo, not for merge.** Context for #1.

## What this is

Two small frontends: Solid TSX and solid-yield’s generator syntax. Both lower onto the existing RX AST; the RX checker, interpreter and compiler are unchanged. **Accepted code must behave like native Solid; otherwise it is refused.** This is the rule, not a claim that all Solid code is supported.

## The same counter in three syntaxes

These fixtures produce **identical canonical checker facts**. Snapshotting a reactive read changes the facts, and the tests catch it. The rendered frames are `0 → 2 → 4`.

### Solid TSX

```tsx
import { createSignal, createMemo } from "solid-js";

export default function Counter() {
  const [count, setCount] = createSignal(0);
  const doubled = createMemo(() => count() * 2);
  return <button onClick={() => setCount(count() + 1)}>{doubled()}</button>;
}
```

### solid-yield syntax

```tsx
import { $event, $memo, $signal, component, view } from "solid-yield";

export default component(function* Counter() {
  const [count, setCount] = yield* $signal(0);
  const doubled = yield* $memo(function* () {
    return (yield* count) * 2;
  });
  const increment = $event(function* () {
    yield* setCount((yield* count) + 1);
  });
  return view(function* () {
    return <button onClick={yield* increment}>{yield* doubled}</button>;
  });
});
```

### RX

```rx
export default component Counter() {
  source count := 0;
  doubled = count * 2;
  <button onClick={() => { count := count + 1 }}>{"" + doubled}</button>
}
```

## The tracker

A store, filter, memos, `Show`/`For`, a child callback, and an optimistic claim with commit or rollback:

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
  const [mode, setMode] = createSignal("all");
  const [claiming, setClaiming] = createOptimistic(0);
  const [status, setStatus] = createSignal("");
  const visible = createMemo(() => issues.list.filter((issue) => mode() === "all" || issue.assignee === ""));
  const unassigned = createMemo(() => issues.list.filter((issue) => issue.assignee === "").length);
  return (
    <section>
      <button onClick={() => setMode(mode() === "all" ? "open" : "all")}>Filter: {mode()}</button>
      <b>{unassigned()} open</b>
      <Show when={visible().length > 0} fallback={<i>Nothing to triage</i>}>
        <For each={visible()}>{(issue) => <IssueRow
          issue={issue}
          claiming={claiming() === issue.id}
          onAssign={action(function* (id: number) {
            setClaiming(id);
            try {
              const owner: string = yield assignIssue(id);
              setIssues((draft) => {
                draft.list[draft.list.findIndex((candidate) => candidate.id === id)].assignee = owner;
              });
              setStatus("");
            } catch (error) {
              setStatus("Could not assign #" + id);
            }
          })}
        />}</For>
      </Show>
      <em>{status()}</em>
    </section>
  );
}

function IssueRow(props: { issue: { id: number; title: string; assignee: string }; claiming: boolean; onAssign: (id: number) => void }) {
  return (
    <p>
      {props.issue.title}: {props.claiming ? "me" : props.issue.assignee || "nobody"}
      <button onClick={() => props.onAssign(props.issue.id)}>take</button>
    </p>
  );
}
```

<details>
<summary>The same tracker in solid-yield syntax</summary>

```tsx
import { $event, $memo, $optimistic, $signal, $store, attempt, component, For, Show, view } from "solid-yield";
import type { Handler, Props, Source } from "solid-yield";
import { assignIssue } from "./api";

type Issue = { id: number; title: string; assignee: string };

export default component(function* Tracker() {
  const [issues, setIssues] = yield* $store({
    list: [
      { id: 1, title: "Crash on save", assignee: "" },
      { id: 2, title: "Slow search", assignee: "ana" },
      { id: 3, title: "Typo in footer", assignee: "" },
    ],
  });
  const [mode, setMode] = yield* $signal("all");
  const [claiming, setClaiming] = yield* $optimistic(0);
  const [status, setStatus] = yield* $signal("");

  const visible = yield* $memo(function* () {
    const current = yield* mode;
    return (yield* issues.list).filter((issue) => current === "all" || issue.assignee === "");
  });
  const unassigned = yield* $memo(function* () {
    return (yield* issues.list).filter((issue) => issue.assignee === "").length;
  });

  const toggle = $event(function* () {
    yield* setMode((yield* mode) === "all" ? "open" : "all");
  });
  // Show the claim at once; commit the server's answer, or roll back and explain.
  const claim = $event(function* (id: number) {
    yield* setClaiming(id);
    const owner = yield* attempt(
      () => assignIssue(id),
      function* () {
        yield* setStatus("Could not assign #" + id);
      },
    );
    if (owner !== undefined) {
      yield* setIssues((draft) => {
        draft.list[draft.list.findIndex((candidate) => candidate.id === id)].assignee = owner;
      });
      yield* setStatus("");
    }
  });

  return view(function* () {
    return (
      <section>
        <button onClick={yield* toggle}>Filter: {yield* mode}</button>
        <b>{yield* unassigned} open</b>
        {yield* Show({
          when: function* () {
            return (yield* visible).length > 0;
          },
          fallback: function* () {
            return <i>Nothing to triage</i>;
          },
          children: function* () {
            return (
              <>
                {yield* For({
                  each: visible,
                  children: function* (issue) {
                    return view(function* () {
                      return (
                        <>
                          {yield* IssueRow({
                            issue,
                            claiming: function* () {
                              return (yield* claiming) === (yield* issue.id);
                            },
                            onAssign: claim,
                          })}
                        </>
                      );
                    });
                  },
                })}
              </>
            );
          },
        })}
        <em>{yield* status}</em>
      </section>
    );
  });
});

const IssueRow = component(function* IssueRow(
  props: Props<{ issue: Source<Issue>; claiming: Source<boolean>; onAssign: Handler<[number]> }>,
) {
  const take = $event(function* () {
    yield* props.onAssign(yield* props.issue.id);
  });
  return view(function* () {
    return (
      <p>
        {yield* props.issue.title}: {(yield* props.claiming) ? "me" : (yield* props.issue.assignee) || "nobody"}
        <button onClick={yield* take}>take</button>
      </p>
    );
  });
});
```

</details>

<details>
<summary>The same tracker in RX</summary>

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
  source mode := "all";
  source claiming = peek(0);
  source status := "";

  visible = filter(issues.list, issue => mode == "all" || issue.assignee == "");
  unassigned = filter(issues.list, issue => issue.assignee == "").length;

  <section>
    <button onClick={() => { mode := mode == "all" ? "open" : "all" }}>Filter: {mode}</button>
    <b>{"" + unassigned} open</b>
    {if visible.length > 0 {
      for issue in visible {
        <IssueRow issue={issue} claiming={claiming == issue.id} onAssign={(id) => {
          optimistic claiming := id;
          try {
            let owner = await assignIssue(id);
            issues.list[indexOf(issues.list, candidate => candidate.id == id)].assignee := owner;
            status := "";
          } catch (error) {
            status := "Could not assign #" + id;
          }
        }}/>
      }
    } else { <i>Nothing to triage</i> }}
    <em>{status}</em>
  </section>
}

component IssueRow(props: { issue: { id: number; title: string; assignee: string }; claiming: boolean; onAssign: (arg0: number) => void }) {
  <p>{props.issue.title}: {if props.claiming { {"me"} } else { {props.issue.assignee || "nobody"} }}<button onClick={() => { props.onAssign(props.issue.id) }}>take</button></p>
}
```

</details>

The TSX, yield and handwritten RX have identical canonical checker facts. Each frontend is checked on five legs: native Solid (the TSX twin), compiled and interpreted frontend output, and compiled and interpreted handwritten RX. All give the same eight frames:

```text
initial: #1 nobody, #2 ana, #3 nobody; 2 open
claim #1: me immediately; still 2 open
answer #1: dev; 1 open
claim #2: me
reject #2: ana again; "Could not assign #2"
filter open: only #3
claim #3: me; still 1 open
answer #3: 0 open, "Nothing to triage"; status cleared
```

The script does not retry a request: the reference harness keys flights by arguments, so retry behavior is not covered here.

## Stale write-back caught in plain TSX

```tsx
const like = action(function* () {
  const before = likes();
  try {
    yield save();
    setLikes(before + 1); // refused: STALE_WRITE_BACK
  } catch (error) {}
});
```

Native Solid loses the intervening update: `0 → 0 → 1 → 1`. The frontend and handwritten RX get the same checker error. `setLikes(n => n + 1)` is accepted and gives `0 → 0 → 1 → 2` on native Solid and both RX backends.

## The differential fuzzer

Each seed emits paired TSX/RX programs and a click/flight script. Five legs compare native Solid, compiled TSX, interpreted TSX, compiled RX and interpreted RX. The 500-seed run found the interpreter/compiler disagreement filed as #33; the in-tree rerun gave **454 matches and 46 upstream interpreter/compiler differences**, with no frontend differences or generator errors.

## Scope and gate

Accepted: literal-seeded scalar signals and stores, synchronous memos and handlers, functional/draft writes, optimistic values, generator actions with try/catch, local components with inline props, JSX, `Show` and `For`. Only the tested combinations are claimed.

Refused: ordinary async callbacks, effects, object-valued signals, contexts, server helpers, async/derived stores, previous/deferred values, general setup helpers and cross-module component imports. Unsupported forms get a diagnostic rather than a rewrite.

The package was cut to only what is verified, including yield and the fuzzer. **`npm run verify:subset`: PASS, 53/53 tests**, strict types and pin/boundary checks. Fuzz seeds 0–199: **179 matches, 21 listed upstream-only differences**. New or unlisted differences fail the gate; listed differences do not count as full parity.

Only `tsx-frontend/` is added, on clean `fdbcad92` with Solid rc.21. Setup: `tsx-frontend/README.md`. No RX core changes or patch queue.

## Question for Ryan

Is “lower into the existing AST, refuse whatever doesn’t match the host” a reasonable way to explore other frontends?

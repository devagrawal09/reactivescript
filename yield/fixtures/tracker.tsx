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
  const toggle = action(function* () {
    setMode(mode() === "all" ? "open" : "all");
  });
  const claim = action(function* (id: number) {
    setClaiming(id);
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
      <button onClick={() => toggle()}>Filter: {mode()}</button>
      <b>{unassigned()} open</b>
      <Show when={visible().length > 0} fallback={<i>Nothing to triage</i>}>
        <For each={visible()}>{(issue) => <IssueRow issue={issue} claiming={claiming() === issue.id} onAssign={(id: number) => claim(id)} />}</For>
      </Show>
      <em>{status()}</em>
    </section>
  );
}

function IssueRow(props: { issue: { id: number; title: string; assignee: string }; claiming: boolean; onAssign: (id: number) => void }) {
  const take = action(function* () {
    props.onAssign(props.issue.id);
  });
  return (
    <p>
      {props.issue.title}: {props.claiming ? "me" : props.issue.assignee || "nobody"}
      <button onClick={() => take()}>take</button>
    </p>
  );
}

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
  const [claiming, setClaiming] = createOptimistic(() => 0);
  const [status, setStatus] = createSignal("");

  const visible = createMemo(() =>
    issues.list.filter((issue) => mode() === "all" || issue.assignee === ""),
  );
  const unassigned = createMemo(() => issues.list.filter((issue) => issue.assignee === "").length);

  // Show the claim at once; commit the server's answer, or roll back and explain.
  const claim = action(function* (id: number) {
    setClaiming(id);
    try {
      const owner: string = yield assignIssue(id);
      setIssues((draft) => {
        draft.list[id - 1].assignee = owner; // ids are 1-based list positions here
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
        <For each={visible()}>
          {(issue) => (
            <IssueRow issue={issue} claiming={claiming() === issue.id} onAssign={() => claim(issue.id)} />
          )}
        </For>
      </Show>
      <em>{status()}</em>
    </section>
  );
}

function IssueRow(props: {
  issue: { id: number; title: string; assignee: string };
  claiming: boolean;
  onAssign: () => void;
}) {
  return (
    <p>
      {props.issue.title}: {props.claiming ? "me" : props.issue.assignee || "nobody"}
      <button onClick={() => props.onAssign()}>take</button>
    </p>
  );
}

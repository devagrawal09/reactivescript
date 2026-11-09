import { action, createMemo, createOptimistic, createSignal, createStore, For, Show } from "solid-js";
import { assignIssue } from "./api";

export default function Tracker() {
  const [issues, setIssues] = createStore({
    list: [
      { id: 1, title: "Crash on save", assignee: "" },
      { id: 2, title: "Slow search", assignee: "ana" },
      { id: 3, title: "Typo in footer", assignee: "" },
    ],
  });
  const [shown, setShown] = createOptimistic(() => issues.list);
  const [mode, setMode] = createSignal("all");
  const [status, setStatus] = createSignal("");
  const visible = createMemo(() => shown().filter((issue) => mode() === "all" || issue.assignee === ""));
  const unassigned = createMemo(() => shown().filter((issue) => issue.assignee === "").length);
  const claim = action(function* (id: number) {
    setShown((list) => list.map((issue) => (issue.id === id ? { id: issue.id, title: issue.title, assignee: "me" } : issue)));
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
        <For each={visible()}>{(issue) => (
          <p>
            {issue.title}: {issue.assignee || "nobody"}
            <button onClick={() => claim(issue.id)}>take</button>
          </p>
        )}</For>
      </Show>
      <em>{status()}</em>
    </section>
  );
}

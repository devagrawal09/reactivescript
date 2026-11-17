import { startTransition, useOptimistic, useState } from "react";
import { assignIssue } from "./api";

export default function Tracker() {
  const [issues, setIssues] = useState({
    list: [
      { id: 1, title: "Crash on save", assignee: "" },
      { id: 2, title: "Slow search", assignee: "ana" },
      { id: 3, title: "Typo in footer", assignee: "" },
    ],
  });
  const [shown, setShown] = useOptimistic(issues.list);
  const [mode, setMode] = useState("all");
  const [status, setStatus] = useState("");
  const visible = shown.filter((issue) => mode === "all" || issue.assignee === "");
  const unassigned = shown.filter((issue) => issue.assignee === "").length;
  const claim = (id: number) => startTransition(async () => {
    setShown((list) => list.map((issue) => (issue.id === id ? { id: issue.id, title: issue.title, assignee: "me" } : issue)));
    try {
      const owner: string = await assignIssue(id);
      startTransition(() => {
        setIssues((prev) => ({ ...prev, list: prev.list.map((issue) => (issue.id === id ? { ...issue, assignee: owner } : issue)) }));
        setStatus("");
      });
    } catch (error) {
      startTransition(() => setStatus("Could not assign #" + id));
    }
  });
  return (
    <section>
      <button onClick={() => setMode(mode === "all" ? "open" : "all")}>Filter: {mode}</button>
      <b>{unassigned} open</b>
      {visible.length > 0 ? visible.map((issue) => (
        <p key={issue.id}>
          {issue.title}: {issue.assignee || "nobody"}
          <button onClick={() => claim(issue.id)}>take</button>
        </p>
      )) : <i>Nothing to triage</i>}
      <em>{status}</em>
    </section>
  );
}

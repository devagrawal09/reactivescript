import { action, affects, createMemo, createSignal, Errored, For, isPending, Loading, refresh } from "solid-js";
import { assignIssue, loadIssues } from "./api";

export default function TrackerAsync() {
  const issues = createMemo(() => loadIssues());
  const [status, setStatus] = createSignal("");
  const claim = action(function* (id: number) {
    affects(issues);
    try {
      const owner: string = yield assignIssue(id);
      refresh(issues);
      setStatus("Assigned #" + id + " to " + owner);
    } catch (error) {
      setStatus("Could not assign #" + id);
    }
  });
  return (
    <section>
      <Errored fallback={(err) => <p>Could not load issues<button onClick={() => refresh(issues)}>retry</button></p>}>
        <Loading fallback={<i>Loading issues…</i>}>
          <b>{"" + (isPending(() => issues()) ? "saving…" : "ready")}</b>
          <For each={issues()}>{(issue) => (
            <p>
              {issue.title}: {issue.assignee || "nobody"}
              <button onClick={() => claim(issue.id)}>take</button>
            </p>
          )}</For>
        </Loading>
      </Errored>
      <em>{status()}</em>
    </section>
  );
}

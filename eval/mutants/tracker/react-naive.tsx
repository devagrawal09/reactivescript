// A plausible first draft: effects that fetch, no cancellation, an optimistic update that forgets the old assignee.
import { useEffect, useState } from "react";
import { assign, fetchIssue, fetchIssues, type Issue, type IssueDetail } from "./api";

export default function App() {
  const [user, setUser] = useState("guest");
  const [filter, setFilter] = useState<"open" | "closed">("open");
  const [issues, setIssues] = useState<Issue[] | null>(null);
  const [listError, setListError] = useState("");
  const [selected, setSelected] = useState<number | null>(null);
  const [detail, setDetail] = useState<IssueDetail | null | undefined>(undefined);
  const [detailError, setDetailError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [assignError, setAssignError] = useState("");

  useEffect(() => {
    setIssues(null); setListError("");
    fetchIssues(filter).then(setIssues, e => setListError(e.message));
  }, [filter]);
  useEffect(() => {
    if (selected === null) return;
    setDetail(undefined); setDetailError("");
    fetchIssue(selected).then(setDetail, e => setDetailError(e.message));
  }, [selected, attempt]);

  const onAssign = async (id: number) => {
    setAssignError("");
    setIssues(list => list && list.map(i => (i.id === id ? { ...i, assignee: user } : i)));
    try { await assign(id, user); } catch (e) {
      setIssues(list => list && list.map(i => (i.id === id ? { ...i, assignee: null } : i)));
      setAssignError((e as Error).message);
    }
  };

  return (
    <main>
      <input data-testid="user" value={user} onChange={e => setUser(e.target.value)} />
      <section data-testid="list">
        <button data-testid="filter-open" onClick={() => setFilter("open")}>open</button>
        <button data-testid="filter-closed" onClick={() => setFilter("closed")}>closed</button>
        {listError ? <p>list error: {listError}</p> : issues === null ? <p>loading {filter} issues</p> :
          <ul>{issues.map(i => <li key={i.id} data-testid="issue" onClick={() => { setSelected(i.id); setAssignError(""); }}>#{i.id} {i.title} ({i.assignee ?? "unassigned"})</li>)}</ul>}
      </section>
      <section data-testid="detail">
        {selected === null ? <p>select an issue</p> : <>
          {detailError ? <p>detail error: {detailError}</p> : detail === undefined ? <p>loading #{selected}</p>
            : detail === null ? <p>detail error: issue #{selected} not found</p> : <><h3>#{detail.id} {detail.title}</h3> <p>{detail.body}</p></>}
          <button data-testid="retry" onClick={() => setAttempt(a => a + 1)}>retry</button>
          <button data-testid="assign" onClick={() => onAssign(selected)}>assign to {user}</button>
          {assignError}
        </>}
      </section>
    </main>
  );
}

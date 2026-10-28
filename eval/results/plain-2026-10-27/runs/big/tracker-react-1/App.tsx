import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { assign, fetchIssue, fetchIssues } from "./api.js";
import type { Issue, IssueDetail } from "./api.js";

type Filter = "open" | "closed";

type ListResult =
  | { filter: Filter; ok: true; issues: Issue[] }
  | { filter: Filter; ok: false; message: string };

type DetailResult =
  | { key: string; ok: true; issue: IssueDetail | null }
  | { key: string; ok: false; message: string };

type Pending = { seq: number; user: string };
type AssignError = { id: number; seq: number; message: string };

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

export default function App() {
  const [user, setUser] = useState("guest");
  const [filter, setFilter] = useState<Filter>("open");
  const [list, setList] = useState<ListResult | null>(null);
  // a fetch generation per filter selection, so re-selecting a filter reloads it
  const [listGen, setListGen] = useState(0);
  const [listGenOf, setListGenOf] = useState(0);

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [detail, setDetail] = useState<DetailResult | null>(null);

  const [pending, setPending] = useState<Map<number, Pending>>(() => new Map());
  const [confirmed, setConfirmed] = useState<Map<number, string>>(() => new Map());
  const [assignError, setAssignError] = useState<AssignError | null>(null);
  const seqRef = useRef(0);

  // ---- list ----
  useEffect(() => {
    let live = true;
    const gen = listGen;
    fetchIssues(filter).then(
      issues => { if (live) { setList({ filter, ok: true, issues }); setListGenOf(gen); } },
      (e: unknown) => { if (live) { setList({ filter, ok: false, message: messageOf(e) }); setListGenOf(gen); } },
    );
    return () => { live = false; };
  }, [filter, listGen]);

  const listReady = list !== null && list.filter === filter && listGenOf === listGen;

  const chooseFilter = (f: Filter) => {
    if (f === filter) return;
    setFilter(f);
    setListGen(g => g + 1);
  };

  // ---- detail ----
  const detailKey = selectedId === null ? null : `${selectedId}:${attempt}`;
  useEffect(() => {
    if (selectedId === null) return;
    let live = true;
    const key = `${selectedId}:${attempt}`;
    fetchIssue(selectedId).then(
      issue => { if (live) setDetail({ key, ok: true, issue }); },
      (e: unknown) => { if (live) setDetail({ key, ok: false, message: messageOf(e) }); },
    );
    return () => { live = false; };
  }, [selectedId, attempt]);

  const select = (id: number) => {
    if (id === selectedId) return;
    setSelectedId(id);
    setAttempt(a => a + 1);
    setAssignError(null);
  };

  const retry = () => setAttempt(a => a + 1);

  // ---- assign ----
  const doAssign = () => {
    if (selectedId === null) return;
    const id = selectedId;
    const who = user;
    const seq = ++seqRef.current;
    setAssignError(null);
    setPending(prev => new Map(prev).set(id, { seq, user: who }));
    assign(id, who).then(
      res => {
        setConfirmed(prev => new Map(prev).set(res.id, res.assignee));
        setPending(prev => {
          if (prev.get(id)?.seq !== seq) return prev;
          const next = new Map(prev);
          next.delete(id);
          return next;
        });
      },
      (e: unknown) => {
        setPending(prev => {
          if (prev.get(id)?.seq !== seq) return prev;
          const next = new Map(prev);
          next.delete(id);
          return next;
        });
        // only the latest assignment's failure is reported
        if (seqRef.current === seq) setAssignError({ id, seq, message: messageOf(e) });
      },
    );
  };

  const assigneeOf = (issue: Issue): string | null => {
    const p = pending.get(issue.id);
    if (p) return p.user;
    if (confirmed.has(issue.id)) return confirmed.get(issue.id) ?? null;
    return issue.assignee;
  };

  // ---- render ----
  let listBody: ReactNode;
  if (!listReady || list === null) {
    listBody = <p>loading {filter} issues</p>;
  } else if (!list.ok) {
    listBody = <p>list error: {list.message}</p>;
  } else {
    listBody = (
      <ul>
        {list.issues.map(issue => (
          <li
            key={issue.id}
            data-testid="issue"
            onClick={() => select(issue.id)}
            style={{ cursor: "pointer", fontWeight: issue.id === selectedId ? "bold" : undefined }}
          >
            {`#${issue.id} ${issue.title} (${assigneeOf(issue) ?? "unassigned"})`}
          </li>
        ))}
      </ul>
    );
  }

  let detailBody: ReactNode;
  if (selectedId === null) {
    detailBody = <p>select an issue</p>;
  } else {
    const d = detail !== null && detail.key === detailKey ? detail : null;
    let content: ReactNode;
    if (d === null) content = <p>loading #{selectedId}</p>;
    else if (!d.ok) content = <p>detail error: {d.message}</p>;
    else if (d.issue === null) content = <p>detail error: issue #{selectedId} not found</p>;
    else
      content = (
        <>
          <h2>{`#${d.issue.id} ${d.issue.title}`}</h2>
          <p>{d.issue.body}</p>
        </>
      );
    detailBody = (
      <>
        {content}
        <button data-testid="retry" onClick={retry}>retry</button>
        <button data-testid="assign" onClick={doAssign}>{`assign to ${user}`}</button>
        {assignError !== null && assignError.id === selectedId && (
          <p data-testid="assign-error">assign error: {assignError.message}</p>
        )}
      </>
    );
  }

  return (
    <main>
      <label>
        user{" "}
        <input data-testid="user" value={user} onChange={e => setUser(e.target.value)} />
      </label>
      <div>
        <button data-testid="filter-open" onClick={() => chooseFilter("open")}>open</button>
        <button data-testid="filter-closed" onClick={() => chooseFilter("closed")}>closed</button>
      </div>
      <div style={{ display: "flex", gap: "2rem" }}>
        <section data-testid="list">{listBody}</section>
        <section data-testid="detail">{detailBody}</section>
      </div>
    </main>
  );
}

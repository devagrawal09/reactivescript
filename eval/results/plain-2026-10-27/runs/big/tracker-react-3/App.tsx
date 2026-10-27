import { useEffect, useState } from "react";
import { assign, fetchIssue, fetchIssues } from "./api.js";
import type { Issue, IssueDetail } from "./api.js";

type Filter = "open" | "closed";
type ListQuery = { filter: Filter; n: number };
type DetailQuery = { id: number; n: number };

type ListResult =
  | { query: ListQuery; ok: true; issues: Issue[] }
  | { query: ListQuery; ok: false; message: string };
type DetailResult =
  | { query: DetailQuery; ok: true; issue: IssueDetail | null }
  | { query: DetailQuery; ok: false; message: string };

type PendingAssign = { token: number; id: number; assignee: string };

const errMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

let tokenSeq = 0;

export default function App() {
  const [user, setUser] = useState("guest");
  const [listQuery, setListQuery] = useState<ListQuery>({ filter: "open", n: 0 });
  const [listResult, setListResult] = useState<ListResult | null>(null);
  const [detailQuery, setDetailQuery] = useState<DetailQuery | null>(null);
  const [detailResult, setDetailResult] = useState<DetailResult | null>(null);
  // assignments still waiting for the server, oldest first
  const [pending, setPending] = useState<PendingAssign[]>([]);
  // assignments the server accepted, applied over the loaded list
  const [confirmed, setConfirmed] = useState<Record<number, string>>({});
  const [assignError, setAssignError] = useState<{ id: number; message: string } | null>(null);

  useEffect(() => {
    let live = true;
    fetchIssues(listQuery.filter).then(
      issues => { if (live) setListResult({ query: listQuery, ok: true, issues }); },
      (e: unknown) => { if (live) setListResult({ query: listQuery, ok: false, message: errMessage(e) }); },
    );
    return () => { live = false; };
  }, [listQuery]);

  useEffect(() => {
    if (!detailQuery) return;
    let live = true;
    fetchIssue(detailQuery.id).then(
      issue => { if (live) setDetailResult({ query: detailQuery, ok: true, issue }); },
      (e: unknown) => { if (live) setDetailResult({ query: detailQuery, ok: false, message: errMessage(e) }); },
    );
    return () => { live = false; };
  }, [detailQuery]);

  function chooseFilter(filter: Filter) {
    if (filter === listQuery.filter) return;
    setListQuery({ filter, n: listQuery.n + 1 });
    // a fresh fetch reflects every assignment the server already accepted
    setConfirmed({});
  }

  function select(id: number) {
    if (detailQuery?.id === id) return;
    setDetailQuery({ id, n: (detailQuery?.n ?? 0) + 1 });
    setAssignError(null);
  }

  function retry() {
    if (!detailQuery) return;
    setDetailQuery({ id: detailQuery.id, n: detailQuery.n + 1 });
  }

  function doAssign() {
    if (!detailQuery) return;
    const id = detailQuery.id;
    const who = user;
    const token = ++tokenSeq;
    setAssignError(null);
    setPending(p => [...p, { token, id, assignee: who }]);
    assign(id, who).then(
      res => {
        setPending(p => p.filter(a => a.token !== token));
        setConfirmed(c => ({ ...c, [res.id]: res.assignee }));
      },
      (e: unknown) => {
        setPending(p => p.filter(a => a.token !== token));
        setAssignError({ id, message: errMessage(e) });
      },
    );
  }

  function assigneeOf(issue: Issue): string | null {
    for (let i = pending.length - 1; i >= 0; i--) {
      if (pending[i].id === issue.id) return pending[i].assignee;
    }
    if (issue.id in confirmed) return confirmed[issue.id];
    return issue.assignee;
  }

  const listCurrent = listResult && listResult.query === listQuery ? listResult : null;
  let list;
  if (!listCurrent) {
    list = <p>loading {listQuery.filter} issues</p>;
  } else if (!listCurrent.ok) {
    list = <p>list error: {listCurrent.message}</p>;
  } else {
    list = (
      <ul>
        {listCurrent.issues.map(issue => {
          const who = assigneeOf(issue);
          return (
            <li
              key={issue.id}
              data-testid="issue"
              onClick={() => select(issue.id)}
              style={{
                cursor: "pointer",
                fontWeight: detailQuery?.id === issue.id ? "bold" : undefined,
              }}
            >
              {`#${issue.id} ${issue.title} (${who ?? "unassigned"})`}
            </li>
          );
        })}
      </ul>
    );
  }

  let detail;
  if (!detailQuery) {
    detail = <p>select an issue</p>;
  } else {
    const current = detailResult && detailResult.query === detailQuery ? detailResult : null;
    let body;
    if (!current) {
      body = <p>loading #{detailQuery.id}</p>;
    } else if (!current.ok) {
      body = <p>detail error: {current.message}</p>;
    } else if (current.issue === null) {
      body = <p>detail error: issue #{detailQuery.id} not found</p>;
    } else {
      body = (
        <>
          <h2>{`#${current.issue.id} ${current.issue.title}`}</h2>
          <p>{current.issue.body}</p>
        </>
      );
    }
    detail = (
      <>
        {body}
        <button data-testid="retry" onClick={retry}>retry</button>
        <button data-testid="assign" onClick={doAssign}>{`assign to ${user}`}</button>
        {assignError && assignError.id === detailQuery.id && (
          <p data-testid="assign-error">{assignError.message}</p>
        )}
      </>
    );
  }

  return (
    <div>
      <label>
        user{" "}
        <input data-testid="user" value={user} onChange={e => setUser(e.target.value)} />
      </label>
      <div>
        <button
          data-testid="filter-open"
          aria-pressed={listQuery.filter === "open"}
          onClick={() => chooseFilter("open")}
        >
          open
        </button>
        <button
          data-testid="filter-closed"
          aria-pressed={listQuery.filter === "closed"}
          onClick={() => chooseFilter("closed")}
        >
          closed
        </button>
      </div>
      <div style={{ display: "flex", gap: "2rem" }}>
        <section data-testid="list">{list}</section>
        <section data-testid="detail">{detail}</section>
      </div>
    </div>
  );
}

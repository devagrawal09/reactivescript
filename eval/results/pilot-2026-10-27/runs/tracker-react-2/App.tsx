import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { assign, fetchIssue, fetchIssues } from "./api.js";
import type { Issue, IssueDetail } from "./api.js";

type Filter = "open" | "closed";

type ListResult =
  | { req: number; ok: true; issues: Issue[] }
  | { req: number; ok: false; message: string };

type DetailResult =
  | { req: number; id: number; ok: true; issue: IssueDetail | null }
  | { req: number; id: number; ok: false; message: string };

type PendingOp = { token: number; user: string };
type Confirmed = { token: number; user: string };
type AssignError = { token: number; id: number; message: string };

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

export default function App() {
  const [user, setUser] = useState("guest");

  // ---- list ----
  const [filter, setFilter] = useState<Filter>("open");
  const [listReq, setListReq] = useState(0);
  const [listResult, setListResult] = useState<ListResult | null>(null);

  useEffect(() => {
    let live = true;
    const req = listReq;
    fetchIssues(filter).then(
      issues => { if (live) setListResult({ req, ok: true, issues }); },
      (e: unknown) => { if (live) setListResult({ req, ok: false, message: errorMessage(e) }); },
    );
    return () => { live = false; };
  }, [filter, listReq]);

  const chooseFilter = (f: Filter) => {
    if (f === filter) return;
    setFilter(f);
    setListReq(r => r + 1);
  };

  // ---- detail ----
  const [sel, setSel] = useState<{ id: number | null; req: number; since: number }>({ id: null, req: 0, since: 0 });
  const selected = sel.id;
  const detailReq = sel.req;
  const [detailResult, setDetailResult] = useState<DetailResult | null>(null);

  useEffect(() => {
    if (selected === null) return;
    let live = true;
    const req = detailReq;
    const id = selected;
    fetchIssue(id).then(
      issue => { if (live) setDetailResult({ req, id, ok: true, issue }); },
      (e: unknown) => { if (live) setDetailResult({ req, id, ok: false, message: errorMessage(e) }); },
    );
    return () => { live = false; };
  }, [selected, detailReq]);

  // ---- assignment ----
  const tokenRef = useRef(0);
  const selectGenRef = useRef(0);
  const [pending, setPending] = useState<Record<number, PendingOp[]>>({});
  const [confirmed, setConfirmed] = useState<Record<number, Confirmed>>({});
  const [assignError, setAssignError] = useState<AssignError | null>(null);

  const select = (id: number) => {
    setAssignError(null);
    selectGenRef.current++;
    if (id === selected) return;
    setSel(s => ({ id, req: s.req + 1, since: s.req + 1 }));
  };

  const retry = () => setSel(s => ({ ...s, req: s.req + 1 }));

  const doAssign = () => {
    if (selected === null) return;
    const id = selected;
    const who = user;
    const token = ++tokenRef.current;
    const gen = selectGenRef.current;
    setAssignError(null);
    setPending(p => ({ ...p, [id]: [...(p[id] ?? []), { token, user: who }] }));
    const removeOp = () =>
      setPending(p => {
        const rest = (p[id] ?? []).filter(op => op.token !== token);
        const next = { ...p };
        if (rest.length) next[id] = rest;
        else delete next[id];
        return next;
      });
    assign(id, who).then(
      res => {
        setConfirmed(c => {
          const prev = c[id];
          if (prev && prev.token > token) return c;
          return { ...c, [id]: { token, user: res.assignee } };
        });
        removeOp();
      },
      (e: unknown) => {
        removeOp();
        if (tokenRef.current === token && selectGenRef.current === gen) {
          setAssignError(cur => (cur === null || cur.token < token ? { token, id, message: errorMessage(e) } : cur));
        }
      },
    );
  };

  const assigneeOf = (issue: Issue): string | null => {
    const ops = pending[issue.id];
    if (ops && ops.length) return ops[ops.length - 1].user;
    const c = confirmed[issue.id];
    if (c) return c.user;
    return issue.assignee;
  };

  // ---- render ----
  let listBody: ReactNode;
  if (!listResult || listResult.req !== listReq) {
    listBody = <p>loading {filter} issues</p>;
  } else if (!listResult.ok) {
    listBody = <p>list error: {listResult.message}</p>;
  } else {
    listBody = (
      <ul>
        {listResult.issues.map(issue => (
          <li
            key={issue.id}
            data-testid="issue"
            onClick={() => select(issue.id)}
            style={{ cursor: "pointer", fontWeight: issue.id === selected ? "bold" : undefined }}
          >
            #{issue.id} {issue.title} ({assigneeOf(issue) ?? "unassigned"})
          </li>
        ))}
      </ul>
    );
  }

  let detailBody: ReactNode;
  if (selected === null) {
    detailBody = <p>select an issue</p>;
  } else {
    let content: ReactNode;
    // A retry keeps showing the current answer for this issue until its own answer arrives.
    if (!detailResult || detailResult.id !== selected || detailResult.req < sel.since) {
      content = <p>loading #{selected}</p>;
    } else if (!detailResult.ok) {
      content = <p>detail error: {detailResult.message}</p>;
    } else if (detailResult.issue === null) {
      content = <p>detail error: issue #{selected} not found</p>;
    } else {
      content = (
        <>
          <h2>#{detailResult.issue.id} {detailResult.issue.title}</h2>
          <p>{detailResult.issue.body}</p>
        </>
      );
    }
    detailBody = (
      <>
        {content}
        <button data-testid="retry" onClick={retry}>retry</button>{" "}
        <button data-testid="assign" onClick={doAssign}>assign to {user}</button>
        {assignError && assignError.id === selected && <p data-testid="assign-error">{assignError.message}</p>}
      </>
    );
  }

  return (
    <div style={{ fontFamily: "sans-serif", padding: 16 }}>
      <label>
        user <input data-testid="user" value={user} onChange={e => setUser(e.target.value)} />
      </label>
      <div style={{ margin: "8px 0" }}>
        <button data-testid="filter-open" onClick={() => chooseFilter("open")} aria-pressed={filter === "open"}>open</button>{" "}
        <button data-testid="filter-closed" onClick={() => chooseFilter("closed")} aria-pressed={filter === "closed"}>closed</button>
      </div>
      <div style={{ display: "flex", gap: 24 }}>
        <section data-testid="list" style={{ flex: 1 }}>{listBody}</section>
        <section data-testid="detail" style={{ flex: 1 }}>{detailBody}</section>
      </div>
    </div>
  );
}

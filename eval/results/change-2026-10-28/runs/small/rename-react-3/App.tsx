import { useEffect, useRef, useState } from "react";
import { assign, fetchIssue, fetchIssues, renameIssue } from "./api.js";
import type { Issue, IssueDetail } from "./api.js";

type Filter = "open" | "closed";

type ListResult =
  | { filter: Filter; nonce: number; ok: true; issues: Issue[] }
  | { filter: Filter; nonce: number; ok: false; message: string };

type DetailResult =
  | { id: number; nonce: number; ok: true; issue: IssueDetail | null }
  | { id: number; nonce: number; ok: false; message: string };

type Pending = { token: number; assignee: string; confirmed: boolean };

type Renamed = { token: number; title: string };

const errMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

export default function App() {
  const [user, setUser] = useState("guest");
  const [filter, setFilter] = useState<Filter>("open");
  const [listNonce, setListNonce] = useState(0);
  const [list, setList] = useState<ListResult | null>(null);

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detailNonce, setDetailNonce] = useState(0);
  const [detail, setDetail] = useState<DetailResult | null>(null);

  // Per-issue assignments, oldest first; the latest still standing wins.
  const [assignments, setAssignments] = useState<Record<number, Pending[]>>({});
  const [assignError, setAssignError] = useState<{ id: number; token: number; message: string } | null>(null);
  const tokenRef = useRef(0);
  const latestAssignRef = useRef(0);
  const selectedRef = useRef<number | null>(null);

  // Per-issue renames, oldest first; the latest still standing wins.
  const [renames, setRenames] = useState<Record<number, Renamed[]>>({});
  const [renameDraft, setRenameDraft] = useState("");
  const [renameError, setRenameError] = useState<{ id: number; token: number; message: string } | null>(null);
  const latestRenameRef = useRef(0);

  useEffect(() => {
    let live = true;
    fetchIssues(filter).then(
      issues => { if (live) setList({ filter, nonce: listNonce, ok: true, issues }); },
      (e: unknown) => { if (live) setList({ filter, nonce: listNonce, ok: false, message: errMessage(e) }); },
    );
    return () => { live = false; };
  }, [filter, listNonce]);

  useEffect(() => {
    if (selectedId === null) return;
    let live = true;
    const id = selectedId;
    fetchIssue(id).then(
      issue => { if (live) setDetail({ id, nonce: detailNonce, ok: true, issue }); },
      (e: unknown) => { if (live) setDetail({ id, nonce: detailNonce, ok: false, message: errMessage(e) }); },
    );
    return () => { live = false; };
  }, [selectedId, detailNonce]);

  const chooseFilter = (f: Filter) => {
    if (f === filter) return;
    setFilter(f);
    setListNonce(n => n + 1);
  };

  const select = (id: number) => {
    if (id === selectedId) return;
    selectedRef.current = id;
    setSelectedId(id);
    setDetailNonce(n => n + 1);
    setAssignError(null);
    setRenameDraft("");
    setRenameError(null);
  };

  const retry = () => {
    setDetailNonce(n => n + 1);
  };

  const doAssign = () => {
    if (selectedId === null) return;
    const id = selectedId;
    const who = user;
    const token = ++tokenRef.current;
    latestAssignRef.current = token;
    setAssignError(null);
    setAssignments(prev => ({ ...prev, [id]: [...(prev[id] ?? []), { token, assignee: who, confirmed: false }] }));
    assign(id, who).then(
      res => {
        setAssignments(prev => {
          const entries = prev[id] ?? [];
          // A confirmed assignment supersedes older ones.
          const idx = entries.findIndex(p => p.token === token);
          if (idx < 0) return prev;
          const next = entries.slice(idx).map(p => (p.token === token ? { ...p, assignee: res.assignee, confirmed: true } : p));
          return { ...prev, [id]: next };
        });
      },
      (e: unknown) => {
        setAssignments(prev => {
          const entries = (prev[id] ?? []).filter(p => p.token !== token);
          return { ...prev, [id]: entries };
        });
        if (latestAssignRef.current === token && selectedRef.current === id) {
          setAssignError({ id, token, message: errMessage(e) });
        }
      },
    );
  };

  const doRename = () => {
    if (selectedId === null || renameDraft === "") return;
    const id = selectedId;
    const title = renameDraft;
    const token = ++tokenRef.current;
    latestRenameRef.current = token;
    setRenameError(null);
    setRenames(prev => ({ ...prev, [id]: [...(prev[id] ?? []), { token, title }] }));
    renameIssue(id, title).then(
      () => {
        // Accepted: the new title stays as it is.
      },
      (e: unknown) => {
        setRenames(prev => ({ ...prev, [id]: (prev[id] ?? []).filter(p => p.token !== token) }));
        if (latestRenameRef.current === token && selectedRef.current === id) {
          setRenameError({ id, token, message: errMessage(e) });
        }
      },
    );
  };

  const shownAssignee = (issue: Issue): string | null => {
    const entries = assignments[issue.id];
    if (entries && entries.length) return entries[entries.length - 1].assignee;
    return issue.assignee;
  };

  const shownTitle = (id: number, base: string): string => {
    const entries = renames[id];
    if (entries && entries.length) return entries[entries.length - 1].title;
    return base;
  };

  const listCurrent = list !== null && list.filter === filter && list.nonce === listNonce ? list : null;

  let listBody;
  if (!listCurrent) listBody = <p>loading {filter} issues</p>;
  else if (!listCurrent.ok) listBody = <p>list error: {listCurrent.message}</p>;
  else
    listBody = (
      <ul>
        {listCurrent.issues.map(issue => (
          <li
            key={issue.id}
            data-testid="issue"
            onClick={() => select(issue.id)}
            style={{ cursor: "pointer", fontWeight: issue.id === selectedId ? "bold" : undefined }}
          >
            {`#${issue.id} ${shownTitle(issue.id, issue.title)} (${shownAssignee(issue) ?? "unassigned"})`}
          </li>
        ))}
      </ul>
    );

  let detailBody;
  if (selectedId === null) detailBody = <p>select an issue</p>;
  else {
    const current = detail !== null && detail.id === selectedId && detail.nonce === detailNonce ? detail : null;
    let content;
    if (!current) content = <p>loading #{selectedId}</p>;
    else if (!current.ok) content = <p>detail error: {current.message}</p>;
    else if (current.issue === null) content = <p>detail error: issue #{selectedId} not found</p>;
    else
      content = (
        <div>
          <h2>{`#${current.issue.id} ${shownTitle(current.issue.id, current.issue.title)}`}</h2>
          <p>{current.issue.body}</p>
        </div>
      );
    detailBody = (
      <>
        {content}
        <button data-testid="retry" onClick={retry}>retry</button>
        <button data-testid="assign" onClick={doAssign}>{`assign to ${user}`}</button>
        {assignError && assignError.id === selectedId && <p data-testid="assign-error">{assignError.message}</p>}
        <input data-testid="title-input" value={renameDraft} onChange={e => setRenameDraft(e.target.value)} />
        <button data-testid="rename" onClick={doRename}>rename</button>
        {renameError && renameError.id === selectedId && <p data-testid="rename-error">{`rename error: ${renameError.message}`}</p>}
      </>
    );
  }

  return (
    <div>
      <label>
        user <input data-testid="user" value={user} onChange={e => setUser(e.target.value)} />
      </label>
      <div>
        <button data-testid="filter-open" onClick={() => chooseFilter("open")}>open</button>
        <button data-testid="filter-closed" onClick={() => chooseFilter("closed")}>closed</button>
      </div>
      <div style={{ display: "flex", gap: "2em" }}>
        <section data-testid="list">{listBody}</section>
        <section data-testid="detail">{detailBody}</section>
      </div>
    </div>
  );
}

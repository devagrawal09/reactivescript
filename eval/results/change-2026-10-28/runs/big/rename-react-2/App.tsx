import { useEffect, useState } from "react";
import { assign, fetchIssue, fetchIssues, renameIssue } from "./api.js";
import type { Issue, IssueDetail } from "./api.js";

type Filter = "open" | "closed";
type ListReq = { filter: Filter };
type ListRes =
  | { req: ListReq; startedAt: number; ok: true; data: Issue[] }
  | { req: ListReq; startedAt: number; ok: false; error: string };
type SelReq = { id: number };
type DetRes =
  | { req: SelReq; startedAt: number; ok: true; data: IssueDetail | null }
  | { req: SelReq; startedAt: number; ok: false; error: string };
type Pending = { seq: number; id: number; user: string };
type Confirmed = Record<number, { assignee: string; at: number }>;
type AssignState = { seq: number; id: number; error: string | null } | null;
type PendingRename = { seq: number; id: number; title: string };
type ConfirmedTitles = Record<number, { title: string; at: number }>;
type RenameState = { seq: number; id: number; error: string | null } | null;

// Logical clock used to tell whether a list response predates a confirmed assignment.
let clock = 0;
let assignSeq = 0;
let renameSeq = 0;

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export default function App() {
  const [user, setUser] = useState("guest");
  const [listReq, setListReq] = useState<ListReq>({ filter: "open" });
  const [listRes, setListRes] = useState<ListRes | null>(null);
  const [sel, setSel] = useState<SelReq | null>(null);
  const [detRes, setDetRes] = useState<DetRes | null>(null);
  const [pending, setPending] = useState<Pending[]>([]);
  const [confirmed, setConfirmed] = useState<Confirmed>({});
  const [assignState, setAssignState] = useState<AssignState>(null);
  const [titleDraft, setTitleDraft] = useState("");
  const [pendingRenames, setPendingRenames] = useState<PendingRename[]>([]);
  const [confirmedTitles, setConfirmedTitles] = useState<ConfirmedTitles>({});
  const [renameState, setRenameState] = useState<RenameState>(null);

  useEffect(() => {
    let cancelled = false;
    const startedAt = ++clock;
    fetchIssues(listReq.filter).then(
      data => { if (!cancelled) setListRes({ req: listReq, startedAt, ok: true, data }); },
      (e: unknown) => { if (!cancelled) setListRes({ req: listReq, startedAt, ok: false, error: message(e) }); },
    );
    return () => { cancelled = true; };
  }, [listReq]);

  useEffect(() => {
    if (!sel) return;
    let cancelled = false;
    const startedAt = ++clock;
    fetchIssue(sel.id).then(
      data => { if (!cancelled) setDetRes({ req: sel, startedAt, ok: true, data }); },
      (e: unknown) => { if (!cancelled) setDetRes({ req: sel, startedAt, ok: false, error: message(e) }); },
    );
    return () => { cancelled = true; };
  }, [sel]);

  const chooseFilter = (filter: Filter) => {
    if (filter !== listReq.filter) setListReq({ filter });
  };

  const select = (id: number) => {
    if (sel && sel.id === id) return;
    setSel({ id });
    setAssignState(null);
    setRenameState(null);
    setTitleDraft("");
  };

  const retry = () => {
    if (sel) setSel({ id: sel.id });
  };

  const doAssign = () => {
    if (!sel) return;
    const id = sel.id;
    const seq = ++assignSeq;
    const who = user;
    setPending(p => [...p, { seq, id, user: who }]);
    setAssignState({ seq, id, error: null });
    assign(id, who).then(
      res => {
        const at = ++clock;
        setConfirmed(c => ({ ...c, [id]: { assignee: res.assignee, at } }));
        setPending(p => p.filter(x => x.seq !== seq));
      },
      (e: unknown) => {
        setPending(p => p.filter(x => x.seq !== seq));
        setAssignState(s => (s && s.seq === seq ? { ...s, error: message(e) } : s));
      },
    );
  };

  const doRename = () => {
    if (!sel) return;
    const title = titleDraft;
    if (title.trim() === "") return;
    const id = sel.id;
    const seq = ++renameSeq;
    setPendingRenames(p => [...p, { seq, id, title }]);
    setRenameState({ seq, id, error: null });
    renameIssue(id, title).then(
      res => {
        const at = ++clock;
        setConfirmedTitles(c => ({ ...c, [id]: { title: res.title, at } }));
        setPendingRenames(p => p.filter(x => x.seq !== seq));
      },
      (e: unknown) => {
        setPendingRenames(p => p.filter(x => x.seq !== seq));
        setRenameState(s => (s && s.seq === seq ? { ...s, error: message(e) } : s));
      },
    );
  };

  const titleOf = (id: number, title: string, startedAt: number): string => {
    let latest: PendingRename | null = null;
    for (const p of pendingRenames) if (p.id === id && (!latest || p.seq > latest.seq)) latest = p;
    if (latest) return latest.title;
    const c = confirmedTitles[id];
    if (c && c.at > startedAt) return c.title;
    return title;
  };

  const assigneeOf = (row: Issue, startedAt: number): string | null => {
    let latest: Pending | null = null;
    for (const p of pending) if (p.id === row.id && (!latest || p.seq > latest.seq)) latest = p;
    if (latest) return latest.user;
    const c = confirmed[row.id];
    if (c && c.at > startedAt) return c.assignee;
    return row.assignee;
  };

  const filter = listReq.filter;
  let list: React.ReactNode;
  if (!listRes || listRes.req !== listReq) list = <p>loading {filter} issues</p>;
  else if (!listRes.ok) list = <p>list error: {listRes.error}</p>;
  else
    list = (
      <ul>
        {listRes.data.map(row => {
          const a = assigneeOf(row, listRes.startedAt);
          return (
            <li
              key={row.id}
              data-testid="issue"
              onClick={() => select(row.id)}
              style={{ cursor: "pointer", fontWeight: sel?.id === row.id ? "bold" : undefined }}
            >
              {`#${row.id} ${titleOf(row.id, row.title, listRes.startedAt)} (${a ?? "unassigned"})`}
            </li>
          );
        })}
      </ul>
    );

  let detail: React.ReactNode;
  if (!sel) detail = <p>select an issue</p>;
  else {
    let body: React.ReactNode;
    if (!detRes || detRes.req !== sel) body = <p>loading #{sel.id}</p>;
    else if (!detRes.ok) body = <p>detail error: {detRes.error}</p>;
    else if (!detRes.data) body = <p>detail error: issue #{sel.id} not found</p>;
    else
      body = (
        <>
          <h2>{`#${detRes.data.id} ${titleOf(detRes.data.id, detRes.data.title, detRes.startedAt)}`}</h2>
          <p>{detRes.data.body}</p>
        </>
      );
    const assignError = assignState && assignState.id === sel.id ? assignState.error : null;
    const renameError = renameState && renameState.id === sel.id ? renameState.error : null;
    detail = (
      <>
        {body}
        <button data-testid="retry" onClick={retry}>retry</button>{" "}
        <button data-testid="assign" onClick={doAssign}>{`assign to ${user}`}</button>
        {assignError !== null && <p data-testid="assign-error">{assignError}</p>}
        <div>
          <input
            data-testid="title-input"
            value={titleDraft}
            onChange={e => setTitleDraft(e.target.value)}
          />{" "}
          <button data-testid="rename" onClick={doRename}>rename</button>
        </div>
        {renameError !== null && <p data-testid="rename-error">{`rename error: ${renameError}`}</p>}
      </>
    );
  }

  return (
    <div>
      <label>
        user <input data-testid="user" value={user} onChange={e => setUser(e.target.value)} />
      </label>
      <div>
        <button data-testid="filter-open" onClick={() => chooseFilter("open")}>open</button>{" "}
        <button data-testid="filter-closed" onClick={() => chooseFilter("closed")}>closed</button>
      </div>
      <div style={{ display: "flex", gap: "2em" }}>
        <section data-testid="list">{list}</section>
        <section data-testid="detail">{detail}</section>
      </div>
    </div>
  );
}

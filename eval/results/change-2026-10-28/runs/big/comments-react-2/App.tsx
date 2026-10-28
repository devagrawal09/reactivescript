import { useEffect, useState } from "react";
import { addComment, assign, fetchComments, fetchIssue, fetchIssues } from "./api.js";
import type { Comment, Issue, IssueDetail } from "./api.js";

type Filter = "open" | "closed";
type ListReq = { filter: Filter };
type ListRes =
  | { req: ListReq; startedAt: number; ok: true; data: Issue[] }
  | { req: ListReq; startedAt: number; ok: false; error: string };
type SelReq = { id: number };
type DetRes =
  | { req: SelReq; ok: true; data: IssueDetail | null }
  | { req: SelReq; ok: false; error: string };
type Pending = { seq: number; id: number; user: string };
type Confirmed = Record<number, { assignee: string; at: number }>;
type AssignState = { seq: number; id: number; error: string | null } | null;

type ComRes =
  | { id: number; startedAt: number; ok: true; data: Comment[] }
  | { id: number; startedAt: number; ok: false; error: string };
type LocalPost = { seq: number; id: number; author: string; text: string; at: number | null };
type PostState = { seq: number; id: number; error: string | null } | null;

// Logical clock used to tell whether a list response predates a confirmed assignment.
let clock = 0;
let assignSeq = 0;
let postSeq = 0;

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
  const [comRes, setComRes] = useState<ComRes | null>(null);
  const [posts, setPosts] = useState<LocalPost[]>([]);
  const [postState, setPostState] = useState<PostState>(null);
  const [draft, setDraft] = useState("");

  const selId = sel ? sel.id : null;
  useEffect(() => {
    if (selId === null) return;
    let cancelled = false;
    const startedAt = ++clock;
    fetchComments(selId).then(
      data => { if (!cancelled) setComRes({ id: selId, startedAt, ok: true, data }); },
      (e: unknown) => { if (!cancelled) setComRes({ id: selId, startedAt, ok: false, error: message(e) }); },
    );
    return () => {
      cancelled = true;
      setComRes(null);
    };
  }, [selId]);

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
    fetchIssue(sel.id).then(
      data => { if (!cancelled) setDetRes({ req: sel, ok: true, data }); },
      (e: unknown) => { if (!cancelled) setDetRes({ req: sel, ok: false, error: message(e) }); },
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
    setPostState(null);
  };

  const doPost = () => {
    if (!sel) return;
    const text = draft;
    if (text.trim() === "") return;
    const id = sel.id;
    const seq = ++postSeq;
    const author = user;
    setDraft("");
    setPosts(p => [...p, { seq, id, author, text, at: null }]);
    setPostState({ seq, id, error: null });
    addComment(id, author, text).then(
      res => {
        const at = ++clock;
        setPosts(p => p.map(x => (x.seq === seq ? { ...x, author: res.author, text: res.text, at } : x)));
      },
      (e: unknown) => {
        setPosts(p => p.filter(x => x.seq !== seq));
        setPostState(s => (s && s.seq === seq ? { ...s, error: message(e) } : s));
      },
    );
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
              {`#${row.id} ${row.title} (${a ?? "unassigned"})`}
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
          <h2>{`#${detRes.data.id} ${detRes.data.title}`}</h2>
          <p>{detRes.data.body}</p>
        </>
      );
    const assignError = assignState && assignState.id === sel.id ? assignState.error : null;
    const res = comRes && comRes.id === sel.id ? comRes : null;
    const local = posts.filter(
      p => p.id === sel.id && (p.at === null || !res || p.at > res.startedAt),
    );
    const postError = postState && postState.id === sel.id ? postState.error : null;
    const comments = (
      <section data-testid="comments">
        {!res ? <p>loading comments</p> : !res.ok ? <p>comments error: {res.error}</p> : null}
        <ul>
          {res && res.ok && res.data.map((c, i) => (
            <li key={`s${i}`} data-testid="comment">{`${c.author}: ${c.text}`}</li>
          ))}
          {local.map(p => (
            <li key={`l${p.seq}`} data-testid="comment">
              {`${p.author}: ${p.text}${p.at === null ? " (sending…)" : ""}`}
            </li>
          ))}
        </ul>
      </section>
    );
    detail = (
      <>
        {body}
        <button data-testid="retry" onClick={retry}>retry</button>{" "}
        <button data-testid="assign" onClick={doAssign}>{`assign to ${user}`}</button>
        {assignError !== null && <p data-testid="assign-error">{assignError}</p>}
        {comments}
        <div>
          <input data-testid="comment-input" value={draft} onChange={e => setDraft(e.target.value)} />{" "}
          <button data-testid="post" onClick={doPost}>post</button>
        </div>
        {postError !== null && <p data-testid="post-error">post error: {postError}</p>}
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

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
type CommentsRes =
  | { id: number; startedAt: number; ok: true; data: Comment[] }
  | { id: number; startedAt: number; ok: false; error: string };
// A post on the server's comment list: `sentAt` is set once the server has accepted it.
type Post = { seq: number; id: number; author: string; text: string; sentAt: number | null };
type PostError = { id: number; message: string } | null;

// Logical clock used to tell whether a list response predates a confirmed assignment,
// and whether a comments response was requested after a post was accepted.
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
  const [commentsRes, setCommentsRes] = useState<CommentsRes | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [draft, setDraft] = useState("");
  const [postError, setPostError] = useState<PostError>(null);

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

  useEffect(() => {
    if (!sel) return;
    let cancelled = false;
    const id = sel.id;
    const startedAt = ++clock;
    fetchComments(id).then(
      data => { if (!cancelled) setCommentsRes({ id, startedAt, ok: true, data }); },
      (e: unknown) => { if (!cancelled) setCommentsRes({ id, startedAt, ok: false, error: message(e) }); },
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
    setPostError(null);
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

  const doPost = () => {
    if (!sel || draft.trim() === "") return;
    const id = sel.id;
    const author = user;
    const text = draft;
    const seq = ++postSeq;
    setPosts(p => [...p, { seq, id, author, text, sentAt: null }]);
    setDraft("");
    setPostError(null);
    addComment(id, author, text).then(
      () => {
        const sentAt = ++clock;
        setPosts(p => p.map(x => (x.seq === seq ? { ...x, sentAt } : x)));
      },
      (e: unknown) => {
        setPosts(p => p.filter(x => x.seq !== seq));
        setPostError({ id, message: message(e) });
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

    // Comments: the fetched list for this issue, then this issue's posts not yet covered by a fetch.
    const cr = commentsRes && commentsRes.id === sel.id ? commentsRes : null;
    const fetched = cr && cr.ok ? cr.data : [];
    // A sent post is dropped once a comments fetch requested after it was sent has succeeded,
    // because that fetch already includes it.
    const covered = (p: Post) => p.sentAt !== null && cr !== null && cr.ok && cr.startedAt > p.sentAt;
    const shown = posts.filter(p => p.id === sel.id && !covered(p));
    const commentsStatus = !cr ? "loading comments" : !cr.ok ? `comments error: ${cr.error}` : null;

    detail = (
      <>
        {body}
        <button data-testid="retry" onClick={retry}>retry</button>{" "}
        <button data-testid="assign" onClick={doAssign}>{`assign to ${user}`}</button>
        {assignError !== null && <p data-testid="assign-error">{assignError}</p>}
        <section data-testid="comments">
          {commentsStatus !== null && <p>{commentsStatus}</p>}
          <ul>
            {fetched.map((c, i) => (
              <li key={`f${i}`} data-testid="comment">{`${c.author}: ${c.text}`}</li>
            ))}
            {shown.map(p => (
              <li key={`p${p.seq}`} data-testid="comment">
                {`${p.author}: ${p.text}${p.sentAt === null ? " (sending…)" : ""}`}
              </li>
            ))}
          </ul>
        </section>
        {postError !== null && postError.id === sel.id && (
          <p data-testid="post-error">{`post error: ${postError.message}`}</p>
        )}
        <div>
          <input data-testid="comment-input" value={draft} onChange={e => setDraft(e.target.value)} />{" "}
          <button data-testid="post" onClick={doPost}>post</button>
        </div>
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

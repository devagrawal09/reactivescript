import { useEffect, useRef, useState } from "react";
import { addComment, assign, fetchComments, fetchIssue, fetchIssues } from "./api.js";
import type { Comment, Issue, IssueDetail } from "./api.js";

type Filter = "open" | "closed";

type ListResult =
  | { filter: Filter; nonce: number; ok: true; issues: Issue[] }
  | { filter: Filter; nonce: number; ok: false; message: string };

type DetailResult =
  | { id: number; nonce: number; ok: true; issue: IssueDetail | null }
  | { id: number; nonce: number; ok: false; message: string };

type Pending = { token: number; assignee: string; confirmed: boolean };

type CommentsResult =
  | { id: number; ok: true; comments: Comment[] }
  | { id: number; ok: false; message: string };

type Post = { token: number; author: string; text: string; status: "sending" | "accepted" };

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

  // Comments of the selected issue, and posts made from this page (per issue, oldest first).
  const [comments, setComments] = useState<CommentsResult | null>(null);
  const [posts, setPosts] = useState<Record<number, Post[]>>({});
  const [draft, setDraft] = useState("");
  const [postError, setPostError] = useState<{ id: number; message: string } | null>(null);
  const postTokenRef = useRef(0);
  const latestPostRef = useRef(0);

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

  useEffect(() => {
    if (selectedId === null) return;
    let live = true;
    const id = selectedId;
    fetchComments(id).then(
      list => { if (live) setComments({ id, ok: true, comments: list }); },
      (e: unknown) => { if (live) setComments({ id, ok: false, message: errMessage(e) }); },
    );
    return () => { live = false; };
  }, [selectedId]);

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
    setComments(null);
    setPostError(null);
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

  const doPost = () => {
    if (selectedId === null) return;
    const text = draft;
    if (text.trim() === "") return;
    const id = selectedId;
    const author = user;
    const token = ++postTokenRef.current;
    latestPostRef.current = token;
    setPostError(null);
    setDraft("");
    setPosts(prev => ({ ...prev, [id]: [...(prev[id] ?? []), { token, author, text, status: "sending" }] }));
    addComment(id, author, text).then(
      () => {
        setPosts(prev => ({
          ...prev,
          [id]: (prev[id] ?? []).map(p => (p.token === token ? { ...p, status: "accepted" as const } : p)),
        }));
      },
      (e: unknown) => {
        setPosts(prev => ({ ...prev, [id]: (prev[id] ?? []).filter(p => p.token !== token) }));
        if (latestPostRef.current === token && selectedRef.current === id) {
          setPostError({ id, message: errMessage(e) });
        }
      },
    );
  };

  const shownAssignee = (issue: Issue): string | null => {
    const entries = assignments[issue.id];
    if (entries && entries.length) return entries[entries.length - 1].assignee;
    return issue.assignee;
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
            {`#${issue.id} ${issue.title} (${shownAssignee(issue) ?? "unassigned"})`}
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
          <h2>{`#${current.issue.id} ${current.issue.title}`}</h2>
          <p>{current.issue.body}</p>
        </div>
      );
    const commentsNow = comments !== null && comments.id === selectedId ? comments : null;
    const fetched: Comment[] = commentsNow?.ok ? commentsNow.comments : [];
    // An accepted post the server's list already shows is not repeated.
    const unmatched = new Map<string, number>();
    for (const c of fetched) {
      const key = JSON.stringify([c.author, c.text]);
      unmatched.set(key, (unmatched.get(key) ?? 0) + 1);
    }
    const shownPosts = (posts[selectedId] ?? []).filter(p => {
      if (p.status === "sending") return true;
      const key = JSON.stringify([p.author, p.text]);
      const n = unmatched.get(key) ?? 0;
      if (n > 0) { unmatched.set(key, n - 1); return false; }
      return true;
    });

    detailBody = (
      <>
        {content}
        <button data-testid="retry" onClick={retry}>retry</button>
        <button data-testid="assign" onClick={doAssign}>{`assign to ${user}`}</button>
        {assignError && assignError.id === selectedId && <p data-testid="assign-error">{assignError.message}</p>}
        <section data-testid="comments">
          {commentsNow === null && <p>loading comments</p>}
          {commentsNow !== null && !commentsNow.ok && <p>{`comments error: ${commentsNow.message}`}</p>}
          <ul>
            {fetched.map((c, i) => (
              <li key={`f${i}`} data-testid="comment">{`${c.author}: ${c.text}`}</li>
            ))}
            {shownPosts.map(p => (
              <li key={`p${p.token}`} data-testid="comment">
                {`${p.author}: ${p.text}${p.status === "sending" ? " (sending…)" : ""}`}
              </li>
            ))}
          </ul>
        </section>
        <div>
          <input data-testid="comment-input" value={draft} onChange={e => setDraft(e.target.value)} />
          <button data-testid="post" onClick={doPost}>post</button>
        </div>
        {postError && postError.id === selectedId && <p data-testid="post-error">{`post error: ${postError.message}`}</p>}
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

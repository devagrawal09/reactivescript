import { useRef, useState } from "react";
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query";
import { addComment, assign, fetchComments, fetchIssue, fetchIssues } from "./api.js";
import type { Comment, Issue } from "./api.js";

type Filter = "open" | "closed";
type Pending = { seq: number; user: string };
type AssignError = { issueId: number; message: string };
type PendingComment = { seq: number; author: string; text: string };

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

function Tracker() {
  const queryClient = useQueryClient();
  const [user, setUser] = useState("guest");
  const [filter, setFilter] = useState<Filter>("open");
  const [selected, setSelected] = useState<number | null>(null);
  // optimistic assignments still in the air, per issue, oldest first
  const [pending, setPending] = useState<Record<number, Pending[]>>({});
  const [assignError, setAssignError] = useState<AssignError | null>(null);
  const seqRef = useRef(0);
  const confirmedSeqRef = useRef<Record<number, number>>({});
  const [commentText, setCommentText] = useState("");
  // optimistic comments still in the air, per issue, oldest first
  const [pendingComments, setPendingComments] = useState<Record<number, PendingComment[]>>({});
  const [postError, setPostError] = useState<AssignError | null>(null);
  const postSeqRef = useRef(0);
  const selectedRef = useRef<number | null>(null);

  const list = useQuery({
    queryKey: ["issues", filter],
    queryFn: () => fetchIssues(filter),
  });

  const detail = useQuery({
    queryKey: ["issue", selected],
    queryFn: async () => {
      const id = selected as number;
      const d = await fetchIssue(id);
      if (d === null) throw new Error(`issue #${id} not found`);
      return d;
    },
    enabled: selected !== null,
  });

  const comments = useQuery({
    queryKey: ["comments", selected],
    queryFn: () => fetchComments(selected as number),
    enabled: selected !== null,
  });

  const assigneeOf = (issue: Issue) => {
    const p = pending[issue.id];
    if (p && p.length > 0) return p[p.length - 1].user;
    return issue.assignee;
  };

  const select = (id: number) => {
    setSelected(id);
    selectedRef.current = id;
    setAssignError(null);
    setPostError(null);
  };

  const doPost = async (id: number, author: string, text: string) => {
    const seq = ++postSeqRef.current;
    setPostError(null);
    setPendingComments(prev => ({ ...prev, [id]: [...(prev[id] ?? []), { seq, author, text }] }));
    const done = () =>
      setPendingComments(prev => {
        const rest = (prev[id] ?? []).filter(p => p.seq !== seq);
        const next = { ...prev };
        if (rest.length) next[id] = rest;
        else delete next[id];
        return next;
      });
    try {
      const res = await addComment(id, author, text);
      queryClient.setQueryData<Comment[]>(["comments", id], old => (old ? [...old, res] : old));
      done();
    } catch (e) {
      done();
      if (selectedRef.current === id) setPostError({ issueId: id, message: errorMessage(e) });
    }
  };

  const doAssign = async (id: number, who: string) => {
    const seq = ++seqRef.current;
    setAssignError(null);
    setPending(prev => ({ ...prev, [id]: [...(prev[id] ?? []), { seq, user: who }] }));
    const done = () =>
      setPending(prev => {
        const rest = (prev[id] ?? []).filter(p => p.seq !== seq);
        const next = { ...prev };
        if (rest.length) next[id] = rest;
        else delete next[id];
        return next;
      });
    try {
      const res = await assign(id, who);
      if ((confirmedSeqRef.current[id] ?? 0) < seq) {
        confirmedSeqRef.current[id] = seq;
        queryClient.setQueriesData<Issue[]>({ queryKey: ["issues"] }, old =>
          old?.map(i => (i.id === id ? { ...i, assignee: res.assignee } : i)),
        );
      }
      done();
    } catch (e) {
      done();
      // only report the failure if no later assignment has started since
      if (seqRef.current === seq) setAssignError({ issueId: id, message: errorMessage(e) });
    }
  };

  let listContent;
  if (list.isPending) listContent = <p>loading {filter} issues</p>;
  else if (list.isError) listContent = <p>list error: {errorMessage(list.error)}</p>;
  else
    listContent = (
      <ul>
        {list.data.map(issue => (
          <li key={issue.id}>
            <button
              type="button"
              data-testid="issue"
              aria-pressed={issue.id === selected}
              onClick={() => select(issue.id)}
            >
              #{issue.id} {issue.title} ({assigneeOf(issue) ?? "unassigned"})
            </button>
          </li>
        ))}
      </ul>
    );

  let detailContent;
  if (selected === null) detailContent = <p>select an issue</p>;
  else {
    let body;
    if (detail.isFetching || detail.isPending) body = <p>loading #{selected}</p>;
    else if (detail.isError) body = <p>detail error: {errorMessage(detail.error)}</p>;
    else
      body = (
        <>
          <h2>
            #{detail.data.id} {detail.data.title}
          </h2>
          <p>{detail.data.body}</p>
        </>
      );
    const id = selected;
    const commentsContent = (
      <>
        {comments.isPending && <p>loading comments</p>}
        {comments.isError && <p>comments error: {errorMessage(comments.error)}</p>}
        <ul>
          {comments.isSuccess &&
            comments.data.map((c, i) => (
              <li key={i} data-testid="comment">
                {c.author}: {c.text}
              </li>
            ))}
          {(pendingComments[id] ?? []).map(p => (
            <li key={`p${p.seq}`} data-testid="comment">
              {p.author}: {p.text} (sending…)
            </li>
          ))}
        </ul>
      </>
    );
    const submitPost = () => {
      if (commentText === "") return;
      setCommentText("");
      void doPost(id, user, commentText);
    };
    detailContent = (
      <>
        {body}
        <button type="button" data-testid="retry" onClick={() => void detail.refetch()}>
          retry
        </button>
        <button type="button" data-testid="assign" onClick={() => void doAssign(id, user)}>
          assign to {user}
        </button>
        {assignError && assignError.issueId === selected && (
          <p data-testid="assign-error">{assignError.message}</p>
        )}
        <div data-testid="comments">{commentsContent}</div>
        <input
          data-testid="comment-input"
          value={commentText}
          onChange={e => setCommentText(e.target.value)}
        />
        <button type="button" data-testid="post" onClick={submitPost}>
          post
        </button>
        {postError && postError.issueId === selected && (
          <p data-testid="post-error">post error: {postError.message}</p>
        )}
      </>
    );
  }

  return (
    <div style={{ display: "flex", gap: "2rem" }}>
      <section>
        <label>
          user{" "}
          <input data-testid="user" value={user} onChange={e => setUser(e.target.value)} />
        </label>
        <div>
          <button
            type="button"
            data-testid="filter-open"
            aria-pressed={filter === "open"}
            onClick={() => setFilter("open")}
          >
            open
          </button>
          <button
            type="button"
            data-testid="filter-closed"
            aria-pressed={filter === "closed"}
            onClick={() => setFilter("closed")}
          >
            closed
          </button>
        </div>
        <div data-testid="list">{listContent}</div>
      </section>
      <section data-testid="detail">{detailContent}</section>
    </div>
  );
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false, gcTime: 0, refetchOnWindowFocus: false, refetchOnReconnect: false },
  },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Tracker />
    </QueryClientProvider>
  );
}

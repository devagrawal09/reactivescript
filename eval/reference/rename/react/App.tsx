import { useRef, useState } from "react";
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query";
import { assign, fetchIssue, fetchIssues, renameIssue } from "./api.js";
import type { Issue, IssueDetail } from "./api.js";

type Filter = "open" | "closed";
type Pending = { seq: number; user: string };
type AssignError = { issueId: number; message: string };
type PendingTitle = { seq: number; title: string };

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
  // optimistic renames still in the air, per issue, oldest first
  const [pendingTitles, setPendingTitles] = useState<Record<number, PendingTitle[]>>({});
  const [renameError, setRenameError] = useState<AssignError | null>(null);
  const [titleInput, setTitleInput] = useState("");
  const renameSeqRef = useRef(0);
  const confirmedTitleSeqRef = useRef<Record<number, number>>({});

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

  const assigneeOf = (issue: Issue) => {
    const p = pending[issue.id];
    if (p && p.length > 0) return p[p.length - 1].user;
    return issue.assignee;
  };

  const titleOf = (id: number, title: string) => {
    const p = pendingTitles[id];
    if (p && p.length > 0) return p[p.length - 1].title;
    return title;
  };

  const select = (id: number) => {
    setSelected(id);
    setAssignError(null);
    setRenameError(null);
    setTitleInput("");
  };

  const doRename = async (id: number, title: string) => {
    const seq = ++renameSeqRef.current;
    setRenameError(null);
    setPendingTitles(prev => ({ ...prev, [id]: [...(prev[id] ?? []), { seq, title }] }));
    const done = () =>
      setPendingTitles(prev => {
        const rest = (prev[id] ?? []).filter(p => p.seq !== seq);
        const next = { ...prev };
        if (rest.length) next[id] = rest;
        else delete next[id];
        return next;
      });
    try {
      const res = await renameIssue(id, title);
      if ((confirmedTitleSeqRef.current[id] ?? 0) < seq) {
        confirmedTitleSeqRef.current[id] = seq;
        queryClient.setQueriesData<Issue[]>({ queryKey: ["issues"] }, old =>
          old?.map(i => (i.id === id ? { ...i, title: res.title } : i)),
        );
        queryClient.setQueryData<IssueDetail>(["issue", id], old => (old ? { ...old, title: res.title } : old));
      }
      done();
    } catch (e) {
      done();
      if (renameSeqRef.current === seq) setRenameError({ issueId: id, message: errorMessage(e) });
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
              #{issue.id} {titleOf(issue.id, issue.title)} ({assigneeOf(issue) ?? "unassigned"})
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
            #{detail.data.id} {titleOf(detail.data.id, detail.data.title)}
          </h2>
          <p>{detail.data.body}</p>
        </>
      );
    const id = selected;
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
        <input data-testid="title-input" value={titleInput} onChange={e => setTitleInput(e.target.value)} />
        <button
          type="button"
          data-testid="rename"
          onClick={() => {
            if (titleInput !== "") void doRename(id, titleInput);
          }}
        >
          rename
        </button>
        {renameError && renameError.issueId === selected && <p>rename error: {renameError.message}</p>}
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

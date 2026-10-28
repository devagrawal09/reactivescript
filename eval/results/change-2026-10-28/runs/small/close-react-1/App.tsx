import { useRef, useState } from "react";
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query";
import { assign, closeIssue, fetchIssue, fetchIssues } from "./api.js";
import type { Issue } from "./api.js";

type Filter = "open" | "closed";
type Pending = { seq: number; user: string };
type AssignError = { issueId: number; message: string };
type CloseError = { issueId: number; message: string };

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
  // closes in the air, per issue (their rows are hidden at once)
  const [closing, setClosing] = useState<Record<number, number>>({});
  // issues the server has accepted closing
  const [closedIds, setClosedIds] = useState<Record<number, boolean>>({});
  const [closeError, setCloseError] = useState<CloseError | null>(null);
  const closeSeqRef = useRef(0);

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

  const select = (id: number) => {
    setSelected(id);
    setAssignError(null);
    setCloseError(null);
    closeSeqRef.current++;
  };

  const isHidden = (id: number) => (closing[id] ?? 0) > 0 || closedIds[id] === true;

  const doClose = async (id: number) => {
    const seq = ++closeSeqRef.current;
    setCloseError(null);
    setClosing(prev => ({ ...prev, [id]: (prev[id] ?? 0) + 1 }));
    try {
      await closeIssue(id);
      setClosedIds(prev => ({ ...prev, [id]: true }));
    } catch (e) {
      // only report the failure if the issue is still the one being looked at
      if (closeSeqRef.current === seq) setCloseError({ issueId: id, message: errorMessage(e) });
    } finally {
      setClosing(prev => {
        const left = (prev[id] ?? 1) - 1;
        const next = { ...prev };
        if (left > 0) next[id] = left;
        else delete next[id];
        return next;
      });
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
        {list.data.filter(issue => !(filter === "open" && isHidden(issue.id))).map(issue => (
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
    detailContent = (
      <>
        {body}
        <button type="button" data-testid="retry" onClick={() => void detail.refetch()}>
          retry
        </button>
        <button type="button" data-testid="assign" onClick={() => void doAssign(id, user)}>
          assign to {user}
        </button>
        <button type="button" data-testid="close" onClick={() => void doClose(id)}>
          close
        </button>
        {assignError && assignError.issueId === selected && (
          <p data-testid="assign-error">{assignError.message}</p>
        )}
        {closeError && closeError.issueId === selected && (
          <p data-testid="close-error">close error: {closeError.message}</p>
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

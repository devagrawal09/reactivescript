import { useRef, useState } from "react";
import {
  QueryClient,
  QueryClientProvider,
  notifyManager,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { assign, fetchIssue, fetchIssues, type Issue } from "./api.js";

type Filter = "open" | "closed";
type PendingAssign = { token: number; id: number; user: string };
type AssignError = { id: number; message: string };

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      staleTime: Infinity,
      gcTime: 0,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    },
  },
});

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function IssueList({
  filter,
  pending,
  onSelect,
}: {
  filter: Filter;
  pending: PendingAssign[];
  onSelect: (id: number) => void;
}) {
  const q = useQuery({
    queryKey: ["issues", filter],
    queryFn: () => fetchIssues(filter),
  });

  let content;
  if (q.isPending) {
    content = <p>loading {filter} issues</p>;
  } else if (q.isError) {
    content = <p>list error: {messageOf(q.error)}</p>;
  } else {
    content = (
      <ul>
        {q.data.map(issue => {
          let assignee = issue.assignee;
          for (const p of pending) if (p.id === issue.id) assignee = p.user;
          return (
            <li
              key={issue.id}
              data-testid="issue"
              style={{ cursor: "pointer" }}
              onClick={() => onSelect(issue.id)}
            >
              {`#${issue.id} ${issue.title} (${assignee ?? "unassigned"})`}
            </li>
          );
        })}
      </ul>
    );
  }
  return <section data-testid="list">{content}</section>;
}

function Detail({
  id,
  user,
  assignError,
  onAssign,
}: {
  id: number;
  user: string;
  assignError: string | null;
  onAssign: () => void;
}) {
  const q = useQuery({
    queryKey: ["issue", id],
    queryFn: () => fetchIssue(id),
  });

  let content;
  if (q.isFetching || q.isPending) {
    content = <p>loading #{id}</p>;
  } else if (q.isError) {
    content = <p>detail error: {messageOf(q.error)}</p>;
  } else if (q.data === null) {
    content = <p>detail error: issue #{id} not found</p>;
  } else {
    content = (
      <>
        <h2>{`#${q.data.id} ${q.data.title}`}</h2>
        <p>{q.data.body}</p>
      </>
    );
  }

  return (
    <>
      {content}
      <button data-testid="retry" onClick={() => void q.refetch()}>
        retry
      </button>
      <button data-testid="assign" onClick={onAssign}>
        {`assign to ${user}`}
      </button>
      {assignError !== null && <p>{assignError}</p>}
    </>
  );
}

function Tracker() {
  const client = useQueryClient();
  const [user, setUser] = useState("guest");
  const [filter, setFilter] = useState<Filter>("open");
  const [selected, setSelected] = useState<number | null>(null);
  const [pending, setPending] = useState<PendingAssign[]>([]);
  const [assignError, setAssignError] = useState<AssignError | null>(null);
  const seq = useRef(0);
  const applied = useRef(new Map<number, number>());

  function select(id: number) {
    if (id === selected) return;
    setSelected(id);
    setAssignError(null);
  }

  async function startAssign() {
    if (selected === null) return;
    const id = selected;
    const who = user;
    const token = ++seq.current;
    setAssignError(null);
    setPending(p => [...p, { token, id, user: who }]);
    const done = () => setPending(p => p.filter(x => x.token !== token));
    try {
      const res = await assign(id, who);
      notifyManager.batch(() => {
        if ((applied.current.get(id) ?? -1) < token) {
          applied.current.set(id, token);
          client.setQueriesData<Issue[]>({ queryKey: ["issues"] }, old =>
            old?.map(i => (i.id === res.id ? { ...i, assignee: res.assignee } : i)),
          );
        }
        notifyManager.schedule(done);
      });
    } catch (e) {
      done();
      setAssignError({ id, message: messageOf(e) });
    }
  }

  return (
    <main style={{ display: "flex", gap: "2rem", fontFamily: "sans-serif" }}>
      <div>
        <label>
          user{" "}
          <input data-testid="user" value={user} onChange={e => setUser(e.target.value)} />
        </label>
        <div>
          <button
            data-testid="filter-open"
            aria-pressed={filter === "open"}
            onClick={() => setFilter("open")}
          >
            open
          </button>
          <button
            data-testid="filter-closed"
            aria-pressed={filter === "closed"}
            onClick={() => setFilter("closed")}
          >
            closed
          </button>
        </div>
        <IssueList filter={filter} pending={pending} onSelect={select} />
      </div>
      <section data-testid="detail">
        {selected === null ? (
          <p>select an issue</p>
        ) : (
          <Detail
            key={selected}
            id={selected}
            user={user}
            assignError={assignError !== null && assignError.id === selected ? assignError.message : null}
            onAssign={() => void startAssign()}
          />
        )}
      </section>
    </main>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Tracker />
    </QueryClientProvider>
  );
}

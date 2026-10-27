import { useState } from "react";
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { QueryClient as QC } from "@tanstack/react-query";
import { assign, fetchIssue, fetchIssues } from "./api.js";
import type { Issue } from "./api.js";

type Filter = "open" | "closed";

const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Writes an assignee into every cached issue list, wherever the issue appears. */
function setAssignee(qc: QC, id: number, assignee: string) {
  qc.setQueriesData<Issue[]>({ queryKey: ["issues"] }, old =>
    old?.map(issue => (issue.id === id ? { ...issue, assignee } : issue)),
  );
}

export default function App() {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: false, refetchOnWindowFocus: false },
          mutations: { retry: false },
        },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <Tracker />
    </QueryClientProvider>
  );
}

function Tracker() {
  const qc = useQueryClient();
  const [user, setUser] = useState("guest");
  const [filter, setFilter] = useState<Filter>("open");
  const [selected, setSelected] = useState<number | null>(null);

  const list = useQuery({
    queryKey: ["issues", filter],
    queryFn: () => fetchIssues(filter),
    retry: false,
  });

  const assignMutation = useMutation({
    mutationFn: ({ id, user }: { id: number; user: string }) => assign(id, user),
    onMutate: ({ id, user }) => {
      const snapshot = qc.getQueriesData<Issue[]>({ queryKey: ["issues"] });
      setAssignee(qc, id, user);
      return { snapshot };
    },
    onError: (_error, _vars, context) => {
      for (const [key, data] of context?.snapshot ?? []) qc.setQueryData(key, data);
    },
    onSuccess: res => setAssignee(qc, res.id, res.assignee),
  });

  const select = (id: number) => {
    setSelected(id);
    assignMutation.reset();
  };

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", padding: 16, display: "flex", gap: 24, alignItems: "flex-start" }}>
      <div style={{ flex: "1 1 320px", minWidth: 0 }}>
        <label>
          Current user{" "}
          <input data-testid="user" value={user} onChange={e => setUser(e.target.value)} />
        </label>
        <div style={{ margin: "12px 0", display: "flex", gap: 8 }}>
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
        <div data-testid="list">
          {list.isPending ? (
            <p>{`loading ${filter} issues`}</p>
          ) : list.isError ? (
            <p>{`list error: ${errorMessage(list.error)}`}</p>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {list.data.map(issue => (
                <li key={issue.id}>
                  <button
                    data-testid="issue"
                    aria-pressed={selected === issue.id}
                    onClick={() => select(issue.id)}
                    style={{ width: "100%", textAlign: "left", padding: "6px 8px", marginBottom: 4 }}
                  >
                    #{issue.id} {issue.title} ({issue.assignee ?? "unassigned"})
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div data-testid="detail" style={{ flex: "2 1 360px", minWidth: 0 }}>
        {selected === null ? (
          <p>select an issue</p>
        ) : (
          <Detail
            key={selected}
            id={selected}
            user={user}
            assignError={assignMutation.error}
            onAssign={() => assignMutation.mutate({ id: selected, user })}
          />
        )}
      </div>
    </div>
  );
}

function Detail({
  id,
  user,
  assignError,
  onAssign,
}: {
  id: number;
  user: string;
  assignError: Error | null;
  onAssign: () => void;
}) {
  const q = useQuery({
    queryKey: ["issue", id],
    queryFn: () => fetchIssue(id),
    retry: false,
  });

  let content;
  if (q.isPending || (q.isFetching && q.isError)) {
    content = <p>{`loading #${id}`}</p>;
  } else if (q.isError) {
    content = (
      <>
        <p>{`detail error: ${errorMessage(q.error)}`}</p>
        <button data-testid="retry" onClick={() => void q.refetch()}>
          retry
        </button>
      </>
    );
  } else if (q.data === null) {
    content = (
      <>
        <p>{`detail error: issue #${id} not found`}</p>
        <button data-testid="retry" onClick={() => void q.refetch()}>
          retry
        </button>
      </>
    );
  } else {
    content = (
      <>
        <h2 style={{ margin: "0 0 8px" }}>
          #{q.data.id} {q.data.title}
        </h2>
        <p>{q.data.body}</p>
      </>
    );
  }

  return (
    <div>
      {content}
      <div style={{ marginTop: 12 }}>
        <button data-testid="assign" onClick={onAssign}>
          {`assign to ${user}`}
        </button>
        {assignError && <p>{`assign error: ${errorMessage(assignError)}`}</p>}
      </div>
    </div>
  );
}

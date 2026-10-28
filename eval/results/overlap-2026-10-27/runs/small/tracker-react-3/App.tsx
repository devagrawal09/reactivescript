import { useState } from "react";
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { assign, fetchIssue, fetchIssues } from "./api.js";
import type { Issue } from "./api.js";

type Filter = "open" | "closed";
type AssignError = { id: number; message: string };

const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export default function App() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: false, refetchOnWindowFocus: false },
          mutations: { retry: false },
        },
      }),
  );
  return (
    <QueryClientProvider client={queryClient}>
      <Tracker />
    </QueryClientProvider>
  );
}

function Tracker() {
  const queryClient = useQueryClient();
  const [user, setUser] = useState("guest");
  const [filter, setFilter] = useState<Filter>("open");
  const [selected, setSelected] = useState<number | null>(null);
  const [assignError, setAssignError] = useState<AssignError | null>(null);

  const select = (id: number) => {
    setSelected(id);
    setAssignError(null);
  };

  const assignMutation = useMutation({
    mutationFn: ({ id, user }: { id: number; user: string }) => assign(id, user),
    onMutate: async ({ id, user }) => {
      await queryClient.cancelQueries({ queryKey: ["issues"] });
      const snapshot = queryClient.getQueriesData<Issue[]>({ queryKey: ["issues"] });
      queryClient.setQueriesData<Issue[]>({ queryKey: ["issues"] }, list =>
        list?.map(i => (i.id === id ? { ...i, assignee: user } : i)),
      );
      return { snapshot };
    },
    onSuccess: ({ id, assignee }) => {
      queryClient.setQueriesData<Issue[]>({ queryKey: ["issues"] }, list =>
        list?.map(i => (i.id === id ? { ...i, assignee } : i)),
      );
    },
    onError: (err, { id }, context) => {
      for (const [key, data] of context?.snapshot ?? []) {
        const before = data?.find(i => i.id === id);
        if (!before) continue;
        queryClient.setQueryData<Issue[]>(key, list =>
          list?.map(i => (i.id === id ? { ...i, assignee: before.assignee } : i)),
        );
      }
      setAssignError({ id, message: errorMessage(err) });
    },
  });

  const onAssign = () => {
    if (selected === null) return;
    setAssignError(null);
    assignMutation.mutate({ id: selected, user });
  };

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: 16, maxWidth: 960, margin: "0 auto" }}>
      <h1 style={{ fontSize: 22 }}>Issue tracker</h1>
      <label style={{ display: "block", marginBottom: 12 }}>
        Current user{" "}
        <input data-testid="user" value={user} onChange={e => setUser(e.target.value)} />
      </label>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
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
      <div style={{ display: "flex", gap: 24, alignItems: "flex-start", flexWrap: "wrap" }}>
        <IssueList filter={filter} selected={selected} onSelect={select} />
        <section data-testid="detail" style={{ flex: "1 1 320px", minWidth: 0 }}>
          {selected === null ? (
            <p>select an issue</p>
          ) : (
            <IssueDetail
              key={selected}
              id={selected}
              user={user}
              assignError={assignError?.id === selected ? assignError.message : null}
              onAssign={onAssign}
            />
          )}
        </section>
      </div>
    </main>
  );
}

function IssueList({
  filter,
  selected,
  onSelect,
}: {
  filter: Filter;
  selected: number | null;
  onSelect: (id: number) => void;
}) {
  const query = useQuery({
    queryKey: ["issues", filter],
    queryFn: () => fetchIssues(filter),
  });

  let content;
  if (query.isFetching) {
    content = <p>{`loading ${filter} issues`}</p>;
  } else if (query.isError) {
    content = <p>{`list error: ${errorMessage(query.error)}`}</p>;
  } else {
    content = (
      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {(query.data ?? []).map(issue => (
          <li key={issue.id} style={{ marginBottom: 4 }}>
            <button
              data-testid="issue"
              aria-current={selected === issue.id ? "true" : undefined}
              onClick={() => onSelect(issue.id)}
              style={{ fontWeight: selected === issue.id ? 700 : 400 }}
            >
              {`#${issue.id} ${issue.title} (${issue.assignee ?? "unassigned"})`}
            </button>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <section data-testid="list" style={{ flex: "1 1 320px", minWidth: 0 }}>
      {content}
    </section>
  );
}

function IssueDetail({
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
  const query = useQuery({
    queryKey: ["issue", id],
    queryFn: () => fetchIssue(id),
  });

  let body;
  if (query.isFetching) {
    body = <p>{`loading #${id}`}</p>;
  } else if (query.isError) {
    body = (
      <>
        <p>{`detail error: ${errorMessage(query.error)}`}</p>
        <button data-testid="retry" onClick={() => void query.refetch()}>
          retry
        </button>
      </>
    );
  } else if (query.data === null || query.data === undefined) {
    body = (
      <>
        <p>{`detail error: issue #${id} not found`}</p>
        <button data-testid="retry" onClick={() => void query.refetch()}>
          retry
        </button>
      </>
    );
  } else {
    body = (
      <>
        <h2 style={{ fontSize: 18, margin: "0 0 8px" }}>{`#${query.data.id} ${query.data.title}`}</h2>
        <p style={{ whiteSpace: "pre-wrap" }}>{query.data.body}</p>
      </>
    );
  }

  return (
    <div>
      {body}
      <div style={{ marginTop: 12 }}>
        <button data-testid="assign" onClick={onAssign}>
          {`assign to ${user}`}
        </button>
      </div>
      {assignError !== null && <p>{`detail error: ${assignError}`}</p>}
    </div>
  );
}

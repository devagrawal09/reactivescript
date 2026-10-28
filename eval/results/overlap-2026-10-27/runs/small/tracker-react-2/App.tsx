import { useState } from "react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { QueryKey } from "@tanstack/react-query";
import { assign, fetchIssue, fetchIssues } from "./api.js";
import type { Issue } from "./api.js";

type Filter = "open" | "closed";

const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

function Tracker() {
  const queryClient = useQueryClient();
  const [user, setUser] = useState("guest");
  const [filter, setFilter] = useState<Filter>("open");
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const issues = useQuery({
    queryKey: ["issues", filter],
    queryFn: () => fetchIssues(filter),
  });

  const selected = selectedId;
  const detail = useQuery({
    queryKey: ["issue", selected],
    queryFn: () => (selected === null ? Promise.resolve(null) : fetchIssue(selected)),
    enabled: selected !== null,
  });

  const assignIssue = useMutation({
    mutationFn: (vars: { id: number; who: string }) => assign(vars.id, vars.who),
    onMutate: async ({ id, who }) => {
      // Remember each cached list's current assignee for this row, then show the new one at once.
      const prior = queryClient.getQueriesData<Issue[]>({ queryKey: ["issues"] });
      const restore: [QueryKey, string | null][] = [];
      for (const [key, rows] of prior) {
        const row = rows?.find(r => r.id === id);
        if (row) restore.push([key, row.assignee]);
      }
      queryClient.setQueriesData<Issue[]>(
        { queryKey: ["issues"] },
        rows => rows?.map(r => (r.id === id ? { ...r, assignee: who } : r)),
      );
      return { id, restore };
    },
    onError: (_error, _vars, ctx) => {
      if (!ctx) return;
      for (const [key, assignee] of ctx.restore) {
        queryClient.setQueryData<Issue[]>(key, rows =>
          rows?.map(r => (r.id === ctx.id ? { ...r, assignee } : r)),
        );
      }
    },
    onSuccess: result => {
      queryClient.setQueriesData<Issue[]>(
        { queryKey: ["issues"] },
        rows => rows?.map(r => (r.id === result.id ? { ...r, assignee: result.assignee } : r)),
      );
    },
  });

  function select(id: number) {
    setSelectedId(id);
    assignIssue.reset();
  }

  let detailContent: ReactNode;
  if (selectedId === null) {
    detailContent = <p>select an issue</p>;
  } else if (detail.isPending) {
    detailContent = <p>loading #{selectedId}</p>;
  } else if (detail.isError) {
    detailContent = <p>detail error: {errorMessage(detail.error)}</p>;
  } else if (detail.data === null || detail.data === undefined) {
    detailContent = <p>detail error: issue #{selectedId} not found</p>;
  } else {
    detailContent = (
      <>
        <h2>#{detail.data.id} {detail.data.title}</h2>
        <p>{detail.data.body}</p>
      </>
    );
  }
  const showRetry = selectedId !== null && (detail.isError || detail.data === null);

  let listContent: ReactNode;
  if (issues.isPending) {
    listContent = <p>loading {filter} issues</p>;
  } else if (issues.isError) {
    listContent = <p>list error: {errorMessage(issues.error)}</p>;
  } else {
    listContent = (
      <ul>
        {issues.data.map(issue => (
          <li key={issue.id}>
            <button
              type="button"
              data-testid="issue"
              aria-current={issue.id === selectedId ? "true" : undefined}
              onClick={() => select(issue.id)}
            >
              {`#${issue.id} ${issue.title} (${issue.assignee ?? "unassigned"})`}
            </button>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: 16 }}>
      <div style={{ marginBottom: 12 }}>
        <label>
          Current user{" "}
          <input data-testid="user" value={user} onChange={e => setUser(e.target.value)} />
        </label>
      </div>
      <div style={{ display: "flex", gap: 24, alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ marginBottom: 8 }}>
            <button
              type="button"
              data-testid="filter-open"
              aria-pressed={filter === "open"}
              onClick={() => setFilter("open")}
            >
              open
            </button>{" "}
            <button
              type="button"
              data-testid="filter-closed"
              aria-pressed={filter === "closed"}
              onClick={() => setFilter("closed")}
            >
              closed
            </button>
          </div>
          <section data-testid="list">{listContent}</section>
        </div>
        <section data-testid="detail" style={{ flex: 1, minWidth: 0 }}>
          {detailContent}
          {showRetry && (
            <button type="button" data-testid="retry" onClick={() => void detail.refetch()}>
              retry
            </button>
          )}
          {selectedId !== null && (
            <div>
              <button
                type="button"
                data-testid="assign"
                onClick={() => assignIssue.mutate({ id: selectedId, who: user })}
              >
                assign to {user}
              </button>
              {assignIssue.isError && <p>detail error: {errorMessage(assignIssue.error)}</p>}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

export default function App() {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: false, gcTime: 0, refetchOnWindowFocus: false },
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

import { useState } from "react";
import { QueryClient, QueryClientProvider, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { assign, fetchIssue, fetchIssues } from "./api.js";
import type { Issue } from "./api.js";

type Filter = "open" | "closed";
type AssignError = { id: number; message: string };
type AssignVars = { id: number; user: string; before: string | null };

export default function App() {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } }),
  );
  return (
    <QueryClientProvider client={queryClient}>
      <Tracker />
    </QueryClientProvider>
  );
}

function setAssignee(queryClient: QueryClient, id: number, assignee: string | null) {
  queryClient.setQueriesData<Issue[]>({ queryKey: ["issues"] }, list =>
    list?.map(issue => (issue.id === id ? { ...issue, assignee } : issue)),
  );
}

function Tracker() {
  const queryClient = useQueryClient();
  const [user, setUser] = useState("guest");
  const [filter, setFilter] = useState<Filter>("open");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [assignError, setAssignError] = useState<AssignError | null>(null);

  const assignMutation = useMutation({
    mutationFn: ({ id, user }: AssignVars) => assign(id, user),
    onSuccess: (result, vars) => setAssignee(queryClient, vars.id, result.assignee),
    onError: (error, vars) => {
      setAssignee(queryClient, vars.id, vars.before);
      setAssignError({ id: vars.id, message: error.message });
    },
  });

  const select = (id: number) => {
    if (id !== selectedId) setAssignError(null);
    setSelectedId(id);
  };

  const assignSelected = (id: number) => {
    setAssignError(null);
    // The assignee the row had before this assignment, taken from any cached list that shows it.
    let before: string | null = null;
    for (const [, list] of queryClient.getQueriesData<Issue[]>({ queryKey: ["issues"] })) {
      const row = list?.find(issue => issue.id === id);
      if (row) { before = row.assignee; break; }
    }
    setAssignee(queryClient, id, user);
    assignMutation.mutate({ id, user, before });
  };

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", padding: 16, maxWidth: 1000, margin: "0 auto" }}>
      <h1 style={{ fontSize: 22, margin: "0 0 12px" }}>Issue tracker</h1>
      <label style={{ display: "block", marginBottom: 16 }}>
        Current user{" "}
        <input data-testid="user" value={user} onChange={e => setUser(e.target.value)} />
      </label>
      <div style={{ display: "flex", gap: 24, flexWrap: "wrap", alignItems: "flex-start" }}>
        <section style={{ flex: "1 1 320px", minWidth: 0 }}>
          <div style={{ marginBottom: 8 }}>
            <button
              data-testid="filter-open"
              aria-pressed={filter === "open"}
              onClick={() => setFilter("open")}
            >
              open
            </button>{" "}
            <button
              data-testid="filter-closed"
              aria-pressed={filter === "closed"}
              onClick={() => setFilter("closed")}
            >
              closed
            </button>
          </div>
          <IssueList filter={filter} selectedId={selectedId} onSelect={select} />
        </section>
        <section style={{ flex: "1 1 320px", minWidth: 0 }}>
          <Detail
            selectedId={selectedId}
            user={user}
            assignError={assignError}
            onAssign={assignSelected}
          />
        </section>
      </div>
    </div>
  );
}

function IssueList({
  filter,
  selectedId,
  onSelect,
}: {
  filter: Filter;
  selectedId: number | null;
  onSelect: (id: number) => void;
}) {
  const query = useQuery({ queryKey: ["issues", filter], queryFn: () => fetchIssues(filter) });

  let content;
  if (query.isFetching) {
    content = <p>{`loading ${filter} issues`}</p>;
  } else if (query.isError) {
    content = <p>{`list error: ${query.error.message}`}</p>;
  } else {
    content = (
      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {(query.data ?? []).map(issue => {
          const selected = issue.id === selectedId;
          return (
            <li
              key={issue.id}
              data-testid="issue"
              role="button"
              tabIndex={0}
              aria-pressed={selected}
              onClick={() => onSelect(issue.id)}
              onKeyDown={e => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(issue.id);
                }
              }}
              style={{
                padding: "8px 10px",
                borderBottom: "1px solid #ddd",
                cursor: "pointer",
                background: selected ? "#e8f0fe" : "transparent",
              }}
            >
              {`#${issue.id} ${issue.title} (${issue.assignee ?? "unassigned"})`}
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <div data-testid="list">
      {content}
    </div>
  );
}

function Detail({
  selectedId,
  user,
  assignError,
  onAssign,
}: {
  selectedId: number | null;
  user: string;
  assignError: AssignError | null;
  onAssign: (id: number) => void;
}) {
  if (selectedId === null) {
    return <div data-testid="detail"><p>select an issue</p></div>;
  }
  return (
    <div data-testid="detail">
      <IssueContent key={selectedId} id={selectedId} />
      <p>
        <button data-testid="assign" onClick={() => onAssign(selectedId)}>
          {`assign to ${user}`}
        </button>
      </p>
      {assignError && assignError.id === selectedId && (
        <p>{`assign error: ${assignError.message}`}</p>
      )}
    </div>
  );
}

function IssueContent({ id }: { id: number }) {
  const query = useQuery({ queryKey: ["issue", id], queryFn: () => fetchIssue(id) });

  let body;
  if (query.isFetching) {
    body = <p>{`loading #${id}`}</p>;
  } else if (query.isError) {
    body = <p>{`detail error: ${query.error.message}`}</p>;
  } else if (query.data === null) {
    body = <p>{`detail error: issue #${id} not found`}</p>;
  } else if (query.data) {
    body = (
      <>
        <h2 style={{ fontSize: 18, margin: "0 0 8px" }}>{`#${query.data.id} ${query.data.title}`}</h2>
        <p>{query.data.body}</p>
      </>
    );
  }

  return (
    <div>
      {body}
      <p>
        <button data-testid="retry" onClick={() => void query.refetch()}>
          retry
        </button>
      </p>
    </div>
  );
}

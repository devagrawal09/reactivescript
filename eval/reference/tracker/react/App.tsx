import { useState } from "react";
import { QueryClient, QueryClientProvider, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { assign, fetchIssue, fetchIssues, type Issue } from "./api";

type Filter = "open" | "closed";
const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });

export default function App() {
  return (
    <QueryClientProvider client={client}>
      <Tracker />
    </QueryClientProvider>
  );
}

function Tracker() {
  const [user, setUser] = useState("guest");
  const [filter, setFilter] = useState<Filter>("open");
  const [selected, setSelected] = useState<number | null>(null);
  const [assignError, setAssignError] = useState("");
  const select = (id: number) => { setSelected(id); setAssignError(""); };
  return (
    <main>
      <input data-testid="user" value={user} onChange={e => setUser(e.target.value)} />{" "}
      <IssueList filter={filter} onFilter={setFilter} onSelect={select} />{" / "}
      <DetailPanel id={selected} user={user} filter={filter} assignError={assignError} setAssignError={setAssignError} />
    </main>
  );
}

function IssueList({ filter, onFilter, onSelect }: { filter: Filter; onFilter: (f: Filter) => void; onSelect: (id: number) => void }) {
  const { data, error, isPending } = useQuery({ queryKey: ["issues", filter], queryFn: () => fetchIssues(filter) });
  return (
    <section data-testid="list">
      <button data-testid="filter-open" onClick={() => onFilter("open")}>open</button>{" "}
      <button data-testid="filter-closed" onClick={() => onFilter("closed")}>closed</button>{" "}
      {isPending ? <p>loading {filter} issues</p>
        : error ? <p>list error: {error.message}</p>
        : <ul>{data.map(i => <li key={i.id} data-testid="issue" onClick={() => onSelect(i.id)}>#{i.id} {i.title} ({i.assignee ?? "unassigned"})</li>)}</ul>}
    </section>
  );
}

function DetailPanel({ id, user, filter, assignError, setAssignError }: { id: number | null; user: string; filter: Filter; assignError: string; setAssignError: (e: string) => void }) {
  const queryClient = useQueryClient();
  const detail = useQuery({ queryKey: ["issue", id], queryFn: () => fetchIssue(id!), enabled: id !== null });
  const assignMutation = useMutation({
    mutationFn: ({ id, user }: { id: number; user: string }) => assign(id, user),
    onMutate: async ({ id, user }) => {
      setAssignError("");
      const key = ["issues", filter];
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<Issue[]>(key);
      queryClient.setQueryData<Issue[]>(key, list => list?.map(i => (i.id === id ? { ...i, assignee: user } : i)));
      return { key, previous };
    },
    onError: (e, _vars, ctx) => {
      if (ctx) queryClient.setQueryData(ctx.key, ctx.previous);
      setAssignError(e.message);
    },
  });
  if (id === null) return <section data-testid="detail"><p>select an issue</p></section>;
  return (
    <section data-testid="detail">
      {detail.isPending ? <p>loading #{id}</p>
        : detail.error ? <p>detail error: {detail.error.message}</p>
        : detail.data === null ? <p>detail error: issue #{id} not found</p>
        : <><h3>#{detail.data.id} {detail.data.title}</h3> <p>{detail.data.body}</p></>}
      {" "}<button data-testid="retry" onClick={() => detail.refetch()}>retry</button>{" "}
      <button data-testid="assign" onClick={() => assignMutation.mutate({ id, user })}>assign to {user}</button>{" "}
      {assignError}
    </section>
  );
}

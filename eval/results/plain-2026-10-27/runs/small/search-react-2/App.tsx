import { useState, type ReactNode } from "react";
import {
  QueryClient,
  QueryClientProvider,
  keepPreviousData,
  useQuery,
} from "@tanstack/react-query";
import { fetchItem, search, type Hit } from "./api.js";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false, refetchOnWindowFocus: false },
  },
});

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

type Found = { q: string; hits: Hit[] };

function Results({
  q,
  selectedId,
  onSelect,
}: {
  q: string;
  selectedId: number | null;
  onSelect: (id: number) => void;
}) {
  const enabled = q.length >= 2;
  const result = useQuery({
    queryKey: ["search", q],
    queryFn: async (): Promise<Found> => ({ q, hits: await search(q) }),
    enabled,
    placeholderData: keepPreviousData,
  });

  let body: ReactNode = null;
  if (q.length === 1) {
    body = <p>too short: {q}</p>;
  } else if (enabled) {
    if (result.isError) {
      body = <p>search failed: {errorMessage(result.error)}</p>;
    } else {
      const shown = result.data;
      body = (
        <>
          {result.isFetching && <p>searching…</p>}
          {shown && (
            <>
              <p>
                {shown.hits.length} results for {shown.q}
              </p>
              <ul>
                {shown.hits.map((hit) => (
                  <li key={hit.id} data-testid="hit" onClick={() => onSelect(hit.id)}>
                    <button type="button">
                      {hit.id === selectedId ? "> " : ""}
                      {hit.name}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      );
    }
  }

  return <div data-testid="results">{body}</div>;
}

function ItemView({ id }: { id: number }) {
  const item = useQuery({
    queryKey: ["item", id],
    queryFn: () => fetchItem(id),
  });

  if (item.isPending) return <p>loading…</p>;
  if (item.isError) {
    return (
      <>
        <p>failed: {errorMessage(item.error)}</p>
        <button type="button" data-testid="retry" onClick={() => void item.refetch()}>
          retry
        </button>
      </>
    );
  }
  if (item.data === null) return <p>item {id} not found</p>;
  return (
    <>
      <h2>{item.data.name}</h2>
      <p>{item.data.blurb}</p>
    </>
  );
}

function Detail({ id }: { id: number | null }) {
  return (
    <div data-testid="detail">
      {id === null ? <p>pick a result</p> : <ItemView id={id} />}
    </div>
  );
}

function Page() {
  const [q, setQ] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);

  return (
    <main>
      <input
        data-testid="query"
        type="text"
        aria-label="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <Results q={q} selectedId={selectedId} onSelect={setSelectedId} />
      <Detail id={selectedId} />
    </main>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Page />
    </QueryClientProvider>
  );
}

import { useState } from "react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { search, fetchItem } from "./api.js";
import type { Hit } from "./api.js";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      staleTime: 0,
      gcTime: 0,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    },
  },
});

type Results = { q: string; hits: Hit[] };

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

function ResultsArea({
  q,
  selected,
  onSelect,
}: {
  q: string;
  selected: number | null;
  onSelect: (id: number) => void;
}) {
  const enabled = q.length >= 2;
  const query = useQuery({
    queryKey: ["search", q],
    queryFn: async (): Promise<Results> => ({ q, hits: await search(q) }),
    enabled,
  });
  const [shown, setShown] = useState<Results | null>(null);

  const fresh = enabled && !query.isFetching && query.isSuccess ? query.data : null;
  const failed = enabled && !query.isFetching && query.isError;
  if (fresh && fresh !== shown) setShown(fresh);
  if ((!enabled || failed) && shown !== null) setShown(null);

  let body;
  if (q.length === 0) body = null;
  else if (!enabled) body = <p>too short: {q}</p>;
  else if (failed) body = <p>search failed: {message(query.error)}</p>;
  else {
    const list = fresh ?? shown;
    body = (
      <>
        {query.isFetching && <p>searching…</p>}
        {list && (
          <>
            <p>
              {list.hits.length} results for {list.q}
            </p>
            <ul>
              {list.hits.map((h) => (
                <li key={h.id} data-testid="hit" onClick={() => onSelect(h.id)} style={{ cursor: "pointer" }}>
                  {h.id === selected ? `> ${h.name}` : h.name}
                </li>
              ))}
            </ul>
          </>
        )}
      </>
    );
  }
  return <div data-testid="results">{body}</div>;
}

function Detail({ id }: { id: number }) {
  const query = useQuery({
    queryKey: ["item", id],
    queryFn: () => fetchItem(id),
  });
  let body;
  if (query.isFetching || query.isPending) body = <p>loading…</p>;
  else if (query.isError)
    body = (
      <>
        <p>failed: {message(query.error)}</p>
        <button data-testid="retry" onClick={() => void query.refetch()}>
          retry
        </button>
      </>
    );
  else if (query.data === null || query.data === undefined) body = <p>item {id} not found</p>;
  else
    body = (
      <>
        <h2>{query.data.name}</h2>
        <p>{query.data.blurb}</p>
      </>
    );
  return <div data-testid="detail">{body}</div>;
}

function SearchPage() {
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<number | null>(null);
  return (
    <main>
      <input data-testid="query" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" />
      <ResultsArea q={q} selected={selected} onSelect={setSelected} />
      {selected === null ? (
        <div data-testid="detail">pick a result</div>
      ) : (
        <Detail key={selected} id={selected} />
      )}
    </main>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <SearchPage />
    </QueryClientProvider>
  );
}

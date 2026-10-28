import { useState } from "react";
import { QueryClient, QueryClientProvider, keepPreviousData, useQuery } from "@tanstack/react-query";
import { search, fetchItem, type Hit, type Item } from "./api.js";

const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

type Found = { q: string; hits: Hit[] };

function Results({ q, selected, onPick }: { q: string; selected: number | null; onPick: (id: number) => void }) {
  const found = useQuery<Found, Error>({
    queryKey: ["search", q],
    queryFn: async () => ({ q, hits: await search(q) }),
    enabled: q.length >= 2,
    retry: false,
    placeholderData: keepPreviousData,
  });

  if (q.length === 0) return null;
  if (q.length === 1) return <p>{`too short: ${q}`}</p>;

  const loading = found.isPending || found.isFetching;
  if (!loading && found.isError) return <p>{`search failed: ${errorMessage(found.error)}`}</p>;

  return (
    <>
      {loading && <p>searching…</p>}
      {found.data && (
        <>
          <p>{`${found.data.hits.length} results for ${found.data.q}`}</p>
          <ul>
            {found.data.hits.map(hit => (
              <li key={hit.id} data-testid="hit" onClick={() => onPick(hit.id)}>
                {hit.id === selected ? "> " : ""}
                {hit.name}
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

function Detail({ id }: { id: number }) {
  const item = useQuery<Item | null, Error>({
    queryKey: ["item", id],
    queryFn: () => fetchItem(id),
    retry: false,
    staleTime: Infinity,
  });

  if (item.isFetching) return <p>loading…</p>;
  if (item.isError) {
    return (
      <>
        <p>{`failed: ${errorMessage(item.error)}`}</p>
        <button type="button" data-testid="retry" onClick={() => void item.refetch()}>
          retry
        </button>
      </>
    );
  }
  if (item.data === null || item.data === undefined) return <p>{`item ${id} not found`}</p>;
  return (
    <>
      <h2>{item.data.name}</h2>
      <p>{item.data.blurb}</p>
    </>
  );
}

function Page() {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<number | null>(null);

  return (
    <main>
      <input
        type="text"
        data-testid="query"
        aria-label="query"
        value={query}
        onChange={e => setQuery(e.target.value)}
      />
      <div data-testid="results">
        <Results q={query} selected={selected} onPick={setSelected} />
      </div>
      <section data-testid="detail">
        {selected === null ? <p>pick a result</p> : <Detail key={selected} id={selected} />}
      </section>
    </main>
  );
}

export default function App() {
  const [client] = useState(() => new QueryClient());
  return (
    <QueryClientProvider client={client}>
      <Page />
    </QueryClientProvider>
  );
}

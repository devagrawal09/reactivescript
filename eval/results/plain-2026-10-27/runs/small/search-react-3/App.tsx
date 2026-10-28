import { useState } from "react";
import { QueryClient, QueryClientProvider, keepPreviousData, useQuery } from "@tanstack/react-query";
import { search, fetchItem } from "./api.js";

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export default function App() {
  // Each search and item request is looked up fresh (gcTime 0) and never retried,
  // so the page shows exactly what the backend answers, when it answers.
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: false, gcTime: 0, refetchOnWindowFocus: false },
        },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <Catalogue />
    </QueryClientProvider>
  );
}

function Catalogue() {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const hits = useQuery({
    queryKey: ["search", query],
    queryFn: () => search(query),
    enabled: query.length >= 2,
    // Keep the previous hits on screen while the new search is in the air.
    placeholderData: keepPreviousData,
  });

  const q = query;
  const searching = q.length >= 2 && !hits.isError && (hits.isPending || hits.isPlaceholderData);
  const showHits = q.length >= 2 && !hits.isError && hits.data !== undefined;

  return (
    <main>
      <input
        data-testid="query"
        type="text"
        aria-label="query"
        value={query}
        onChange={e => setQuery(e.target.value)}
      />

      <section data-testid="results">
        {q.length === 1 && <p>{`too short: ${q}`}</p>}
        {q.length >= 2 && hits.isError && <p>{`search failed: ${messageOf(hits.error)}`}</p>}
        {searching && <p>searching…</p>}
        {showHits && !hits.isPlaceholderData && (
          <p>{`${hits.data?.length ?? 0} results for ${q}`}</p>
        )}
        {showHits && (
          <ul>
            {hits.data?.map((hit, i) => {
              const selected = hit.id === selectedId;
              return (
                <li
                  key={`${i}-${hit.id}`}
                  data-testid="hit"
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedId(hit.id)}
                  onKeyDown={e => {
                    if (e.key === "Enter" || e.key === " ") setSelectedId(hit.id);
                  }}
                >
                  {selected ? "> " : ""}
                  {hit.name}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section data-testid="detail">
        {selectedId === null ? "pick a result" : <Detail key={selectedId} id={selectedId} />}
      </section>
    </main>
  );
}

function Detail({ id }: { id: number }) {
  const item = useQuery({
    queryKey: ["item", id],
    queryFn: () => fetchItem(id),
  });

  if (item.isFetching) return <p>loading…</p>;
  if (item.isError) {
    return (
      <>
        <p>{`failed: ${messageOf(item.error)}`}</p>
        <button type="button" data-testid="retry" onClick={() => void item.refetch()}>
          retry
        </button>
      </>
    );
  }
  if (item.data === null) return <p>{`item ${id} not found`}</p>;
  if (item.data === undefined) return <p>loading…</p>;
  return (
    <>
      <h2>{item.data.name}</h2>
      <p>{item.data.blurb}</p>
    </>
  );
}

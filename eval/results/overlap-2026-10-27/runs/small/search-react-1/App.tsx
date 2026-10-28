import { useState } from "react";
import { QueryClient, QueryClientProvider, keepPreviousData, useQuery } from "@tanstack/react-query";
import { search, fetchItem } from "./api.js";

const queries = new QueryClient();

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export default function App() {
  return (
    <QueryClientProvider client={queries}>
      <Catalogue />
    </QueryClientProvider>
  );
}

function Catalogue() {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<number | null>(null);

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "16px", maxWidth: "960px", margin: "0 auto" }}>
      <input
        data-testid="query"
        type="text"
        aria-label="Search"
        placeholder="Search the catalogue"
        value={query}
        onChange={e => setQuery(e.target.value)}
        style={{ width: "100%", boxSizing: "border-box", padding: "8px", fontSize: "16px" }}
      />
      <div style={{ display: "flex", gap: "24px", marginTop: "16px", flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 280px", minWidth: 0 }}>
          <SearchResults q={query} selected={selected} onSelect={setSelected} />
        </div>
        <section data-testid="detail" style={{ flex: "1 1 280px", minWidth: 0 }}>
          {selected === null ? "pick a result" : <Detail id={selected} />}
        </section>
      </div>
    </main>
  );
}

type SearchResult = { q: string; hits: { id: number; name: string }[] };

function SearchResults({
  q,
  selected,
  onSelect,
}: {
  q: string;
  selected: number | null;
  onSelect: (id: number) => void;
}) {
  const enabled = q.length >= 2;
  const result = useQuery({
    queryKey: ["search", q],
    queryFn: async (): Promise<SearchResult> => ({ q, hits: await search(q) }),
    enabled,
    placeholderData: keepPreviousData,
    retry: false,
    staleTime: 0,
    gcTime: 0,
  });

  if (q.length === 0) return <div data-testid="results" />;
  if (q.length === 1) return <div data-testid="results">{`too short: ${q}`}</div>;

  const searching = result.isFetching;
  const data = result.data;

  return (
    <div data-testid="results">
      {result.isError && !searching ? (
        <p>{`search failed: ${errorMessage(result.error)}`}</p>
      ) : data ? (
        <>
          <p>{`${data.hits.length} results for ${data.q}`}</p>
          <ul style={{ paddingLeft: "20px" }}>
            {data.hits.map(hit => (
              <li
                key={hit.id}
                data-testid="hit"
                onClick={() => onSelect(hit.id)}
                style={{ cursor: "pointer" }}
              >
                {hit.id === selected ? `> ${hit.name}` : hit.name}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {searching ? <p>searching…</p> : null}
    </div>
  );
}

function Detail({ id }: { id: number }) {
  const item = useQuery({
    queryKey: ["item", id],
    queryFn: () => fetchItem(id),
    retry: false,
    staleTime: 0,
    gcTime: 0,
  });

  if (item.isFetching) return <p>loading…</p>;
  if (item.isError) {
    return (
      <div>
        <p>{`failed: ${errorMessage(item.error)}`}</p>
        <button type="button" data-testid="retry" onClick={() => void item.refetch()}>
          retry
        </button>
      </div>
    );
  }
  if (item.data === null) return <p>{`item ${id} not found`}</p>;
  if (!item.data) return null;
  return (
    <div>
      <h2 style={{ marginTop: 0 }}>{item.data.name}</h2>
      <p>{item.data.blurb}</p>
    </div>
  );
}

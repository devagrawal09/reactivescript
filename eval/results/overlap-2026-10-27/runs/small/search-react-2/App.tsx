import { useState } from "react";
import { QueryClient, QueryClientProvider, keepPreviousData, useQuery } from "@tanstack/react-query";
import { fetchItem, search } from "./api.js";

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

type ResultsProps = {
  q: string;
  selected: number | null;
  onSelect: (id: number) => void;
};

function Results({ q, selected, onSelect }: ResultsProps) {
  const enabled = q.length >= 2;
  const s = useQuery({
    queryKey: ["search", q],
    queryFn: () => search(q),
    enabled,
    // keep the previous hits on screen until the new ones arrive
    placeholderData: keepPreviousData,
  });

  if (q === "") return <div data-testid="results" />;
  if (q.length < 2) {
    return (
      <div data-testid="results">
        <p>too short: {q}</p>
      </div>
    );
  }
  if (s.isError) {
    return (
      <div data-testid="results">
        <p>search failed: {errorMessage(s.error)}</p>
      </div>
    );
  }

  const hits = s.data ?? [];
  return (
    <div data-testid="results">
      {s.isFetching ? <p>searching…</p> : <p>{hits.length} results for {q}</p>}
      <ul>
        {hits.map((h, i) => {
          const sel = h.id === selected;
          return (
            <li
              key={`${h.id}:${i}`}
              data-testid="hit"
              tabIndex={0}
              aria-selected={sel}
              onClick={() => onSelect(h.id)}
              onKeyDown={e => {
                if (e.key === "Enter" || e.key === " ") onSelect(h.id);
              }}
            >
              {sel ? "> " : ""}
              {h.name}
            </li>
          );
        })}
      </ul>
    </div>
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
        <p>failed: {errorMessage(item.error)}</p>
        <button type="button" data-testid="retry" onClick={() => void item.refetch()}>
          retry
        </button>
      </>
    );
  }
  if (item.data === null) return <p>item {id} not found</p>;
  if (!item.data) return <p>loading…</p>;
  return (
    <>
      <h2>{item.data.name}</h2>
      <p>{item.data.blurb}</p>
    </>
  );
}

function Page() {
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<number | null>(null);

  return (
    <main>
      <input
        data-testid="query"
        aria-label="query"
        value={q}
        onChange={e => setQ(e.target.value)}
      />
      <Results q={q} selected={selected} onSelect={setSelected} />
      <section data-testid="detail">
        {selected === null ? <p>pick a result</p> : <Detail id={selected} />}
      </section>
    </main>
  );
}

export default function App() {
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } }),
  );
  return (
    <QueryClientProvider client={client}>
      <Page />
    </QueryClientProvider>
  );
}

// A plausible first draft: effects that fetch, no cancellation. The hidden tests must catch it.
import { useEffect, useState } from "react";
import { fetchItem, search, type Hit, type Item } from "./api";

export default function App() {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [item, setItem] = useState<Item | null | undefined>(undefined);
  const [itemError, setItemError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (query.length < 2) return;
    setSearching(true); setSearchError(null);
    search(query).then(h => { setHits(h); setSearching(false); }, e => { setSearchError(e.message); setSearching(false); });
  }, [query]);

  useEffect(() => {
    if (selected === null) return;
    setItem(undefined); setItemError(null);
    fetchItem(selected).then(setItem, e => setItemError(e.message));
  }, [selected, attempt]);

  return (
    <main>
      <input data-testid="query" value={query} onChange={e => setQuery(e.target.value)} />
      {query !== "" && (
        <section data-testid="results">
          {query.length < 2 ? <p>too short: {query}</p> : <>
            {searching && <p>searching…</p>}
            {searchError ? <p>search failed: {searchError}</p> : hits && <>
              <h2>{hits.length} results for {query}</h2>
              <ul>{hits.map(h => <li key={h.id} data-testid="hit" onClick={() => setSelected(h.id)}>{h.id === selected ? "> " : ""}{h.name}</li>)}</ul>
            </>}
          </>}
        </section>
      )}
      {selected === null ? <p data-testid="detail">pick a result</p> : (
        <section data-testid="detail">
          {itemError ? <><p>failed: {itemError}</p><button data-testid="retry" onClick={() => setAttempt(a => a + 1)}>retry</button></>
            : item === undefined ? <p>loading…</p>
            : item === null ? <p>item {selected} not found</p>
            : <article><h3>{item.name}</h3> <p>{item.blurb}</p></article>}
        </section>
      )}
    </main>
  );
}

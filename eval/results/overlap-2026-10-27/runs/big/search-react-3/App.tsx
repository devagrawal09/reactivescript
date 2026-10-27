import { useEffect, useState } from "react";
import type React from "react";
import { search, fetchItem } from "./api.js";
import type { Hit, Item } from "./api.js";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

type SearchResult = { q: string; hits: Hit[] } | { q: string; error: string };

type DetailResult =
  | { id: number; attempt: number; item: Item | null }
  | { id: number; attempt: number; error: string };

export default function App() {
  const [query, setQuery] = useState("");
  // last settled search answer (only for queries that were asked)
  const [settled, setSettled] = useState<SearchResult | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [detail, setDetail] = useState<DetailResult | null>(null);

  const asks = query.length >= 2;

  useEffect(() => {
    if (!asks) return;
    let active = true;
    search(query).then(
      hits => { if (active) setSettled({ q: query, hits }); },
      e => { if (active) setSettled({ q: query, error: message(e) }); },
    );
    return () => { active = false; };
  }, [query, asks]);

  useEffect(() => {
    if (selected === null) return;
    let active = true;
    fetchItem(selected).then(
      item => { if (active) setDetail({ id: selected, attempt, item }); },
      e => { if (active) setDetail({ id: selected, attempt, error: message(e) }); },
    );
    return () => { active = false; };
  }, [selected, attempt]);

  function onType(q: string) {
    setQuery(q);
    // results no longer on screen once the query is too short
    if (q.length < 2) setSettled(null);
  }

  function select(id: number) {
    if (id === selected) return;
    setSelected(id);
    setAttempt(a => a + 1);
  }

  let results: React.ReactNode = null;
  if (query.length === 1) {
    results = <p>too short: {query}</p>;
  } else if (asks) {
    const current = settled !== null && settled.q === query;
    const shown = settled !== null && "hits" in settled ? settled : null;
    results = (
      <>
        {!current && <p>searching…</p>}
        {current && settled !== null && "error" in settled && <p>search failed: {settled.error}</p>}
        {shown && (
          <>
            <p>{shown.hits.length} results for {shown.q}</p>
            <ul>
              {shown.hits.map(hit => (
                <li key={hit.id} data-testid="hit" onClick={() => select(hit.id)} style={{ cursor: "pointer" }}>
                  {hit.id === selected ? `> ${hit.name}` : hit.name}
                </li>
              ))}
            </ul>
          </>
        )}
      </>
    );
  }

  let pane: React.ReactNode;
  if (selected === null) {
    pane = <p>pick a result</p>;
  } else if (detail === null || detail.id !== selected || detail.attempt !== attempt) {
    pane = <p>loading…</p>;
  } else if ("error" in detail) {
    pane = (
      <>
        <p>failed: {detail.error}</p>
        <button data-testid="retry" onClick={() => setAttempt(a => a + 1)}>retry</button>
      </>
    );
  } else if (detail.item === null) {
    pane = <p>item {detail.id} not found</p>;
  } else {
    pane = (
      <>
        <h2>{detail.item.name}</h2>
        <p>{detail.item.blurb}</p>
      </>
    );
  }

  return (
    <main>
      <input data-testid="query" value={query} onChange={e => onType(e.target.value)} placeholder="search" />
      <section data-testid="results">{results}</section>
      <section data-testid="detail">{pane}</section>
    </main>
  );
}

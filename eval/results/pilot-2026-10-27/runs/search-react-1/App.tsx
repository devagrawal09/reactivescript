import { useRef, useState } from "react";
import { fetchItem, search } from "./api.js";
import type { Hit, Item } from "./api.js";

type Results =
  | { kind: "none" }
  | { kind: "short"; q: string }
  | { kind: "searching"; q: string; hits: Hit[] | null }
  | { kind: "done"; q: string; hits: Hit[] }
  | { kind: "failed"; q: string; message: string };

type Detail =
  | { kind: "none" }
  | { kind: "loading"; id: number }
  | { kind: "item"; id: number; item: Item }
  | { kind: "notfound"; id: number }
  | { kind: "failed"; id: number; message: string };

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

export default function App() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Results>({ kind: "none" });
  const [selected, setSelected] = useState<number | null>(null);
  const [detail, setDetail] = useState<Detail>({ kind: "none" });
  const searchToken = useRef(0);
  const detailToken = useRef(0);

  function onQuery(q: string) {
    setQuery(q);
    const token = ++searchToken.current;
    if (q.length === 0) {
      setResults({ kind: "none" });
      return;
    }
    if (q.length === 1) {
      setResults({ kind: "short", q });
      return;
    }
    setResults(prev => ({
      kind: "searching",
      q,
      hits: prev.kind === "done" || prev.kind === "searching" ? prev.hits : null,
    }));
    search(q).then(
      hits => {
        if (searchToken.current === token) setResults({ kind: "done", q, hits });
      },
      (e: unknown) => {
        if (searchToken.current === token) setResults({ kind: "failed", q, message: messageOf(e) });
      },
    );
  }

  function load(id: number) {
    const token = ++detailToken.current;
    fetchItem(id).then(
      item => {
        if (detailToken.current !== token) return;
        setDetail(item ? { kind: "item", id, item } : { kind: "notfound", id });
      },
      (e: unknown) => {
        if (detailToken.current === token) setDetail({ kind: "failed", id, message: messageOf(e) });
      },
    );
  }

  function select(id: number) {
    if (id === selected) return;
    setSelected(id);
    setDetail({ kind: "loading", id });
    load(id);
  }

  const hits = results.kind === "done" || results.kind === "searching" ? results.hits : null;

  return (
    <main>
      <input
        data-testid="query"
        value={query}
        onChange={e => onQuery(e.target.value)}
        placeholder="search"
        aria-label="search"
      />
      <section data-testid="results">
        {results.kind === "short" && <p>too short: {results.q}</p>}
        {results.kind === "searching" && <p>searching…</p>}
        {results.kind === "done" && (
          <p>
            {results.hits.length} results for {results.q}
          </p>
        )}
        {results.kind === "failed" && <p>search failed: {results.message}</p>}
        {hits && (
          <ul>
            {hits.map(hit => (
              <li key={hit.id} data-testid="hit" onClick={() => select(hit.id)} style={{ cursor: "pointer" }}>
                {hit.id === selected ? `> ${hit.name}` : hit.name}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section data-testid="detail">
        {detail.kind === "none" && <p>pick a result</p>}
        {detail.kind === "loading" && <p>loading…</p>}
        {detail.kind === "item" && (
          <>
            <h2>{detail.item.name}</h2>
            <p>{detail.item.blurb}</p>
          </>
        )}
        {detail.kind === "notfound" && <p>item {detail.id} not found</p>}
        {detail.kind === "failed" && (
          <>
            <p>failed: {detail.message}</p>
            <button data-testid="retry" onClick={() => load(detail.id)}>
              retry
            </button>
          </>
        )}
      </section>
    </main>
  );
}

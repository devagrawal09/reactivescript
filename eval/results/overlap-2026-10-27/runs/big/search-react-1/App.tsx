import { useRef, useState } from "react";
import { fetchItem, search } from "./api.js";
import type { Hit, Item } from "./api.js";

type Results =
  | { kind: "none" }
  | { kind: "short"; q: string }
  | { kind: "hits"; q: string; hits: Hit[] }
  | { kind: "error"; message: string };

type Detail =
  | { kind: "none" }
  | { kind: "loading"; id: number }
  | { kind: "item"; item: Item }
  | { kind: "missing"; id: number }
  | { kind: "error"; id: number; message: string };

const errMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

export default function App() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Results>({ kind: "none" });
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [detail, setDetail] = useState<Detail>({ kind: "none" });
  const searchSeq = useRef(0);
  const detailSeq = useRef(0);

  function onQuery(q: string) {
    setQuery(q);
    const seq = ++searchSeq.current;
    if (q.length === 0) {
      setSearching(false);
      setResults({ kind: "none" });
      return;
    }
    if (q.length === 1) {
      setSearching(false);
      setResults({ kind: "short", q });
      return;
    }
    setSearching(true);
    search(q).then(
      hits => {
        if (seq !== searchSeq.current) return;
        setSearching(false);
        setResults({ kind: "hits", q, hits });
      },
      (e: unknown) => {
        if (seq !== searchSeq.current) return;
        setSearching(false);
        setResults({ kind: "error", message: errMessage(e) });
      },
    );
  }

  function load(id: number) {
    const seq = ++detailSeq.current;
    setDetail({ kind: "loading", id });
    fetchItem(id).then(
      item => {
        if (seq !== detailSeq.current) return;
        setDetail(item ? { kind: "item", item } : { kind: "missing", id });
      },
      (e: unknown) => {
        if (seq !== detailSeq.current) return;
        setDetail({ kind: "error", id, message: errMessage(e) });
      },
    );
  }

  function select(id: number) {
    if (id === selected) return;
    setSelected(id);
    load(id);
  }

  return (
    <main>
      <input
        data-testid="query"
        value={query}
        onChange={e => onQuery(e.target.value)}
        placeholder="search"
      />
      <section data-testid="results">
        {searching && <p>searching…</p>}
        {results.kind === "short" && <p>too short: {results.q}</p>}
        {results.kind === "error" && <p>search failed: {results.message}</p>}
        {results.kind === "hits" && (
          <>
            <p>
              {results.hits.length} results for {results.q}
            </p>
            <ul>
              {results.hits.map(hit => (
                <li key={hit.id} data-testid="hit" onClick={() => select(hit.id)} style={{ cursor: "pointer" }}>
                  {hit.id === selected ? `> ${hit.name}` : hit.name}
                </li>
              ))}
            </ul>
          </>
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
        {detail.kind === "missing" && <p>item {detail.id} not found</p>}
        {detail.kind === "error" && (
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

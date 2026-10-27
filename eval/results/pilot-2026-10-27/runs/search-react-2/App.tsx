import { useRef, useState } from "react";
import { search, fetchItem } from "./api.js";
import type { Hit, Item } from "./api.js";

type Results =
  | { kind: "none" }
  | { kind: "ok"; q: string; hits: Hit[] }
  | { kind: "err"; q: string; message: string };

type Detail =
  | { kind: "loading"; id: number }
  | { kind: "item"; id: number; item: Item }
  | { kind: "notfound"; id: number }
  | { kind: "err"; id: number; message: string };

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

export default function App() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Results>({ kind: "none" });
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const searchSeq = useRef(0);
  const detailSeq = useRef(0);

  function onQuery(q: string) {
    setQuery(q);
    const seq = ++searchSeq.current;
    if (q.length < 2) {
      setSearching(false);
      setResults({ kind: "none" });
      return;
    }
    setSearching(true);
    if (results.kind === "err") setResults({ kind: "none" });
    search(q).then(
      hits => {
        if (seq !== searchSeq.current) return;
        setResults({ kind: "ok", q, hits });
        setSearching(false);
      },
      (e: unknown) => {
        if (seq !== searchSeq.current) return;
        setResults({ kind: "err", q, message: messageOf(e) });
        setSearching(false);
      },
    );
  }

  function load(id: number) {
    const seq = ++detailSeq.current;
    setDetail({ kind: "loading", id });
    fetchItem(id).then(
      item => {
        if (seq !== detailSeq.current) return;
        setDetail(item ? { kind: "item", id, item } : { kind: "notfound", id });
      },
      (e: unknown) => {
        if (seq !== detailSeq.current) return;
        setDetail({ kind: "err", id, message: messageOf(e) });
      },
    );
  }

  function select(id: number) {
    if (id === selected) return;
    setSelected(id);
    load(id);
  }

  let resultsBody: React.ReactNode = null;
  if (query.length === 1) {
    resultsBody = <p>too short: {query}</p>;
  } else if (query.length >= 2) {
    resultsBody = (
      <>
        {searching && <p>searching…</p>}
        {results.kind === "ok" && (
          <>
            <p>
              {results.hits.length} results for {results.q}
            </p>
            <ul>
              {results.hits.map(hit => (
                <li key={hit.id} data-testid="hit" onClick={() => select(hit.id)} style={{ cursor: "pointer" }}>
                  {hit.id === selected ? "> " : ""}
                  {hit.name}
                </li>
              ))}
            </ul>
          </>
        )}
        {results.kind === "err" && !searching && <p>search failed: {results.message}</p>}
      </>
    );
  }

  let detailBody: React.ReactNode;
  if (selected === null || detail === null) {
    detailBody = <p>pick a result</p>;
  } else if (detail.kind === "loading") {
    detailBody = <p>loading…</p>;
  } else if (detail.kind === "item") {
    detailBody = (
      <>
        <h2>{detail.item.name}</h2>
        <p>{detail.item.blurb}</p>
      </>
    );
  } else if (detail.kind === "notfound") {
    detailBody = <p>item {detail.id} not found</p>;
  } else {
    const id = detail.id;
    detailBody = (
      <>
        <p>failed: {detail.message}</p>
        <button data-testid="retry" onClick={() => load(id)}>
          retry
        </button>
      </>
    );
  }

  return (
    <main>
      <input data-testid="query" value={query} onChange={e => onQuery(e.target.value)} placeholder="search" />
      <section data-testid="results">{resultsBody}</section>
      <section data-testid="detail">{detailBody}</section>
    </main>
  );
}

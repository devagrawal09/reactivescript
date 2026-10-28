import { useRef, useState } from "react";
import { search, fetchItem } from "./api.js";
import type { Hit, Item } from "./api.js";

type SearchState =
  | { status: "idle" }
  | { status: "searching"; shown: { q: string; hits: Hit[] } | null }
  | { status: "done"; shown: { q: string; hits: Hit[] } }
  | { status: "error"; message: string };

type DetailState =
  | { status: "none" }
  | { status: "loading"; id: number }
  | { status: "item"; id: number; item: Item }
  | { status: "missing"; id: number }
  | { status: "error"; id: number; message: string };

const errMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

export default function App() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchState>({ status: "idle" });
  const [selected, setSelected] = useState<number | null>(null);
  const [detail, setDetail] = useState<DetailState>({ status: "none" });
  const searchToken = useRef(0);
  const detailToken = useRef(0);

  function onQuery(q: string) {
    setQuery(q);
    const token = ++searchToken.current;
    if (q.length < 2) {
      setResults({ status: "idle" });
      return;
    }
    setResults(prev => ({
      status: "searching",
      shown: prev.status === "done" ? prev.shown : prev.status === "searching" ? prev.shown : null,
    }));
    search(q).then(
      hits => {
        if (token === searchToken.current) setResults({ status: "done", shown: { q, hits } });
      },
      (e: unknown) => {
        if (token === searchToken.current) setResults({ status: "error", message: errMessage(e) });
      },
    );
  }

  function load(id: number) {
    const token = ++detailToken.current;
    setDetail({ status: "loading", id });
    fetchItem(id).then(
      item => {
        if (token !== detailToken.current) return;
        setDetail(item ? { status: "item", id, item } : { status: "missing", id });
      },
      (e: unknown) => {
        if (token === detailToken.current) setDetail({ status: "error", id, message: errMessage(e) });
      },
    );
  }

  function select(id: number) {
    if (id === selected && detail.status !== "none") return;
    setSelected(id);
    load(id);
  }

  let resultsBody: React.ReactNode = null;
  if (query.length === 1) {
    resultsBody = <p>too short: {query}</p>;
  } else if (query.length >= 2) {
    const shown = results.status === "done" || results.status === "searching" ? results.shown : null;
    resultsBody = (
      <>
        {results.status === "searching" && <p>searching…</p>}
        {results.status === "error" && <p>search failed: {results.message}</p>}
        {shown && (
          <>
            <p>
              {shown.hits.length} results for {shown.q}
            </p>
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

  let detailBody: React.ReactNode;
  switch (detail.status) {
    case "none":
      detailBody = <p>pick a result</p>;
      break;
    case "loading":
      detailBody = <p>loading…</p>;
      break;
    case "item":
      detailBody = (
        <>
          <h2>{detail.item.name}</h2>
          <p>{detail.item.blurb}</p>
        </>
      );
      break;
    case "missing":
      detailBody = <p>item {detail.id} not found</p>;
      break;
    case "error": {
      const id = detail.id;
      detailBody = (
        <>
          <p>failed: {detail.message}</p>
          <button data-testid="retry" onClick={() => load(id)}>
            retry
          </button>
        </>
      );
      break;
    }
  }

  return (
    <main>
      <input data-testid="query" value={query} onChange={e => onQuery(e.target.value)} placeholder="search" />
      <section data-testid="results">{resultsBody}</section>
      <section data-testid="detail">{detailBody}</section>
    </main>
  );
}

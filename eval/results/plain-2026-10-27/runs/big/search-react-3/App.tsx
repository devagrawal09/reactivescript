import { useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { search, fetchItem } from "./api.js";
import type { Hit, Item } from "./api.js";

type Results =
  | { kind: "idle" }
  | { kind: "done"; q: string; hits: Hit[] }
  | { kind: "error"; message: string };

type Detail =
  | { kind: "none" }
  | { kind: "loading"; id: number }
  | { kind: "item"; item: Item }
  | { kind: "missing"; id: number }
  | { kind: "error"; id: number; message: string };

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

export default function App() {
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<Results>({ kind: "idle" });
  const [selected, setSelected] = useState<number | null>(null);
  const [detail, setDetail] = useState<Detail>({ kind: "none" });
  const searchSeq = useRef(0);
  const detailSeq = useRef(0);

  function onChange(e: ChangeEvent<HTMLInputElement>) {
    const q = e.target.value;
    setQuery(q);
    const token = ++searchSeq.current;
    if (q.length < 2) {
      setSearching(false);
      setResults({ kind: "idle" });
      return;
    }
    setSearching(true);
    search(q).then(
      hits => {
        if (token !== searchSeq.current) return;
        setSearching(false);
        setResults({ kind: "done", q, hits });
      },
      (err: unknown) => {
        if (token !== searchSeq.current) return;
        setSearching(false);
        setResults({ kind: "error", message: messageOf(err) });
      },
    );
  }

  function load(id: number) {
    const token = ++detailSeq.current;
    setDetail({ kind: "loading", id });
    fetchItem(id).then(
      item => {
        if (token !== detailSeq.current) return;
        setDetail(item ? { kind: "item", item } : { kind: "missing", id });
      },
      (err: unknown) => {
        if (token !== detailSeq.current) return;
        setDetail({ kind: "error", id, message: messageOf(err) });
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
        {results.kind === "error" && !searching && <p>search failed: {results.message}</p>}
        {results.kind === "done" && (
          <>
            <p>
              {results.hits.length} results for {results.q}
            </p>
            <ul>
              {results.hits.map(hit => (
                <li
                  key={hit.id}
                  data-testid="hit"
                  onClick={() => select(hit.id)}
                  style={{ cursor: "pointer" }}
                >
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
  switch (detail.kind) {
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
      <input
        data-testid="query"
        value={query}
        onChange={onChange}
        placeholder="search"
        autoFocus
      />
      <section data-testid="results">{resultsBody}</section>
      <section data-testid="detail">{detailBody}</section>
    </main>
  );
}

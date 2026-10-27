import { useRef, useState } from "react";
import type { ReactNode } from "react";
import { fetchItem, search } from "./api.js";
import type { Hit, Item } from "./api.js";

type Shown = { q: string; hits: Hit[] };
type SearchState =
  | { status: "idle" }
  | { status: "loading"; q: string }
  | { status: "done"; q: string }
  | { status: "error"; q: string; message: string };

type Detail =
  | { status: "none" }
  | { status: "loading"; id: number }
  | { status: "item"; id: number; item: Item }
  | { status: "missing"; id: number }
  | { status: "error"; id: number; message: string };

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

export default function App() {
  const [query, setQuery] = useState("");
  const [searchState, setSearchState] = useState<SearchState>({ status: "idle" });
  const [shown, setShown] = useState<Shown | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<Detail>({ status: "none" });
  const searchSeq = useRef(0);
  const detailSeq = useRef(0);

  function onQuery(q: string) {
    setQuery(q);
    const seq = ++searchSeq.current;
    if (q.length < 2) {
      setSearchState({ status: "idle" });
      setShown(null);
      return;
    }
    setSearchState({ status: "loading", q });
    search(q).then(
      hits => {
        if (seq !== searchSeq.current) return;
        setShown({ q, hits });
        setSearchState({ status: "done", q });
      },
      (e: unknown) => {
        if (seq !== searchSeq.current) return;
        setShown(null);
        setSearchState({ status: "error", q, message: messageOf(e) });
      },
    );
  }

  function load(id: number) {
    const seq = ++detailSeq.current;
    setDetail({ status: "loading", id });
    fetchItem(id).then(
      item => {
        if (seq !== detailSeq.current) return;
        setDetail(item ? { status: "item", id, item } : { status: "missing", id });
      },
      (e: unknown) => {
        if (seq !== detailSeq.current) return;
        setDetail({ status: "error", id, message: messageOf(e) });
      },
    );
  }

  function select(id: number) {
    if (id === selectedId) return;
    setSelectedId(id);
    load(id);
  }

  let results: ReactNode = null;
  if (query.length === 1) {
    results = <p>too short: {query}</p>;
  } else if (query.length >= 2) {
    results = (
      <>
        {searchState.status === "loading" && <p>searching…</p>}
        {searchState.status === "error" && <p>search failed: {searchState.message}</p>}
        {shown && (
          <>
            <p>
              {shown.hits.length} results for {shown.q}
            </p>
            <ul>
              {shown.hits.map(hit => (
                <li
                  key={hit.id}
                  data-testid="hit"
                  onClick={() => select(hit.id)}
                  style={{ cursor: "pointer" }}
                >
                  {hit.id === selectedId ? `> ${hit.name}` : hit.name}
                </li>
              ))}
            </ul>
          </>
        )}
      </>
    );
  }

  let detailBody: ReactNode;
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
          <button type="button" data-testid="retry" onClick={() => load(id)}>
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
        onChange={e => onQuery(e.target.value)}
        placeholder="search"
        autoFocus
      />
      <section data-testid="results">{results}</section>
      <section data-testid="detail">{detailBody}</section>
    </main>
  );
}

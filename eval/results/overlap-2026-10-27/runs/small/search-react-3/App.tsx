import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { search, fetchItem, type Hit, type Item } from "./api.js";

type SearchState = { q: string; hits?: Hit[]; error?: string };

type DetailState =
  | { id: number; status: "loading" }
  | { id: number; status: "ok"; item: Item }
  | { id: number; status: "missing" }
  | { id: number; status: "error"; error: string };

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

function HitList({ hits, selected, onSelect }: { hits: Hit[]; selected: number | null; onSelect: (id: number) => void }) {
  return (
    <ul>
      {hits.map((hit, i) => {
        const onKey = (e: KeyboardEvent<HTMLLIElement>) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelect(hit.id);
          }
        };
        return (
          <li
            key={`${i}-${hit.id}`}
            data-testid="hit"
            tabIndex={0}
            onClick={() => onSelect(hit.id)}
            onKeyDown={onKey}
            style={{ cursor: "pointer", fontWeight: hit.id === selected ? 600 : 400 }}
          >
            {hit.id === selected ? `> ${hit.name}` : hit.name}
          </li>
        );
      })}
    </ul>
  );
}

export default function App() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchState | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [detail, setDetail] = useState<DetailState | null>(null);
  const searchSeq = useRef(0);
  const detailSeq = useRef(0);

  function onQuery(q: string) {
    setQuery(q);
    // every keystroke invalidates older searches, so only the latest answer lands
    const n = ++searchSeq.current;
    if (q.length < 2) return;
    search(q).then(
      hits => { if (searchSeq.current === n) setResults({ q, hits }); },
      e => { if (searchSeq.current === n) setResults({ q, error: errText(e) }); },
    );
  }

  function load(id: number) {
    const n = ++detailSeq.current;
    setDetail({ id, status: "loading" });
    fetchItem(id).then(
      item => {
        if (detailSeq.current !== n) return;
        setDetail(item ? { id, status: "ok", item } : { id, status: "missing" });
      },
      e => { if (detailSeq.current === n) setDetail({ id, status: "error", error: errText(e) }); },
    );
  }

  function select(id: number) {
    setSelected(id);
    load(id);
  }

  let resultsBody: ReactNode = null;
  const q = query;
  if (q.length === 1) {
    resultsBody = <p>{`too short: ${q}`}</p>;
  } else if (q.length >= 2) {
    const fresh = results !== null && results.q === q;
    if (!fresh) {
      // keep the previous hits on screen while the new search runs
      resultsBody = (
        <>
          <p>searching…</p>
          {results?.hits && <HitList hits={results.hits} selected={selected} onSelect={select} />}
        </>
      );
    } else if (results.error !== undefined) {
      resultsBody = <p>{`search failed: ${results.error}`}</p>;
    } else {
      const hits = results.hits ?? [];
      resultsBody = (
        <>
          <p>{`${hits.length} results for ${q}`}</p>
          <HitList hits={hits} selected={selected} onSelect={select} />
        </>
      );
    }
  }

  let detailBody: ReactNode;
  if (selected === null) {
    detailBody = <p>pick a result</p>;
  } else if (detail === null || detail.status === "loading") {
    detailBody = <p>loading…</p>;
  } else if (detail.status === "ok") {
    detailBody = (
      <>
        <h2>{detail.item.name}</h2>
        <p>{detail.item.blurb}</p>
      </>
    );
  } else if (detail.status === "missing") {
    detailBody = <p>{`item ${detail.id} not found`}</p>;
  } else {
    const failedId = detail.id;
    detailBody = (
      <>
        <p>{`failed: ${detail.error}`}</p>
        <button type="button" data-testid="retry" onClick={() => load(failedId)}>
          retry
        </button>
      </>
    );
  }

  return (
    <main style={{ display: "flex", gap: "2rem", padding: "1rem", fontFamily: "system-ui, sans-serif", flexWrap: "wrap" }}>
      <section style={{ flex: "1 1 260px" }}>
        <label>
          Search{" "}
          <input data-testid="query" type="text" value={query} onChange={e => onQuery(e.target.value)} />
        </label>
        <div data-testid="results">{resultsBody}</div>
      </section>
      <section data-testid="detail" style={{ flex: "1 1 260px" }}>
        {detailBody}
      </section>
    </main>
  );
}

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { search, fetchItem } from "./api.js";
import type { Hit, Item } from "./api.js";

type SearchAnswer =
  | { q: string; ok: true; hits: Hit[] }
  | { q: string; ok: false; message: string };

type Shown = { q: string; hits: Hit[] };

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function HitList({ shown, selectedId, onSelect }: { shown: Shown; selectedId: number | null; onSelect: (id: number) => void }) {
  return (
    <>
      <div>{`${shown.hits.length} results for ${shown.q}`}</div>
      <ul>
        {shown.hits.map((h, i) => (
          <li key={`${h.id}-${i}`} data-testid="hit" style={{ cursor: "pointer" }} onClick={() => onSelect(h.id)}>
            {h.id === selectedId ? `> ${h.name}` : h.name}
          </li>
        ))}
      </ul>
    </>
  );
}

type DetailState =
  | { kind: "item"; item: Item }
  | { kind: "notFound" }
  | { kind: "failed"; message: string };

function Detail({ id }: { id: number }) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<DetailState | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchItem(id).then(
      item => {
        if (cancelled) return;
        setState(item ? { kind: "item", item } : { kind: "notFound" });
      },
      (e: unknown) => {
        if (cancelled) return;
        setState({ kind: "failed", message: errorMessage(e) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [id, attempt]);

  if (state === null) return <div>loading…</div>;
  if (state.kind === "item")
    return (
      <div>
        <h2>{state.item.name}</h2>
        <p>{state.item.blurb}</p>
      </div>
    );
  if (state.kind === "notFound") return <div>{`item ${id} not found`}</div>;
  return (
    <div>
      <div>{`failed: ${state.message}`}</div>
      <button data-testid="retry" onClick={() => setAttempt(a => a + 1)}>
        retry
      </button>
    </div>
  );
}

export default function App() {
  const [query, setQuery] = useState("");
  const [answer, setAnswer] = useState<SearchAnswer | null>(null);
  const [shown, setShown] = useState<Shown | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  useEffect(() => {
    if (query.length < 2) return;
    let cancelled = false;
    search(query).then(
      hits => {
        if (cancelled) return;
        setAnswer({ q: query, ok: true, hits });
        setShown({ q: query, hits });
      },
      (e: unknown) => {
        if (cancelled) return;
        setAnswer({ q: query, ok: false, message: errorMessage(e) });
        setShown(null);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [query]);

  function onChange(value: string) {
    setQuery(value);
    setAnswer(null);
    if (value.length < 2) setShown(null);
  }

  let results: ReactNode = null;
  if (query.length === 1) {
    results = `too short: ${query}`;
  } else if (query.length >= 2) {
    const current = answer && answer.q === query ? answer : null;
    if (current && !current.ok) {
      results = `search failed: ${current.message}`;
    } else if (current && current.ok) {
      results = <HitList shown={{ q: current.q, hits: current.hits }} selectedId={selectedId} onSelect={setSelectedId} />;
    } else {
      results = (
        <>
          <div>searching…</div>
          {shown && <HitList shown={shown} selectedId={selectedId} onSelect={setSelectedId} />}
        </>
      );
    }
  }

  return (
    <main>
      <input data-testid="query" value={query} onChange={e => onChange(e.target.value)} autoFocus />
      <section data-testid="results">{results}</section>
      <section data-testid="detail">
        {selectedId === null ? "pick a result" : <Detail key={selectedId} id={selectedId} />}
      </section>
    </main>
  );
}

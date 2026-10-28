import { createMemo, createSignal, Errored, For, isPending, latest, Loading, refresh, Show, untrack } from "solid-js";
import { fetchItem, search } from "./api";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

class TooShort extends Error {}
class ItemNotFound extends Error {}

// Opens on `query` with `selected` chosen (both empty from the tab; a related hit opens it on its issue's title).
export default function HelpPage(props: { query: string; selected: number | null }) {
  const [query, setQuery] = createSignal(untrack(() => props.query));
  const [selected, setSelected] = createSignal<number | null>(untrack(() => props.selected));

  // empty: nothing; one character: too short, nothing asked; otherwise the search
  const results = createMemo(() => {
    const q = query();
    if (q === "") return [];
    if (q.length < 2) throw new TooShort(`too short: ${q}`);
    return search(q);
  });
  const item = createMemo(async () => {
    const id = selected();
    if (id === null) return null;
    const it = await fetchItem(id);
    if (it === null) throw new ItemNotFound(`item ${id} not found`);
    return it;
  });

  return (
    <section>
      {/* the input shows what was typed even while the search it started is in flight */}
      <input data-testid="query" value={latest(query)} onInput={e => setQuery(e.currentTarget.value)} />
      <Show when={latest(query) !== ""}>
        <div data-testid="results">
          <Errored fallback={e => (e() instanceof TooShort ? <p>{message(e())}</p> : <p>search failed: {message(e())}</p>)}>
            <Loading fallback={<p>searching…</p>}>
              <p>{isPending(() => results()) ? "searching…" : ""}</p>
              <h2>
                {results().length} results for {latest(query)}
              </h2>
              <ul>
                <For each={results()}>
                  {r => (
                    <li data-testid="hit" onClick={() => setSelected(r.id)}>
                      {r.id === selected() ? "> " : ""}
                      {r.name}
                    </li>
                  )}
                </For>
              </ul>
            </Loading>
          </Errored>
        </div>
      </Show>
      <Show when={selected() !== null} fallback={<p data-testid="item">pick a result</p>}>
        <div data-testid="item">
          <Loading on={selected()} fallback={<p>loading…</p>}>
            {/* a fresh region per selection, so a failure shown for one item doesn't stay up while the next loads */}
            <Show when={selected()} keyed>
              {_id => (
                <Errored
                  fallback={e =>
                    e() instanceof ItemNotFound ? (
                      <p>{message(e())}</p>
                    ) : (
                      <>
                        <p>failed: {message(e())}</p>
                        <button data-testid="retry-item" onClick={() => refresh(item)}>retry</button>
                      </>
                    )
                  }
                >
                  <h3>{item()?.name}</h3>
                  <p>{item()?.blurb}</p>
                </Errored>
              )}
            </Show>
          </Loading>
        </div>
      </Show>
    </section>
  );
}

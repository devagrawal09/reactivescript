import { createMemo, Errored, For, Loading, Show } from "solid-js";
import { search } from "./api";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** help related to an issue: the first hits of a search for its title */
export default function Related(props: { title: string; onOpen: (query: string, id: number) => void }) {
  const hits = createMemo(() => search(props.title));
  return (
    <div data-testid="related">
      <Loading on={props.title} fallback={<p>finding related help</p>}>
        <Errored fallback={e => <p>related help failed: {message(e())}</p>}>
          <Show when={hits().length > 0} fallback={<p>no related help</p>}>
            <ul>
              <For each={hits().slice(0, 3)}>
                {h => (
                  <li>
                    <button data-testid="related-hit" onClick={() => props.onOpen(props.title, h.id)}>{h.name}</button>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </Errored>
      </Loading>
    </div>
  );
}

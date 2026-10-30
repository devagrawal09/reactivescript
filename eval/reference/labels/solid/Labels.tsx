import { action, createEffect, createMemo, createOptimisticStore, createSignal, Errored, For, Loading, onFlush, refresh, Show } from "solid-js";
import { addLabel, fetchLabels, removeLabel } from "./api";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

type Change = { id: number; label: string };

// The selected issue's labels, adding and removing them. Changes in flight live in their own stores, so changing the
// selection never waits for them, and each shows only under its own issue.
export default function Labels(props: { id: number }) {
  const labels = createMemo(() => fetchLabels(props.id));
  const [adding, setAdding] = createOptimisticStore<Change[]>([]);
  const [removing, setRemoving] = createOptimisticStore<Change[]>([]);
  const [labelError, setLabelError] = createSignal("");
  const [labelInput, setLabelInput] = createSignal("");
  const shown = () => [
    ...labels().filter(l => !removing.some(r => r.id === props.id && r.label === l)),
    ...adding.filter(a => a.id === props.id).map(a => a.label),
  ];

  // a label error belongs to the issue it was made on: selecting another clears it
  createEffect(() => props.id, () => {
    setLabelError("");
  });

  const add = action(function* (id: number, label: string) {
    try {
      setAdding(a => { a.push({ id, label }); });
      yield addLabel(id, label);
      refresh(labels);
    } catch (e) {
      setLabelError(message(e));
    }
  });

  const remove = action(function* (id: number, label: string) {
    try {
      setRemoving(r => { r.push({ id, label }); });
      yield removeLabel(id, label);
      refresh(labels);
    } catch (e) {
      setLabelError(message(e));
    }
  });

  return (
    <div>
      <div data-testid="labels">
        <Loading on={props.id} fallback={<p>loading labels</p>}>
          <Errored fallback={e => <p>labels error: {message(e())}</p>}>
            <ul>
              <For each={shown()}>
                {l => (
                  <li>
                    <span data-testid="label">{l}</span>{" "}
                    <button
                      data-testid="remove-label"
                      onClick={() => {
                        onFlush(() => setLabelError(""));
                        remove(props.id, l);
                      }}
                    >
                      remove {l}
                    </button>
                  </li>
                )}
              </For>
            </ul>
          </Errored>
        </Loading>
      </div>
      <input data-testid="label-input" value={labelInput()} onInput={e => setLabelInput(e.currentTarget.value)} />
      <button
        data-testid="add-label"
        onClick={() => {
          const label = labelInput();
          if (label === "" || shown().includes(label)) return;
          onFlush(() => {
            setLabelInput("");
            setLabelError("");
          });
          add(props.id, label);
        }}
      >
        add label
      </button>
      <Show when={labelError()}>
        <p>label error: {labelError()}</p>
      </Show>
    </div>
  );
}

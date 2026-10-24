import { createSignal, createMemo } from "solid-js";
import { markSafeError } from "@solidjs/web";
export function App(props) {
  const [sel, setSel] = createSignal(4); props.expose({ setSel });
  const item = createMemo(() => props.ask("i:" + sel()));
  const shown = createMemo(() => { const v = item(); if (v == null) throw markSafeError(new Error(`item ${sel()} not found`)); return v; });
  return <Errored fallback={e => <p>{e().message}</p>}><p>{shown()}</p></Errored>;
}

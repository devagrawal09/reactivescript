import { createSignal, createMemo } from "solid-js";
export function App(props) {
  const [id, setId] = createSignal(0); props.expose({ setId });
  const details = createMemo(() => props.ask("d:" + id()));
  return <Loading fallback={<p>loading</p>}><p>{String(details())}</p></Loading>;
}

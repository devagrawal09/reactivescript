import { createSignal, action } from "solid-js";
export function App(props) {
  const [n, setN] = createSignal(0);
  const bump = action(function* () { setN(n() + 1); });
  return <><p>{n()}</p><button onClick={() => bump()}>+</button></>;
}

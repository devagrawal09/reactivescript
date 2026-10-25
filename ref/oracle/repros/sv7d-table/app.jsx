import { createSignal, For } from "solid-js";
function Row(props) { return <tr><td>{props.name}</td></tr>; }
export function App(props) {
  const [names, setNames] = createSignal(["Ann", "Bo"]);
  props.expose({ add: n => setNames(xs => [...xs, n]) });
  return <table><For each={names()}>{n => <Row name={n} />}</For></table>;
}

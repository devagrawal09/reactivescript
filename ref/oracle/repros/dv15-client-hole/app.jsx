import { createMemo, Loading } from "solid-js";
export function App(props) {
  const width = createMemo(() => props.ask("viewport"), { ssrSource: "client" });
  return <div><Loading fallback={<p>measuring</p>}><p>{width() < 600 ? "narrow" : "wide"}</p></Loading></div>;
}

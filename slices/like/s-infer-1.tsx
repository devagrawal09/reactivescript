import { action, createOptimistic, createSignal } from "solid-js";
import { fetch } from "./api";

export default function App() {
  const [truth, setTruth] = createSignal("no");
  const [liked, setLiked] = createOptimistic(() => truth());
  const [error, setError] = createSignal("");
  return <button onClick={action(function* () {
    setLiked("yes");
    try {
      const r: string = yield fetch("like");
      setTruth(r);
    } catch (e) {
      setError(e.message);
    }
  })}>{liked()} {error()}</button>;
}

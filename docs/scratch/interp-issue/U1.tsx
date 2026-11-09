import { createSignal, createOptimistic, action } from "solid-js";
import { request } from "./api.mjs";

export default function App() {
  const [n, setN] = createSignal(0);
  const [guess, setGuess] = createOptimistic(() => n());
  const save = action(function* () {
    setGuess(value => value + 1);
    try { yield request(1); } catch (error) {}
  });
  return <section>
    <button onClick={() => { setN(2); save(); }}>save</button>
    <output>{guess()}</output>
  </section>;
}

import { createSignal, createOptimistic, action } from "solid-js";
import { request } from "./api.mjs";

export default function App() {
  const [n, setN] = createSignal(0);
  const [guess, setGuess] = createOptimistic(() => n());
  const save = action(function* (amount: number) {
    setGuess(value => value + amount);
    try {
      const got: number = yield request(amount);
      setN(value => value + got);
    } catch (error) {}
  });
  return <section>
    <button onClick={() => { save(2); }}>two</button>
    <button onClick={() => { save(3); }}>three</button>
    <output>{n()}</output>
  </section>;
}

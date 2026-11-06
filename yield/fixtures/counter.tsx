import { createSignal, createMemo, action } from "solid-js";

export default function Counter() {
  const [count, setCount] = createSignal(0);
  const doubled = createMemo(() => count() * 2);
  const increment = action(function* () {
    setCount(count() + 1);
  });
  return <button onClick={() => increment()}>{doubled()}</button>;
}

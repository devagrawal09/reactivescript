import { action, createOptimistic, createSignal } from "solid-js";
import { save } from "./api";

export default function Like() {
  const [likes, setLikes] = createSignal(0);
  const [shown, setShown] = createOptimistic(() => likes());
  return <button onClick={action(function* () {
    setShown(n => n + 1);
    try {
      const answer: number = yield save();
      setLikes(answer);
    } catch (error) {}
  })}>{shown()}</button>;
}

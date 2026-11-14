import { startTransition, useOptimistic, useState } from "react";
import { save } from "./api";

export default function Like() {
  const [likes, setLikes] = useState(0);
  const [shown, setShown] = useOptimistic(likes);
  return <button onClick={() => startTransition(async () => {
    setShown(n => n + 1);
    try {
      const answer: number = await save();
      startTransition(() => setLikes(answer));
    } catch (error) {}
  })}>{shown}</button>;
}

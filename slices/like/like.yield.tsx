import { $event, $optimistic, $signal, attempt, component, view } from "solid-yield";
import { save } from "./api";

export default component(function* Like() {
  const [likes, setLikes] = yield* $signal(0);
  const [shown, setShown] = yield* $optimistic(function* () { return yield* likes; });
  const like = $event(function* () {
    yield* setShown(n => n + 1);
    const answer = yield* attempt(() => save(), function* () {});
    if (answer !== undefined) {
      yield* setLikes(answer);
    }
  });
  return view(function* () {
    return <button onClick={yield* like}>{yield* shown}</button>;
  });
});

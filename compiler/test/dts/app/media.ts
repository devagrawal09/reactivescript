import { pure, ref, instantiates } from "@reactivescript/js";

type Accessor<T> = () => T;
function createSignal<T>(value: T): [Accessor<T>, (v: T) => void] {
  return [() => value, (v) => { value = v; }];
}

export const createToggle = pure(ref({ result: [0] }, (initial: boolean) => createSignal(initial)));

export const createDebounced = pure(ref({ args: [0], result: true }, (source: Accessor<string>, ms: number) => {
  void ms;
  return source;
}));

export const createEventListener = pure(instantiates((target: EventTarget, type: string, handler: (e: Event) => void) => {
  target.addEventListener(type, handler);
}));

export const fields = ["name", "title"] as const;

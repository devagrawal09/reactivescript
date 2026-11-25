import type { Pure, Ref, Instantiates } from "@reactivescript/types";

export function createToggle(initial: boolean): Pure<[Ref<boolean>, (v: boolean) => void]> {
  let on = initial;
  return [() => on, (v) => { on = v; }];
}

export const createDebounced = (source: Ref<string>, ms: number): Pure<Ref<string>> => {
  void ms;
  return source;
};

export function createEventListener(target: EventTarget, type: string, handler: (e: Event) => void): Pure<Instantiates<void>> {
  target.addEventListener(type, handler);
}

export const fields = ["name", "title"] as const;

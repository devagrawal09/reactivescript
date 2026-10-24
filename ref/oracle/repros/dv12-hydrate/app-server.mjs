// The server half of DV-12: <Errored><p>{shown()}</p></Errored>, where `shown` throws (a safe error) because the answer
// to `item` is null — as Solid's compiler emits it for SSR with hydration.
import { createSignal, createMemo, createComponent, Errored } from "solid-js";
import { ssr, escape, ssrHydrationKey, renderToStream, markSafeError } from "@solidjs/web";
export function render(ask, write, end) {
  return renderToStream(() => {
    const [sel] = createSignal(4);
    const item = createMemo(() => ask("i:" + sel()));
    const shown = createMemo(() => { const v = item(); if (v == null) throw markSafeError(new Error(`item ${sel()} not found`)); return v; });
    return createComponent(Errored, {
      fallback: e => ssr(["<p", ">", "</p>"], ssrHydrationKey(), escape(e().message)),
      get children() { return ssr(["<p", ">", "</p>"], ssrHydrationKey(), () => escape(shown())); },
    });
  }).pipe({ write, end });
}

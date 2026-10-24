// The server half of DV-11: <Loading><p>{details()}</p></Loading>, whose answer has not arrived when the client takes over.
import { createSignal, createMemo, createComponent, Loading } from "solid-js";
import { ssr, escape, ssrHydrationKey, renderToStream } from "@solidjs/web";
export function render(ask, write, end) {
  return renderToStream(() => {
    const [id] = createSignal(0);
    const details = createMemo(() => ask("d:" + id()));
    return createComponent(Loading, {
      get fallback() { return ssr(["<p", ">loading</p>"], ssrHydrationKey()); },
      get children() { return ssr(["<p", ">", "</p>"], ssrHydrationKey(), () => escape(String(details()))); },
    });
  }).pipe({ write, end });
}

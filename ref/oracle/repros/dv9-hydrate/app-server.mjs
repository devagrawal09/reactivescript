// The server half of DV-9's hydration: <Errored><Loading><p>{user()}</p></Loading></Errored>, as Solid's compiler emits it
// for SSR with hydration (babel-preset-solid, generate: "ssr", hydratable: true).
import { createMemo, createComponent, Errored, Loading } from "solid-js";
import { ssr, escape, ssrHydrationKey, renderToStream, markSafeError } from "@solidjs/web";
export function render(ask, write, end) {
  return renderToStream(() => {
    const user = createMemo(() => ask("u"));
    return createComponent(Errored, {
      fallback: e => ssr(["<p", ">failed: ", "</p>"], ssrHydrationKey(), escape(e().message)),
      get children() {
        return createComponent(Loading, {
          get fallback() { return ssr(["<p", ">loading</p>"], ssrHydrationKey()); },
          get children() { return ssr(["<p", ">", "</p>"], ssrHydrationKey(), () => escape(user())); },
        });
      },
    });
  }).pipe({ write, end });
}
export { markSafeError };

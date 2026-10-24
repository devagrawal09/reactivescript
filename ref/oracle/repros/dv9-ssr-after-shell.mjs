// DV-9: a boundary whose async read fails, during the server render.
// node repros/dv9-ssr-after-shell.mjs [client|server-component] [ms]      (default conditions: the server build)
// ms: when the read rejects — 200 (default) is after the shell has flushed, 1 is before.
import { createMemo, Loading, Errored, createComponent, runInServerComponentScope } from "solid-js";
import { renderToStream, ssr, escape, markSafeError } from "@solidjs/web";
const mode = process.argv[2] ?? "client"; const ms = Number(process.argv[3] ?? 200);
let reject; const p = new Promise((_, j) => (reject = j)); p.catch(() => {});
function App() {
  const user = createMemo(() => p);
  return ssr(["<main>", "</main>"], createComponent(Errored, {
    fallback: e => ssr(["<p>failed: ", "</p>"], escape(e().message)),
    get children() { return createComponent(Loading, { fallback: ssr(["<p>loading</p>"]), get children() { return ssr(["<p>", "</p>"], () => escape(user().name)); } }); },
  }));
}
const view = () => createComponent(App, {});
renderToStream(mode === "server-component" ? () => runInServerComponentScope(view) : view)
  .pipe({ write: c => console.log(c.replace(/<script>[\s\S]*?<\/script>/g, "")), end() {} });
setTimeout(() => reject(markSafeError(new Error("no user 7"))), ms);   // marked safe: a failure the client may see
// after the shell:
//   client:            <template id="100"> </template>                    the placeholder is replaced by nothing; the fallback waits for hydration
//   server-component:  <template id="100"><p>failed: no user 7</p></template>
// before the shell (ms = 1):
//   client:            <main></main>                                       the boundary renders nothing
//   server-component:  <main><p>failed: no user 7</p></main>

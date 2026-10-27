# @reactivescript/runtime

ReactiveScript's runtime (spec/11 CP-4a): `createApp` and the `__rt` helpers
that compiled `.rx` calls, over Solid. Each helper is a Solid primitive, a
composition of them, or plain JavaScript; nothing in it adds run-time
behaviour beyond Solid.

There is a browser build and a server build, chosen by export condition as
`@solidjs/web` chooses (`browser` → the browser build; `node`, `deno`,
`worker` → the server build; `./web` and `./server` name one explicitly).
Both create the same owners in the same order, so a page the server streamed
hydrates (spec/10).

```js
import { createApp } from "@reactivescript/runtime";
import main from "./app.rx";   // compiled by @reactivescript/compiler (Solid's Vite plugin loads it)

const app = createApp({ root: document.getElementById("app") });
app.mount(main(app));
```

Solid is a peer: `solid-js`, `@solidjs/web` and `@solidjs/signals` (the
runtime reads owner context from `@solidjs/signals`, which `solid-js` runs on;
with pnpm, add it to the app).

The source is the reference's runtime, `ref/compile/rt-web.ts` and
`rt-server.ts`, the one every scenario runs on; `npm run build` transpiles it
to `dist/` with its declarations. `npm test` checks both builds and renders
a program compiled by the crate on the server build (it needs the compiler's
Node-API build: `npm run build` in `../compiler`).

Not yet: the server build's `stream` takes no request (it provides a
placeholder one); a framework's request handling is to come.

Releases: as `@reactivescript/compiler`'s (`../compiler/README.md`,
Releasing), by the `runtime` workflow, tagged `runtime-v<version>`.

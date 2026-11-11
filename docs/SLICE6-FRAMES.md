# Slice 6: inferred server components over Solid 2's Frames (research and design)

Status: research and design, 2026-11-10. Nothing here is implemented yet. The probes below ran at the pins and are kept
under `/tmp/s6probe/`. Pins: RX `fdbcad9`, Solid `2105ffb8` (2.0.0-rc.21, 2026-11-03). Branch `solid-model` at
`18e7d6a` (the task text said `7186e52`, which is an ancestor: HEAD and `origin/solid-model` are both `18e7d6a`).

**FEASIBLE: yes.** Frames and server functions are in rc.21 (`@solidjs/web/frames` and
`@solidjs/web/server-functions`). They run without the vite plugin, which only generates code. At the pin, a native
tracker-shaped app ran end to end in Chromium with no plugin: document SSR, hydration, a client island, a server frame
refetched after an action, and a server-function call. The frames surface is marked experimental, outside the 2.0
stability guarantee, and its wire format may change between prereleases (RFC 11). That is a risk for later repins, not
a blocker at this pin.

---

## 1. Where things are

| What | Where / state |
| --- | --- |
| Frames runtime, server half | `solid-next/packages/web/frames/src/{server.ts, frame-sink.ts (3696 lines), frame-transport.ts, frame-container-plugin.ts, tree-rewrite.ts}`; dist `frames/dist/server{,.dev,.observe}.js`; export `@solidjs/web/frames` under the `node`/`worker`/`deno` conditions |
| Frames runtime, client half | `frames/src/{client.ts, frame-client.ts (2730), frame-morph.ts, frame-transport.ts}` plus lazy tiers `{wire,regions,assets,trace}-tier.ts`; export `@solidjs/web/frames` under the `browser` condition, tiers at `@solidjs/web/frames/{wire,regions,assets,trace}` |
| Server functions | `packages/web/server-functions/src/{server.ts (5429), client.ts, shared.ts, registry.ts, argument-codec.ts, flash.ts, uploads.ts}`; `@solidjs/web/server-functions` resolves to the server or client half by condition |
| Directive compiler | `packages/compiler` (native, `compiler.node` is built at the pin): `transformDirectives(code, { mode: "server" \| "client", directive: "use server", register, create, root })` |
| Design records | `solid-next/documentation/server-components/{server-components.md, frame-streams-rfc.md, server-components-principles.md, frames-consistency-contract.md, frames-rulings.md}`; `packages/web/skills/server-components/SKILL.md` |
| Examples | `solid-next/examples/{todos-server, notes, chat}` (these need `@solidjs/router` and the vite plugin) |
| Dependencies | `@solidjs/web` depends only on `seroval` and `seroval-plugins` 1.7.0, with peer `solid-js`. No dom-expressions anywhere |
| `/workspace/solid` (the user's fork, read only) | Checked out on **`main`**, not `next`. `origin/next` = `38e0c493` (2026-10-28), 6 days older than the pin and an **ancestor** of it (199 commits behind). Frames and server functions are already there. Against the pin: `frames/src/client.ts` +2, `server-functions/src/server.ts` +231/−63, `uploads.ts` +44. The fork's `FETCH_HEAD` records upstream `next` at `8138dabe` (2026-11-06), 14 commits past the pin, which changes `frame-sink.ts` by 80 lines and `wire-tier.ts` by 8. Nothing was pulled |
| `/workspace/solid-vite-plugin` (read only) | Working tree on **`main`**: `vite-plugin-solid` 2.11.15, the Solid 1 plugin. `origin/next` = `3cb10ddb` (2026-11-03): `@solidjs/vite-plugin` 3.0.0-next.55. Read with `git show` only |
| RX | `spec/10-server.md` (SSR, hydration, SV-1..7) and `spec/12-server-functions.md` (`server fn`, `server`/`client` JS rows, SF-1..7) are implemented in the pinned checker: `SERVER_ONLY`, `SERVER_CAPTURE`, `SERVER_WRITE`, CP-6 symbol kind `server`, computation kind `server` |

## 2. The Frames runtime at rc.21

### 2.1 The model, from Solid's own docs

- **A server component is a function returned from a server function.** The server function's arguments are its
  server inputs. They cross the wire and name the call. The returned component's props are **client positions
  (slots)**: holes the client fills, which never reach the server.
  - `{props.children}` is a direct insert.
  - `<props.x a={…}/>` is a render-prop **occurrence** (`x#0`, `x#1`, …, positional unless `$key`). Primitive
    arguments ride inline in the slot record. Other values go into `data` records. Server JSX arguments stream as
    nested regions.
- **A boundary is a call.** Content is keyed by its address: `frameAddress(id, args)` = `id` + `":" +
  hashArguments(args)`, a structural 31-hash in base 36. Refetching the same call morphs in place, so client state
  inside slots survives. Different arguments give a different address, and the mount rebinds and morphs. A store is
  retained per address.
- **Server markup has no handlers.** A control there is a form `action` or a client component in a slot (SKILL.md,
  "Behavior on server markup").
- **Hydration happens at t=0 only.** Post-load responses carry server content and slot arguments only. They never
  render client components.
- **Inside a server component**, `For`/`Show` are one-shot. User context does not cross the server-component root
  (`runInServerComponentScope`, the context barrier). The output renders under `NoHydration`: no `_hk` keys and no
  async hydration records. Client positions re-enter through `Hydration`, with keys `sc-<fnId>-<slot>#<n>-<k>`.
- **On the client** there is no server-component API. `installServerComponents()` installs a response policy on the
  server-function client. `dynamicComponent(() => serverFn(args))` mounts the result, and every call of the same
  function resolves to the same mount identity (contract C16).
- **A refetch inside an action is staged** (contract C15, "holds on next"). Root, fills and sibling writes land in one
  frame at the transaction's commit, never when the body finishes arriving.

### 2.2 The wire protocol (observed at the pin)

**Endpoint.** The transport's calls POST to `/_server/data/<id>`. The bare address `/_server/<id>` is for no-JS forms
and direct HTTP. Ids are `<name>-<xxHash32(root-relative path)>[-ordinal]` (`transformDirectives`), for example
`Detail$server-c06e01e8`.

**Requests.** The header `x-server-function-format` gives the body format:

- `1`: a single string argument, raw text (body `i1`).
- `8`: a JSON argument list (body `[2]`).
- `0`: seroval, used for everything else.

The handler checks the request is same-origin (`Sec-Fetch-Site`/`Origin`/`Referer`). Without those headers it answers
`403`. Responses carry `vary: Sec-Fetch-Site, Origin, Referer`.

**Data responses.**

- A string result is `200`, `content-type: text/plain`, `x-server-function-format: 1`, body `me`.
- A JSON-safe value is `content-type: application/json`, `x-server-function-format: 8`, body `true` or
  `[{"id":1,…}]`.
- Always present: `cache-control: no-store`, `x-content-type-options: nosniff`.

**Frame-stream responses** (a function returned a function, with the `frameTransformResult` hook installed): `200`,
`content-type: application/x-frame-stream`, `x-frame-stream: <id>`, `x-content-raw: 1`, plus the headers above. The
body is a sequence of chunks. Each chunk is `;0x` + an 8-digit hex byte length + `;` + UTF-8 JSON
(`shared.ts:createChunk`, shared with the codec stream). Observed body for `Detail$server(2)`:

```
;0x0000003a;{"type":"start","id":"Detail$server-c06e01e8","version":1}
;0x00000077;{"id":"Detail$server-c06e01e8","version":1,"r":{"slot:ClaimButton#0":{"kind":"slot","args":{"id":2,"assignee":"ana"}}}}
;0x000000ee;{"id":"Detail$server-c06e01e8","version":1,"r":{"":{"kind":"html","value":"<article><h2>Slow search</h2><p>p95 is 4s</p><!--$--><!--slot:ClaimButton#0:start--><!--slot:ClaimButton#0:end--><!--/--></article>","digest":"d3f8990ee34a16a0"}}}
;0x00000042;{"id":"Detail$server-c06e01e8","version":1,"r":{":complete":true}}
```

(The real body has no newlines.) The "wire is the store" addendum (RFC, 2026-10-19) explains the shape:

- A message is a batch `{ id, version, r }` of keyed records that the client's resident store applies as it arrives.
- The record keys are:
  - `""` (the root html),
  - `seg:<k>`, plus `:reveal`, `:fallback`, `:assets` and `:error`,
  - `slot:<k>`,
  - `hole:<k>` (and `:error`),
  - `attr:<k>`,
  - `:complete` (with `:bound`),
  - `:error`.
- Three messages are not records: `start`, `data` (a seroval node of the response's data table) and `outcome`
  (single flight).
- `digest` is `textDigest(html)`: two FNV-1a lanes, 16 hex digits (`shared.ts:1595`).
- The batching rule: one message per frame per synchronous run. A data node or a repeated key starts a new batch.

**t=0 document** (document SSR with `plugins: [ServerComponentPlugin]` and the `transformDirectResult:
frameTransformDirectResult` hook):

- The server component renders inline as `<solid-frame data-fid="<id>" data-fa="<argsHash>"
  style="display:contents">…</solid-frame>`.
- Its slot fills are rendered on the server, inside `Hydration`, with keys `_hk=sc-<id>-<slot>#<n>-<k>`.
- The hydration script adds seroval records:
  - the mount's answer resolves to `self._$SC.r("<id>","<address>")`, the self-installing bootstrap of
    `SERVER_COMPONENT_BOOTSTRAP`;
  - `_$HY.r["sc:live"]`, a seroval `ReadableStream`;
  - `_$HY.r["sc:slot:<id>:<slot>#<n>"]`, the slot arguments;
  - `_$HY.r["sc:deps:<id>:0"]`.
- Two renders of the same document are byte-identical, across requests and across processes (probe).

### 2.3 Production and consumption

- **Server.** `handleServerFunctionRequest(request, { provideEvent, transformResult: frameTransformResult })`.
  - `provideEvent` is required. Without it the handler throws "No request event provider". `provideRequestEvent`
    comes from `@solidjs/web/storage`.
  - A function result that is a component streams through `serverComponentResponse` → `renderServerComponent` →
    `renderToStream` with the frame sink (`frame-sink.ts:createFrameSink`).
  - `createSlotProps` is the props proxy that turns `<props.x/>` into slot records and marker ranges.
  - `serverOwned` wraps the output in `NoHydration`.
- **Client.** `installServerComponents()` runs before `hydrate`/`render`. It sets `_$SC.impl` and registers
  `createServerComponentHandler` as the server-function client's `responseHandler`.
  - A frame-stream response resolves the call with the per-function binding, and its chunks stream into the host
    (`createFrameHost`).
  - The frame (`createFrame`, `<solid-frame>`) morphs server content (`frame-morph.ts`) and never detaches a
    client-owned slot range.
  - At t=0 a call whose boundary is already in the page is answered locally, with zero requests (`intercept`).

### 2.4 Server functions

`"use server"` is compiled by `transformDirectives`:

- The server build turns each function into
  `const f = createServerReference(registerServerReference("<id>", async function f(…){…}))`.
- The client build turns it into `const f = createServerReference("<id>")`. The server-only imports the bodies use are
  dropped.
- The extraction rule is lexical: a body may name only parameters, locals and module-level bindings. RX replaces this
  with SF-3's capture by kind.
- On the server, a call made during a render is a direct in-process call (`transformDirectResult` brands it with its
  address).
- On the client, a call is an HTTP request.

### 2.5 What the vite plugin's Start mode adds (all of it is code generation)

The plugin is `@solidjs/vite-plugin` `origin/next`: `src/server-functions/index.ts`, `src/ssr/index.ts` and
`src/index.ts`. With `serverFunctions: { components: true }` it does the following:

- **Directive compile.** It runs `transformDirectives` over `src/**`. The client compile records every id it emitted
  into the server manifest (`virtual:solid-server-function-manifest`), so functions referenced only from client code
  still register. Builds stamp `X-Server-Function-Build`.
- **Handler module.** It generates `virtual:solid-server-function-handler`:
  `configureServerFunctionsServer({ provideEvent: provideRequestEvent, endpoint, buildId?, transformResult:
  frameTransformResult, transformFlightResult: frameTransformFlightResult, transformDirectResult:
  frameTransformDirectResult })`. It also re-exports `handleServerFunctionRequest`. A dev middleware owns `/_server`.
- **SSR compile option.** It turns on the compiler's `serverComponents: true` for the SSR generate.
- **Server entry** (generated in Start mode with `ssr: true`): `renderToStream(() => <Document><App/></Document>, {
  manifest, nonce, signal, plugins: [ServerComponentPlugin] })`, plus
  `configureServerFunctionsServer({ transformDirectResult: frameTransformDirectResult })`.
- **Client entry**: `installServerComponents(); hydrate(() => <Document><App/></Document>, document)`.
- **Assets.** `serverModuleStyles` collects a server component's CSS for client builds. `start.renderMode` (for
  example `"async"`) chooses the document mode.

None of this is runtime. Each piece is one import and one call, which a harness can make directly (2.6).

### 2.6 The probe at the pin (no plugin; `/tmp/s6probe`)

**Build.** The probe compiles with `@solidjs/compiler`:

- `transformDirectives`, then `transform` with `{generate:"ssr", hydratable:true, serverComponents:true}` for the
  server and `{generate:"dom", hydratable:true}` for the client.
- It bundles the client with esbuild from solid-next's pnpm store, with `tsconfigRaw: '{}'`. Without that,
  `packages/web/tsconfig.build.json`'s `paths` resolve the frames tiers to `src/*.ts`, a second instance.

**Server.** A Node server runs `handleServerFunctionRequest` and `renderToStream` with `ServerComponentPlugin`.

**Drive.** Chromium 143 from nix runs the client.

**App.** The native split of section 5:

- A server-only host `db` (`listIssues`, `getIssue`, `countOpen`, `assignIssue`, with an access log).
- Server components `Detail$server(selected)` and `Summary$server()`.
- A client `Tracker` with a filter, a list with "show" buttons, `<Detail ClaimButton={p => <ClaimButton … take={take}/>}/>`
  and an action `take` that does `yield claim(id); refresh(issues); refresh(issue); refresh(open)`.

Observed:

| step | frame (`#app` text, scripts and templates excluded) | client requests |
| --- | --- | --- |
| 0 hydrated | `Filter: all2 openCrash on saveshowSlow searchshowTypo in footershowCrash on saveStack trace attachedtake` | none (zero requests at boot) |
| 1 filter | `Filter: open2 openCrash on saveshowTypo in footershowCrash on saveStack trace attachedtake` | none |
| 2 filter | back to the step-0 frame | none |
| 3 show #2 | `…Slow searchp95 is 4staken by ana` | `Detail$server [2]` (frame stream) |
| 4 show #3 | `…Typo in footer'Copyrigth'take` | `Detail$server [3]` |
| 5 take | `Filter: all1 open…Typo in footer'Copyrigth'taken by meAssigned #3 to me` | `claim [3]` (body `me`), then `loadList`, `Detail$server [3]`, `Summary$server` |

What this shows:

- **Server host log**: `listIssues, getIssue 1, countOpen` (document render), `getIssue 2`, `getIssue 3`,
  `assignIssue 3`, `listIssues`, `getIssue 3`, `countOpen`.
- **Node identity.** The server `<article>` node is the same node before and after the arg changes and the refetch.
  Client state in a slot fill survived the morph: a counter in the fill kept its value in the first probe.
- **One frame per transaction.** A MutationObserver during step 5 recorded exactly two distinct frames, before and
  after. The claim's server call, a data refresh, two server-frame refetches and a client write landed in one frame
  (C15).
- **The all-client twin agrees.** The same app with `Detail`/`Summary` as client components over
  `createMemo(() => loadIssue(selected()))`, also SSR'd and hydrated, gave **the same frames at every step and the
  same server host log**. Its requests differed only in function identity: `loadIssue [2]` where the split has
  `Detail$server [2]`, `loadSummary` where it has `Summary$server`.
- **Zero client JS for server components.**
  - The client compile of the server module is 127–393 bytes: only `createServerReference("<id>")` lines.
  - `db` is not in the client module graph.
  - The client bundle has no `<article><h2>…` or Summary template. The twin's bundle has both.
- **The compile flag is inert here.** For every module of the app, the SSR compile with and without
  `serverComponents: true` is identical.
- **Harness note.** The page's only console error was a 404 for `/favicon.ico`. The harness must serve it, because a
  console error fails a run.

### 2.7 Feasibility

Everything the slice needs exists at `2105ffb8` and runs without the vite plugin:

- the frame format and wire protocol;
- server production (`frameTransformResult`, `renderServerComponent`);
- client consumption (`installServerComponents`, `dynamicComponent`);
- t=0 hydration (`ServerComponentPlugin`, `frameTransformDirectResult`, `_$SC`);
- server functions (`transformDirectives`, `handleServerFunctionRequest`, `createServerReference`).

The experimental status is a risk for a future repin: upstream `8138dabe` already changes `frame-sink.ts`. The pin
does not move, and every recorded byte stays at rc.21.

---

## 3. What a "server component" means here, and the native explicit split (the oracle twin)

In Solid 2 Frames terms, a **server component** of a program is one component instance subtree whose markup is
rendered only on the server, by a `"use server"` function that returns a component:

- **Inputs.** The function's parameters are its inputs: wire values the client sends and the frame address hashes.
- **Data.** It awaits server data in its body, through server functions over server-only hosts.
- **Output.** It returns `(props) => markup`, where `props` holds only slots: the client components (islands) placed
  inside its markup.
- **Client mount.** The client mounts it with `dynamicComponent` over a memo that calls the function, so `refresh`
  of the memo refetches the frame.
- **Slot fills.** The fills are client closures defined at the mount site. They can close over client state and
  actions, which never cross the wire.

The **native explicit split** is the oracle twin: hand-written Solid TSX that states the split.

- `tracker-frames.server.tsx`: every `"use server"` function, and each server component as `<Component>$server`.
- `tracker-frames.split.tsx`: the client.

Compile options, fixed: server `{ generate: "ssr", hydratable: true, serverComponents: true }`, client
`{ generate: "dom", hydratable: true }`. Root and module paths are fixed too, so the function ids
(`<name>-<xxHash32(path)>`) are fixed.

Runtime wiring, fixed:

- Server: `configureServerFunctionsServer({ provideEvent: provideRequestEvent, transformResult: frameTransformResult,
  transformDirectResult: frameTransformDirectResult })`, and `renderToStream(…, { plugins: [ServerComponentPlugin] })`
  for the document.
- Client: `installServerComponents()` before `hydrate`.

These are the Start-mode pieces of 2.5, written by hand.

---

## 4. Placement inference from RX checker facts

The inference runs on the authored, placement-free program (RX, or TSX lowered to RX) after `checkModules` passes. It
decides a placement for every component application site. **Client placement is always sound**: the all-client
program *is* the authored program, and server data reaches it through server functions (SF-2). So the inference is
*maximal server placement under the rules below*. Any site the rules cannot place stays client and records the rule
that kept it there. Refusals (4.6) are only for forms plan v2.2 cannot represent at all.

### 4.1 Facts

From CP-6 (`ref/src/model.ts`), verified on the slice app at the pin (`/tmp/s6probe/rxcheck.ts`, no diagnostics):

- **Regions**: `component`, `children` (named after the applied component), `for`, `then`/`else`, `loading`,
  `errored`.
- **Symbols**: kinds `comp`, `props`, `source`, `eq`, `action`, `server` (with `io`), `import` (with `io`).
- **Computations**: kinds `memo`, `question`, `seed`, `reader`, `prop` (`at: "Detail issue"`), `handler`, `action`,
  `effect`, `apply`, `provide`, `server`.
- **Reads**: `mode` (`tracked`, `snapshot`, `pre`), `field`, `probe` (`pending`/`latest`).
- **Writes**: `op` (`write`, `optimistic`, `refresh`, `affects`), `path`.
- **Calls**: of `fn`, `action`, `server`, `import`.

Gaps: like v2's eight fallbacks, these are read from the AST or declarations, not CP-6.

- **F-a. Import sides.** `server`/`client` JS (SF-5) is `declaredSide` on the import AST and its `.d.rx`. CP-6
  symbols carry no side.
- **F-b. Prop argument kinds.** An action passed as a prop (`take={take}`) produces a `prop` computation with no read,
  because actions are not read kinds. Whether an argument is an action, a function or a value comes from the AST and
  the symbol kinds.
- **F-c. Wire types.** These are static types from `plan/types.ts` (EVAL's grammar: `number`, `string`, `boolean`,
  `T[]`, `{ k: T }`). The checker's types are text (RX 07 §2).
- **F-d. Server fn bodies.** Steps come from the AST, as action steps do today.
- **F-e. Wire ids.** These come from Solid's `transformDirectives` on the canonical split's fixed module path.

### 4.2 Definitions

- **Site.** A `component` view: an application `<C …/>` inside component D, with its `prop` computations. Placement
  is decided per site. The entry component is client.
- **Server-fn question.** An equation (`memo` computation) whose value is exactly `await f(args)` with `f` a `server`
  symbol. `f` is pure: an `io` server fn in reactive scope is already `IO_IN_REACTIVE`, and the builder asserts it
  anyway.
- **Wire prop.** A prop of C whose argument at the site has a wire type (F-c).
- **Through prop.** A prop whose argument is an action, or a through prop forwarded verbatim. C uses it only as an
  island argument written exactly `props.p`.
- **Client marks of C.** Any one of these makes C *client-required*. They cover C's regions, excluding the `children`
  regions of nested sites.
  - M1: a `source`.
  - M2: a computation of kind `handler`, `action`, `effect`, `apply` or `provide`.
  - M3: any write (any `op`).
  - M4: a read with mode `pre`, or with a `probe`.
  - M5: a context read (`use`).
  - M6: a call to `client` JS, or a question over a JS host that is not `server`.
  - M7: an `eval` site.
  - M8: a `loading` or `errored` region inside C (v1: a server component's body has finished all its awaits before
    it returns, so it streams no segments).
  - M9: a read of a through prop outside an island argument, or of `props.children`.

### 4.3 Rules

- **PL-1 (unit).** A placement applies to a site and to that site's instance subtree. Elements are never split: a
  server subtree is a component instance minus its islands. A static element subtree inside a client component stays
  client.
- **PL-2 (server-eligible).** C is server-eligible at a site when:
  - it has no client marks (M1–M9);
  - every prop it reads outside island arguments is a wire prop;
  - every nested site in its markup is either an inline server site (PL-6) or an island (PL-5).
- **PL-3 (server root).** A site S of C in client markup (in D) is a **server root** iff all of these hold:
  - a. C is server-eligible.
  - b. S is not under a client `for` row. (v1: rows stay client. They would need one call per row.)
  - c. **Server data.** C at S has exactly one server-fn question, which is one of:
    - *owned*: a question inside C whose arguments depend only on C's wire props;
    - *sunk*: a sinkable question of D (PL-4) passed as one of C's wire-prop arguments.

    Zero questions means no server root: the minimal-request rule, so a static component does not become a server
    round trip. Two or more questions mean no server root either (request parity: the all-client program would make
    two requests where the split makes one).
  - d. **Request parity for the other wire props.** Every other wire-prop argument at S is a literal, or flows only
    into the owned question's arguments. A client-reactive value that C's markup reads directly would refetch in the
    split but re-render synchronously in the all-client program, so that site stays client.

  Anything else is client, and the placement table records the failed condition (`PL-3a` … `PL-3d`).
- **PL-4 (sinking).** A question `q` of D is sinkable at S iff all of these hold:
  - its value is exactly `await f(args)` with `f` a server fn;
  - every CP-6 read of `q`, across every computation, is in a `prop` computation of S (D never needs `q`'s data on
    the client);
  - it is not probed;
  - its only writes are `refresh`/`affects` in actions.

  When sunk, the server root's function takes `q`'s arguments (evaluated in D, tracked) as its parameters and awaits
  `f` in its body. The call memo takes `q`'s place in D's declaration order (`q = createMemo(() => C$server(args))`).
  `refresh q` and `affects q` then act on the call.
- **PL-5 (islands).** Inside a server root's subtree, a site of a client-required component K becomes a slot
  occurrence named `K` (`K#0`, `K#1`, …, positional). Each argument of K is classified:
  - computable on the server (literals, C's wire props, the server root's question value and locals derived from
    them): a **slot argument**, which must be a scalar in v1;
  - exactly `props.p` with `p` a through prop of C: resolved in the fill at S, as D's argument expression for `p`;
  - anything else (for example a mix of a server value and a through prop): C is not eligible (PL-3a, recorded as
    `PL-5`).

  A K with M1 (local state) under a `for` inside the server subtree makes C not eligible. The all-client program
  recreates such a row's K on every landing (fresh records keyed by identity), while a positional slot keeps it, so
  the island's state would diverge.
- **PL-6 (inline).** A site of a server-eligible K inside a server subtree renders on the server, inside the same
  frame. In v1 an inline K may own no question: the all-client program would ask it as a separate request.
- **PL-7 (one function per component and question).** The root of C sinking or owning a question over `f` is served
  by `C$server`. A second root of C over a different `f'` gets `C$server$2`, and so on, in site order. Two roots of C
  over the same `f` share one function: different arguments give different addresses.
- **PL-8 (actions and server functions).** Actions stay client. An action's `await f(…)` of a server fn is a request
  (SF-2c), encoded as Solid encodes it. The inference never invents a server function for an action. The only server
  functions it adds are the `C$server` wrappers.
- **PL-9 (server hosts).** `server` JS stays where RX already confines it: server fn bodies (SF-5a, `SERVER_ONLY`).
  A server component reaches server data only through server fns, called in process on the server.

### 4.4 How data crosses

| What | Direction | Encoding at rc.21 | v1 |
| --- | --- | --- | --- |
| Server-root parameters (the sunk or owned question's arguments) | client → server | server-function request body: format `1` (one string), `8` (JSON list) | wire scalars and records; Rust decodes `1` and `8`, and refuses `0` with a diagnostic (the subset never produces it) |
| Server markup | server → client | `""` / `hole:` records (html, NoHydration), and inline `<solid-frame>` at t=0 | as Solid emits it |
| Slot arguments | server → client | inline in `slot:<k>` records; non-primitives as `data` records + `$ref`; at t=0 `_$HY.r["sc:slot:…"]` | scalars only (structured slot arguments are a follow-up) |
| Through props (actions, client values) | never cross | the fill closure at the client site | as Solid does |
| Action calls to server fns | client → server → client | data responses: format `1` (string), `8` (JSON), thrown → sanitized (SV-5b) | as Solid emits it |
| Failures | server → client | a thrown server-root body makes the call reject, so the client's `errored` above the site shows its fallback, as it would for the all-client question | generic `Error` only (declared classes, SV-5a, are a follow-up) |

### 4.5 The rules on the slice app (section 5)

| Site | Decision | Why |
| --- | --- | --- |
| `<Summary open={open}/>` in Tracker | **server root** `Summary$server()` | no marks; `open` = `await loadSummary()` is read only by this site's `prop` computation (CP-6 computation 21), so it is sunk; one question; no other props |
| `<Detail issue={issue} take={take}/>` in Tracker | **server root** `Detail$server(selected)` | no marks; `issue` = `await loadIssue(selected)` is read only by this site's prop (computation 25), so it is sunk; `take` is a through prop used only as `ClaimButton`'s argument `props.take` |
| `<ClaimButton …/>` in Detail | **island** `ClaimButton#0` | it has a handler (M2); `id` and `assignee` are server values (scalars), so they are slot arguments; `take` is through |
| Tracker (entry) | client | entry; sources, handlers, an action |
| `issues` (`loadList`) | client question | read by the `visible` memo and a `for`, so not sinkable; its data crosses as JSON |

`refresh issue` and `refresh open` in `take` become `refresh` of the two call memos.

### 4.6 Refused by the v2.2 builder (diagnostics; the program gets no plan)

| Code | Form |
| --- | --- |
| `FRAMES_SERVER_FN_BODY` | a server fn body outside `let x = await h(…)`* `return e` (an `if`, a loop, `throw`, `try`, a non-await `let`) |
| `FRAMES_WRAPPED_SERVER_FN` | `GET(server fn …)`, `live`, other wrappers (SF-1d) |
| `FRAMES_CLIENT_JS` | `client` JS imports (SF-5b client questions) |
| `FRAMES_WIRE_TYPE` | a server fn parameter or result, or a server host signature, outside the wire grammar |
| `FRAMES_ERROR_CLASS` | declared error classes crossing (SV-5a `$class`) |
| `FRAMES_CHILDREN` | `props.children`, JSX-valued props |
| `FRAMES_EVAL_PLACE` | eval sites with `place` (EVAL.md keeps it refused) |
| `FRAMES_MODULES` | more than one RX module; cross-module components; recursive components |
| `FRAMES_SITE_AMBIGUOUS` | a server fn awaited at more than one site (the scenario addresses requests by site; see 6.3) |

Everything else either places (4.3) or stays client with a recorded `PL-*` reason.

---

## 5. The slice-6 app: `slices/tracker-frames/`

### 5.1 Authored, placement-free RX (`tracker-frames.rx`; checks clean at `fdbcad9`)

```rx
import { getIssue, listIssues, countOpen, assignIssue } from "./db";

server fn loadList() { let xs = await listIssues(); return xs; }
server fn loadIssue(id: number) {
  let i = await getIssue(id);
  return { id: i.id, title: i.title, body: i.body, assignee: i.assignee };
}
server fn loadSummary() { let n = await countOpen(); return n; }
server fn claim(id: number) { let who = await assignIssue(id); return who; }

component ClaimButton(props) {
  <button onClick={() => { props.take(props.id) }}>{props.assignee == "" ? "take" : "taken by " + props.assignee}</button>
}
component Detail(props) {
  <article><h2>{props.issue.title}</h2><p>{props.issue.body}</p><ClaimButton id={props.issue.id} assignee={props.issue.assignee} take={props.take} /></article>
}
component Summary(props) { <p>{"" + props.open + " open"}</p> }

export default component Tracker() {
  source mode := "all";
  source selected := 1;
  source status := "";
  issues = await loadList();
  issue = await loadIssue(selected);
  open = await loadSummary();
  visible = filter(issues, row => mode == "all" || row.assignee == "");
  action take(id: number) {
    try {
      let who = await claim(id);
      refresh issues; refresh issue; refresh open;
      status := "Assigned #" + id + " to " + who;
    } catch (e) { status := "Could not assign #" + id; }
  }
  <section>
    <button onClick={() => { mode := mode == "all" ? "open" : "all" }}>{"Filter: " + mode}</button>
    {errored fallback(e) { <p>Could not load</p> } {
      loading fallback { <i>Loading…</i> } {
        <Summary open={open} />
        for row in visible { <p>{row.title}<button onClick={() => { selected := row.id }}>show</button></p> }
        <Detail issue={issue} take={take} />
      }
    }}
    <em>{status}</em>
  </section>
}
```

`db.d.rx`:

```
export server pure fn getIssue(id: number): { id: number, title: string, body: string, assignee: string }
export server pure fn listIssues(): { id: number, title: string, assignee: string }[]
export server pure fn countOpen(): number
export server fn assignIssue(id: number): string
```

### 5.2 Authored TSX (`tracker-frames.tsx`)

This is the frontend's new frames tier. It is also the **all-client native twin**: it runs on Solid as written.

- Module-level `async function loadIssue(id: number) { "use server"; … }`, and the same for the other three server fns.
- `ClaimButton`, `Detail` and `Summary` as plain components with typed props.
- `Tracker` with `createSignal`, `createMemo(() => loadIssue(selected()))`, `action(function* (id) { try { const who =
  yield claim(id); refresh(issues); refresh(issue); refresh(open); setStatus(…) } catch { … } })`, and `<Errored>` /
  `<Loading>` / `<For>`.
- Text holes are coerced as in the canonical twins of earlier slices (`{"" + (c ? a : b)}`).

The probe's `src/AppTwin.tsx` is this program with the server fns in a sibling module.

### 5.3 Native explicit split (the oracle): `tracker-frames.server.tsx` + `tracker-frames.split.tsx`

```tsx
// tracker-frames.server.tsx: the four authored server fns as "use server" functions, plus:
export async function Detail$server(selected: number) {
  "use server";
  const issue = await loadIssue(selected);        // direct in-process call on the server
  return (props: { ClaimButton: Slot<{ id: number; assignee: string }> }) => (
    <article><h2>{issue.title}</h2><p>{issue.body}</p><props.ClaimButton id={issue.id} assignee={issue.assignee} /></article>
  );
}
export async function Summary$server() {
  "use server";
  const open = await loadSummary();
  return () => <p>{"" + open + " open"}</p>;
}

// tracker-frames.split.tsx (client): ClaimButton as authored, and in Tracker:
const issue = createMemo(() => Detail$server(selected()));   // takes the place of the sunk `issue`
const open = createMemo(() => Summary$server());             // takes the place of the sunk `open`
const Detail = dynamicComponent(() => issue());
const Summary = dynamicComponent(() => open());
// …
<Summary />
<For each={visible()}>{(row) => <p>{row.title}<button onClick={() => setSelected(row.id)}>show</button></p>}</For>
<Detail ClaimButton={(p) => <ClaimButton id={p.id} assignee={p.assignee} take={take} />} />
```

These are the probe's `src/panel.tsx` and `src/App.tsx`, which ran at the pin (2.6).

### 5.4 Its placement table: what G1 compares

```json
{ "version": 1,
  "client": [{ "component": "Tracker", "reason": "entry" }, { "component": "ClaimButton", "reason": "M2" }],
  "server": [
    { "component": "Detail", "fn": "Detail$server", "site": ["Tracker", 0, 1, 0, 2],
      "question": { "memo": "issue", "kind": "sunk", "serverFn": "loadIssue", "args": [{ "op": "read", "source": "selected" }] },
      "props": { "issue": "question", "take": "through" }, "inline": [],
      "slots": [{ "name": "ClaimButton", "component": "ClaimButton", "args": ["assignee", "id"], "through": ["take"] }] },
    { "component": "Summary", "fn": "Summary$server", "site": ["Tracker", 0, 1, 0, 0],
      "question": { "memo": "open", "kind": "sunk", "serverFn": "loadSummary", "args": [] },
      "props": { "open": "question" }, "inline": [], "slots": [] } ],
  "serverFns": ["claim", "loadIssue", "loadList", "loadSummary"],
  "serverHosts": ["assignIssue", "countOpen", "getIssue", "listIssues"] }
```

The table is canonical JSON: sorted keys, sorted name lists, and site paths as view indices from the component's
markup root. The emitter writes it from RX and from TSX. A separate extractor reads it from the native split, with
`oxc-parser` plus `transformDirectives`' function list:

- `"use server"` functions whose body returns a function are server components;
- their slot names and arguments come from the props used in component position;
- the client sites are `dynamicComponent(() => m())` with `m = createMemo(() => fn(args))`;
- the fills' through arguments are read from the fill expressions;
- server hosts are the imports of server-only modules.

### 5.5 Scenario (`tracker-frames.scenario.json`, format 2.2)

Server hosts read a deterministic table: issues 1 "Crash on save" / "Stack trace attached" / "", 2 "Slow search" /
"p95 is 4s" / "ana", 3 "Typo in footer" / "'Copyrigth'" / "".

A holding proxy forwards every request to the server at once, in the page's issue order (a sequence header the page
prelude adds and the proxy removes), and holds each response until a `deliver` step. Steps address requests by their
**site** (a question memo, or an action's await), not by wire function, so one scenario drives every placement.

| # | step | frame after the step | requests (site → wire) |
| --- | --- | --- | --- |
| 0 | mount: t=0 document; hydrate after the last chunk | `Filter: all2 openCrash on saveshowSlow searchshowTypo in footershowCrash on saveStack trace attachedtake` | none at boot. Server host log from the render: `listIssues`, `getIssue 1`, `countOpen` |
| 1 | click `Filter: all` (client island) | `Filter: open2 openCrash on saveshowTypo in footershowCrash on saveStack trace attachedtake` | none |
| 2 | click `Filter: open` | step 0's frame | none |
| 3 | click `show` in "Slow search" | unchanged (held) | `issue#2 [2]` → `Detail$server` (split) / `loadIssue` (twin) |
| 4 | deliver `issue#2` | `…Slow searchp95 is 4staken by ana` | |
| 5 | click `show` in "Typo in footer", then deliver `issue#3` | `…Typo in footer'Copyrigth'take` | `issue#3 [3]` |
| 6 | click `take`: the island inside the server component | unchanged | `take/claim#1 [3]` (server-function call) |
| 7 | deliver `take/claim#1` | unchanged (the transaction holds) | `issues#2`, `issue#4 [3]`, `open#2` (the refreshes) |
| 8–10 | deliver `open#2`, `issues#2`, `issue#4` (in this order) | unchanged until the last, then `Filter: all1 open…Typo in footer'Copyrigth'taken by meAssigned #3 to me` in **one** frame | |
| 11 | click `show` in "Slow search", deliver `issue#5` | `…Slow searchp95 is 4staken by ana…` | |
| 12 | click `take`, deliver `take/claim#2` **rejected** by the answer script (`assignIssue` throws a plain `Error`) | `…Could not assign #2` (SV-5b: the client sees the generic error; the catch writes the status) | |

Rows 0–5 and 8–10 were observed in the probe, with immediate delivery. Rows 3, 6 and 7 (held responses) and row 12 are
the planned scenario. Its frames will be recorded from the all-client twin and must be reproduced by every leg.

---

## 6. Gate definition

### 6.1 Legs

| Leg | What runs |
| --- | --- |
| **T** (all-client twin) | `tracker-frames.tsx` on Solid. Document SSR with its questions answered in process, hydrated in Chromium; requests to Solid's `handleServerFunctionRequest` |
| **N** (native split, the oracle) | `tracker-frames.{server,split}.tsx` on Solid's server, Solid's client in Chromium |
| **J** (inferred, Solid) | The plan v2.2 emitted from RX (and from TSX: byte-identical plans), lowered by the JS consumer (`plan/split.ts`) to the canonical split TSX, on Solid's server and client |
| **R** (inferred, Rust) | rust-solid serves the document, the frame streams and the server-function endpoint from the same plan. The client is Solid's build of J's client half, in Chromium |
| **U** (universal legs) | The plan with its placement annotations ignored (the twin's semantics, server fns as scenario-settled requests) on the existing four legs: native, compiled RX, `solid-plan.ts`, Rust `plan-trace`. This covers components, props and actions with full renderer host logs |

Chromium runs Solid's production client builds, with a dev-build pass as in slice 5 (key misses, unclaimed nodes and
structure mismatches fail the run). Every console error or warning fails a run. Nothing is filtered or normalized; each
comparison below is between artifacts each leg writes in the same format.

### 6.2 G1: placement

`placement(RX)` == `placement(TSX)` == `extract(N)`, byte for byte (5.4). The plan's own `placement` block must equal
the table recomputed from the rest of the plan, or the consumers refuse the plan.

### 6.3 G2: bytes, Solid against Rust

For every request of the scenario and for the t=0 document, R equals N and J: same status, same handler-emitted
headers in order, same body bytes. A frame stream is compared as its chunk sequence, as flushed: message boundaries,
then bytes. This covers:

- the document: HTML, the inline `<solid-frame>`, the `sc-` hydration keys, and the hydration script with `_$SC`,
  `sc:live`, `sc:slot:*` and `sc:deps:*`;
- every frame stream: the `start`, `slot:*`, `""` (+ digest) and `:complete` records;
- every data response;
- the `403` of a cross-origin request.

N and J must also be equal to each other, which shows the canonical split is the oracle's program.

### 6.4 G3: client behaviour

Each leg writes:

- (a) the frame after every step: `#app` text, scripts and templates excluded, the slice 5 definition;
- (b) the client request log: `site, call, wire id, args, outcome`, one row per request in issue order;
- (c) the server host log: `step, host, args, outcome`, each server-host call attributed to the scenario step whose
  request (or document render) caused it;
- (d) the DOM serialization of `#app` after every step.

Comparisons:

- **N = J = R**: (a), (b), (c) and (d) equal.
- **N against T**: (a) equal at every step, and (c) equal. For (b), the `site, call, args, outcome` columns are equal.
  The wire id differs by construction: `issue` is `Detail$server` in N and `loadIssue` in T. This is the
  placement-dependent part, and the placement table states it.

The full list of placement-dependent artifacts, compared only between split legs:

- the wire id column of (b);
- data-versus-frame response bodies;
- (d), because `<solid-frame>`, the slot markers and the missing `_hk` inside server-owned output are not
  frame-visible;
- the t=0 document bytes (T serializes answers, N serializes `_$SC` references).

Any other difference is a divergence. The inference keeps placement-dependent behaviour out by construction:

- request parity (PL-3c, PL-3d): one request where the twin makes one;
- staged refetches inside actions (C15): one frame where the twin's transaction lands in one frame;
- PL-5's row rule: no island state that the twin would reset.

Each of these has a pin test: a minimal program, forced to server placement by a test-only override, shows the frame
or request difference that the rule prevents.

**Host logs.** The renderer host log of client components and islands (createElement, insert, …) is compared on the U
legs, which run the twin's semantics on the recording universal host. The web legs have no renderer log: the frames
client builds server-owned DOM by parsing and morphing HTML.

### 6.5 G4: zero client JS for server-only components

For each component whose every site is server-placed (Detail and Summary here), checked on the page's module graph:
the set of JS modules Chromium fetched, recorded from the network log, with the import-map setup of slice 5 and no
bundler.

- The client compile of the server module is exactly `createServerReference("<id>")` declarations and their exports.
  The test pins its text.
- No fetched module contains the component's compiled template strings. The test computes them from the server
  compile of the component.
- No server-only host module (`./db`) is fetched.
- The twin's graph does contain the templates. This control shows the measurement can fail.

### 6.6 Existing gates

- `npm run verify:subset` stays green. It rises from 131 by the new tests: the tracker-frames slice (G1, G2, G3 against
  N and T, G4), the frames-tier TSX boundary tests, the v2.2 emitter tests (equal emission, the saved plan, refusals,
  "no placement emits v2.1/v2 byte for byte"), the PL pin tests, the U-leg tests and placement-fuzz seeds 1..100.
- `cargo test` rises from 166 with none deleted: unit tests of `createChunk`, `textDigest`, `frameAddress`, the
  request codec and CSRF; frame-sink fixtures; t=0 document fixtures; the server-function endpoint fixtures.
- Every recorded fuzz summary stays byte-identical. The v2.2 builder runs only under the frames opt-in, and a program
  without a v2.2 form is emitted as before.
- fmt, clippy `-D warnings` and `git diff --check` stay clean.

---

## 7. Fuzz plan

`plan/fuzz/gen.ts` gains a `frames` family. Its programs have:

- a client root;
- 1–3 server fns over a seeded server-host table (list, record and scalar loaders; one or two io mutators);
- questions in the root over server fns;
- 1–4 child components with props, applied in the root, some in Show branches.

Their shapes are chosen to exercise every PL rule:

- sinkable questions, and questions read by both a prop and a memo (not sinkable);
- owned questions over props;
- two questions in one component (PL-3c);
- props read directly by markup from client state (PL-3d);
- handlers (M2), sources (M1), probes (M4);
- islands with through actions, mixed island arguments (PL-5), stateful islands under a server `for` (PL-5);
- inline components (PL-6), static components (minimal-request);
- actions with `refresh`/`affects` of sunk questions, filters and arg changes while requests are held;
- server-host rejections.

Each program is printed four ways: placement-free RX, placement-free TSX (the twin), `db.d.rx`, and an **explicit
split TSX from the generator's own placement model**. That model is written separately from `plan/placement.ts`, from
4.3 as a specification, so G1 compares two independent implementations.

Per seed:

1. Emit v2.2 from RX and TSX: identical plans or identical refusals. The inferred placement must equal the
   generator's.
2. Record the scenario on T. The chooser picks clicks from the live clickables and `deliver` steps (resolve, or a
   server-host rejection through the answer script) from the held requests, in any order, then delivers everything
   left.
3. Replay on T, N, J and R (Chromium), and on the four U legs.
4. Compare G2, G3 and G4 as in section 6.

Outcomes, as in the earlier fuzzes:

- `agree`;
- `refused` (counted by diagnostic code);
- `client-only` (the inference placed nothing on the server; counted by `PL-*` reason);
- `invalid` (native Solid fails);
- `generator-bug`;
- `divergent`.

Runs: seeds 1..1000 and 1001..3000 held out, summaries recorded under `.out/frames-fuzz/` with rust-solid copies under
`docs/frames-fuzz/`. The gate runs seeds 1..100. Earlier summaries are not touched.

---

## 8. Plan v2.2 schema additions (additive)

A plan is `"version": 2.2` when any form below occurs; otherwise the v2.1 or v2 plan is emitted byte for byte. A
consumer that does not know 2.2 refuses it by its version. **Placement is annotation over an all-client plan.** A
consumer that ignores `place`, `sunk`, `serverComponents` and `placement` runs the twin, which is how the U legs run.
A placement-aware consumer derives the split.

```json
{ "version": 2.2, "component": "Tracker",
  "hosts": [],
  "serverHosts": [
    { "name": "getIssue", "params": ["number"], "returns": "{ id: number, title: string, body: string, assignee: string }", "pure": true },
    { "name": "assignIssue", "params": ["number"], "returns": "string" } ],
  "serverFns": [
    { "name": "loadIssue", "id": "loadIssue-<xxh32>", "params": [{ "name": "id", "type": "number" }],
      "returns": "{ id: number, title: string, body: string, assignee: string }",
      "steps": [{ "op": "await", "serverHost": "getIssue", "args": [{ "op": "local", "name": "id" }], "bind": "i" },
                { "op": "return", "value": { "op": "object", "fields": [ … ] } }] },
    { "name": "claim", "id": "claim-<xxh32>", "io": true, "params": [ … ], "returns": "string", "steps": [ … ] } ],
  "components": [
    { "name": "Detail", "props": [{ "name": "issue", "type": "{ id: number, title: string, body: string, assignee: string }" }, { "name": "take", "type": "action" }],
      "sources": [], "memos": [], "actions": [],
      "markup": [{ "kind": "element", "tag": "article", "events": [], "children": [
        { "kind": "element", "tag": "h2", "events": [], "children": [{ "kind": "text", "value": { "op": "get", "object": { "op": "prop", "name": "issue" }, "key": "title" } }] },
        …,
        { "kind": "component", "name": "ClaimButton", "props": [
          { "name": "id", "value": { "op": "get", "object": { "op": "prop", "name": "issue" }, "key": "id" } },
          { "name": "assignee", "value": { … } },
          { "name": "take", "forward": "take" } ] } ] }] } ],
  "memos": [
    { "name": "issue", "await": { "serverFn": "loadIssue", "args": [{ "op": "read", "source": "selected" }] }, "sunk": "Detail$server" } ],
  "actions": [{ "name": "take", "params": ["id"], "steps": [
    { "op": "try", "body": [{ "op": "await", "serverFn": "claim", "args": [{ "op": "local", "name": "id" }], "bind": "$await0" },
                           { "op": "refresh", "source": "issues" }, { "op": "refresh", "source": "issue" }, … ], "catch": [ … ] } ] }],
  "markup": [ …, { "kind": "component", "name": "Detail", "props": [
      { "name": "issue", "value": { "op": "read", "source": "issue" } }, { "name": "take", "action": "take" } ],
      "place": "server", "server": "Detail$server" } ],
  "serverComponents": [
    { "name": "Detail$server", "id": "Detail$server-<xxh32>", "component": "Detail", "params": ["number"],
      "question": "issue", "slots": [{ "name": "ClaimButton", "view": [0, 2], "args": ["id", "assignee"], "through": ["take"] }] } ],
  "placement": { …the table of 5.4… } }
```

New keys and kinds:

- **Top level.**
  - `serverHosts[]`: `server` JS, from `.d.rx` `export server [pure] fn`.
  - `serverFns[]`: `name`, wire `id`, typed `params`, `returns`, `io?`, and `steps` from the v1 subset: `await` of a
    `serverHost` or a `serverFn` with `bind`, then `return`.
  - `components[]`: the non-entry components. Each has typed `props`, where a type is a wire type or `"action"`, and
    the v2 `sources`/`memos`/`actions`/`markup`.
  - `serverComponents[]`.
  - `placement`.
- **Expressions.** `{ "op": "prop", "name" }`: a prop read through the props getter, tracked in reactive contexts.
- **Views.** `{ "kind": "component", "name", "props": [{ "name", "value": Expr } | { "name", "action" } | { "name",
  "forward" }] }` as `createComponent(C, { get name() {…} })`, the compiler's output. Optional `place: "server"` and
  `server: <serverComponent name>`.
- **Async memo.** `await.serverFn` is a new key beside v2.1's `await.host`. The question is a request to the server
  function. `sunk` names the server component whose call replaces it under placement.
- **Action step.** `{ "op": "await", "serverFn", "args", "bind" }` beside v2.1's `host` form.
- **Ids.** The emitter takes every wire `id` from Solid's `transformDirectives` on the canonical split's fixed module
  paths (`src/<stem>.server.tsx` under the slice root). The consumers use them verbatim.

The scenario format 2.2 adds `deliver` steps addressed by site and call (`issue#2`, `take/claim#1`) and a
server-host answer script (`host, call, args → value | reject`), recorded from N. R replays it, and a call that does
not match it fails the run, as slice 5's answer scripts do.

---

## 9. Implementation plan (for the background workers; not started)

Each phase is a tracer bullet with its own gate tests.

1. **Oracle harness (frontend, JS only).** `frontend/frames/`:
   - the Node server: handler, document render, favicon;
   - the holding proxy with sequenced forwarding;
   - the Chromium driver with the import-map page and the frames client tiers mapped;
   - the four logs, and G4's module-graph check;
   - `slices/tracker-frames/` with T and N, the scenario recorded on T, and N = T on frames and server host log.

   This is 2.6's probe made deterministic, with nothing inferred yet.
2. **Inference and the JS consumer.**
   - The TSX frames tier: `"use server"` lowered to RX `server fn`, `server` imports, components with props in plans.
   - `plan/resolve-v2.ts` v2.2: components, server fns.
   - `plan/placement.ts`: PL rules → table, with reasons.
   - `plan/split.ts`: plan → canonical split TSX.
   - The placement extractor for N.
   - G1, then J = N.
   - The U legs for v2.2 in `solid-plan.ts` and rust-solid's `plan-trace` (components, props, server-fn requests),
     without placement.
3. **Rust, the endpoint and frames.** Structural ports, each with `// Solid: file.ts:lines` comments:
   - `shared.ts` `createChunk`, `textDigest`, `frameAddress`/`hashArguments`/`stableString`, `BodyFormat`;
   - `server.ts` `handleServerFunctionRequest`: dispatch for `/_server/data/<id>`, the CSRF decision, decoding of
     formats `1`/`8`, and `encodeResult` for formats `1` and `8`, void and thrown-sanitized;
   - `frame-sink.ts`: `createFrameSink` batching, `renderServerComponent`, `createSlotProps`, `serverOwned`
     (NoHydration), `frameTransformResult`/`serverComponentResponse` headers.

   G2 on the frame and data responses.
4. **Rust, the t=0 document.**
   - `frameTransformDirectResult` and `createDocumentSlotProps`: inline `<solid-frame>`, slot fills with `sc-` keys
     under `Hydration`.
   - `ServerComponentPlugin` and `SERVER_COMPONENT_BOOTSTRAP` in the seroval port.
   - The `sc:live` stream and the `sc:slot`/`sc:deps` records.
   - Lifting `ssr.rs`'s refusal of `</head>` / `<!--xs-->` for the document face.

   G2 on the document; R hydrates.
5. **Fuzz** (section 7): the generator's independent placement model, the five-leg runner, summaries, and gate seeds.

## 10. Risks and open decisions

- **Experimental surface.** rc.21's frames are excluded from the 2.0 stability guarantee, and upstream `8138dabe`
  already changes `frame-sink.ts`. Recorded bytes stay at the pin. A repin regenerates fixtures, and that is the
  user's call.
- **Known reds in Solid's own contract** (`frames-consistency-contract.md`, "Red on next", 2026-10-05: R1–R10, among
  them R5 on held slot records and R8 on the shell-gate address). Some may be fixed by rc.21. A slice-6 divergence
  that reproduces on N alone, with nothing of ours in it, is a Solid finding for `docs/scratch/solid-rc21-issues.md`
  and is not worked around.
- **Decisions for the user, two at a time:**
  1. Accept the minimal-request rule: a server-eligible component with no server data stays client. The alternative
     is placing every eligible component on the server, which costs a request per static piece on navigation.
  2. Accept request parity: one question per server root; a site whose markup reads client state stays client. The
     alternative is allowing merges and documenting their request-count difference as placement-dependent.
  3. v1 restrictions to lift later: structured slot arguments (port the `data`-record path), `props.children`/JSX
     slots, server roots in client rows, owned questions in inline components, declared error classes, server
     `Loading` inside frames (segments).

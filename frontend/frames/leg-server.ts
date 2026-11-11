// A frames leg's server (docs/RESULTS.md, "Slice 6"): Solid's own server for one compiled program, in a process of
// its own (fresh registry, fresh host table). Run with plain Node conditions, so `@solidjs/web`, `solid-js` and
// `@solidjs/web/frames` resolve to their server builds (production). The wiring is @solidjs/vite-plugin's Start mode
// (src/server-functions/index.ts, src/ssr/index.ts), written by hand:
//   configureServerFunctionsServer({ provideEvent: provideRequestEvent, transformResult: frameTransformResult,
//                                    transformDirectResult: frameTransformDirectResult })
//   renderToStream(() => createComponent(App, {}), { plugins: [ServerComponentPlugin] }) inside provideRequestEvent
// plus one observation hook, `wrapInvocation`, that records which server functions the document render called (the
// outermost ones: the questions answered at t=0), so the harness can number the client's later calls per site. It
// returns `run()` unchanged.
//
// Usage: node frames/leg-server.ts BUILD_DIR ENTRY   (ENTRY: the server module, under BUILD_DIR, whose default export is
// the app). Prints `{"port":N}` on its first stdout line. Endpoints:
//   GET /            the document: `<!doctype html><html><head>` + generateHydrationScript() + `</head><body><div
//                    id="app">` + the stream + `</div></body></html>`
//   * /_server/...   handleServerFunctionRequest, its response streamed as Solid produces it
//   GET /__log       { hosts: the server host log, document: the document render's outermost server-function calls,
//                    wire: every response this server gave (document and /_server), as the handler produced it: status,
//                    headers in the Response's order, body chunks in flush order. G2 compares these records, never what
//                    the HTTP transport added (Node's Date is off; Connection and framing are transport). }
import { createServer, type IncomingMessage } from 'node:http';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
// @ts-ignore: the server builds have no types under this package's conditions
import { renderToStream, generateHydrationScript } from '@solidjs/web';
// @ts-ignore
import { createComponent } from 'solid-js';
// @ts-ignore
import { handleServerFunctionRequest, configureServerFunctionsServer } from '@solidjs/web/server-functions';
// @ts-ignore
import { frameTransformResult, frameTransformDirectResult, ServerComponentPlugin } from '@solidjs/web/frames';
// @ts-ignore
import { provideRequestEvent } from '@solidjs/web/storage';

const [dir, entry] = process.argv.slice(2);
if (!dir || !entry) throw new Error('usage: leg-server.ts BUILD_DIR ENTRY');
const documentCalls: { id: string; args: unknown[] }[] = [];
let rendering = false;
const INNER = Symbol.for('frames.inner');
configureServerFunctionsServer({
  provideEvent: provideRequestEvent,
  transformResult: frameTransformResult,
  transformDirectResult: frameTransformDirectResult,
  wrapInvocation: (run: () => unknown, ctx: { id: string; args: unknown[]; event: any; direct: boolean }) => {
    // A nested call's event is spread from its caller's, so the mark reaches every call made inside this one.
    if (ctx.direct && rendering && !ctx.event[INNER]) documentCalls.push({ id: ctx.id, args: structuredClone(ctx.args) });
    ctx.event[INNER] = true;
    return run();
  },
});
const App = (await import(pathToFileURL(resolve(dir, entry)).href)).default;
const hostLog = ((globalThis as any).__framesHostLog ??= []) as unknown[];
type Wire = { method: string; path: string; body: string; status: number; headers: [string, string][]; chunks: string[] };
const wire: Wire[] = [];
// The requests behind the wire records, one for one: method, target, header pairs (lowercased names, arrival order) and
// body. Not part of any comparison (rust's /__log has none); scripts/frames-corpus.ts writes them into rust-solid's
// fixtures, which replay them against the Rust server without Node.
type Incoming = { method: string; target: string; headers: [string, string][]; body: string };
const incoming: Incoming[] = [];
const incomingOf = (req: IncomingMessage, body: string): Incoming => {
  const headers: [string, string][] = [];
  for (let i = 0; i < req.rawHeaders.length; i += 2) headers.push([req.rawHeaders[i].toLowerCase(), req.rawHeaders[i + 1]]);
  return { method: req.method ?? '', target: req.url ?? '/', headers, body };
};

const server = createServer(async (req, res) => {
  res.sendDate = false;
  try {
    const url = new URL(req.url ?? '/', 'http://' + req.headers.host);
    if (req.method === 'GET' && url.pathname === '/') {
      const request = new Request(url, { headers: req.headers as Record<string, string> });
      rendering = true;
      const body = await provideRequestEvent({ request, locals: {} }, () => new Promise<string>((done, fail) => {
        let out = '';
        try {
          renderToStream(() => createComponent(App, {}), { plugins: [ServerComponentPlugin], onError: fail })
            .pipe({ write(chunk: string) { out += chunk; }, end() { done(out); } });
        } catch (e) { fail(e); }
      }));
      rendering = false;
      const html = '<!doctype html><html><head>' + generateHydrationScript() + '</head><body><div id="app">' + body + '</div></body></html>';
      wire.push({ method: 'GET', path: '/', body: '', status: 200, headers: [['content-type', 'text/html; charset=utf-8']], chunks: [html] });
      incoming.push(incomingOf(req, ''));
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }
    if (req.method === 'GET' && url.pathname === '/__log') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ hosts: hostLog, document: documentCalls, wire, incoming }));
      return;
    }
    if (url.pathname.startsWith('/_server')) {
      const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
      const headers = new Headers();
      for (let i = 0; i < req.rawHeaders.length; i += 2) headers.append(req.rawHeaders[i], req.rawHeaders[i + 1]);
      const sent = hasBody ? Buffer.concat(await Array.fromAsync(req as AsyncIterable<Buffer>)) : undefined;
      const request = new Request(url, { method: req.method, headers, ...(sent ? { body: sent } : {}) });
      const response: Response = await handleServerFunctionRequest(request);
      const record: Wire = { method: req.method ?? '', path: url.pathname + url.search, body: sent ? sent.toString('utf8') : '', status: response.status, headers: [], chunks: [] };
      wire.push(record);
      incoming.push(incomingOf(req, record.body));
      const raw: string[] = [];
      response.headers.forEach((v, k) => { raw.push(k, v); record.headers.push([k, v]); });
      res.writeHead(response.status, raw);
      const decoder = new TextDecoder();
      if (response.body) for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
        record.chunks.push(decoder.decode(chunk, { stream: true }));
        res.write(chunk);
      }
      const tail = decoder.decode();
      if (tail) record.chunks.push(tail);
      res.end();
      return;
    }
    res.writeHead(404); res.end();
  } catch (e) {
    rendering = false;
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('leg server error: ' + String((e as Error)?.stack ?? e));
  }
});
server.listen(0, '127.0.0.1', () => console.log(JSON.stringify({ port: (server.address() as { port: number }).port })));

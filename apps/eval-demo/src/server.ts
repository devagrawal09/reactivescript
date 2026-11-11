// The demo server: POST /eval takes ReactiveScript as a text body, checks it against the page's bindings, keeps it in
// the history and pushes it to every open page over Server-Sent Events. Bound to localhost only.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { compileEval } from '../../../frontend/eval/compile.ts';
import { INTERFACE } from './interface.ts';
import { createHistory, submission, type Entry, type History, type Submission } from './history.ts';

export const check = (s: Submission) => {
  const r = compileEval({ code: s.code, interface: INTERFACE, syntax: s.syntax, ...(s.type ? { type: s.type } : {}) });
  return r.ok ? { ok: true, diagnostics: r.warnings, ...(s.syntax === 'tsx' ? { plan: r.plan } : {}) } : { ok: false, diagnostics: r.diagnostics };
};

const MAX_BODY = 64 * 1024;
const body = (req: IncomingMessage) => new Promise<string>((resolve, reject) => {
  let size = 0; const chunks: Buffer[] = [];
  req.on('data', (c: Buffer) => { size += c.length; if (size > MAX_BODY) { reject(new Error('body over 64 KiB')); req.destroy(); } else chunks.push(c); });
  req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  req.on('error', reject);
});
const json = (res: ServerResponse, status: number, value: unknown) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(value));
};
const sse = (res: ServerResponse, event: string, data: unknown) => res.write('event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n');

export type Assets = { html: string; js: () => string };

export function createApp(history: History, assets: Assets) {
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    try {
      if (req.method === 'POST' && url.pathname === '/eval') {
        const s = submission(await body(req), url.searchParams);
        if ('error' in s) return json(res, 400, s);
        const e: Entry = history.add(s);
        return json(res, e.ok ? 201 : 422, e);
      }
      if (req.method === 'GET' && url.pathname === '/history') return json(res, 200, history.list());
      if (req.method === 'GET' && url.pathname === '/events') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
        sse(res, 'history', history.list());
        const off = history.subscribe(e => sse(res, 'entry', e));
        req.on('close', off);
        return;
      }
      if (req.method === 'GET' && url.pathname === '/') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(assets.html); }
      if (req.method === 'GET' && url.pathname === '/app.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); return res.end(assets.js()); }
      if (url.pathname === '/favicon.ico') { res.writeHead(204); return res.end(); }
      json(res, 404, { error: 'not found' });
    } catch (err) {
      json(res, 400, { error: err instanceof Error ? err.message : String(err) });
    }
  });
}

if (import.meta.url === 'file://' + process.argv[1]) {
  const port = Number(process.env.PORT ?? 4180);
  const dist = new URL('../dist/', import.meta.url);
  const assets: Assets = {
    html: readFileSync(new URL('../client/index.html', import.meta.url), 'utf8'),
    js: () => readFileSync(new URL('app.js', dist), 'utf8'),
  };
  createApp(createHistory(check), assets).listen(port, '127.0.0.1', () => {
    console.log('eval demo on http://127.0.0.1:' + port + '  (POST /eval, GET /history, GET /events)');
  });
}

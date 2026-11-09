// Solid's own server render of one TSX program, in a fresh worker thread with Node's default conditions, so that
// `solid-js` and `@solidjs/web` resolve to their production server builds (dist/server.js), not the client builds the
// rest of the suite loads with --conditions=browser. The TSX is compiled by Solid's compiler with
// { generate: "ssr", hydratable: true }; `renderToString(() => App())` renders it. Posts the HTML and Solid's
// generateHydrationScript() output, or the thrown error. Nothing is normalized.
import { parentPort, workerData } from 'node:worker_threads';
import { mkdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';
import { transform } from '@solidjs/compiler';

export type ServerInput = { tsx: string; hosts: string[]; dir: string };
export type ServerOutput = { html: string; script: string; compiled: string } | { error: string; compiled?: string };

const input = workerData as ServerInput;
let out: ServerOutput;
let compiled: string | undefined;
try {
  compiled = transform(input.tsx, { filename: 'App.tsx', generate: 'ssr', hydratable: true }).code;
  const js = stripTypeScriptTypes(compiled).replaceAll('"./api"', '"./api.server.mjs"');
  mkdirSync(input.dir, { recursive: true });
  // A host call during a server render would mean a handler or an action ran on the server: plan apps never do.
  writeFileSync(input.dir + '/api.server.mjs', input.hosts.map(h => 'export const ' + h + ' = () => { throw new Error("host ' + h + ' called during a server render"); };').join('\n') + '\n');
  writeFileSync(input.dir + '/app.server.mjs', js);
  const web = await import('@solidjs/web');
  if (web.isServer !== true) throw new Error('@solidjs/web resolved to its client build in the server leg');
  const App = (await import(pathToFileURL(input.dir + '/app.server.mjs').href)).default;
  const html = web.renderToString(() => App());
  out = { html, script: web.generateHydrationScript(), compiled };
} catch (e) {
  out = { error: String((e as Error)?.stack ?? e), compiled };
}
parentPort!.postMessage(out);

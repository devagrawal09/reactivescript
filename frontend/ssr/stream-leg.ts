// Slice 5, async data: Solid's own server renders of one TSX program with async data, in a fresh worker thread with
// Node's default conditions (the production server builds, dist/server.js), as server-leg.ts does for renderToString.
// The TSX is compiled by Solid's compiler with { generate: "ssr", hydratable: true }. The worker runs
//  1. renderToStream(() => App()).pipe(sink) under a server answer policy (stream-core.ts): a fixed script, or the SSR
//     fuzz's seeded chooser (every request gets an answer as it arrives: now or idle, a value of its host's type, or a
//     rejection for a host whose readers are all inside an <Errored>), and
//  2. renderToString(() => App()) (its host calls never settle),
// and posts the chunks, the event log, the realized answer script, the HTML and its requests, and Solid's
// generateHydrationScript() output. Nothing is normalized.
import { installTimers, renderStream, renderString, serverApiModule, timeoutsScheduled, type Policy, type ServerAnswer, type StreamResult, type StringResult } from './stream-core.ts';
installTimers();
import { parentPort, workerData } from 'node:worker_threads';
import { mkdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';
import { transform } from '@solidjs/compiler';
import { rng } from '../tsx/fuzz/gen.ts';
import type { AsyncHost } from '../plan/fuzz/gen-async.ts';

/** The SSR fuzz's server chooser: its seed and the program's hosts. */
export type ServerChooser = { seed: number; hosts: AsyncHost[] };
export type StreamLegInput = { tsx: string; hosts: string[]; dir: string; script?: ServerAnswer[]; chooser?: ServerChooser };
export type StreamLegOutput = {
  compiled?: string; script?: string;
  stream?: StreamResult | { error: string };
  string?: StringResult | { error: string };
  /** setTimeout calls the renders made (the Rust event loop has none: a render that uses one is not comparable). */
  timeouts?: number;
} | { error: string; compiled?: string };

const VALUES: Record<string, (string | number | boolean)[]> = { int: [0, 1, 2, 3, 5, 7], str: ['dev', 'ana', 'bo', '', 'me', 'a<b', 'x & y'], bool: [true, false] };
const TITLES = ['Crash', 'Slow', 'Typo', 'Docs', 'Leak', 'Build'];
const OWNERS = ['', 'ana', 'bo', 'dev'];

/** The chooser: each request is answered now (35%) or at an idle point; a rejectable query host rejects 15% of the
 *  time; a list host answers 0..4 records with distinct ids. Idle answers settle in a random order. */
export function serverChooser(c: ServerChooser): Extract<Policy, { pickIdle: unknown }> {
  const r = rng(c.seed * 7919 + 5);
  return {
    choose: q => {
      const h = c.hosts.find(h => h.name === q.host);
      if (!h) throw new Error('the server called ' + q.host + ', which is not a host of the program');
      const mode = r.chance(0.35) ? 'now' as const : 'idle' as const;
      if (h.rejectable && r.chance(0.15)) return { mode, error: r.pick(['offline', 'denied']) };
      if (h.scalar) return { mode, value: r.pick(VALUES[h.scalar]) };
      const ids = [1, 2, 3, 4, 5].filter(() => r.chance(0.55)).slice(0, 4);
      return { mode, value: ids.map(id => Object.fromEntries(h.rows!.map(f => [f.name, f.name === 'id' ? id : f.name === 'title' ? TITLES[(id + r.int(2)) % TITLES.length]
        : f.name === 'owner' ? r.pick(OWNERS) : f.ty === 'int' ? r.pick(VALUES.int) : f.ty === 'bool' ? r.chance(0.5) : r.pick(VALUES.str)]))) };
    },
    pickIdle: n => r.int(n),
  };
}

if (parentPort && workerData) {
  const input = workerData as StreamLegInput;
  let out: StreamLegOutput;
  let compiled: string | undefined;
  try {
    compiled = transform(input.tsx, { filename: 'App.tsx', generate: 'ssr', hydratable: true }).code;
    const js = stripTypeScriptTypes(compiled).replaceAll('"./api"', '"./api.server.mjs"');
    mkdirSync(input.dir, { recursive: true });
    writeFileSync(input.dir + '/api.server.mjs', serverApiModule(input.hosts));
    writeFileSync(input.dir + '/app.server.mjs', js);
    const web = await import('@solidjs/web');
    if (web.isServer !== true) throw new Error('@solidjs/web resolved to its client build in the server leg');
    const App = (await import(pathToFileURL(input.dir + '/app.server.mjs').href)).default;
    const policy: Policy = input.script ? { script: input.script } : serverChooser(input.chooser!);
    let stream: StreamResult | { error: string };
    try { stream = await renderStream(web, App, policy); } catch (e) { stream = { error: String((e as Error)?.stack ?? e) }; }
    let string: StringResult | { error: string };
    try { string = renderString(web, App); } catch (e) { string = { error: String((e as Error)?.stack ?? e) }; }
    out = { compiled, script: web.generateHydrationScript(), stream, string, timeouts: timeoutsScheduled() };
  } catch (e) {
    out = { error: String((e as Error)?.stack ?? e), compiled };
  }
  parentPort.postMessage(out);
}

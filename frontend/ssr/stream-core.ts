// Slice 5, async data (docs/RESULTS.md, "Slice 5: async data"; rust-solid docs/SSR.md, "Async data and streaming"):
// Solid's own server render of an app with async data, under a server answer script. This module is the render loop
// shared by the worker (stream-leg.ts) and the coverage study; it runs on the production server builds.
//
// The server's host calls are requests, numbered per host in call order. Each request gets an answer:
//  - `now`: the host returns a settled promise (`Promise.resolve(value)` / `Promise.reject(new Error(error))`), so the
//    answer is there before any microtask runs;
//  - `idle`: the host returns a pending promise, settled when the render is idle: no microtask and no timer Solid
//    scheduled (setTimeout, setImmediate) is left. Idle answers settle one per idle point, in the script's order (`at`).
// The timers are counted by wrapping the globals before Solid is imported (installTimers); nothing in Solid is changed.
// The event log interleaves the chunks the stream wrote, the settlements and the end: chunk boundaries are part of the
// verdict. renderToString runs too: its host calls return promises that never settle (it does not wait), and its
// requests are logged.
import type { HostValue, Scalar } from '../plan/fuzz/host.ts';

export type ServerAnswer = { host: string; call: number; args: Scalar[]; mode: 'now' | 'idle'; at?: number } & ({ value: HostValue } | { error: string });
export type StreamEvent = { chunk: string } | { settle: string } | { end: true };
export type StreamResult = {
  chunks: string[]; events: StreamEvent[]; answers: ServerAnswer[];
  /** `ended`: the stream ended. `stuck`: the render went idle with no idle answer left to give and did not end. */
  status: 'ended' | 'stuck';
};
export type StringResult = { html: string; requests: { host: string; call: number; args: Scalar[] }[] };

/** An answer policy: a fixed script, or a chooser deciding each answer as its request arrives (the SSR fuzz). */
export type Policy =
  | { script: ServerAnswer[] }
  | { choose: (req: { host: string; call: number; args: Scalar[] }) => { mode: 'now' | 'idle'; value: HostValue } | { mode: 'now' | 'idle'; error: string };
      pickIdle: (pending: number) => number };

const counted = { pending: new Set<unknown>(), installed: false, setImmediate: globalThis.setImmediate, timeouts: 0 };
/** How many setTimeout calls the renders made (a timer the Rust event loop does not model; the leg reports it). */
export const timeoutsScheduled = () => counted.timeouts;

/** Wraps setTimeout/setImmediate (and their clears) so that the timers anything schedules are counted. Call before
 *  Solid is imported: web/dist/server.js reads `setImmediate` once, at module evaluation (`deferFlush`). */
export function installTimers() {
  if (counted.installed) return;
  counted.installed = true;
  const st = globalThis.setTimeout, si = globalThis.setImmediate, ct = globalThis.clearTimeout, ci = globalThis.clearImmediate;
  const p = counted.pending;
  (globalThis as any).setTimeout = (fn: (...a: unknown[]) => void, ms?: number, ...a: unknown[]) => { counted.timeouts++; const h = st(() => { p.delete(h); fn(...a); }, ms); p.add(h); return h; };
  (globalThis as any).setImmediate = (fn: (...a: unknown[]) => void, ...a: unknown[]) => { const h = si(() => { p.delete(h); fn(...a); }); p.add(h); return h; };
  (globalThis as any).clearTimeout = (h: any) => { p.delete(h); ct(h); };
  (globalThis as any).clearImmediate = (h: any) => { p.delete(h); ci(h); };
}

type Pending = { answer: ServerAnswer; resolve: (v: unknown) => void; reject: (e: unknown) => void };

/** The host functions a render calls: `globalThis.__ssrServerHost(name, args)`, which the app's api module forwards. */
export async function renderStream(web: any, App: () => unknown, policy: Policy): Promise<StreamResult> {
  const calls: Record<string, number> = {};
  const answers: ServerAnswer[] = [];
  const waiting: Pending[] = [];
  const script = 'script' in policy ? policy.script : undefined;
  const chooser = 'script' in policy ? undefined : policy;
  const idleScript = script ? script.filter(a => a.mode === 'idle').sort((a, b) => a.at! - b.at!) : undefined;
  let failure: string | undefined;
  (globalThis as any).__ssrServerHost = (host: string, args: Scalar[]) => {
    const call = (calls[host] = (calls[host] ?? 0) + 1);
    let answer: ServerAnswer;
    if (script) {
      const a = script.find(a => a.host === host && a.call === call);
      if (!a) { failure ??= 'no server answer for ' + host + '#' + call; return new Promise(() => {}); }
      if (JSON.stringify(a.args) !== JSON.stringify(args)) failure ??= host + '#' + call + ' was called with ' + JSON.stringify(args) + ', the script answers ' + JSON.stringify(a.args);
      answer = a;
    } else {
      answer = { host, call, args, ...chooser!.choose({ host, call, args }) } as ServerAnswer;
    }
    answers.push(answer);
    if (answer.mode === 'now') return 'error' in answer ? Promise.reject(new Error(answer.error)) : Promise.resolve(answer.value);
    return new Promise((resolve, reject) => { waiting.push({ answer, resolve, reject }); });
  };
  const chunks: string[] = [];
  const events: StreamEvent[] = [];
  let ended = false;
  const stream = web.renderToStream(() => App());
  stream.pipe({ write(c: string) { chunks.push(c); events.push({ chunk: c }); }, end() { ended = true; events.push({ end: true }); } });
  let at = 0;
  const status = await new Promise<'ended' | 'stuck'>(done => {
    const check = () => {
      if (counted.pending.size) return void counted.setImmediate(check);
      if (ended) return done('ended');
      if (failure) return done('stuck');
      let k: number;
      if (idleScript) {
        const want = idleScript[at];
        k = want ? waiting.findIndex(w => w.answer === want) : -1;
        if (k < 0) { failure = want ? 'the script settles ' + want.host + '#' + want.call + ' next, which is not pending' : undefined; return done('stuck'); }
      } else {
        if (!waiting.length) return done('stuck');
        k = chooser!.pickIdle(waiting.length);
      }
      const w = waiting.splice(k, 1)[0];
      w.answer.at = at++;
      events.push({ settle: w.answer.host + '#' + w.answer.call });
      if ('error' in w.answer) w.reject(new Error(w.answer.error)); else w.resolve(w.answer.value);
      counted.setImmediate(check);
    };
    counted.setImmediate(check);
  });
  if (failure) throw new Error(failure);
  return { chunks, events, answers, status };
}

/** renderToString: it does not wait for async data; every host call returns a promise that never settles. */
export function renderString(web: any, App: () => unknown): StringResult {
  const calls: Record<string, number> = {};
  const requests: StringResult['requests'] = [];
  (globalThis as any).__ssrServerHost = (host: string, args: Scalar[]) => {
    const call = (calls[host] = (calls[host] ?? 0) + 1);
    requests.push({ host, call, args });
    return new Promise(() => {});
  };
  return { html: web.renderToString(() => App()), requests };
}

/** The api module a compiled server app imports: every host forwards to the render's answer script. */
export const serverApiModule = (hosts: string[]) =>
  hosts.map(h => 'export const ' + h + ' = (...args) => globalThis.__ssrServerHost(' + JSON.stringify(h) + ', args);').join('\n') + '\n';

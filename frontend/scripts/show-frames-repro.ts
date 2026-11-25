// docs/UPSTREAM-ISSUES.md, "Solid's <Show> lowering changes the frames": plan fuzz v2.1 seed 419, minimized. Native Solid
// with its <Show> lowered (production, #4730) and kept as a component replay one scenario and show different frames.
//   node --experimental-strip-types --conditions=browser scripts/show-frames-repro.ts
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { transform } from '@solidjs/compiler';
import { STRING_RENDERER } from '../tsx/rx/compiler.ts';

const fuzz = (p: string) => fileURLToPath(new URL('../plan/fuzz/' + p, import.meta.url));
const app = `import { Loading, Show, action, createMemo, createSignal, latest } from "solid-js";
import { loadTotal, h0 } from "./api";
export default function App() {
  const [shown, setShown] = createSignal(true);
  const total = createMemo(() => loadTotal());
  const label = createMemo(() => "v " + total());
  const claim = action(function* () { yield h0(); });
  return <section><button onClick={() => claim()}>take</button><button onClick={() => setShown(!shown())}>toggle</button>
    <div><Show when={shown()}><Loading fallback={<i>Loading</i>}><code>{latest(() => label())}</code></Loading></Show></div></section>;
}`;
const hosts = [{ name: 'loadTotal', parameters: [], returns: 'number', async: true }, { name: 'h0', parameters: [], returns: 'string', async: true }];
// Hide the Show, reject loadTotal, start the action, show it again, then end the action.
const script = [{ type: 'mount' }, { type: 'click', target: { text: 'toggle', index: 0 } },
  { type: 'reject', host: 'loadTotal', call: 1, args: [], error: 'offline' }, { type: 'click', target: { text: 'take', index: 0 } },
  { type: 'click', target: { text: 'toggle', index: 0 } }, { type: 'resolve', host: 'h0', call: 1, args: [], value: 'x' }].map(s => ({ ...s, frame: '' }));

const dir = mkdtempSync(tmpdir() + '/show-frames-');
writeFileSync(dir + '/api.mjs', hosts.map(h => 'export const ' + h.name + ' = globalThis.__planFuzzApi.' + h.name + ';').join('\n') + '\n');
for (const lowerShow of [true, false]) {
  const code = transform(app, { filename: 'App.tsx', generate: 'universal', moduleName: STRING_RENDERER, ...(lowerShow ? {} : { lowerShow }) } as Parameters<typeof transform>[1]).code
    .replaceAll('"' + STRING_RENDERER + '"', JSON.stringify(fuzz('renderer.ts'))).replaceAll('"solid-js"', JSON.stringify(fuzz('solid-native.ts'))).replaceAll('"./api"', '"./api.mjs"');
  writeFileSync(dir + '/native-' + lowerShow + '.mts', code);
  const trace = await new Promise<{ log: unknown[][] }>(resolve => {
    const w = new Worker(fuzz('leg.ts'), { workerData: { leg: 'native', entry: dir + '/native-' + lowerShow + '.mts', hosts, actions: ['claim'], script }, execArgv: ['--experimental-strip-types', '--conditions=browser', '--disable-warning=ExperimentalWarning'] });
    w.once('message', m => { void w.terminate(); resolve(m); });
  });
  const shown = trace.log.filter(e => e[0] === 'frame' || (e[0] === 'request' && e[1] === 'loadTotal')).map(e => e[0] === 'frame' ? JSON.stringify(e[1]) : 'request ' + e[1] + ' #' + e[2]);
  console.log((lowerShow ? 'lowered (production)' : 'Show component      ') + ': ' + shown.join(', '));
}

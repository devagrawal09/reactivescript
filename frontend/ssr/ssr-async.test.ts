// Slice 5, async data (docs/RESULTS.md, "Slice 5: async data"): rust-solid's server renderer against Solid's own
// renderToStream and renderToString of plan v2.1 apps, chunk for chunk and byte for byte, and Chromium hydrating each
// stream (fed chunk by chunk) with Solid's client build and continuing the scenario. The Rust leg is $RUST_SSR
// (verify-pinned.sh sets it from RUST_SOLID). Without it the Rust tests are not registered, so the gate, which lists
// them in baselines/subset-tests.json, fails ("ran 0 times").
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { generateAsync } from '../plan/fuzz/gen-async.ts';
import { apiModule, clientModule, openBrowser, type Browser } from './browser.ts';
import { compareStreams, runAsyncSsrCase, runAsyncSsrProgram, rustStreamRender, rustStringRender, solidServerAsync } from './run-async.ts';
import type { ServerAnswer } from './stream-core.ts';
import type { ScenarioStep } from '../plan/fuzz/host.ts';

const rust = process.env.RUST_SSR;
const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const tmp = here('../.out/ssr/tmp/');
mkdirSync(tmp, { recursive: true });
const dir = mkdtempSync(tmp + 'async-test-');
after(() => rmSync(dir, { recursive: true, force: true }));

let opened: Browser | undefined;
const browser = async () => (opened ??= await openBrowser());
after(async () => { await opened?.close(); });

const tsx = readFileSync(here('../slices/tracker-async/tracker-async.tsx'), 'utf8');
const scenario = JSON.parse(readFileSync(here('../slices/tracker-async/tracker-async.scenario.json'), 'utf8'));
const planFile = here('../plan/tracker-async.plan.json');
const plan = JSON.parse(readFileSync(planFile, 'utf8'));
const steps: ScenarioStep[] = scenario.steps;
const hosts = ['assignIssue', 'loadIssues'];
const first = (steps[1] as { value: unknown }).value;
/** The server's answer scripts: loadIssues #1 answered at the first idle point (after the shell) or when asked
 *  (before the shell), with the scenario's first answer or a rejection. */
const scripts: Record<string, ServerAnswer[]> = {
  idle: [{ host: 'loadIssues', call: 1, args: [], mode: 'idle', at: 0, value: first as never }],
  now: [{ host: 'loadIssues', call: 1, args: [], mode: 'now', value: first as never }],
  'idle-reject': [{ host: 'loadIssues', call: 1, args: [], mode: 'idle', at: 0, error: 'offline' }],
  'now-reject': [{ host: 'loadIssues', call: 1, args: [], mode: 'now', error: 'offline' }],
};
const SHELL = '<section _hk=1><!--$--><template id="pl-200"></template><i _hk=2000>Loading issues&#8230;</i><!--pl-200--><!--/--><em></em></section><script>(self.$R=self.$R||{})[""]=[];_$HY.r["0"]=$R[0]=($R[1]=($R[2]=() => {';
const STRING = '<section _hk=1><!--$--><i _hk=2000>Loading issues&#8230;</i><!--/--><em></em></section><script>(self.$R=self.$R||{})[""]=[];_$HY.r["200"]="$$f";</script>';

const solid = async (name: string) => {
  const r = await solidServerAsync(tsx, hosts, dir + '/' + name, { script: scripts[name] });
  assert.ok(!('error' in r), 'error' in r ? r.error : '');
  if ('error' in r) throw new Error(String(r.error));
  assert.ok(r.stream && !('error' in r.stream) && r.string && !('error' in r.string), JSON.stringify(r).slice(0, 300));
  return r as { stream: Exclude<typeof r.stream, { error: string } | undefined>; string: Exclude<typeof r.string, { error: string } | undefined>; script: string };
};

test('ssr async: Solid streams tracker-async under four server answer scripts, and renders its Loading fallback to a string', async () => {
  const idle = await solid('idle');
  // The shell (the fallback in its placeholder; the pending memo and fragment serialized), then the settlement, then
  // the content's template with its swap, then the end.
  assert.deepEqual(idle.stream.events.map(e => 'chunk' in e ? 'chunk' : 'settle' in e ? 'settle ' + e.settle : 'end'), ['chunk', 'settle loadIssues#1', 'chunk', 'end']);
  assert.ok(idle.stream.chunks[0].startsWith(SHELL), idle.stream.chunks[0]);
  assert.ok(idle.stream.chunks[1].startsWith('<template id="200"><b _hk=200000>ready</b><p _hk=20000100>'), idle.stream.chunks[1]);
  // Answered before the shell, the content is inlined: one chunk.
  const now = await solid('now');
  assert.equal(now.stream.chunks.length, 1);
  assert.ok(now.stream.chunks[0].startsWith('<section _hk=1><!--$--><b _hk=200000>ready</b>'));
  // A rejection: the fragment settles with the Errored fallback, marked `e`; the sanitized error is serialized under
  // the Errored boundary's id.
  const rejected = await solid('idle-reject');
  assert.ok(rejected.stream.chunks[1].startsWith('<template id="200" e><p _hk=30>Could not load issues<button>retry</button></p></template>'));
  assert.ok(rejected.stream.chunks[1].includes('new Error("Internal Server Error")'));
  const rejectedNow = await solid('now-reject');
  assert.ok(rejectedNow.stream.chunks[0].startsWith('<section _hk=1><!--$--><p _hk=30>Could not load issues<button>retry</button></p>'));
  // renderToString does not wait: the fallback, and "$$f" under the Loading boundary's id; its host call never settles.
  assert.equal(idle.string.html, STRING);
  assert.deepEqual(idle.string.requests, [{ host: 'loadIssues', call: 1, args: [] }]);
});

if (rust) {
  test('ssr async: Rust streams tracker-async as Solid does, chunk for chunk and settlement for settlement, under each script, and renders the same string', async () => {
    for (const name of Object.keys(scripts)) {
      const s = await solid(name);
      writeFileSync(dir + '/answers-' + name + '.json', JSON.stringify(s.stream.answers));
      const r = rustStreamRender(rust, planFile, dir + '/answers-' + name + '.json');
      assert.ok(!('error' in r), 'error' in r ? r.error : '');
      if ('error' in r) continue;
      assert.equal(compareStreams(s.stream, r), undefined, name);
      assert.deepEqual(r.chunks, s.stream.chunks, name);
      assert.deepEqual(r.requests, [{ host: 'loadIssues', call: 1, args: [] }]);
      const h = rustStringRender(rust, planFile);
      assert.ok('html' in h && h.html === s.string.html, name);
    }
  });

  test('ssr async: Chromium hydrates Rust\'s tracker-async stream after its shell and after its last chunk (prod and dev builds) and the scenario continues from step 2 with the recorded frames, as with Solid\'s stream; the renderToString HTML replays the whole scenario from mount', async () => {
    for (const [name, streamFrames] of [['idle', [steps[0].frame, steps[1].frame]], ['now', [steps[1].frame]]] as const) {
      const o = await runAsyncSsrProgram({ seed: 0, family: 'slice', files: {}, tsx, hostSigs: scenario.host, plan, policy: { script: scripts[name] },
        fromMount: steps, continuation: { steps: steps.slice(2), streamFrames: [...streamFrames] } }, { rust, browser: await browser(), dev: true }, dir + '/run-' + name);
      assert.equal(o.status, 'agree', name + ': ' + o.classes.join('; ') + ' ' + (o.detail ?? ''));
      assert.deepEqual(Object.keys(o.browser!).sort(), ['rust-stream', 'rust-stream-dev', 'rust-stream-end', 'rust-string', 'solid-stream', 'solid-stream-dev', 'solid-stream-end', 'solid-string']);
      for (const [run, h] of Object.entries(o.browser!)) {
        assert.ok(h.ok, run + ': ' + h.problems.join('; '));
        // The slice hydrates clean: nothing created, nothing left unclaimed, nothing on the console.
        assert.deepEqual([h.fresh, h.unclaimed, h.console], [[], [], []], run);
        const want = run.endsWith('string') ? steps.map(s => s.frame) : steps.slice(2).map(s => s.frame);
        assert.deepEqual(h.frames, want, run);
      }
      assert.deepEqual(o.browser!['rust-stream'].streamFrames, streamFrames);
      assert.deepEqual(o.browser!['rust-stream-end'].streamFrames, [steps[1].frame]);
    }
  });

  test('ssr async: a first load the server rejects streams the Errored fallback; hydrated (Solid\'s client renders that fallback fresh, by design), its retry asks the client\'s loadIssues #2 and shows the issues', async () => {
    const value = (steps[1] as { value: unknown }).value;
    const retry: ScenarioStep[] = [
      { type: 'click', target: { text: 'retry', index: 0 }, frame: 'Could not load issuesretry' },
      { type: 'resolve', host: 'loadIssues', call: 2, args: [], value: value as never, frame: steps[1].frame },
    ];
    const o = await runAsyncSsrProgram({ seed: 0, family: 'slice', files: {}, tsx, hostSigs: scenario.host, plan, policy: { script: scripts['idle-reject'] },
      continuation: { steps: retry, streamFrames: [steps[0].frame, 'Could not load issuesretry'] } }, { rust, browser: await browser(), dev: true }, dir + '/run-reject');
    assert.equal(o.status, 'agree', o.classes.join('; ') + ' ' + (o.detail ?? ''));
    for (const run of ['solid-stream', 'rust-stream', 'solid-stream-end', 'rust-stream-end']) assert.deepEqual(o.browser![run].frames, retry.map(s => s.frame), run);
    // Hydrated after the shell, the client renders the failure's fallback fresh (server.ts `sink.fragment`, #4287);
    // after the last chunk it claims the server's. Rust's stream is hydrated the same way in each mode.
    assert.deepEqual(o.browser!['solid-stream'].fresh, ['p', 'button']);
    assert.deepEqual(o.browser!['rust-stream'].fresh, ['p', 'button']);
    assert.deepEqual(o.browser!['rust-stream-end'].fresh, []);
  });

  test('ssr async: the oracle fails closed: a changed byte in a chunk is a stream difference, and a changed key or text is a hydration difference', async () => {
    const s = await solid('idle');
    writeFileSync(dir + '/answers-closed.json', JSON.stringify(s.stream.answers));
    const r = rustStreamRender(rust, planFile, dir + '/answers-closed.json');
    assert.ok(!('error' in r));
    if ('error' in r) return;
    const changed = { ...r, events: r.events.map(e => 'chunk' in e ? { chunk: e.chunk.replace('_hk=20000110', '_hk=20000111') } : e) };
    assert.match(compareStreams(s.stream, changed) ?? '', /event 2 differs/);
    const page = (chunks: string[], build: 'prod' | 'dev') => ({ chunks, when: 'shell' as const, script: s.script, client: clientModule(tsx), api: apiModule(hosts), build, offsets: { loadIssues: 1 }, steps: steps.slice(2) });
    const b = await browser();
    const control = await b.hydrateStream(page(r.chunks, 'prod'));
    assert.ok(control.ok, control.problems.join('; '));
    // A row's key: the client cannot claim it and builds the row fresh; the dev build says so.
    const keyed = r.chunks.map(c => c.replace('_hk=20000110', '_hk=20000111'));
    const prod = await b.hydrateStream(page(keyed, 'prod'));
    assert.notDeepEqual(prod.fresh, control.fresh);
    const dev = await b.hydrateStream(page(keyed, 'dev'));
    assert.ok(dev.console.some(m => /Hydration key miss/.test(m)), dev.console.join('; '));
    // A row's text: the frames differ from the scenario.
    const text = await b.hydrateStream(page(r.chunks.map(c => c.replace('Slow search', 'Slow serch')), 'prod'));
    assert.equal(text.ok, false);
    assert.match(text.problems[0], /step 0: frame/);
  });

  test('ssr async: generated v2.1 programs (seeds 1..12): Rust\'s streams and HTML are Solid\'s, and every hydration observes what Solid\'s does', async () => {
    const b = await browser();
    for (let seed = 1; seed <= 12; seed++) {
      const o = await runAsyncSsrCase(generateAsync(seed), { rust, browser: b, dev: true });
      assert.ok(o.status === 'agree' || o.status === 'refused', 'seed ' + seed + ': ' + o.status + ' ' + o.classes.join('; ') + ' ' + (o.detail ?? ''));
      if (o.status === 'refused') { assert.equal(o.rust, undefined); continue; }
      assert.deepEqual(Object.keys(o.browser!).sort(), ['rust-stream', 'rust-stream-dev', 'rust-stream-end', 'rust-string', 'solid-stream', 'solid-stream-dev', 'solid-stream-end', 'solid-string']);
      assert.deepEqual(o.browser!['rust-string'].frames, o.scenario!.map(s => s.frame));
    }
  });

  test('ssr async: the Rust renderer refuses an answer script that does not fit the render, with a diagnostic', () => {
    const cases: [ServerAnswer[], RegExp][] = [
      [[], /no server answer for loadIssues#1/],
      [[{ ...scripts.now[0], args: [7] }], /was called with \[\], the script answers \[7\]/],
      [[...scripts.now, { ...scripts.now[0], call: 2 }], /never asked/],
    ];
    for (const [answers, re] of cases) {
      writeFileSync(dir + '/bad.json', JSON.stringify(answers));
      const r = rustStreamRender(rust, planFile, dir + '/bad.json');
      assert.ok('error' in r && re.test(r.error), JSON.stringify(r).slice(0, 300) + ' ' + re);
    }
  });
}

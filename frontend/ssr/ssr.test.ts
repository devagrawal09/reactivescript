// Slice 5 (docs/RESULTS.md, "Slice 5: server rendering"): rust-solid's server renderer against Solid's own
// renderToString, byte for byte, and Chromium hydrating both with Solid's client build and replaying the scenario. The
// Rust leg is $RUST_SSR (rust-solid's `ssr` binary; verify-pinned.sh sets it from RUST_SOLID). Without it the Rust tests
// are not registered, so the gate, which lists them in baselines/subset-tests.json, fails ("ran 0 times").
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { generate } from '../plan/fuzz/gen.ts';
import { apiModule, clientModule, openBrowser, type Browser, type Build } from './browser.ts';
import { runSsrCase, rustServer, solidServer } from './run.ts';
import type { ScenarioStep } from '../plan/fuzz/host.ts';

const rust = process.env.RUST_SSR;
const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const slice = (f: string) => readFileSync(here('../slices/' + f), 'utf8');
const tmp = here('../.out/ssr/tmp/');
mkdirSync(tmp, { recursive: true });
const dir = mkdtempSync(tmp + 'test-');
after(() => rmSync(dir, { recursive: true, force: true }));

let opened: Browser | undefined;
const browser = async () => (opened ??= await openBrowser());
after(async () => { await opened?.close(); });

// The plan's canonical TSX twin coerces an integer text hole (ssr/plan.rs in rust-solid): the tracker's idiomatic
// `<b>{unassigned()} open</b>` and like's `{shown()}` are written `{"" + …}` there, as plan-fuzz.test.ts writes them.
const tracker = { idiomatic: slice('tracker/tracker.tsx'), scenario: JSON.parse(slice('tracker/tracker.scenario.json')) };
const trackerCanonical = tracker.idiomatic.replace('<b>{unassigned()} open</b>', '<b>{"" + unassigned()} open</b>');
const like = { idiomatic: slice('like/like.tsx'), scenario: JSON.parse(slice('like/like.scenario.json')) };
const likeCanonical = like.idiomatic.replace('>{shown()}</button>', '>{"" + shown()}</button>');
const TRACKER_HTML = '<section _hk=3><button>Filter: <!--$-->all<!--/--></button><b><!--$-->2<!--/--> open</b><!--$--><p _hk=7000><!--$-->Crash on save<!--/-->: <!--$-->nobody<!--/--><button>take</button></p><p _hk=7010><!--$-->Slow search<!--/-->: <!--$-->ana<!--/--><button>take</button></p><p _hk=7020><!--$-->Typo in footer<!--/-->: <!--$-->nobody<!--/--><button>take</button></p><!--/--><em></em></section>';

const server = async (tsx: string, hosts: string[], name: string) => {
  const r = await solidServer(tsx, hosts, dir + '/' + name);
  assert.ok('html' in r, 'error' in r ? r.error : '');
  return r as { html: string; script: string };
};
const run = async (html: string, script: string, tsx: string, hosts: string[], steps: ScenarioStep[], build: Build) =>
  (await browser()).hydrate({ html, script, client: clientModule(tsx), api: apiModule(hosts), steps, build });

test('ssr: Solid renders the canonical tracker and like twins; the idiomatic tracker differs only by its keys after the number hole', async () => {
  const canonical = await server(trackerCanonical, ['assignIssue'], 'tracker');
  assert.equal(canonical.html, TRACKER_HTML);
  // `{unassigned()}` is scoped (`_$scope`: it could return hydratable content) and takes one id slot; `{"" + …}` is
  // provably a string and takes none. Every key after it shifts by one: the rows' 70x0 become 80x0.
  const idiomatic = await server(tracker.idiomatic, ['assignIssue'], 'tracker-idiomatic');
  assert.notEqual(idiomatic.html, canonical.html);
  assert.equal(idiomatic.html, canonical.html.replaceAll(' _hk=70', ' _hk=80'));
  const likes = await Promise.all([likeCanonical, like.idiomatic].map((t, i) => server(t, ['save'], 'like' + i)));
  assert.equal(likes[0].html, '<button _hk=1>0</button>');
  assert.equal(likes[1].html, likes[0].html, "like's hole is its button's only child: no id follows it");
});

if (rust) {
  const plan = (f: string) => here('../plan/' + f);

  test('ssr: Rust renders the tracker and like plans as Solid renders their canonical TSX twins, byte for byte', async () => {
    const t = rustServer(rust, plan('tracker.plan.json'));
    assert.ok('html' in t, 'error' in t ? t.error : '');
    assert.equal(t.html, (await server(trackerCanonical, ['assignIssue'], 'tracker-2')).html);
    assert.equal(t.html, TRACKER_HTML);
    const l = rustServer(rust, plan('like.plan-v2.json'));
    assert.ok('html' in l, 'error' in l ? l.error : '');
    assert.equal(l.html, (await server(likeCanonical, ['save'], 'like-2')).html);
    // The hydration script: generateHydrationScript() with its default events.
    const s = spawnSync(rust, ['--hydration-script'], { encoding: 'utf8' });
    assert.equal(JSON.parse(s.stdout).script, (await server(likeCanonical, ['save'], 'like-3')).script);
  });

  test('ssr: Chromium hydrates Rust\'s tracker HTML with Solid\'s client and replays the tracker scenario (prod and dev builds), as it does Solid\'s HTML', async () => {
    const solid = await server(trackerCanonical, ['assignIssue'], 'tracker-3');
    const r = rustServer(rust, plan('tracker.plan.json'));
    assert.ok('html' in r);
    for (const build of ['prod', 'dev'] as const)
      for (const [name, html] of [['rust', r.html], ['solid', solid.html]] as const) {
        const h = await run(html, solid.script, trackerCanonical, ['assignIssue'], tracker.scenario.steps, build);
        assert.deepEqual(h.problems, [], name + ' ' + build);
        assert.deepEqual(h.frames, tracker.scenario.steps.map((s: ScenarioStep) => s.frame), name + ' ' + build);
        assert.deepEqual([h.fresh, h.dropped, h.unclaimed, h.htmlChanged], [[], [], 0, false]);
      }
  });

  test('ssr: Chromium hydrates Rust\'s like HTML and replays the like scenario', async () => {
    const solid = await server(likeCanonical, ['save'], 'like-4');
    const r = rustServer(rust, plan('like.plan-v2.json'));
    assert.ok('html' in r);
    for (const build of ['prod', 'dev'] as const) {
      const h = await run(r.html, solid.script, likeCanonical, ['save'], like.scenario.steps, build);
      assert.deepEqual(h.problems, [], build);
      assert.deepEqual(h.frames, ['0', '1', '0', '1', '1']);
    }
  });

  test('ssr: the oracle fails closed: the canonical HTML under the idiomatic tracker client is a hydration mismatch', async () => {
    const r = rustServer(rust, plan('tracker.plan.json'));
    assert.ok('html' in r);
    const { script } = await server(trackerCanonical, ['assignIssue'], 'tracker-4');
    const prod = await run(r.html, script, tracker.idiomatic, ['assignIssue'], tracker.scenario.steps, 'prod');
    assert.equal(prod.ok, false);
    // The client wants keys 8000.. and finds 7000..: it builds detached rows and leaves the server's unclaimed.
    assert.ok(prod.unclaimed > 0 && prod.problems.some(p => /never claimed/.test(p)), prod.problems.join('; '));
    const dev = await run(r.html, script, tracker.idiomatic, ['assignIssue'], tracker.scenario.steps, 'dev');
    assert.ok(dev.messages.some(m => /Hydration key miss/.test(m)), dev.messages.join('; '));
    // A changed byte in the Rust HTML is caught by the HTML comparison before any browser runs.
    assert.notEqual(r.html.replace('_hk=7010', '_hk=7011'), TRACKER_HTML);
  });

  test('ssr: generated programs (seeds 1..12): Rust\'s HTML is Solid\'s, and both hydrate and replay the scenario', async () => {
    const b = await browser();
    for (let seed = 1; seed <= 12; seed++) {
      const o = await runSsrCase(generate(seed), { rust, browser: b, dev: true });
      assert.ok(o.status === 'agree' || o.status === 'refused', 'seed ' + seed + ': ' + o.status + ' ' + o.classes.join('; ') + ' ' + (o.detail ?? ''));
      if (o.status === 'refused') { assert.equal(o.rust, undefined); continue; }
      assert.ok(o.rust && 'html' in o.rust && o.solid && 'html' in o.solid && o.rust.html === o.solid.html);
      assert.deepEqual(Object.keys(o.browser!), ['rust', 'solid', 'rust-dev']);
      for (const h of Object.values(o.browser!)) assert.deepEqual(h.frames, o.scenario!.steps.map(s => s.frame));
    }
  });

  test('ssr: the Rust renderer refuses what it has no twin for, with a diagnostic', () => {
    const base = { version: 2, component: 'A', hosts: [], memos: [], actions: [] };
    const text = (value: unknown) => ({ kind: 'text', value });
    const el = (tag: string, children: unknown[]) => ({ kind: 'element', tag, events: [], children });
    const cases: [unknown, RegExp][] = [
      [{ ...base, sources: [], markup: [el('b', [text({ op: 'literal', value: 'a & b' })])] }, /raw JSX spelling/],
      [{ ...base, sources: [], markup: [el('b', [text({ op: 'literal', value: 'a' }), text({ op: 'literal', value: 'b' })])] }, /adjacent static texts/],
      [{ ...base, sources: [], markup: [el('b', [text({ op: 'add', left: { op: 'literal', value: 1 }, right: { op: 'literal', value: 2 } })])] }, /constant value/],
      [{ ...base, sources: [], markup: [el('br', [text({ op: 'literal', value: 'x' })])] }, /void element/],
      [{ ...base, sources: [], markup: [el('head', [])] }, /<head> is not ported/],
      [{ ...base, sources: [{ name: 's', kind: 'store', seed: { op: 'object', fields: [{ key: 'list', value: { op: 'array', items: [] } }] } }],
        markup: [el('ul', [{ kind: 'for', each: { op: 'get', object: { op: 'read', source: 's' }, key: 'list' }, item: 'r', key: 'identity',
          children: [el('li', [text({ op: 'get', object: { op: 'local', name: 'r' }, key: 'title' })])] }])] }, /type is not known statically/],
    ];
    for (const [p, re] of cases) {
      const f = dir + '/refuse.plan.json';
      writeFileSync(f, JSON.stringify(p));
      const r = rustServer(rust, f);
      assert.ok('error' in r && re.test(r.error), JSON.stringify(r) + ' ' + re);
    }
  });
}

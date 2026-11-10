// npm run ssr-fuzz -- --seeds N --start S [--jobs J] [--rust SSR] [--out DIR] [--dev] [--async]
// The SSR fuzz (docs/RESULTS.md, "Slice 5"): for each program of the plan fuzz's generator (plan/fuzz/gen.ts), Rust's
// server HTML of its plan must be Solid's own server HTML of its TSX twin byte for byte, and Chromium must hydrate both
// with Solid's client build and replay the scenario recorded on native Solid (ssr/run.ts, ssr/browser.ts). --dev also
// hydrates the Rust HTML with Solid's dev client builds, which report mismatches on the console.
// Writes DIR (default .out/ssr-fuzz/run-S-N/): summary.json, summary.md, and for each program that does not agree its
// files, plan, scenario, both HTMLs and the hydration results. The Rust renderer is `ssr` from --rust, or
// $RUST_SOLID/target/debug/ssr.
// --async runs plan v2.1 programs instead (plan/fuzz/gen-async.ts; docs/RESULTS.md, "Slice 5: async data"): Rust's
// renderToStream chunks and event log under Solid's realized server answers, and its renderToString HTML, must be
// Solid's byte for byte; Chromium feeds each stream chunk by chunk, hydrates it (after the shell and after the last
// chunk, production builds; after the shell on the dev builds with --dev), and runs a continuation recorded on Solid's
// own stream; each renderToString HTML hydrates and replays the scenario native Solid recorded from mount
// (ssr/run-async.ts).
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { generate } from '../plan/fuzz/gen.ts';
import { generateAsync } from '../plan/fuzz/gen-async.ts';
import { runSsrCase, type SsrOutcome } from '../ssr/run.ts';
import { runAsyncSsrCase, type AsyncSsrOutcome } from '../ssr/run-async.ts';
import { openBrowser } from '../ssr/browser.ts';

const flag = (name: string) => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
const seeds = Number(flag('--seeds') ?? 100), start = Number(flag('--start') ?? 1), jobs = Number(flag('--jobs') ?? 4);
const dev = process.argv.includes('--dev');
const asyncMode = process.argv.includes('--async');
const rust = flag('--rust') ?? (process.env.RUST_SOLID ? process.env.RUST_SOLID + '/target/debug/ssr' : undefined);
if (!rust || !existsSync(rust)) { console.error('the Rust leg needs the ssr binary: pass --rust PATH or set RUST_SOLID (missing: ' + rust + ')'); process.exit(2); }
const out = flag('--out') ?? fileURLToPath(new URL('../.out/ssr-fuzz/run-' + (asyncMode ? 'async-' : '') + start + '-' + seeds + '/', import.meta.url));
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
if (asyncMode) {
  await runAsync();
  process.exit(process.exitCode ?? 0);
}

async function runAsync() {
  const browser = await openBrowser();
  const outcomes: AsyncSsrOutcome[] = [];
  let next = start;
  const work = async () => {
    for (;;) {
      const seed = next++;
      if (seed >= start + seeds) return;
      const o = await runAsyncSsrCase(generateAsync(seed), { rust: rust!, browser, dev });
      outcomes.push(o);
      if (o.status !== 'agree') {
        console.log('seed', seed, o.status, o.classes.join(' + '), o.detail ? o.detail.split('\n')[0] : '');
        const dir = out + 'seed-' + seed + '/';
        mkdirSync(dir, { recursive: true });
        for (const [name, text] of Object.entries(o.files)) writeFileSync(dir + name, text);
        if (o.plan) writeFileSync(dir + 'app.plan.json', JSON.stringify(o.plan, null, 2) + '\n');
        if (o.answers) writeFileSync(dir + 'answers.json', JSON.stringify(o.answers, null, 2) + '\n');
        if (o.scenario) writeFileSync(dir + 'from-mount.json', JSON.stringify(o.scenario, null, 2) + '\n');
        const s = o.solid && !('error' in o.solid) ? o.solid : undefined;
        if (s?.compiled) writeFileSync(dir + 'App.server.js', s.compiled);
        writeFileSync(dir + 'outcome.json', JSON.stringify({ seed, family: o.family, status: o.status, classes: o.classes, detail: o.detail, notes: o.notes,
          solid: { stream: s?.stream, string: s?.string, error: o.solid && 'error' in o.solid ? o.solid.error : undefined }, rust: o.rust, continuation: o.continuation, browser: o.browser }, null, 2) + '\n');
      }
    }
  };
  try { await Promise.all(Array.from({ length: jobs }, work)); } finally { await browser.close(); }
  outcomes.sort((a, b) => a.seed - b.seed);
  const tally: Record<string, number> = { agree: 0, stream: 0, html: 0, hydration: 0, 'ssr-refused': 0, refused: 0, invalid: 0, 'generator-bug': 0 };
  const classes: Record<string, { count: number; seeds: number[] }> = {};
  const refusals: Record<string, { count: number; seeds: number[] }> = {};
  const notes: Record<string, { count: number; seeds: number[] }> = {};
  const families: Record<string, Record<string, number>> = {};
  const agreeing = { streamBytes: 0, chunks: 0, multiChunkStreams: 0, errorFragments: 0, serverRejections: 0, htmlBytes: 0, hydrationKeys: 0, hydrations: 0, continuationSteps: 0, fromMountSteps: 0 };
  const add = (m: Record<string, { count: number; seeds: number[] }>, k: string, seed: number) => { m[k] ??= { count: 0, seeds: [] }; m[k].count++; if (m[k].seeds.length < 20) m[k].seeds.push(seed); };
  for (const o of outcomes) {
    tally[o.status]++;
    (families[o.family] ??= { total: 0, agree: 0 }).total++;
    if (o.status === 'agree') families[o.family].agree++;
    for (const k of o.classes) add(classes, k, o.seed);
    if (o.status === 'refused' || o.status === 'ssr-refused') add(refusals, o.status + ': ' + (o.detail ?? '').split('\n')[0], o.seed);
    // Notes: what Solid's own runs observed besides frames, by run and kind (each Rust run observed the same).
    for (const n of new Set((o.notes ?? []).map(n => n.split(':')[0]))) add(notes, n, o.seed);
    const s = o.solid && !('error' in o.solid) ? o.solid : undefined;
    if (o.status === 'agree' && s?.stream && !('error' in s.stream) && s.string && !('error' in s.string)) {
      const all = s.stream.chunks.join('');
      agreeing.streamBytes += all.length; agreeing.chunks += s.stream.chunks.length;
      if (s.stream.chunks.length > 1) agreeing.multiChunkStreams++;
      agreeing.errorFragments += (all.match(/<template id="[^"]*" e>/g) ?? []).length;
      agreeing.serverRejections += s.stream.answers.filter(a => 'error' in a).length;
      agreeing.htmlBytes += s.string.html.length; agreeing.hydrationKeys += (all.match(/ _hk=/g) ?? []).length;
      agreeing.hydrations += Object.keys(o.browser ?? {}).length;
      agreeing.continuationSteps += o.continuation?.length ?? 0;
      agreeing.fromMountSteps += o.scenario?.length ?? 0;
    }
  }
  const summary = { schema: '2.1', start, seeds, total: outcomes.length, dev, ...tally, agreeing, families, classes, refusals, notes };
  writeFileSync(out + 'summary.json', JSON.stringify(summary, null, 1) + '\n');
  writeFileSync(out + 'summary.md', [
    '# SSR fuzz v2.1 (async data): seeds ' + start + '..' + (start + seeds - 1), '',
    'Rust\'s renderToStream chunks and event log, and its renderToString HTML, must be Solid\'s byte for byte; Chromium hydrates each (streams fed chunk by chunk) with Solid\'s client and every Rust run must observe what the run of Solid\'s own output observed.', '',
    ...Object.entries(tally).map(([k, n]) => '- ' + k + ': ' + n),
    '- agreeing programs: ' + JSON.stringify(agreeing), '',
    '## Classes', '', ...(Object.keys(classes).length ? Object.entries(classes).map(([k, v]) => '- ' + k + ': ' + v.count + ' (seeds ' + v.seeds.join(', ') + ')') : ['none']), '',
    '## Refusals (not agreement)', '', ...(Object.keys(refusals).length ? Object.entries(refusals).map(([k, v]) => '- ' + k + ': ' + v.count + ' (seeds ' + v.seeds.join(', ') + ')') : ['none']), '',
    '## Notes (Solid\'s own runs; every Rust run observed the same)', '', ...(Object.keys(notes).length ? Object.entries(notes).map(([k, v]) => '- ' + k + ': ' + v.count + ' (seeds ' + v.seeds.join(', ') + ')') : ['none']),
  ].join('\n') + '\n');
  console.log(JSON.stringify({ total: summary.total, ...tally }, null, 1));
  console.log('wrote ' + out);
  process.exitCode = tally.stream || tally.html || tally.hydration || tally.invalid || tally['generator-bug'] || tally['ssr-refused'] ? 1 : 0;
}

const browser = await openBrowser();
const outcomes: SsrOutcome[] = [];
let next = start;
const work = async () => {
  for (;;) {
    const seed = next++;
    if (seed >= start + seeds) return;
    const o = await runSsrCase(generate(seed), { rust, browser, dev });
    outcomes.push(o);
    if (o.status !== 'agree') {
      console.log('seed', seed, o.status, o.classes.join(' + '), o.detail ? o.detail.split('\n')[0] : '');
      const dir = out + 'seed-' + seed + '/';
      mkdirSync(dir, { recursive: true });
      for (const [name, text] of Object.entries(o.files)) writeFileSync(dir + name, text);
      if (o.plan) writeFileSync(dir + 'app.plan.json', JSON.stringify(o.plan, null, 2) + '\n');
      if (o.scenario) writeFileSync(dir + 'app.scenario.json', JSON.stringify(o.scenario, null, 2) + '\n');
      if (o.solid && 'html' in o.solid) writeFileSync(dir + 'solid.html', o.solid.html);
      if (o.solid?.compiled) writeFileSync(dir + 'App.server.js', o.solid.compiled);
      if (o.rust && 'html' in o.rust) writeFileSync(dir + 'rust.html', o.rust.html);
      writeFileSync(dir + 'outcome.json', JSON.stringify({ seed, family: o.family, status: o.status, classes: o.classes, detail: o.detail, rust: o.rust, solid: o.solid && 'error' in o.solid ? o.solid : undefined, browser: o.browser }, null, 2) + '\n');
    }
  }
};
try { await Promise.all(Array.from({ length: jobs }, work)); } finally { await browser.close(); }
outcomes.sort((a, b) => a.seed - b.seed);

const tally: Record<string, number> = { agree: 0, html: 0, hydration: 0, 'ssr-refused': 0, refused: 0, invalid: 0, 'generator-bug': 0 };
const classes: Record<string, { count: number; seeds: number[] }> = {};
const refusals: Record<string, { count: number; seeds: number[] }> = {};
const families: Record<string, Record<string, number>> = {};
let steps = 0, bytes = 0, keys = 0, hydrations = 0;
const add = (m: Record<string, { count: number; seeds: number[] }>, k: string, seed: number) => { m[k] ??= { count: 0, seeds: [] }; m[k].count++; if (m[k].seeds.length < 20) m[k].seeds.push(seed); };
for (const o of outcomes) {
  tally[o.status]++;
  (families[o.family] ??= { total: 0, agree: 0 }).total++;
  if (o.status === 'agree') families[o.family].agree++;
  for (const k of o.classes) add(classes, k, o.seed);
  if (o.status === 'refused' || o.status === 'ssr-refused') add(refusals, o.status + ': ' + (o.detail ?? '').split('\n')[0], o.seed);
  if (o.status === 'agree' && o.rust && 'html' in o.rust) {
    steps += o.scenario!.steps.length; bytes += o.rust.html.length; keys += (o.rust.html.match(/ _hk=/g) ?? []).length;
    hydrations += Object.keys(o.browser ?? {}).length;
  }
}
const summary = {
  start, seeds, total: outcomes.length, dev, ...tally,
  agreeing: { htmlBytes: bytes, hydrationKeys: keys, hydrations, scenarioStepsPerHydration: steps },
  families, classes, refusals,
};
writeFileSync(out + 'summary.json', JSON.stringify(summary, null, 1) + '\n');
writeFileSync(out + 'summary.md', [
  '# SSR fuzz: seeds ' + start + '..' + (start + seeds - 1), '',
  'Rust `ssr` HTML must be Solid\'s renderToString HTML byte for byte; Chromium hydrates both with Solid\'s client build and replays the recorded scenario.', '',
  ...Object.entries(tally).map(([k, n]) => '- ' + k + ': ' + n),
  '- agreeing programs: ' + bytes + ' HTML bytes, ' + keys + ' hydration keys, ' + hydrations + ' hydrations, ' + steps + ' scenario steps each', '',
  '## Classes', '', ...(Object.keys(classes).length ? Object.entries(classes).map(([k, v]) => '- ' + k + ': ' + v.count + ' (seeds ' + v.seeds.join(', ') + ')') : ['none']), '',
  '## Refusals (not agreement)', '', ...(Object.keys(refusals).length ? Object.entries(refusals).map(([k, v]) => '- ' + k + ': ' + v.count + ' (seeds ' + v.seeds.join(', ') + ')') : ['none']),
].join('\n') + '\n');
console.log(JSON.stringify({ total: summary.total, ...tally }, null, 1));
console.log('wrote ' + out);
process.exitCode = tally.html || tally.hydration || tally.invalid || tally['generator-bug'] || tally['ssr-refused'] ? 1 : 0;

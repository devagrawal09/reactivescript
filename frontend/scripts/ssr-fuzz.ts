// npm run ssr-fuzz -- --seeds N --start S [--jobs J] [--rust SSR] [--out DIR] [--dev]
// The SSR fuzz (docs/RESULTS.md, "Slice 5"): for each program of the plan fuzz's generator (plan/fuzz/gen.ts), Rust's
// server HTML of its plan must be Solid's own server HTML of its TSX twin byte for byte, and Chromium must hydrate both
// with Solid's client build and replay the scenario recorded on native Solid (ssr/run.ts, ssr/browser.ts). --dev also
// hydrates the Rust HTML with Solid's dev client builds, which report mismatches on the console.
// Writes DIR (default .out/ssr-fuzz/run-S-N/): summary.json, summary.md, and for each program that does not agree its
// files, plan, scenario, both HTMLs and the hydration results. The Rust renderer is `ssr` from --rust, or
// $RUST_SOLID/target/debug/ssr.
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { generate } from '../plan/fuzz/gen.ts';
import { runSsrCase, type SsrOutcome } from '../ssr/run.ts';
import { openBrowser } from '../ssr/browser.ts';

const flag = (name: string) => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
const seeds = Number(flag('--seeds') ?? 100), start = Number(flag('--start') ?? 1), jobs = Number(flag('--jobs') ?? 4);
const dev = process.argv.includes('--dev');
const rust = flag('--rust') ?? (process.env.RUST_SOLID ? process.env.RUST_SOLID + '/target/debug/ssr' : undefined);
if (!rust || !existsSync(rust)) { console.error('the Rust leg needs the ssr binary: pass --rust PATH or set RUST_SOLID (missing: ' + rust + ')'); process.exit(2); }
const out = flag('--out') ?? fileURLToPath(new URL('../.out/ssr-fuzz/run-' + start + '-' + seeds + '/', import.meta.url));
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

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

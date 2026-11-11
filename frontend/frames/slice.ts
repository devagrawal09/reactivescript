// A frames slice's legs (docs/RESULTS.md, "Slice 6"): T, the all-client twin (the authored TSX on Solid); N, the
// native explicit split (the oracle); J, the plan v2.2 lowered by plan/split.ts to the canonical split, on Solid; R,
// rust-solid's frames server for the same plan, with Solid's build of J's client half. Each leg runs the slice's
// scenario on its own leg server, in a fresh page; runs are cached per process (the tests share them).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { buildProgram, runLeg, sliceDir, startNodeLeg, startRustLeg, type Build, type FramesProgram, type HostSpec, type Step, type Trace } from './harness.ts';
import { siteNames } from './sites.ts';
import { splitTsx } from '../plan/split.ts';
import type { FramesPlan } from '../plan/resolve-frames.ts';
import { fileURLToPath } from 'node:url';

export type LegName = 'T' | 'N' | 'J' | 'R';
export type Slice = {
  name: string; plan: FramesPlan; hosts: HostSpec; steps: Step[];
  /** The authored twin, the oracle's split and the plan's split, as frames programs. */
  programs: Record<'T' | 'N' | 'J', FramesProgram & { placed: boolean }>;
};

export function loadSlice(name: string): Slice {
  const dir = sliceDir(name);
  const read = (f: string) => readFileSync(join(dir, f), 'utf8');
  const plan = JSON.parse(readFileSync(fileURLToPath(new URL('../plan/' + name + '.plan.json', import.meta.url)), 'utf8')) as FramesPlan;
  const hosts = JSON.parse(read('db.hosts.json')) as HostSpec;
  const scenario = JSON.parse(read(name + '.scenario.json'));
  if (scenario.version !== 2.2) throw new Error('a frames scenario is format 2.2');
  return {
    name, plan, hosts, steps: scenario.steps,
    programs: {
      T: { modules: { [name + '.tsx']: read(name + '.tsx') }, entry: name + '.tsx', hosts, placed: false },
      N: { modules: { [name + '.server.tsx']: read(name + '.server.tsx'), [name + '.split.tsx']: read(name + '.split.tsx') }, entry: name + '.split.tsx', hosts, placed: true },
      J: { modules: splitTsx(plan, name), entry: name + '.split.tsx', hosts, placed: true },
    },
  };
}

/** The answer script the Rust server replays: the native split's server host log (host, call per host, args, value or
 *  error), recorded from a run of N. */
export function answerScript(hosts: Trace['hosts']) {
  const calls = new Map<string, number>();
  return hosts.map(h => { const call = (calls.get(h.host) ?? 0) + 1; calls.set(h.host, call); return { host: h.host, call, args: h.args, ...('error' in h && h.error !== undefined ? { error: h.error } : { value: h.value }) }; });
}

const cache = new Map<string, Promise<Trace>>();
/** Runs one leg of a slice (cached by slice, leg and build). R needs `rust` (rust-solid's frames-server) and the answer
 *  script recorded from N. */
export function runSliceLeg(s: Slice, leg: LegName, build: Build = 'prod', rust?: string): Promise<Trace> {
  const key = s.name + ' ' + leg + ' ' + build;
  if (!cache.has(key)) cache.set(key, (async () => {
    const p = s.programs[leg === 'R' ? 'J' : leg];
    const b = buildProgram(p);
    const ids = Object.fromEntries([...b.functions].map(([id, f]) => [f.name, id]));
    const sites = Object.fromEntries(Object.entries(siteNames(s.plan, p.placed)).map(([f, site]) => [ids[f] ?? f, site]));
    let server;
    if (leg === 'R') {
      if (!rust) throw new Error('the R leg needs rust-solid\'s frames-server');
      const n = await runSliceLeg(s, 'N', 'prod');
      const dir = fileURLToPath(new URL('../.out/frames/rust/' + s.name + '/', import.meta.url));
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'plan.json'), JSON.stringify(s.plan));
      writeFileSync(join(dir, 'answers.json'), JSON.stringify(answerScript(n.hosts)));
      server = await startRustLeg(rust, join(dir, 'plan.json'), join(dir, 'answers.json'));
    } else server = await startNodeLeg(b);
    try {
      return await runLeg(server, b, p.entry, { sites, steps: s.steps, build });
    } finally { await server.close(); }
  })());
  return cache.get(key)!;
}

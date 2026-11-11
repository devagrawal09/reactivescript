// Suspected Solid issue 10 (docs/scratch/solid-rc21-issues.md, "Issue 10"): a server component under a `Show` is
// hidden, its call's argument changes and the new call's response lands while it is hidden; shown again, it renders
// the answer it showed before it was hidden, not the current one. The same app with a client component shows the
// current answer. Found by the placement fuzz (seed 982 and others).
//
// Run from frontend/: `nix shell nixpkgs#nodejs_24 -c node --experimental-strip-types --no-warnings
// frames/repros/reshow-stale.ts` (`--dev`: Solid's dev client builds). The app modules use public Solid 2 APIs only;
// frames/harness.ts serves them as every leg is served (Solid's frames server wiring) and holds each server-function
// response until a `deliver` step.
import { buildProgram, closeBrowser, runLeg, startNodeLeg, type FramesProgram, type Step } from '../harness.ts';

const hosts: FramesProgram['hosts'] = {
  table: [{ id: 1, title: 'One' }, { id: 2, title: 'Two' }, { id: 3, title: 'Three' }],
  hosts: [{ name: 'titleOf', kind: 'scalar', field: 'title' }],
};

const client = `import { Loading, Show, createMemo, createSignal } from "solid-js";
import { titleOf } from "./db";
async function loadOne(id: number) { "use server"; const v = await titleOf(id); return v; }
function Card(props: { title: string }) { return <b>{"card " + props.title}</b>; }
export default function App() {
  const [sel, setSel] = createSignal(1);
  const [shown, setShown] = createSignal(true);
  const card = createMemo(() => loadOne(sel()));
  return <main><button onClick={() => setShown(!shown())}>toggle</button><button onClick={() => setSel(3)}>pick</button>
    <Loading fallback="…"><Show when={shown()}><Card title={card()} /></Show></Loading></main>;
}
`;
const server = `import { titleOf } from "./db";
export async function loadOne(id: number) { "use server"; const v = await titleOf(id); return v; }
export async function Card$server(id: number) { "use server"; const t = await loadOne(id); return () => <b>{"card " + t}</b>; }
`;
const split = `import { Loading, Show, createMemo, createSignal, dynamicComponent } from "solid-js";
import { Card$server } from "./app.server.tsx";
export default function App() {
  const [sel, setSel] = createSignal(1);
  const [shown, setShown] = createSignal(true);
  const card = createMemo(() => Card$server(sel()));
  const Card = dynamicComponent(() => card());
  return <main><button onClick={() => setShown(!shown())}>toggle</button><button onClick={() => setSel(3)}>pick</button>
    <Loading fallback="…"><Show when={shown()}><Card /></Show></Loading></main>;
}
`;

const click = (text: string): Step => ({ type: 'click', target: { text, index: 0 } }) as Step;
const deliver = (site: string, call: number): Step => ({ type: 'deliver', site, call }) as Step;
// hide; pick 3 (its response lands while hidden); show. `--pending`: show while the response is still out, then
// deliver it.
const steps: Step[] = process.argv.includes('--pending')
  ? [{ type: 'mount' } as Step, click('toggle'), click('pick'), click('toggle'), deliver('card', 2)]
  : [{ type: 'mount' } as Step, click('toggle'), click('pick'), deliver('card', 2), click('toggle')];

const legs = {
  client: { program: { modules: { 'app.tsx': client }, entry: 'app.tsx', hosts }, sites: { loadOne: 'card' } },
  frames: { program: { modules: { 'app.server.tsx': server, 'app.split.tsx': split }, entry: 'app.split.tsx', hosts }, sites: { Card$server: 'card' } },
};
for (const [name, leg] of Object.entries(legs)) {
  const b = buildProgram(leg.program);
  const sites = Object.fromEntries([...b.functions].map(([id, f]) => [id, (leg.sites as Record<string, string>)[f.name] ?? f.name]));
  const srv = await startNodeLeg(b);
  try {
    const t = await runLeg(srv, b, leg.program.entry, { sites, chooser: (_l, i) => steps[i] ?? null, build: process.argv.includes('--dev') ? 'dev' : 'prod' });
    console.log('== ' + name);
    t.steps.forEach((s, i) => console.log(String(i).padStart(2), JSON.stringify({ ...s, frame: undefined }).padEnd(60), '|', t.frames[i]));
    console.log('requests', t.requests.map(r => r.site + '#' + r.call + JSON.stringify(r.args)).join(' '));
    if (t.problems.length) console.log('problems', t.problems);
  } finally { await srv.close(); }
}
await closeBrowser();

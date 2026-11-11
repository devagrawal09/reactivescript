// Suspected Solid issue 9 (docs/scratch/solid-rc21-issues.md, "Issue 9"): an island's event handler reads its slot
// props while its server component's refetch is staged in a still-pending action, and the read throws NotReadyError
// out of the handler (an uncaught page error; the click does nothing). The same app with the list as a client
// component handles the click. Found by the placement fuzz (seed 204).
//
// Run from frontend/: `nix shell nixpkgs#nodejs_24 -c node --experimental-strip-types --no-warnings
// frames/repros/island-not-ready.ts` (`--dev`: Solid's dev client builds). The app modules use public Solid 2 APIs only; frames/harness.ts serves them as
// every leg is served (Solid's frames server wiring) and holds each server-function response until a `deliver` step.
import { buildProgram, closeBrowser, runLeg, startNodeLeg, type FramesProgram, type Step } from '../harness.ts';

const hosts: FramesProgram['hosts'] = {
  table: [{ id: 1, title: 'One', owner: '' }, { id: 2, title: 'Two', owner: '' }],
  hosts: [
    { name: 'rowsOf', kind: 'list', fields: ['id', 'title', 'owner'] },
    { name: 'topOf', kind: 'list', fields: ['id', 'title'] },
    { name: 'claimRow', kind: 'assign', field: 'owner', value: 'me' },
  ],
};

const client = `import { For, Loading, action, createMemo, createSignal, refresh } from "solid-js";
import { rowsOf, topOf, claimRow } from "./db";
async function loadRows() { "use server"; const v = await rowsOf(); return v; }
async function loadTop() { "use server"; const v = await topOf(); return v; }
async function act(id: number) { "use server"; const v = await claimRow(id); return v; }
function Chip(props: { id: number; label: string; act: (id: number) => void }) { return <button onClick={() => props.act(props.id)}>{props.label}</button>; }
function TopList(props: { items: { id: number; title: string }[]; act: (id: number) => void }) { return <ul><For each={props.items}>{(x) => <li><Chip id={x.id} label={x.title} act={props.act} /></li>}</For></ul>; }
export default function App() {
  const rows = createMemo(() => loadRows());
  const top = createMemo(() => loadTop());
  const take = action(function* (id: number) { yield act(id); refresh(rows); refresh(top); });
  return <main><Loading fallback="…"><TopList items={top()} act={take} /><p>{"rows " + rows().length}</p></Loading></main>;
}
`;
const server = `import { For } from "solid-js";
import { rowsOf, topOf, claimRow } from "./db";
export async function loadRows() { "use server"; const v = await rowsOf(); return v; }
export async function loadTop() { "use server"; const v = await topOf(); return v; }
export async function act(id: number) { "use server"; const v = await claimRow(id); return v; }
export async function TopList$server() { "use server"; const top = await loadTop(); return (props: any) => <ul><For each={top}>{(x) => <li><props.Chip id={x.id} label={x.title} /></li>}</For></ul>; }
`;
const split = `import { Loading, action, createMemo, dynamicComponent, refresh } from "solid-js";
import { loadRows, act, TopList$server } from "./app.server.tsx";
function Chip(props: { id: number; label: string; act: (id: number) => void }) { return <button onClick={() => props.act(props.id)}>{props.label}</button>; }
export default function App() {
  const rows = createMemo(() => loadRows());
  const top = createMemo(() => TopList$server());
  const Top = dynamicComponent(() => top());
  const take = action(function* (id: number) { yield act(id); refresh(rows); refresh(top); });
  return <main><Loading fallback="…"><Top Chip={(p) => <Chip id={p.id} label={p.label} act={take} />} /><p>{"rows " + rows().length}</p></Loading></main>;
}
`;

const click = (text: string): Step => ({ type: 'click', target: { text, index: 0 } }) as Step;
const deliver = (site: string, call: number): Step => ({ type: 'deliver', site, call }) as Step;
// take(1); its act lands; top's refetch lands while rows' is still out (the action is pending); then a chip is clicked.
const steps: Step[] = [{ type: 'mount' } as Step, click('One'), deliver('act', 1), deliver('top', 2), click('Two'), deliver('act', 2), deliver('rows', 2), deliver('rows', 3), deliver('top', 3)];

const legs = {
  client: { program: { modules: { 'app.tsx': client }, entry: 'app.tsx', hosts }, sites: { loadRows: 'rows', loadTop: 'top', act: 'act' } },
  frames: { program: { modules: { 'app.server.tsx': server, 'app.split.tsx': split }, entry: 'app.split.tsx', hosts }, sites: { loadRows: 'rows', TopList$server: 'top', act: 'act' } },
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

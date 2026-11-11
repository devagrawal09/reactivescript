// Suspected Solid issue 8 (docs/scratch/solid-rc21-issues.md, "Issue 8"): a server component's argument switch is
// held until an unrelated action's refresh of ANOTHER server component lands. The same app with client components
// shows the switch as soon as its own data lands. Found by the placement fuzz (seed 19).
//
// Run from frontend/: `nix shell nixpkgs#nodejs_24 -c node --experimental-strip-types --no-warnings
// frames/repros/switch-held.ts` (`--dev`: Solid's dev client builds). The app modules below use public Solid 2 APIs only (solid-js, "use server");
// frames/harness.ts serves them the way frames/leg-server.ts serves every leg (Solid's own frames server wiring and
// server-function handler), drives Chromium, and holds each server-function response until a `deliver` step.
import { buildProgram, closeBrowser, runLeg, startNodeLeg, type FramesProgram, type Step } from '../harness.ts';

const db = `export server pure fn titleOf(id: number): string
export server pure fn topOf(): { id: number, title: string }[]
export server fn claimRow(id: number): string
`;
void db;
const hosts: FramesProgram['hosts'] = {
  table: [{ id: 1, title: 'One', owner: '' }, { id: 2, title: 'Two', owner: '' }, { id: 3, title: 'Three', owner: '' }],
  hosts: [
    { name: 'titleOf', kind: 'scalar', field: 'title' },
    { name: 'topOf', kind: 'list', fields: ['id', 'title'] },
    { name: 'claimRow', kind: 'assign', field: 'owner', value: 'me' },
  ],
};

// All client: Card and Top are client components reading server functions.
const client = `import { Loading, action, createMemo, createSignal, refresh } from "solid-js";
import { titleOf, topOf, claimRow } from "./db";
async function loadOne(id: number) { "use server"; const t = await titleOf(id); return t; }
async function loadTop() { "use server"; const v = await topOf(); return v; }
async function act(id: number) { "use server"; const v = await claimRow(id); return v; }
function Card(props: { id: number }) { const t = createMemo(() => loadOne(props.id)); return <b>{"card " + t()}</b>; }
export default function App() {
  const [sel, setSel] = createSignal(1);
  const take = action(function* () { yield act(1); refresh(top); });
  const top = createMemo(() => loadTop());
  return <main><button onClick={() => take()}>take</button><button onClick={() => setSel(3)}>pick</button><Loading fallback="…"><Card id={sel()} /><i>{"top " + top().length}</i></Loading></main>;
}
`;

// The same app with Card and Top as server components.
const server = `import { titleOf, topOf, claimRow } from "./db";
export async function act(id: number) { "use server"; const v = await claimRow(id); return v; }
export async function Card$server(id: number) { "use server"; const t = await titleOf(id); return () => <b>{"card " + t}</b>; }
export async function Top$server() { "use server"; const v = await topOf(); return () => <i>{"top " + v.length}</i>; }
`;
const split = `import { Loading, action, createMemo, createSignal, dynamicComponent, refresh } from "solid-js";
import { act, Card$server, Top$server } from "./app.server.tsx";
export default function App() {
  const [sel, setSel] = createSignal(1);
  const card = createMemo(() => Card$server(sel()));
  const top = createMemo(() => Top$server());
  const Card = dynamicComponent(() => card());
  const Top = dynamicComponent(() => top());
  const take = action(function* () { yield act(1); refresh(top); });
  return <main><button onClick={() => take()}>take</button><button onClick={() => setSel(3)}>pick</button><Loading fallback="…"><Card /><Top /></Loading></main>;
}
`;

// Card a server component, top plain data.
const mixedServer = `import { titleOf, topOf, claimRow } from "./db";
export async function act(id: number) { "use server"; const v = await claimRow(id); return v; }
export async function loadTop() { "use server"; const v = await topOf(); return v; }
export async function Card$server(id: number) { "use server"; const t = await titleOf(id); return () => <b>{"card " + t}</b>; }
`;
const mixedSplit = `import { Loading, action, createMemo, createSignal, dynamicComponent, refresh } from "solid-js";
import { act, loadTop, Card$server } from "./app.server.tsx";
export default function App() {
  const [sel, setSel] = createSignal(1);
  const card = createMemo(() => Card$server(sel()));
  const top = createMemo(() => loadTop());
  const Card = dynamicComponent(() => card());
  const take = action(function* () { yield act(1); refresh(top); });
  return <main><button onClick={() => take()}>take</button><button onClick={() => setSel(3)}>pick</button><Loading fallback="…"><Card /><i>{"top " + top().length}</i></Loading></main>;
}
`;

const click = (text: string): Step => ({ type: 'click', target: { text, index: 0 } }) as Step;
const deliver = (site: string, call: number): Step => ({ type: 'deliver', site, call }) as Step;
// take -> act lands -> refresh(top) is out (held); pick -> the card's new call lands; then top's refetch lands.
const steps: Step[] = [{ type: 'mount' } as Step, click('take'), deliver('act', 1), click('pick'), deliver('card', 2), deliver('top', 2)];

const legs = {
  client: { program: { modules: { 'app.tsx': client }, entry: 'app.tsx', hosts }, sites: { loadOne: 'card', loadTop: 'top', act: 'act' } },
  frames: { program: { modules: { 'app.server.tsx': server, 'app.split.tsx': split }, entry: 'app.split.tsx', hosts }, sites: { Card$server: 'card', Top$server: 'top', act: 'act' } },
  mixed: { program: { modules: { 'app.server.tsx': mixedServer, 'app.split.tsx': mixedSplit }, entry: 'app.split.tsx', hosts }, sites: { Card$server: 'card', loadTop: 'top', act: 'act' } },
};
for (const [name, leg] of Object.entries(legs)) {
  const b = buildProgram(leg.program);
  const sites = Object.fromEntries([...b.functions].map(([id, f]) => [id, (leg.sites as Record<string, string>)[f.name] ?? f.name]));
  const srv = await startNodeLeg(b);
  try {
    const t = await runLeg(srv, b, leg.program.entry, { sites, chooser: (_l, i) => steps[i] ?? null, build: process.argv.includes('--dev') ? 'dev' : 'prod' });
    console.log('== ' + name);
    t.steps.forEach((s, i) => console.log(String(i).padStart(2), JSON.stringify({ ...s, frame: undefined }).padEnd(60), '|', t.frames[i]));
    if (t.problems.length) console.log('problems', t.problems);
  } finally { await srv.close(); }
}
await closeBrowser();

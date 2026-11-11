// The PL pins (docs/SLICE6-FRAMES.md 6.4): for each rule that keeps a site on the client because server placement would
// change what the page does, a minimal program in two prints — T, the all-client twin, and F, the site FORCED to the
// server by hand (what placement would print without the rule) — run on the same clicks, every held request delivered
// as soon as it is out. plan/frames.test.ts asserts the difference each rule prevents. The prints use public Solid 2
// APIs only; frames/harness.ts serves and drives them like every other leg.
import { buildProgram, runLeg, startNodeLeg, type FramesProgram, type HostSpec, type Step, type Trace } from './harness.ts';

export const PIN_HOSTS: HostSpec = {
  table: [{ id: 1, title: 'One', body: 'first', owner: '' }, { id: 2, title: 'Two', body: 'second', owner: '' }, { id: 3, title: 'Three', body: 'third', owner: 'bo' }],
  hosts: [
    { name: 'rowOf', kind: 'record', fields: ['id', 'title', 'body', 'owner'] },
    { name: 'countOpen', kind: 'count', field: 'owner', equals: '' },
    { name: 'titleOf', kind: 'scalar', field: 'title' },
    { name: 'topOf', kind: 'list', fields: ['id', 'title'] },
    { name: 'claimRow', kind: 'assign', field: 'owner', value: 'me' },
  ],
};

export type Pin = { rule: string; clicks: string[]; T: FramesProgram; F: FramesProgram };
const prog = (modules: Record<string, string>, entry: string): FramesProgram => ({ modules, entry, hosts: PIN_HOSTS });

export const PINS: Record<string, Pin> = {
  // PL-3c (two questions): one server root would answer both questions in one request, so a change of one re-asks
  // both hosts; the twin asks only the question that changed.
  'PL-3c': {
    rule: 'PL-3c',
    clicks: ['next', 'take'],
    T: prog({ 'app.tsx': `import { Loading, action, createMemo, createSignal, refresh } from "solid-js";
import { rowOf, countOpen, claimRow } from "./db";
async function loadPick(id: number) { "use server"; const v = await rowOf(id); return v; }
async function loadTotal() { "use server"; const v = await countOpen(); return v; }
async function act(id: number) { "use server"; const v = await claimRow(id); return v; }
function PairView(props: { pick: { title: string }; total: number }) { return <p>{props.pick.title + " of " + props.total}</p>; }
export default function App() {
  const [sel, setSel] = createSignal(1);
  const pick = createMemo(() => loadPick(sel()));
  const total = createMemo(() => loadTotal());
  const take = action(function* () { yield act(sel()); refresh(total); });
  return <main><button onClick={() => setSel(2)}>next</button><button onClick={() => take()}>take</button><Loading fallback="…"><PairView pick={pick()} total={total()} /></Loading></main>;
}
` }, 'app.tsx'),
    F: prog({ 'app.server.tsx': `import { rowOf, countOpen, claimRow } from "./db";
export async function loadPick(id: number) { "use server"; const v = await rowOf(id); return v; }
export async function loadTotal() { "use server"; const v = await countOpen(); return v; }
export async function act(id: number) { "use server"; const v = await claimRow(id); return v; }
export async function PairView$server(id: number) { "use server"; const pick = await loadPick(id); const total = await loadTotal(); return (props: any) => <p>{pick.title + " of " + total}</p>; }
`, 'app.split.tsx': `import { Loading, action, createMemo, createSignal, dynamicComponent, refresh } from "solid-js";
import { act, PairView$server } from "./app.server.tsx";
export default function App() {
  const [sel, setSel] = createSignal(1);
  const pair = createMemo(() => PairView$server(sel()));
  const Pair = dynamicComponent(() => pair());
  const take = action(function* () { yield act(sel()); refresh(pair); });
  return <main><button onClick={() => setSel(2)}>next</button><button onClick={() => take()}>take</button><Loading fallback="…"><Pair /></Loading></main>;
}
` }, 'app.split.tsx'),
  },
  // PL-3d (markup reads client state): a server root would take the client state as an argument, so each change of it
  // is a request; the twin re-renders locally.
  'PL-3d': {
    rule: 'PL-3d',
    clicks: ['mode', 'mode'],
    T: prog({ 'app.tsx': `import { Loading, createMemo, createSignal } from "solid-js";
import { titleOf } from "./db";
async function loadOne(id: number) { "use server"; const v = await titleOf(id); return v; }
function Card(props: { id: number; mode: string }) { const c = createMemo(() => loadOne(props.id)); return <b>{c() + " " + props.mode}</b>; }
export default function App() {
  const [mode, setMode] = createSignal("all");
  return <main><button onClick={() => setMode(mode() === "all" ? "open" : "all")}>mode</button><Loading fallback="…"><Card id={1} mode={mode()} /></Loading></main>;
}
` }, 'app.tsx'),
    F: prog({ 'app.server.tsx': `import { titleOf } from "./db";
export async function loadOne(id: number) { "use server"; const v = await titleOf(id); return v; }
export async function Card$server(id: number, mode: string) { "use server"; const c = await loadOne(id); return (props: any) => <b>{c + " " + mode}</b>; }
`, 'app.split.tsx': `import { Loading, createMemo, createSignal, dynamicComponent } from "solid-js";
import { Card$server } from "./app.server.tsx";
export default function App() {
  const [mode, setMode] = createSignal("all");
  const card = createMemo(() => Card$server(1, mode()), { lazy: true });
  const Card = dynamicComponent(() => card());
  return <main><button onClick={() => setMode(mode() === "all" ? "open" : "all")}>mode</button><Loading fallback="…"><Card /></Loading></main>;
}
` }, 'app.split.tsx'),
  },
  // PL-5 (stateful islands under a server row): a refresh gives the twin's For new row objects, so it re-creates its
  // rows and the island's state starts over; a server row's slot occurrence keeps its id across the refetch (the
  // frames client morphs the new markup in), so the island would keep its state.
  'PL-5': {
    rule: 'PL-5',
    clicks: ['One off', 'take'],
    T: prog({ 'app.tsx': `import { For, Loading, action, createMemo, createSignal, refresh } from "solid-js";
import { topOf, claimRow } from "./db";
async function loadTop() { "use server"; const v = await topOf(); return v; }
async function act(id: number) { "use server"; const v = await claimRow(id); return v; }
function Toggle(props: { label: string }) { const [on, setOn] = createSignal(false); return <button onClick={() => setOn(!on())}>{props.label + (on() ? " on" : " off")}</button>; }
function TopToggles(props: { items: { id: number; title: string }[] }) { return <ul><For each={props.items}>{(x) => <li><Toggle label={x.title} /></li>}</For></ul>; }
export default function App() {
  const top = createMemo(() => loadTop());
  const take = action(function* () { yield act(2); refresh(top); });
  return <main><button onClick={() => take()}>take</button><Loading fallback="…"><TopToggles items={top()} /></Loading></main>;
}
` }, 'app.tsx'),
    F: prog({ 'app.server.tsx': `import { For } from "solid-js";
import { topOf, claimRow } from "./db";
export async function loadTop() { "use server"; const v = await topOf(); return v; }
export async function act(id: number) { "use server"; const v = await claimRow(id); return v; }
export async function TopToggles$server() { "use server"; const top = await loadTop(); return (props: any) => <ul><For each={top}>{(x) => <li><props.Toggle label={x.title} /></li>}</For></ul>; }
`, 'app.split.tsx': `import { Loading, action, createMemo, createSignal, dynamicComponent, refresh } from "solid-js";
import { act, TopToggles$server } from "./app.server.tsx";
function Toggle(props: { label: string }) { const [on, setOn] = createSignal(false); return <button onClick={() => setOn(!on())}>{props.label + (on() ? " on" : " off")}</button>; }
export default function App() {
  const top = createMemo(() => TopToggles$server());
  const Top = dynamicComponent(() => top());
  const take = action(function* () { yield act(2); refresh(top); });
  return <main><button onClick={() => take()}>take</button><Loading fallback="…"><Top Toggle={(p) => <Toggle label={p.label} />} /></Loading></main>;
}
` }, 'app.split.tsx'),
  },
};

/** Runs one print of a pin: each click in turn, every held request delivered (oldest first) before the next click. */
export async function runPin(pin: Pin, which: 'T' | 'F'): Promise<Trace> {
  const program = pin[which];
  const b = buildProgram(program);
  const sites = Object.fromEntries([...b.functions].map(([id, f]) => [id, f.name]));
  const clicks = [...pin.clicks];
  const chooser = (live: { held: { site: string; call: number }[] }, index: number): Step | null => {
    if (index === 0) return { type: 'mount' } as Step;
    if (live.held.length) return { type: 'deliver', site: live.held[0].site, call: live.held[0].call } as Step;
    const c = clicks.shift();
    return c === undefined ? null : ({ type: 'click', target: { text: c, index: 0 } } as Step);
  };
  const srv = await startNodeLeg(b);
  try { return await runLeg(srv, b, program.entry, { sites, chooser: chooser as never }); }
  finally { await srv.close(); }
}

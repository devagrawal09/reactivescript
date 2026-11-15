// React Compiler as a fourth frontend (react/lower.ts). A .react.tsx fixture is accepted only if it lowers to the same
// plan v2 as its TSX twin and React 19 renders the slice scenario's frames; everything else is a typed refusal.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadScenario } from "../slices/run-js.ts";
import { resolvePlanV2 } from "../plan/resolve-v2.ts";
import { loadReactModules, lowerReact, ReactRefusal, type RefusalCode } from "./lower.ts";
import { runReact } from "./run-react.ts";

const path = (p: string) => fileURLToPath(new URL("../" + p, import.meta.url));
const read = (p: string) => { try { return readFileSync(p, "utf8"); } catch { return undefined; } };

for (const [name, saved] of [["like", "plan/like.plan-v2.json"], ["tracker", "plan/tracker.plan.json"]]) {
  const source = path("slices/" + name + "/" + name + ".react.tsx");
  test(name + ".react.tsx lowers to the TSX twin's plan", () => {
    assert.equal(JSON.stringify(resolvePlanV2(loadReactModules(source, read), { async: false }), null, 2) + "\n", read(path(saved)));
  });
  test(name + ".react.tsx renders the scenario's frames on React 19", async () => {
    await runReact(source, loadScenario(path("slices/" + name + "/" + name + ".scenario.json")));
  });
}

const HEAD = `import { startTransition, useEffect, useOptimistic, useRef, useState } from "react";\nimport { save } from "./api";\n`;
const REFUSED: [RefusalCode, string, string][] = [
  ["REACT_COMPILER", "a hook called conditionally", `export default function A() { const [n, setN] = useState(0); if (n > 1) { useState(2); } return <b>{n}</b>; }`],
  ["REACT_COMPILER", "a ref read during render", `export default function A() { const r = useRef(0); return <b>{r.current}</b>; }`],
  ["REACT_NOT_COMPONENT", "no component", `export default function helper() { return 1; }`],
  ["REACT_SET_STATE_IN_RENDER", "a setter called in render", `export default function A() { const [n, setN] = useState(0); setN(1); return <b>{n}</b>; }`],
  ["REACT_SET_STATE_IN_RENDER", "derived state copied in render", `export default function A() { const [n, setN] = useState(0); const [p, setP] = useState(0); if (n !== p) { setP(n); } return <b>{n}</b>; }`],
  ["REACT_EFFECT", "an effect", `export default function A() { const [n, setN] = useState(0); useEffect(() => { setN(1); }, []); return <b>{n}</b>; }`],
  ["REACT_HOOK", "an unknown library hook", `import { useQuery } from "lib";\nexport default function A() { const q = useQuery(); return <b>{q}</b>; }`],
  ["REACT_UNDECIDED", "a let reassigned in render", `export default function A() { const [n, setN] = useState(0); let m = n; if (n > 1) { m = 2; } return <b>{m}</b>; }`],
  ["REACT_STALE_READ", "state read after an await", `export default function A() { const [n, setN] = useState(0); return <button onClick={() => startTransition(async () => { await save(); startTransition(() => setN(n + 1)); })}>{n}</button>; }`],
  ["REACT_URGENT_WRITE", "a setter after an await outside startTransition", `export default function A() { const [n, setN] = useState(0); return <button onClick={() => startTransition(async () => { const v: number = await save(); setN(v); })}>{n}</button>; }`],
  ["REACT_OPTIMISTIC_BASE_WRITE", "a plain handler writes the state under an optimistic value", `export default function A() { const [n, setN] = useState(0); const [s, setS] = useOptimistic(n); return <div><button onClick={() => startTransition(async () => { setS((v) => v + 1); try { const v: number = await save(); startTransition(() => setN(v)); } catch (error) {} })}>{s}</button><button onClick={() => setN((v) => v + 1)}>go</button></div>; }`],
  ["REACT_OPTIMISTIC_OUTSIDE_ACTION", "an optimistic write in a plain handler", `export default function A() { const [n, setN] = useState(0); const [s, setS] = useOptimistic(n); return <button onClick={() => setS(5)}>{s}</button>; }`],
  ["REACT_FALSY_RENDER", "a number guarding markup with &&", `export default function A() { const [n, setN] = useState(0); return <div>{n && <b>x</b>}</div>; }`],
  ["REACT_LAZY_STATE", "a lazy initial state", `export default function A() { const [n, setN] = useState(() => 0); return <b>{n}</b>; }`],
  ["REACT_PROPS", "an entry component with props", `export default function A(props: { x: number }) { return <b>{props.x}</b>; }`],
  ["REACT_COMPONENT_IMPORTED", "a component from a library", `import { Icon } from "lib";\nexport default function A() { return <b><Icon /></b>; }`],
  ["REACT_COMPONENT_IMPORTED", "a member tag", `import { UI } from "lib";\nexport default function A() { return <b><UI.Icon /></b>; }`],
  ["REACT_SYNTAX", "a style object", `export default function A() { return <b style={{ color: "red" }}>x</b>; }`],
  ["REACT_SYNTAX", "a setter passed as a callback", `function C(props: { on: (x: number) => void }) { return <b onClick={() => props.on(1)}>x</b>; }\nexport default function A() { const [n, setN] = useState(0); return <div><C on={setN} />{n}</div>; }`],
  ["REACT_SYNTAX", "an async handler outside startTransition", `export default function A() { const [n, setN] = useState(0); return <button onClick={async () => { const v: number = await save(); setN(v); }}>{n}</button>; }`],
];
for (const [code, what, source] of REFUSED) {
  test(code + ": " + what, () => {
    assert.throws(() => lowerReact(HEAD + source, "a.react.tsx"), (e: unknown) => e instanceof ReactRefusal && e.code === code);
  });
}

test("generated programs (seeds 1..12): React and the plan give the same frames, or the frontend refuses", async () => {
  const { check } = await import("./fuzz.ts");
  for (let seed = 1; seed <= 12; seed++) assert.notEqual((await check(seed)).result, "disagree", "seed " + seed);
});

test("a request settling while another is open counts as batched, not as a difference (seed 63)", async () => {
  const { check } = await import("./fuzz.ts");
  assert.equal((await check(63)).result, "batched");
});

// Plan v2.3 (plan/docs/PLAN-V2.md, "v2.3: composition"): the module's own components, their props and children, and host
// attributes. The plan fuzz's React twin is the differential check; these are its rules one at a time.
const plan = (source: string) => resolvePlanV2(loadReactModules("/a.react.tsx", p => (p === "/a.react.tsx" ? source : undefined)), { compose: true });

test("plan v2.3: React's attribute names become HTML's (className, tabIndex), others stay as written", () => {
  const p = plan(`export default function A() { return <p className="x" tabIndex={1} aria-label="y" data-n={2}>w</p>; }`);
  const el = p.markup[0];
  assert.ok(el.kind === "element");
  assert.deepEqual(el.attrs!.map(a => a.name), ["class", "tabindex", "aria-label", "data-n"]);
});

test("plan v2.3: a ternary of two values is a text hole, not a Show", () => {
  const p = plan(`import { useState } from "react";\nexport default function A() { const [on, setOn] = useState(true); return <p>{on ? "a" : "b"}</p>; }`);
  const el = p.markup[0];
  assert.ok(el.kind === "element");
  assert.deepEqual(el.children.map(c => c.kind), ["text"]);
});

test("plan v2.3: a component reached from the entry is lowered with its props; one never applied is left out", () => {
  const p = plan(`function Badge({ label }: { label: string }) { return <li>{label}</li>; }
function Unused() { return <i>u</i>; }
export default function A() { return <ul><Badge label="a" /></ul>; }`);
  assert.deepEqual(p.components!.map(c => [c.name, c.props]), [["Badge", [{ name: "label", kind: "value" }]]]);
});

test("plan v2.3: children read as {children} or {props.children} are a children view", () => {
  for (const read of ["{children}", "{props.children}"]) {
    const head = read === "{children}" ? "{ children }: { children: React.ReactNode }" : "props: { children: React.ReactNode }";
    const p = plan(`function Panel(${head}) { return <section>${read}</section>; }\nexport default function A() { return <div><Panel><b>k</b></Panel></div>; }`);
    assert.deepEqual(p.components![0].markup[0], { kind: "element", tag: "section", events: [], children: [{ kind: "children" }] }, read);
  }
});

test("plan v2.3: an action passed by name and a callback passed on run in React and the plan with the same frames", async () => {
  const source = `import { startTransition, useState } from "react";
function Inner(props: { onPick: (x: number) => void; n: number }) {
  return <button onClick={() => props.onPick(props.n)}>{"pick " + props.n}</button>;
}
function Outer(props: { onPick: (x: number) => void; n: number }) {
  return <p><Inner onPick={props.onPick} n={props.n + 1} /></p>;
}
export default function App() {
  const [n, setN] = useState(0);
  const bump = (x: number) => startTransition(async () => { setN(x + 2); });
  return <div><Outer onPick={bump} n={n} /><span>{n}</span></div>;
}
`;
  const p = plan(source);
  const outer = p.markup[0].kind === "element" ? p.markup[0].children[0] : undefined;
  assert.ok(outer?.kind === "component");
  assert.deepEqual(outer.props[0], { name: "onPick", action: "bump" });
  const inner = p.components!.find(c => c.name === "Outer")!.markup[0];
  assert.ok(inner.kind === "element" && inner.children[0].kind === "component");
  assert.deepEqual(inner.children[0].props[0], { name: "onPick", forward: "onPick" });
  const { scenarioFrames } = await import("./fuzz.ts");
  assert.deepEqual(await scenarioFrames(source, p, 3), ["pick 10", "pick 43", "pick 76", "pick 109"]);
});

test("plan v2.3: the plan fuzz's React twins lower to the TSX twin's plan and show native Solid's frames (seeds 1..6)", async () => {
  const { checkCompose } = await import("./fuzz.ts");
  for (let seed = 1; seed <= 6; seed++) assert.equal((await checkCompose(seed)).result, "agree", "seed " + seed);
});

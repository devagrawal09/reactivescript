// React Compiler as a fourth frontend (react/lower.ts). A .react.tsx fixture is accepted only if it lowers to the same
// plan v2 as its TSX twin and React 19 renders the slice scenario's frames; everything else is a typed refusal.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadScenario } from "../slices/run-js.ts";
import { resolvePlanV2 } from "../plan/resolve-v2.ts";
import { ladderOf, loadReactModules, lowerReact, ReactRefusal, type Level, type RefusalCode } from "./lower.ts";
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

const HEAD = `import { createContext, startTransition, useContext, useEffect, useOptimistic, useRef, useState } from "react";\nimport { save } from "./api";\n`;
const REFUSED: [RefusalCode, string, string][] = [
  ["REACT_COMPILER", "a hook called conditionally", `export default function A() { const [n, setN] = useState(0); if (n > 1) { useState(2); } return <b>{n}</b>; }`],
  ["REACT_COMPILER", "a ref read during render", `export default function A() { const r = useRef(0); return <b>{r.current}</b>; }`],
  ["REACT_NOT_COMPONENT", "no component", `export default function helper() { return 1; }`],
  ["REACT_SET_STATE_IN_RENDER", "a setter called in render", `export default function A() { const [n, setN] = useState(0); setN(1); return <b>{n}</b>; }`],
  ["REACT_SET_STATE_IN_RENDER", "derived state copied in render", `export default function A() { const [n, setN] = useState(0); const [p, setP] = useState(0); if (n !== p) { setP(n); } return <b>{n}</b>; }`],
  ["REACT_EFFECT", "an effect", `export default function A() { const [n, setN] = useState(0); useEffect(() => { setN(1); }, []); return <b>{n}</b>; }`],
  ["REACT_HOOK", "an unknown library hook", `import { useQuery } from "lib";\nexport default function A() { const q = useQuery(); return <b>{q}</b>; }`],
  ["REACT_URGENT_WRITE", "a setter after an await outside startTransition", `export default function A() { const [n, setN] = useState(0); return <button onClick={() => startTransition(async () => { const v: number = await save(); setN(v); })}>{n}</button>; }`],
  ["REACT_OPTIMISTIC_BASE_WRITE", "a plain handler writes the state under an optimistic value", `export default function A() { const [n, setN] = useState(0); const [s, setS] = useOptimistic(n); return <div><button onClick={() => startTransition(async () => { setS((v) => v + 1); try { const v: number = await save(); startTransition(() => setN(v)); } catch (error) {} })}>{s}</button><button onClick={() => setN((v) => v + 1)}>go</button></div>; }`],
  ["REACT_OPTIMISTIC_OUTSIDE_ACTION", "an optimistic write in a plain handler", `export default function A() { const [n, setN] = useState(0); const [s, setS] = useOptimistic(n); return <button onClick={() => setS(5)}>{s}</button>; }`],
  ["REACT_FALSY_RENDER", "a number guarding markup with &&", `export default function A() { const [n, setN] = useState(0); return <div>{n && <b>x</b>}</div>; }`],
  ["REACT_HELD_PLAIN_WRITE", "a plain handler writing a state an action holds", `export default function A() { const [n, setN] = useState(0); return <div><button onClick={() => startTransition(async () => { setN(n + 1); await save(); })}>{n}</button><button onClick={() => setN(n + 5)}>go</button></div>; }`],
  ["REACT_PROPS", "an entry component with props", `export default function A(props: { x: number }) { return <b>{props.x}</b>; }`],
  ["REACT_SYNTAX", "an async handler outside startTransition", `export default function A() { const [n, setN] = useState(0); return <button onClick={async () => { const v: number = await save(); setN(v); }}>{n}</button>; }`],
];
for (const [code, what, source] of REFUSED) {
  test(code + ": " + what, () => {
    assert.throws(() => lowerReact(HEAD + source, "a.react.tsx"), (e: unknown) => e instanceof ReactRefusal && e.code === code);
  });
}

// The fallback ladder: forms refused before, now lowered at a slower level that still renders React's frames.
const click = (n: number) => [{ type: "mount" as const, frame: "" }, ...Array.from({ length: n }, () => ({ type: "click" as const, element: 0, frame: "" }))];
const save = [{ name: "save", parameters: [], returns: "number" }];
const LADDER: [Level, string, string, string, number][] = [
  ["snapshot", "REACT_STALE_READ", "state read after an await", `export default function A() { const [n, setN] = useState(0); return <button onClick={() => startTransition(async () => { try { const v: number = await save(); startTransition(() => setN(n + v)); } catch (error) {} })}>{n}</button>; }`, 1],
  ["snapshot", "HELD_WRITE", "an inline action writing before its await", `export default function A() { const [n, setN] = useState(0); return <button onClick={() => startTransition(async () => { setN(n + 1); try { const v: number = await save(); startTransition(() => setN(v)); } catch (error) {} })}>{n}</button>; }`, 2],
  ["snapshot", "STALE_OWN_READ", "an updater after a write in the same handler", `export default function A() { const [n, setN] = useState(0); return <button onClick={() => { setN(n + 1); setN((v) => v + 2); }}>{n}</button>; }`, 2],
  ["coarse", "REACT_UNDECIDED", "a let reassigned in render", `export default function A() { const [n, setN] = useState(0); let m = n; if (n > 1) { m = 2; } return <button onClick={() => setN(n + 1)}>{m}</button>; }`, 3],
  ["coarse", "REACT_UNDECIDED", "a state never read", `export default function A() { const [n, setN] = useState(0); const [u, setU] = useState(1); return <button onClick={() => setN(n + 1)}>{n}</button>; }`, 1],
  ["coarse", "REACT_LAZY_STATE", "a lazy initial state", `export default function A() { const [n, setN] = useState(() => 4); return <button onClick={() => setN(n + 1)}>{n}</button>; }`, 1],
  ["coarse", "REACT_HOOK", "a ref only handlers touch", `export default function A() { const [n, setN] = useState(0); const r = useRef(0); return <button onClick={() => { r.current += 1; setN(r.current + n); }}>{n}</button>; }`, 2],
  ["coarse", "REACT_HOOK", "a context with no provider", `const Step = createContext(2);\nexport default function A() { const [n, setN] = useState(0); const k = useContext(Step); return <button onClick={() => setN(n + k)}>{n}</button>; }`, 2],
  ["island", "REACT_EFFECT", "an effect", `export default function A() { const [n, setN] = useState(0); const [d, setD] = useState(0); useEffect(() => { setD(n + n); }, [n]); return <button onClick={() => setN(n + 1)}>{n}:{d}</button>; }`, 2],
  ["island", "REACT_SYNTAX", "a custom hook", `function useCount() { const [c, setC] = useState(3); return [c, () => setC(c + 1)] as const; }\nexport default function A() { const [c, inc] = useCount(); return <button onClick={inc}>{c}</button>; }`, 2],
  ["island", "REACT_SYNTAX", "a child component with its own state", `function Cell() { const [k, setK] = useState(0); return <button onClick={() => setK(k + 1)}>{k}</button>; }\nexport default function A() { return <div><Cell /><Cell key="b" /></div>; }`, 2],
  ["island", "REACT_FALSY_RENDER", "a number guarding markup with &&", `export default function A() { const [n, setN] = useState(0); return <div><button onClick={() => setN(n + 1)}>+</button>{n && <b>{n}</b>}</div>; }`, 2],
  ["island", "REACT_SYNTAX", "an async handler outside startTransition", `export default function A() { const [n, setN] = useState(0); return <button onClick={async () => { const v: number = await save(); setN(v); }}>{n}</button>; }`, 1],
  ["coarse", "REACT_LAZY_STATE", "an initial state computed from another", `export default function A() { const [n, setN] = useState(1); const [c, setC] = useState(n + 2); return <button onClick={() => setC(c + 1)}>{c}</button>; }`, 1],
];
const load = (source: string) => loadReactModules("a.react.tsx", p => p === "a.react.tsx" ? source : p === "api.d.rx" ? "export fn save(): number\n" : undefined);
for (const [level, replaces, what, source, clicks] of LADDER) {
  test(level + " level accepts " + what + " and matches React", async () => {
    assert.ok(ladderOf(load(HEAD + source)).some(l => l.level === level && l.replaces === replaces));
    const { compare } = await import("./fuzz.ts");
    const outcome = await compare(HEAD + source, { name: what, host: save, steps: [...click(clicks), { type: "resolve", host: "save", call: 1, value: 3, frame: "" }] });
    assert.equal(outcome.result, "agree", outcome.detail);
  });
}

test("an island takes no async transition: the refusal stands", () => {
  const source = `export default function A() { const [n, setN] = useState(0); useEffect(() => {}, []); return <button onClick={() => startTransition(async () => { try { const v: number = await save(); startTransition(() => setN(v)); } catch (error) {} })}>{n}</button>; }`;
  assert.throws(() => load(HEAD + source), (e: unknown) => e instanceof ReactRefusal && e.code === "REACT_EFFECT");
});

test("REACT_HELD_PLAIN_WRITE: a plain write to a state an action writes after its await", () => {
  const source = `export default function A() { const [n, setN] = useState(0); return <div><button onClick={() => startTransition(async () => { try { const v: number = await save(); startTransition(() => setN(v)); } catch (error) {} })}>{n}</button><button onClick={() => setN(n + 5)}>go</button></div>; }`;
  assert.throws(() => lowerReact(HEAD + source, "a.react.tsx"), (e: unknown) => e instanceof ReactRefusal && e.code === "REACT_HELD_PLAIN_WRITE");
});

test("generated programs (seeds 1..12): React and the plan give the same frames, or the frontend refuses", async () => {
  const { check } = await import("./fuzz.ts");
  for (let seed = 1; seed <= 12; seed++) assert.notEqual((await check(seed)).result, "disagree", "seed " + seed);
});

test("a request settling while another is open counts as batched, not as a difference (seed 130)", async () => {
  const { check } = await import("./fuzz.ts");
  assert.equal((await check(130)).result, "batched");
});

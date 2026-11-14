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

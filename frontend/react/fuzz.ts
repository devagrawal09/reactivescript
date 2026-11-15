// React-vs-plan differential check for the React frontend. Each seed generates a small React 19 component inside the
// subset react/lower.ts claims (scalar state, derived values, sync handlers, one optional async action with
// useOptimistic), lowers it to plan v2 or a typed refusal, records its frames on React (with and without React
// Compiler), and runs the same steps on the plan leg (plan/solid-plan.ts). Usage: fuzz.ts [FIRST] [LAST]
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { runScenario } from "../slices/run-js.ts";
import { ladderOf, loadReactModules, ReactRefusal, reactPlan } from "./lower.ts";
import { runReact, type Scenario } from "./run-react.ts";

const rng = (seed: number) => () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

export type Generated = { source: string; scenario: Scenario };

/** `ladder`: also the forms the fallback ladder lowers (react/lower.ts Level), drawn from a second stream so the plain
 *  family stays as it was: a render let folded by ifs, a lazy or computed initial state and an unused state (coarse),
 *  and refs, effects and a custom hook (islands). */
export function generate(seed: number, ladder = false): Generated {
  const r = rng(seed), pick = <T,>(xs: T[]): T => xs[Math.floor(r() * xs.length)], chance = (p: number) => r() < p;
  const l = rng(seed * 7919 + 1), lpick = <T,>(xs: T[]): T => xs[Math.floor(l() * xs.length)], lchance = (p: number) => ladder && l() < p;
  const action = chance(0.5), ints = action || chance(0.5) ? ["a", "b"] : ["a"], str = chance(0.6), bool = chance(0.6);
  // A plain handler writing the optimistic base is refused (REACT_OPTIMISTIC_BASE_WRITE); keep it rare so most programs run.
  const target = () => action && chance(0.85) ? "b" : pick(ints);
  const cap = (n: string) => "set" + n[0].toUpperCase() + n.slice(1);
  const hooks = ints.map(n => `const [${n}, ${cap(n)}] = useState(${pick([0, 1, 2, 3])});`);
  if (str) hooks.push(`const [s, setS] = useState(${JSON.stringify(pick(["", "x"]))});`);
  if (bool) hooks.push(`const [on, setOn] = useState(${pick([true, false])});`);
  if (action) hooks.push(`const [shown, setShown] = useOptimistic(a);`);
  const int = () => pick([...ints, "1", "2"]);
  const derived: string[] = [];
  for (let i = 0; i < pick([0, 1, 2]); i++) {
    const forms = [`${pick(ints)} + ${int()}`, `${pick(ints)} + ${pick(ints)}`, ...(bool ? [`on ? ${pick(ints)} : ${int()}`] : [])];
    hooks.push(`const d${i} = ${pick(forms)};`); derived.push(`d${i}`);
  }
  const extraView: string[] = [], extraWrites: (() => string)[] = [];
  if (lchance(0.4)) {
    hooks.push(`let m = ${lpick([...ints, "1"])};`, `if (${lpick(ints)} > ${lpick([0, 1, 2])}) { m = ${lpick(ints)} + ${lpick([1, 2])}; }${lchance(0.5) ? ` else if (${lpick(ints)} > 3) { m = 0; }` : ""}`);
    extraView.push(`<p>m={m}</p>`); derived.push("m");
  }
  if (lchance(0.4)) {
    hooks.push(`const [c, setC] = useState(${lpick(["() => 2", "() => " + lpick(ints) + " + 1", lpick(ints) + " + 2"])});`);
    extraView.push(`<p>c={c}</p>`); extraWrites.push(() => `setC(c + 1);`, () => `setC((n) => n + 2);`);
  }
  if (lchance(0.3)) hooks.push(`const [u, setU] = useState(${lpick([0, 1])});`);
  // Islands: an effect, a ref written in handlers, a custom hook, a falsy number guarding markup, a child with state.
  const prelude: string[] = [], used = new Set(["useState"]);
  if (lchance(0.25)) {
    const dep = lpick(ints);
    hooks.push(`const [e, setE] = useState(0);`, `useEffect(() => { setE(${dep} * 2 + ${lpick([0, 1])}); }, [${dep}]);`);
    extraView.push(`<p>e={e}</p>`); used.add("useEffect");
  }
  if (lchance(0.2)) {
    hooks.push(`const r = useRef(0);`); used.add("useRef");
    const n = lpick(ints);
    extraWrites.push(() => `r.current += 1; ${cap(n)}(r.current);`);
  }
  if (lchance(0.2)) {
    prelude.push(`function useToggle(init: boolean) { const [t, setT] = useState(init); return [t, () => setT(!t)] as const; }`);
    hooks.push(`const [t, flip] = useToggle(${lpick([true, false])});`);
    extraView.push(`{t ? <b>T</b> : <i>F</i>}`); extraWrites.push(() => `flip();`);
  }
  if (lchance(0.15)) extraView.push(`{${lpick(ints)} && <em>nz</em>}`);
  if (lchance(0.15)) {
    prelude.push(`function Cell(props: { v: number }) { const [k, setK] = useState(0); return <p><button onClick={() => setK(k + props.v)}>cell</button>{k}</p>; }`);
    extraView.push(`<Cell v={${lpick(ints)}} />`);
  }
  const num = () => pick([...ints, ...derived, "1"]);
  const writes = [
    () => `${cap(target())}(${num()} + 1);`, () => `${cap(target())}((n) => n + 1);`, () => `${cap(target())}(${num()});`,
    () => `${cap(target())}(0);`,
    ...(bool ? [() => `setOn(!on);`, () => `setOn((v) => !v);`] : []),
    ...(str ? [() => `setS(s + "x");`, ...(bool ? [() => `setS(on ? "y" : s);`] : [])] : []),
    ...extraWrites,
  ];
  const buttons = Array.from({ length: pick([1, 2, 3]) }, (_, i) => {
    const body = Array.from({ length: pick([1, 1, 2, 3]) }, () => pick(writes)()).join(" ");
    return `<button onClick={() => { ${body} }}>go${i}</button>`;
  });
  if (action) {
    const before = [pick([`setShown((n) => n + 1);`, `setShown(${pick([5, 9])});`]), ...(ints.length > 1 && chance(0.4) ? [`setB(b + 1);`] : [])];
    const fail = str ? `startTransition(() => setS("failed"));` : "";
    buttons.splice(pick([0, buttons.length]), 0, `<button onClick={() => startTransition(async () => { ${before.join(" ")} try { const v: number = await save(); startTransition(() => setA(v)); } catch (error) { ${fail} } })}>{shown}</button>`);
  }
  const view = [
    ...ints.map(n => `<p>${n}={${n}}</p>`), ...derived.filter(d => d !== "m").map(d => `<p>{${d}}</p>`), ...extraView, ...(str ? [`<p>s:{s}</p>`] : []),
    ...(bool ? [pick([`{on ? <b>{${pick(ints)}}</b> : <i>off</i>}`, `{on && <u>on</u>}`, `<p>{on}</p>`])] : []),
    ...(chance(0.4) ? [`{${pick(ints)} > 1 && <em>big</em>}`] : []),
    ...buttons,
  ];
  const imports = ladder ? [...(action ? ["startTransition", "useOptimistic"] : []), ...used].sort().join(", ") : "startTransition, useOptimistic, useState";
  const source = `import { ${imports} } from "react";\n` + (action ? `import { save } from "./api";\n` : "") + prelude.map(p => p + "\n").join("") +
    `export default function App() {\n  ${hooks.join("\n  ")}\n  return <div>${view.join("")}</div>;\n}\n`;
  const steps: Scenario["steps"] = [{ type: "mount", frame: "" }];
  let call = 0;
  for (let i = 0; i < 10; i++) {
    if (action && chance(0.3)) steps.push(chance(0.7) ? { type: "resolve", host: "save", call: ++call, value: pick([3, 7]), frame: "" } : { type: "reject", host: "save", call: ++call, error: "offline", frame: "" });
    else steps.push({ type: "click", element: Math.floor(r() * buttons.length), frame: "" });
  }
  return { source, scenario: { name: "react fuzz " + seed, host: action ? [{ name: "save", parameters: [], returns: "number" }] : [], steps } };
}

const out = fileURLToPath(new URL("./.out/", import.meta.url));
/** batched: the first difference is a request settling while another is still open. React holds every transition
 *  until all of them finish; Solid lands the ones that overlapped and finished. That difference is intended. */
export type Outcome = { seed: number; result: "agree" | "refused" | "batched" | "disagree"; detail?: string; levels?: string[] };

export async function check(seed: number, ladder = false): Promise<Outcome> {
  const { source, scenario } = generate(seed, ladder);
  return compare(source, scenario, seed);
}

/** Lowers `source`, records its frames on React 19 with and without the compiler, and replays them on the plan. */
export async function compare(source: string, scenario: Scenario, seed = 0): Promise<Outcome> {
  mkdirSync(out, { recursive: true });
  const dir = mkdtempSync(out + "fuzz-");
  try {
    writeFileSync(dir + "/App.react.tsx", source);
    writeFileSync(dir + "/api.d.rx", "export fn save(): number\n");
    let plan: unknown;
    let levels: string[] = [];
    try {
      const set = loadReactModules(dir + "/App.react.tsx", p => (p.endsWith("api.d.rx") ? "export fn save(): number\n" : p.endsWith("App.react.tsx") ? source : undefined));
      levels = [...new Set(ladderOf(set).map(l => l.level + ":" + l.replaces))].sort();
      plan = reactPlan(set, { async: false });
    }
    catch (e) { if (e instanceof ReactRefusal) return { seed, result: "refused", detail: e.code }; return { seed, result: "refused", detail: "PLAN: " + (e as Error).message.split("\n")[0] }; }
    const pending: number[] = [];
    await runReact(dir + "/App.react.tsx", scenario, { prune: true, pending });
    const plain = await runReact(dir + "/App.react.tsx", structuredClone(scenario), { compiler: false, record: true });
    const compiled = scenario.steps.map(s => s.frame);
    if (JSON.stringify(plain) !== JSON.stringify(compiled)) return { seed, result: "disagree", detail: "React Compiler changed frames", levels };
    writeFileSync(dir + "/plan.json", JSON.stringify(plan));
    writeFileSync(dir + "/fuzz.scenario.json", JSON.stringify({ version: 2, fixture: "fuzz", ...scenario, host: scenario.host.map(h => ({ ...h, async: true })) }));
    try { await runScenario(dir + "/fuzz.scenario.json", "plan", { plan: dir + "/plan.json" }); }
    catch (e) {
      const detail = (e as Error).message.split("\n").slice(0, 6).join(" | "), at = Number(detail.match(/\/ plan \/ step (\d+)/)?.[1]);
      const settled = scenario.steps[at]?.type === "resolve" || scenario.steps[at]?.type === "reject";
      return { seed, result: settled && pending[at] > 0 ? "batched" : "disagree", detail, levels };
    }
    return { seed, result: "agree", levels };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

// A plan that throws halts Solid's reactivity for the whole process, so the CLI checks each seed in a child process.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const one = process.argv.indexOf("--one");
  const ladder = process.argv.includes("--ladder");
  if (one >= 0) process.stdout.write(JSON.stringify(await check(Number(process.argv[one + 1]), ladder)));
  else {
    const [first = 1, last = 20] = process.argv.slice(2).filter(a => !a.startsWith("--")).map(Number);
    const tally: Record<string, number> = {};
    for (let seed = first; seed <= last; seed++) {
      const run = spawnSync(process.execPath, [...process.execArgv, process.argv[1], "--one", String(seed), ...(ladder ? ["--ladder"] : [])], { encoding: "utf8" });
      const o: Outcome = run.status === 0 ? JSON.parse(run.stdout.slice(run.stdout.lastIndexOf('{"seed"'))) : { seed, result: "disagree", detail: "crashed: " + run.stderr.split("\n").find(l => /Error/.test(l)) };
      const top = ["island", "coarse", "snapshot"].find(l => o.levels?.some(x => x.startsWith(l + ":")));
      const key = o.result === "refused" ? "refused " + (o.detail!.match(/"code":"(\w+)"/)?.[1] ?? o.detail) : o.result + (top ? " at " + top : " precise");
      tally[key] = (tally[key] ?? 0) + 1;
      if (o.result === "disagree") console.log(seed, o.detail, o.levels);
    }
    console.log(tally);
  }
}

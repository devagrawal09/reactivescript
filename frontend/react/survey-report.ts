// Summarize survey.ts output: what the frontend accepts today, which blockers stop the most components, and how many
// components each rung of the fallback ladder unlocks, counted cumulatively. Usage: survey-report.ts COMPONENTS_JSON
import { readFileSync } from "node:fs";
import { RUNG, type Blocker, type Row } from "./survey.ts";

const rows: Row[] = JSON.parse(readFileSync(process.argv[2], "utf8"));
const n = rows.length, pct = (k: number) => k + " (" + Math.round((100 * k) / n) + "%)";
const tally = (keys: string[]) => Object.entries(keys.reduce<Record<string, number>>((t, k) => ((t[k] = (t[k] ?? 0) + 1), t), {})).sort((a, b) => b[1] - a[1]);
const semantic = (r: Row) => r.blockers.filter(b => RUNG[b] !== "gap");
const within = (r: Row, allowed: Set<string>, gapsFilled: boolean) => r.blockers.every(b => allowed.has(RUNG[b]) || (gapsFilled && RUNG[b] === "gap"));

console.log("components:", n, "in", new Set(rows.map(r => r.file)).size, "files");
console.log("accepted today:", rows.filter(r => r.today === "accepted").length);
console.log("\nfirst refusal today:"); for (const [k, v] of tally(rows.map(r => r.today))) console.log("  " + k, v);
console.log("\nblockers (components blocked by each, collect-all):");
for (const [k, v] of tally(rows.flatMap(r => r.blockers))) console.log("  " + k.padEnd(20), String(v).padStart(4), pct(v).padStart(11), RUNG[k as Blocker]);

const ladder = [["snapshot"], ["snapshot", "coarse"], ["snapshot", "coarse", "island"]];
for (const gapsFilled of [true, false]) {
  console.log("\ncumulative unlock" + (gapsFilled ? " (frontend gaps filled: attributes, render control, &&, useMemo/useCallback, useReducer)" : " (frontend as it is)") + ":");
  console.log("  precise only".padEnd(28), pct(rows.filter(r => within(r, new Set(), gapsFilled)).length));
  for (const rungs of ladder) console.log(("  + " + rungs.join(" + ")).padEnd(28), pct(rows.filter(r => within(r, new Set(rungs), gapsFilled)).length));
}
const pc = new Set(["PROPS", "CHILD_COMPONENT"]);
const onlyPropsChild = rows.filter(r => semantic(r).length && semantic(r).every(b => pc.has(b))).length;
const withSnapCoarse = rows.filter(r => semantic(r).length && semantic(r).every(b => pc.has(b) || RUNG[b] === "snapshot" || RUNG[b] === "coarse")).length;
console.log("\nprops + child components (a frontend gap): blocked by nothing else (gaps filled):", pct(onlyPropsChild), "; with snapshot + coarse too:", pct(withSnapCoarse));
console.log("no semantic blocker at all (gaps filled):", pct(rows.filter(r => !semantic(r).length).length));
const lib = tally(rows.flatMap(r => r.hooks.library)), custom = tally(rows.flatMap(r => r.hooks.custom));
console.log("\nlibrary hooks:", lib.length, "distinct; top:", lib.slice(0, 12).map(([k, v]) => k + " " + v).join(", "));
console.log("custom hooks:", custom.length, "distinct; top:", custom.slice(0, 12).map(([k, v]) => k + " " + v).join(", "));
console.log("components needing an island only for library hooks:", rows.filter(r => semantic(r).includes("HOOK_LIBRARY") && semantic(r).every(b => b === "HOOK_LIBRARY" || RUNG[b] !== "island")).length);

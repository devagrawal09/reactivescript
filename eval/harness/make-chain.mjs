// Round 7 (maintenance chains): writes tasks/chain1 … chain4, one task per step of a chain of changes to the issue
// desk, each made by a fresh agent to the app the step before it left. Step k's task:
// - brief-plain.md: the step's change brief;
// - BASE.md: the desk's brief and the earlier steps' change briefs, in order (what the app was built to);
// - api.*: the labels task's API (a superset of every step's);
// - visible.mjs: every step's visible tests so far, in one file, deduplicated by name (the app's test suite grows);
// - hidden.mjs, hidden-overlap.mjs: every step's hidden tests so far, deduplicated by name (earlier steps' hidden
//   tests become regressions).
// Usage: node harness/make-chain.mjs
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const tasks = path.resolve(here, "../tasks");
const steps = ["labels", "count", "related", "rows"];
const read = (t, f) => readFileSync(path.join(tasks, t, f), "utf8");

// the fixtures each step's tests need: labels' (count adds none), then related help's, then the row actions'
const union = read("rows", "fixtures.mjs");
const fixturesFor = k => k <= 2 ? read("labels", "fixtures.mjs") : k === 3 ? union.slice(0, union.indexOf("\n// Row actions")) + "\n" : union;

/** the entries of a visible file's `export default [ … ]`, as [name, text] */
function entries(text) {
  const body = text.slice(text.indexOf("export default [\n") + "export default [\n".length, text.lastIndexOf("];"));
  const parts = body.split(/^(?=  \{ name: )/m).filter(p => p.trim());
  return parts.map(p => {
    const m = p.match(/^  \{ name: "((?:[^"\\]|\\.)*)"/);
    if (!m) throw new Error(`cannot read a test entry: ${p.slice(0, 80)}`);
    return [m[1], p];
  });
}

const demote = brief => brief.replace(/^(#+) /gm, "#$1 ");
const chained = brief => brief.replace("`BASE.md` is the brief it was built to.", "`BASE.md` is the brief it was built to, with the changes made since.");

for (let k = 1; k <= steps.length; k++) {
  const dir = path.join(tasks, `chain${k}`);
  mkdirSync(dir, { recursive: true });
  for (const f of ["api.js", "api.d.ts", "api.d.rx"]) cpSync(path.join(tasks, "labels", f), path.join(dir, f));
  writeFileSync(path.join(dir, "brief-plain.md"), k === 1 ? read(steps[0], "brief-plain.md") : chained(read(steps[k - 1], "brief-plain.md")));
  const earlier = steps.slice(0, k - 1).map((s, i) => `\n---\n\n${demote(read(s, "brief-plain.md")).replace(/^## Change request: /m, `## Change ${i + 1}: `)}`);
  writeFileSync(path.join(dir, "BASE.md"), (k === 1 ? "" : `The app was built to the brief below, then changed by the ${k - 1 === 1 ? "change request" : `${k - 1} change requests`} after it, in order.\n\n`) + read("desk", "brief-plain.md") + earlier.join(""));
  const fixtures = fixturesFor(k);
  writeFileSync(path.join(dir, "fixtures.mjs"), fixtures);
  const names = Object.keys(await import(pathToFileURL(path.join(dir, "fixtures.mjs")).href + `?k=${k}`));
  const seen = new Set();
  const tests = [];
  for (const s of steps.slice(0, k)) for (const [name, text] of entries(read(s, "visible.mjs"))) if (!seen.has(name)) { seen.add(name); tests.push(text); }
  writeFileSync(path.join(dir, "visible.mjs"), `// Visible tests: the agent sees and runs these. The desk's, then each change's so far.\nimport { ${names.join(", ")} } from "./fixtures.mjs";\n\nexport default [\n${tests.join("")}];\n`);
  for (const f of ["hidden", "hidden-overlap"]) {
    const imports = steps.slice(0, k).map((s, i) => `import s${i} from "../${s}/${f}.mjs";`).join("\n");
    writeFileSync(path.join(dir, `${f}.mjs`), `// Round 7, chain step ${k}: every step's ${f} tests so far, deduplicated by name. Never shown to the agent.\n${imports}\n\nconst seen = new Set();\nexport default [${steps.slice(0, k).map((_, i) => `...s${i}`).join(", ")}].filter(t => !seen.has(t.name) && seen.add(t.name));\n`);
  }
  console.log(`chain${k}: ${tests.length} visible tests`);
}

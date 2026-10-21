// Usage: node --experimental-strip-types ref/run.ts [scenario-name...]
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseScenario, runScenario } from "./src/scenario.ts";

const dir = join(import.meta.dirname, "..", "scenarios");
const only = process.argv.slice(2);
let failed = 0;
for (const f of readdirSync(dir).filter(f => f.startsWith("S-") && f.endsWith(".md")).sort()) {
  const name = f.replace(/\.md$/, "");
  if (only.length && !only.some(o => name.includes(o))) continue;
  const r = runScenario(parseScenario(name, readFileSync(join(dir, f), "utf8")));
  console.log(`${r.ok ? "PASS" : "FAIL"} ${name}`);
  for (const l of r.lines) console.log(l);
  if (!r.ok) failed++;
}
process.exit(failed ? 1 : 0);

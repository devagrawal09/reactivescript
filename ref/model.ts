// Usage: node --experimental-strip-types ref/model.ts file.rx...
// Prints the resolved model (spec/11 CP-6) of each file and the .rx modules it imports, as JSON: regions, symbols, and the
// computations with their reads (tracked, snapshot, pre), writes and calls. The checker's diagnostics come first, if any.
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadModules } from "./src/modules.ts";
import { checkModules } from "./src/check.ts";
let bad = 0;
for (const f of process.argv.slice(2)) {
  const set = loadModules(resolve(f), p => existsSync(p) ? readFileSync(p, "utf8") : undefined);
  const { diags, models } = checkModules(set);
  for (const d of diags) { bad++; console.error(`${d.file ?? f}:${d.line}: error ${d.code} [${d.rule}] ${d.msg}`); }
  const rel = (p: string) => p.replace(process.cwd() + "/", "");
  console.log(JSON.stringify(set.order.map(p => ({ ...models.get(p)!, file: rel(p) })), null, 1).replace(/\n\s+(?=[^\s{\[])/g, " ").replace(/\n\s+([}\]])/g, " $1"));
}
process.exit(bad ? 1 : 0);

// Usage: node --experimental-strip-types ref/check.ts file.rx...  — run the checker (08) and print every diagnostic.
import { readFileSync } from "node:fs";
import { parseProgram } from "./src/parse.ts";
import { check } from "./src/check.ts";
let bad = 0;
for (const f of process.argv.slice(2)) {
  try {
    const ds = check(parseProgram(readFileSync(f, "utf8")));
    if (!ds.length) console.log(`ok   ${f}`);
    else { bad++; for (const d of ds) console.log(`${f}:${d.line}: error ${d.code} [${d.rule}] ${d.msg}`); }
  } catch (e) { bad++; console.log(`${f}: parse error: ${(e as Error).message}`); }
}
process.exit(bad ? 1 : 0);

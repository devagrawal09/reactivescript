// Parses every examples/*.rx under the 07 grammar and reports what it declares.
import { readdirSync, readFileSync } from "node:fs";
import { parseProgram } from "./src/parse.ts";
const dir = new URL("../examples/", import.meta.url);
let bad = 0;
for (const f of readdirSync(dir).filter(f => f.endsWith(".rx")).sort()) {
  try {
    const p = parseProgram(readFileSync(new URL(f, dir), "utf8"));
    const kinds = p.decls.reduce((m, d) => (m[d.k] = (m[d.k] ?? 0) + 1, m), {} as Record<string, number>);
    console.log(`ok   ${f}: ${Object.entries(kinds).map(([k, n]) => `${n} ${k}`).join(", ")}; view: ${p.view.length} top-level node(s)`);
  } catch (e) { bad++; console.log(`FAIL ${f}: ${(e as Error).message}`); }
}
process.exit(bad ? 1 : 0);

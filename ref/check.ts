// Usage: node --experimental-strip-types ref/check.ts [--signature] file.rx...
// Runs the checker (08) over each file and every .rx module it imports (09: dependencies first, each against its imports'
// signatures), and prints every diagnostic. --signature also prints each module's signature as .d.rx text (MO-3).
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadModules } from "./src/modules.ts";
import { checkModules } from "./src/check.ts";
import { printSignature } from "./src/signature.ts";
const args = process.argv.slice(2); const sigOut = args.includes("--signature");
let bad = 0;
for (const f of args.filter(a => !a.startsWith("--"))) {
  try {
    const set = loadModules(resolve(f), p => existsSync(p) ? readFileSync(p, "utf8") : undefined);
    const { diags, sigs } = checkModules(set);
    const rel = (p?: string) => (p ?? resolve(f)).replace(process.cwd() + "/", "");
    if (!diags.length) console.log(`ok   ${f}${set.order.length > 1 ? ` (+${set.order.length - 1} module${set.order.length > 2 ? "s" : ""})` : ""}`);
    else { bad++; for (const d of diags) console.log(`${rel(d.file)}:${d.line}: error ${d.code} [${d.rule}] ${d.msg}`); }
    if (sigOut) for (const p of set.order) console.log(printSignature(sigs.get(p)!));
  } catch (e) { bad++; console.log(`${f}: parse error: ${(e as Error).message}`); }
}
process.exit(bad ? 1 : 0);

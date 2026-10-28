// One-off migration aid (upstream MO-1c): finds string/template literals in test files that are RX programs with
// top-level markup and proposes the current spelling: the same declarations, with the view wrapped in
// `export default component App() { … }`. Prints a JSON list of insertions; they are reviewed and applied by patch.
// Only literals with RX-only syntax are considered; TSX fragments are skipped, because upstream parseProgram does not
// terminate on some of them (docs/UPSTREAM-ISSUES.md). Template expressions are parsed as placeholder identifiers.
// Usage: node --experimental-strip-types scripts/find-legacy-rx-views.ts tsx/a.test.ts ...
import { readFileSync } from "node:fs";
import { parseSync } from "oxc-parser/src-js/index";
import { parseProgram, viewStart } from "../tsx/rx/compiler.ts";

type Insert = { file: string; at: number; text: string };
const inserts: Insert[] = [];
const skipped: { file: string; line: number; why: string }[] = [];
const rxOnly = (s: string) => [":=", "source ", "errored ", " pre ", "{pre ", "error ", ".rx\"", "export component", "component "].some(t => s.includes(t));
for (const file of process.argv.slice(2)) {
  const source = readFileSync(file, "utf8");
  const ast = parseSync(file, source, { sourceType: "module", lang: "ts" }).program;
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node || typeof node !== "object") return;
    const n = node as { type?: string; start: number; end: number; value?: unknown; quasis?: { start: number; end: number; value: { raw: string; cooked: string } }[] };
    // pieces: [sourceStart, text] runs of literal text, joined by placeholder identifiers
    let pieces: { start: number; raw: string; cooked: string }[] | undefined;
    if (n.type === "Literal" && typeof n.value === "string") pieces = [{ start: n.start + 1, raw: source.slice(n.start + 1, n.end - 1), cooked: n.value }];
    if (n.type === "TemplateLiteral" && n.quasis) pieces = n.quasis.map(q => ({ start: q.start, raw: q.value.raw, cooked: q.value.cooked }));
    if (pieces) {
      const PH = "__tsx_placeholder";
      const joined = pieces.map(p => p.cooked).join(PH);
      if (joined.includes("<") && rxOnly(joined) && !joined.trimEnd().endsWith(">}")) {
        let legacy = false;
        try { legacy = !!parseProgram(joined).legacyView; } catch { legacy = false; }
        if (legacy) {
          const line = source.slice(0, n.start).split("\n").length;
          const at = viewStart(joined);
          const end = joined.trimEnd().length;
          const locate = (offset: number): number | undefined => {
            let base = 0;
            for (const p of pieces!) {
              if (offset <= base + p.cooked.length) return p.raw === p.cooked ? p.start + offset - base : undefined;
              base += p.cooked.length + PH.length;
            }
          };
          const a = locate(at), b = locate(end);
          if (a === undefined || b === undefined) skipped.push({ file, line, why: "escapes or expression at the view boundary" });
          else { inserts.push({ file, at: a, text: "export default component App() { " }); inserts.push({ file, at: b, text: " }" }); }
        }
      }
    }
    for (const value of Object.values(node)) if (value && typeof value === "object") visit(value);
  };
  visit(ast);
}
console.log(JSON.stringify({ inserts, skipped }));

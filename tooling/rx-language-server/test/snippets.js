// Eval snippets (src/snippet.js), driven over LSP as an editor drives them: the eval todo app's three snippets come back
// clean, a binding hovers with its type and goes to its `@bind` line, and an unbound name, a malformed `@bind` line and a
// write to a binding are each placed on the snippet's own line. A `.rx` without the `// @eval` line is analyzed as before.
// Same prerequisites as test/run.js.
//   node test/snippets.js       VERBOSE=1 prints each answer
const { startLanguageServer } = require("@volar/test-utils");
const { URI } = require("vscode-uri");
const fs = require("node:fs");
const path = require("node:path");
const { analyze, preludeFor } = require("../src/rxc");

const repo = path.resolve(__dirname, "../../..");
const ws = path.join(__dirname, "../.test/snippets");
fs.rmSync(ws, { recursive: true, force: true });
fs.mkdirSync(ws, { recursive: true });
for (const f of fs.readdirSync(path.join(__dirname, "snippets"))) fs.copyFileSync(path.join(__dirname, "snippets", f), path.join(ws, f));
fs.symlinkSync(path.join(repo, "ref/node_modules"), path.join(ws, "node_modules"), "dir");
fs.writeFileSync(path.join(ws, "tsconfig.json"), JSON.stringify({
  compilerOptions: { jsx: "preserve", jsxImportSource: "@solidjs/web", strict: true, noImplicitAny: false, target: "ES2022", module: "ESNext", moduleResolution: "Bundler", allowImportingTsExtensions: true, noEmit: true, skipLibCheck: true, lib: ["ES2022", "DOM"], types: [] },
  include: ["*.rx"],
}, null, 2));

let pass = 0, fail = 0;
function check(name, ok, got) {
  if (ok) pass++; else fail++;
  const shown = Array.isArray(got) ? got.map(d => (d?.source ? { source: d.source, code: d.code, message: d.message, range: d.range } : d)) : got;
  console.log(`${ok ? "  ✓" : "  ✗"} ${name}${!ok || process.env.VERBOSE ? `\n      ${JSON.stringify(shown)?.slice(0, ok ? 600 : 4000)}` : ""}`);
}
function at(text, needle, delta = 0, n = 1) {
  let i = -1;
  for (let k = 0; k < n; k++) { i = text.indexOf(needle, i + 1); if (i < 0) throw new Error(`no ${needle}`); }
  i += delta;
  const before = text.slice(0, i).split("\n");
  return { line: before.length - 1, character: before[before.length - 1].length };
}
const hoverText = h => !h ? "" : typeof h.contents === "string" ? h.contents : Array.isArray(h.contents) ? h.contents.map(c => c.value ?? c).join("\n") : h.contents.value;
const errors = d => (d.items ?? []).filter(x => x.severity === 1 || x.severity === undefined);

(async () => {
  const server = startLanguageServer(process.env.SERVER ? path.resolve(process.env.SERVER) : path.join(__dirname, "../bin/server.js"), ws);
  await server.initialize(URI.file(ws).toString(), { typescript: { tsdk: path.dirname(require.resolve("typescript")) } });

  console.log("clean snippets");
  for (const f of ["todo.rx", "editor.rx", "inventory.rx"]) {
    const doc = await server.openTextDocument(path.join(ws, f), "reactivescript");
    const dg = await server.sendDocumentDiagnosticRequest(doc.uri);
    check(`${f}: no diagnostics`, errors(dg).length === 0, dg.items);
  }

  console.log("bindings");
  const todo = await server.openTextDocument(path.join(ws, "todo.rx"), "reactivescript");
  const tt = todo.getText();
  const h1 = await server.sendHoverRequest(todo.uri, at(tt, "db.list;", 0));
  check("a store binding hovers with its type", /db: \{\s*list: \{\s*id: number;\s*text: string;\s*done: boolean;\s*\}\[\];\s*\}/.test(hoverText(h1)), h1);
  const d1 = await server.sendDefinitionRequest(todo.uri, at(tt, "db.list;", 0));
  const r1 = d1?.[0]?.targetSelectionRange ?? d1?.[0]?.range;
  check("`db` goes to its @bind line", String(d1?.[0]?.targetUri ?? d1?.[0]?.uri).endsWith("todo.rx") && r1?.start.line === 1 && r1?.start.character === at(tt, "db:").character, d1);
  const h2 = await server.sendHoverRequest(todo.uri, at(tt, "addTodo(text)", 1));
  check("a host hovers with its signature", /addTodo\(a0: string\): Promise<string>/.test(hoverText(h2)), h2);
  const d2 = await server.sendDefinitionRequest(todo.uri, at(tt, "addTodo(text)", 1));
  check("a host goes to its @bind line", (d2?.[0]?.targetSelectionRange ?? d2?.[0]?.range)?.start.line === 2, d2);
  const editor = await server.openTextDocument(path.join(ws, "editor.rx"), "reactivescript");
  const et = editor.getText();
  const h3 = await server.sendHoverRequest(editor.uri, at(et, "edit(e.target", 1));
  check("an action binding hovers as a function of its parameters", /edit\(a0: string\)/.test(hoverText(h3)), h3);
  const h4 = await server.sendHoverRequest(editor.uri, at(et, "{title}", 2));
  check("a read binding hovers with its type", /title: string/.test(hoverText(h4)), h4);

  console.log("errors on the snippet's lines");
  const unb = await server.updateTextDocument(editor.uri, [{ range: { start: at(et, "{title}", 1), end: at(et, "{title}", 6) }, newText: "titel" }]);
  const ut = unb.getText();
  const dg1 = await server.sendDocumentDiagnosticRequest(editor.uri);
  const u = (dg1.items ?? []).find(d => d.code === "UNBOUND");
  check("an unbound name is UNBOUND on its line", u && u.range.start.line === at(ut, "{titel}").line && /titel/.test(u.message) && (dg1.items ?? []).every(d => d.code !== "TOP_LEVEL_MARKUP"), dg1.items);
  const ts = (dg1.items ?? []).find(d => d.source !== "rx");
  check("and TypeScript's error is on the name itself", ts && ts.range.start.line === at(ut, "{titel}").line && ts.range.start.character === at(ut, "{titel}", 1).character, dg1.items);

  const bad = await server.updateTextDocument(editor.uri, [{ range: { start: at(ut, "read version"), end: at(ut, "read version", 4) }, newText: "reed" }]);
  const bt = bad.getText();
  const dg2 = await server.sendDocumentDiagnosticRequest(editor.uri);
  const i2 = (dg2.items ?? []).find(d => d.code === "INTERFACE");
  check("a malformed @bind line is a diagnostic on that line", i2 && i2.range.start.line === at(bt, "reed version").line, dg2.items);
  check("and its name is then unbound where it is used", (dg2.items ?? []).some(d => d.code === "UNBOUND" && /version/.test(d.message) && d.range.start.line === at(bt, '"running v"').line), dg2.items);

  const ro = await server.updateTextDocument(todo.uri, [{ range: { start: at(tt, '    draft := "";', 4), end: at(tt, '    draft := "";', 16) }, newText: 'draft := ""; guess db.list := [];' }]);
  const rt = ro.getText();
  const dg3 = await server.sendDocumentDiagnosticRequest(todo.uri);
  const w = (dg3.items ?? []).filter(d => d.code === "READ_ONLY");
  check("a guess to a binding is READ_ONLY on the guess", w.length === 1 && w[0].range.start.line === at(rt, "guess db.list").line && w[0].range.start.character === at(rt, "guess db.list").character, dg3.items);
  const ro2 = await server.updateTextDocument(editor.uri, [{ range: { start: at(bt, "keys := keys + 1"), end: at(bt, "keys := keys + 1", 16) }, newText: "code := \"\"" }]);
  const r2t = ro2.getText();
  const dg4 = await server.sendDocumentDiagnosticRequest(editor.uri);
  check("so is a write to a read binding", (dg4.items ?? []).some(d => d.code === "READ_ONLY" && /read-only binding code/.test(d.message) && d.range.start.line === at(r2t, 'code := ""').line), dg4.items);

  console.log("not a snippet");
  const plainText = fs.readFileSync(path.join(ws, "editor.rx"), "utf8").replace("// @eval\n", "// eval\n");
  fs.writeFileSync(path.join(ws, "plain.rx"), plainText);
  const plain = await server.openTextDocument(path.join(ws, "plain.rx"), "reactivescript");
  const dg5 = await server.sendDocumentDiagnosticRequest(plain.uri);
  const direct = analyze(path.join(ws, "plain.rx"), plainText, preludeFor(path.join(ws, "plain.rx"))).diagnostics;
  const rx5 = (dg5.items ?? []).filter(d => d.source === "rx");
  check("a .rx without `// @eval` on line 1 is analyzed as before (the crate's own diagnostics)", rx5.length === direct.length && rx5.length > 0 && rx5.every((d, i) => d.code === direct[i].code && d.range.start.line === direct[i].range.start.line - 1), { lsp: rx5, crate: direct.map(d => [d.code, d.range?.start.line]) });

  await server.shutdown();
  console.log(`\n${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

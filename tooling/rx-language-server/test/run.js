// The language server, driven over LSP as an editor drives it, on a copy of examples/shop: hover, go to definition across
// modules, completion while typing, TypeScript's type errors and the crate's diagnostics, each placed on the .rx.
// Needs compiler/ built (cargo build --release) and Solid's types (ref/node_modules, via ref/scripts/solid-next.sh).
//   node test/run.js            VERBOSE=1 prints each answer
const { startLanguageServer } = require("@volar/test-utils");
const { URI } = require("vscode-uri");
const fs = require("node:fs");
const path = require("node:path");

const repo = path.resolve(__dirname, "../../..");
const ws = path.join(__dirname, "../.test/shop");
fs.rmSync(ws, { recursive: true, force: true });
fs.mkdirSync(ws, { recursive: true });
for (const f of fs.readdirSync(path.join(repo, "examples/shop"))) fs.copyFileSync(path.join(repo, "examples/shop", f), path.join(ws, f));
// the injected API's types, its `pure` stated as a .d.ts can state it (the brand type; a .ts states it with `pure(…)`), so
// the shop's `import pure` restates it and is no narrowing (09 MO-11e)
fs.writeFileSync(path.join(ws, "api.d.ts"), 'import type { Pure } from "@reactivescript/js";\nexport declare function checkout(items: { id: number; qty: number }[], coupon: string): Pure<Promise<{ id: number }>>;\n');
const nm = path.join(ws, "node_modules");
fs.mkdirSync(path.join(nm, "@reactivescript"), { recursive: true });
for (const f of fs.readdirSync(path.join(repo, "ref/node_modules")).filter(f => !f.startsWith("."))) fs.symlinkSync(path.join(repo, "ref/node_modules", f), path.join(nm, f), "dir");
// MO-11: the helpers (`@reactivescript/js`), and the declaration generator (`@reactivescript/compiler/dts`), as a project
// installs them
fs.symlinkSync(path.join(repo, "js"), path.join(nm, "@reactivescript/js"), "dir");
fs.symlinkSync(path.join(repo, "compiler"), path.join(nm, "@reactivescript/compiler"), "dir");
const usersTs = [
  'import { pure, ref } from "@reactivescript/js";',
  "export const initials = pure((name: string) => name.slice(0, 1));",
  "export const createUpper = pure(ref({ args: [0], result: true }, (source: () => string) => () => source().toUpperCase()));",
  "export function greet(name: string) { return `hi ${name}`; }",
  "",
].join("\n");
fs.writeFileSync(path.join(ws, "users.ts"), usersTs);
fs.writeFileSync(path.join(ws, "narrow.rx"), [
  'import pure { greet } from "./users"',
  "export default component Narrow() {",
  '  source name := "ada"',
  "  hello = greet(name)",
  "  <p>{hello}</p>",
  "}",
  "",
].join("\n"));
fs.writeFileSync(path.join(ws, "profile.rx"), [
  'import { initials, createUpper } from "./users"',
  "export default component Profile() {",
  '  source name := "ada"',
  "  first = initials(name)",
  "  loud = createUpper(name)",
  "  <p>{first}{loud}</p>",
  "}",
  "",
].join("\n"));
fs.writeFileSync(path.join(ws, "tsconfig.json"), JSON.stringify({
  compilerOptions: { jsx: "preserve", jsxImportSource: "@solidjs/web", strict: true, noImplicitAny: false, target: "ES2022", module: "ESNext", moduleResolution: "Bundler", allowImportingTsExtensions: true, noEmit: true, skipLibCheck: true, lib: ["ES2022", "DOM"], types: [] },
  include: ["*.rx", "*.ts"],
}, null, 2));

let pass = 0, fail = 0;
function check(name, ok, got) {
  if (ok) pass++; else fail++;
  const shown = Array.isArray(got) ? got.map(d => (d?.source ? { source: d.source, code: d.code, message: d.message, range: d.range } : d)) : got;
  console.log(`${ok ? "  ✓" : "  ✗"} ${name}${!ok || process.env.VERBOSE ? `\n      ${JSON.stringify(shown)?.slice(0, ok ? 600 : 4000)}` : ""}`);
}
/** The position of the `n`th `needle` in `text`, `delta` characters into it. */
function at(text, needle, delta = 0, n = 1) {
  let i = -1;
  for (let k = 0; k < n; k++) { i = text.indexOf(needle, i + 1); if (i < 0) throw new Error(`no ${needle}`); }
  i += delta;
  const before = text.slice(0, i).split("\n");
  return { line: before.length - 1, character: before[before.length - 1].length };
}
const hoverText = h => !h ? "" : typeof h.contents === "string" ? h.contents : Array.isArray(h.contents) ? h.contents.map(c => c.value ?? c).join("\n") : h.contents.value;

(async () => {
  // SERVER: another build of it, such as the extension's bundle (tooling/vscode-rx/dist/server.js)
  const server = startLanguageServer(process.env.SERVER ? path.resolve(process.env.SERVER) : path.join(__dirname, "../bin/server.js"), ws);
  await server.initialize(URI.file(ws).toString(), { typescript: { tsdk: path.dirname(require.resolve("typescript")) } });
  const cartFile = path.join(ws, "cart.rx");
  const cart = await server.openTextDocument(cartFile, "reactivescript");
  const text = cart.getText();

  console.log("hover");
  const h1 = await server.sendHoverRequest(cart.uri, at(text, "count = cart.reduce", 9));
  check("a source's type: `cart` is Line[]", /Line\[\]/.test(hoverText(h1)), h1);
  const h2 = await server.sendHoverRequest(cart.uri, at(text, "export subtotal", 8));
  check("an equation's type: `subtotal` is number", /subtotal: number/.test(hoverText(h2)), h2);
  const h3 = await server.sendHoverRequest(cart.uri, at(text, "qtyOf(p.id)", 1));
  check("a function: `qtyOf(id: number): number`", /qtyOf\(id: number\): number/.test(hoverText(h3)), h3);

  console.log("go to definition");
  const d1 = await server.sendDefinitionRequest(cart.uri, at(text, "products.reduce", 2));
  const t1 = d1?.[0]?.targetUri ?? d1?.[0]?.uri;
  check("`products` goes to catalog.rx", String(t1).endsWith("catalog.rx"), d1);
  const d2 = await server.sendDefinitionRequest(cart.uri, at(text, "qtyOf(p.id)", 1));
  const r2 = d2?.[0]?.targetSelectionRange ?? d2?.[0]?.range;
  check("`qtyOf` goes to its declaration on line 13", String(d2?.[0]?.targetUri ?? d2?.[0]?.uri).endsWith("cart.rx") && r2?.start.line === at(text, "export fn qtyOf").line, d2);

  console.log("references and rename");
  const refs = await server.sendReferencesRequest(cart.uri, at(text, "export count", 8), { includeDeclaration: true });
  check("`count` is referenced in cart.rx and beyond", (refs ?? []).length >= 3, refs?.map(r => `${path.basename(r.uri)}:${r.range.start.line + 1}`));

  console.log("completion while typing");
  const lines = text.split("\n"); const end = { line: lines.length - 1, character: lines[lines.length - 1].length };
  const typed = await server.updateTextDocument(cart.uri, [{ range: { start: end, end }, newText: "\nnewest = cart." }]);
  const tt = typed.getText();
  const c1 = await server.sendCompletionRequest(cart.uri, at(tt, "newest = cart.", "newest = cart.".length));
  const labels = (c1?.items ?? []).map(i => i.label);
  check("after `cart.`: array members (`reduce`, `length`)", labels.includes("reduce") && labels.includes("length"), labels.slice(0, 20));
  const c2 = await server.sendCompletionRequest(cart.uri, at(tt, "newest = ca", "newest = ca".length));
  check("in an expression: names in scope (`cart`, `count`, `qtyOf`)", ["cart", "count", "qtyOf"].every(l => (c2?.items ?? []).some(i => i.label === l)), (c2?.items ?? []).map(i => i.label).slice(0, 30));

  console.log("diagnostics");
  const dg0 = await server.sendDocumentDiagnosticRequest(cart.uri);
  check("a half-typed line is a parse error on that line (07)", (dg0.items ?? []).some(d => d.code === "PARSE" && d.range.start.line === at(tt, "newest").line), dg0.items);
  await server.updateTextDocument(cart.uri, [{ range: { start: at(tt, "newest = cart."), end: at(tt, "newest = cart.", "newest = cart.".length) }, newText: "newest = cart" }]);
  const typeErr = await server.updateTextDocument(cart.uri, [{ range: { start: at(text, 'orderError: string := ""', 22), end: at(text, 'orderError: string := ""', 24) }, newText: "42" }]);
  const te = typeErr.getText();
  const dg1 = await server.sendDocumentDiagnosticRequest(cart.uri);
  const ts1 = (dg1.items ?? []).find(d => String(d.code) === "2345" || String(d.code) === "2322");
  check("a type error (`string := 42`) is TypeScript's, on the `42`", ts1 && ts1.range.start.line === at(te, ":= 42").line && ts1.range.start.character === at(te, ":= 42", 3).character, dg1.items);
  const unb = await server.updateTextDocument(cart.uri, [{ range: { start: at(te, ":= 42", 3), end: at(te, ":= 42", 5) }, newText: '""' }]);
  const ut = unb.getText();
  const unb2 = await server.updateTextDocument(cart.uri, [{ range: { start: at(ut, "newest = cart", 9), end: at(ut, "newest = cart", 13) }, newText: "nope" }]);
  const nt = unb2.getText();
  const dg2 = await server.sendDocumentDiagnosticRequest(cart.uri);
  const rx = (dg2.items ?? []).find(d => d.source === "rx");
  check("an undeclared name is the crate's diagnostic, with its rule", rx && rx.range.start.line === at(nt, "newest = nope").line && /SCOPE|RG-/.test(rx.message), dg2.items);

  console.log("views");
  const main = await server.openTextDocument(path.join(ws, "main.rx"), "reactivescript");
  const mt = main.getText();
  const h4 = await server.sendHoverRequest(main.uri, at(mt, "<Row", 2));
  check("a component's tag hovers as its function (`<Row>`)", /function Row/.test(hoverText(h4)), h4);
  const d4 = await server.sendDefinitionRequest(main.uri, at(mt, "<Row", 2));
  check("`<Row>` goes to ui.rx", String(d4?.[0]?.targetUri ?? d4?.[0]?.uri).endsWith("ui.rx"), d4);
  const h5 = await server.sendHoverRequest(main.uri, at(mt, "product={p}", 1));
  check("a prop hovers with its type (`product: Product`)", /product: Product/.test(hoverText(h5)), h5);
  const ui = await server.openTextDocument(path.join(ws, "ui.rx"), "reactivescript");
  const uit = ui.getText();
  const typedUi = await server.updateTextDocument(ui.uri, [{ range: { start: at(uit, "{props.product.name}", 15), end: at(uit, "{props.product.name}", 19) }, newText: "" }]);
  const c3 = await server.sendCompletionRequest(ui.uri, at(typedUi.getText(), "{props.product.}", 15));
  const l3 = (c3?.items ?? []).map(i => i.label);
  check("in markup, after `props.product.`: Product's fields", l3.includes("name") && l3.includes("price"), l3.slice(0, 20));
  const h6 = await server.sendHoverRequest(ui.uri, at(uit, "onClick", 2));
  check("an attribute hovers as Solid's JSX type", /onClick/.test(hoverText(h6)), h6);

  console.log("a .ts with no .d.rx (09 MO-11)");
  const profile = await server.openTextDocument(path.join(ws, "profile.rx"), "reactivescript");
  const pt = profile.getText();
  const h7 = await server.sendHoverRequest(profile.uri, at(pt, "loud =", 1));
  check("a Ref result hovers as its T (TY-4d): `loud: string`", /loud: string/.test(hoverText(h7)), h7);
  const dg3 = await server.sendDocumentDiagnosticRequest(profile.uri);
  check("its generated declaration checks clean", (dg3.items ?? []).length === 0, dg3.items);
  // the .ts changes on disk, the .rx does not: the analysis is stale by the record's files
  fs.writeFileSync(path.join(ws, "users.ts"), usersTs.replace("export const initials", "export const initialsOf") + "export const score = [pure((n: number) => n)][0];\n");
  const dg4 = await server.sendDocumentDiagnosticRequest(profile.uri);
  check("after the .ts drops `initials`, the .rx's import is NOT_EXPORTED (no edit to the .rx)", (dg4.items ?? []).some(d => d.code === "NOT_EXPORTED" && d.range.start.line === 0), dg4.items);
  const users = await server.openTextDocument(path.join(ws, "users.ts"), "typescript");
  const dg5 = await server.sendDocumentDiagnosticRequest(users.uri);
  check("a misplaced helper is DECLARATION_HELPER, on the .ts at the call", (dg5.items ?? []).some(d => d.code === "DECLARATION_HELPER" && d.source === "rx" && d.range.start.line === 4), dg5.items);
  // 09 MO-11e: `import pure` on a defaulted fact of the .ts compiles, and the editor shows the deprecation as a warning
  const narrowed = await server.openTextDocument(path.join(ws, "narrow.rx"), "reactivescript");
  const dg6 = await server.sendDocumentDiagnosticRequest(narrowed.uri);
  check("`import pure` on a defaulted fact is IMPORT_ROW_DEPRECATED, a Warning (severity 2), naming `pure(…)`", (dg6.items ?? []).length === 1 && dg6.items[0].code === "IMPORT_ROW_DEPRECATED" && dg6.items[0].severity === 2 && dg6.items[0].range.start.line === 0 && dg6.items[0].message.includes("`export const greet = pure(…)`"), dg6.items);

  await server.shutdown();
  console.log(`\n${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

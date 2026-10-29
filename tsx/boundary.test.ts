// Fast contracts for the moving-foundation layout: the import boundary, the pinned stack, and the upstream
// representations the adapter constructs or reads. A failure here is adapter/type/API breakage, not a paired
// behavior mismatch; scripts/canary.sh runs these first.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseProgram, parseStmts, singleModule } from "./rx/compiler.ts";
import { entryView, serverDecl, selectEntry } from "./rx/ast.ts";
import { semanticFacts } from "./rx/facts.ts";
import { actionInference } from "./rx/infer.ts";
import { lowerTsx } from "./lower.ts";

const here = new URL(".", import.meta.url);
const root = new URL("..", import.meta.url);

test("only tsx/rx/ imports the upstream checkout", () => {
  const banned = ["#" + "rx/", "../" + "src/", "../" + "compile/", "upstream" + "/ref/"];
  const files = (readdirSync(here, { recursive: true }) as string[])
    .filter(f => /\.(ts|tsx|mjs)$/.test(f) && !f.startsWith("rx/") && !f.startsWith("fixtures/"));
  assert.ok(files.length > 20);
  for (const f of files) {
    const text = readFileSync(new URL(f, here), "utf8");
    for (const b of banned) assert.ok(!text.includes(b), f + " reaches upstream directly (" + b + ")");
  }
});

test("pinned stack: reactivescript, its ref/SOLID_NEXT and the Solid checkout agree" + (process.env.RX_CANARY ? " (canary: pins not enforced)" : " with pins.json"), () => {
  const pins = JSON.parse(readFileSync(new URL("pins.json", root), "utf8"));
  const upstream = fileURLToPath(new URL("upstream/", root));
  const head = (dir: string) => execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const solidNext = readFileSync(upstream + "ref/SOLID_NEXT", "utf8").trim();
  assert.equal(head(upstream + "../solid-next"), solidNext, "the Solid checkout is upstream's ref/SOLID_NEXT");
  if (!process.env.RX_CANARY) {
    assert.equal(head(upstream), pins.reactivescript.commit);
    assert.equal(solidNext, pins.solid.commit);
  }
});

test("entry representation: the adapter's default-component entry is what upstream's parser produces (MO-1c)", () => {
  const parsed = parseProgram("export default component App() { <p>x</p> }");
  assert.equal(parsed.legacyView, undefined);
  assert.deepEqual(parsed.view, entryView("App", 1));
  const c = parsed.decls[0];
  assert.ok(c.k === "component" && c.isDefault && c.exported);
  const selected = parseProgram("export component App() { <p>x</p> }");
  selectEntry(selected, "App");
  assert.deepEqual(selected.view, parsed.view);
  assert.deepEqual(selected.decls, parsed.decls);
});

test("server representation: one server declaration kind, io inferred by the checker (SF-1)", () => {
  const [parsed] = parseProgram("server fn load(a) { return a }").decls;
  assert.equal(parsed.k, "server");
  assert.ok(!("kind" in parsed), "no server fn/action split");
  const built = serverDecl("load", ["a"], parseStmts("return a"), 1);
  for (const key of Object.keys(built)) assert.ok(key in parsed, "upstream server decls still carry " + key);
  assert.deepEqual({ ...built, body: undefined }, { k: parsed.k, name: (parsed as any).name, params: (parsed as any).params, body: undefined, line: parsed.line });
});

test("model contract: canonical facts keep read modes, writes and region nesting", () => {
  const facts = semanticFacts(singleModule(parseProgram(
    'export default component App() { source n := 0; d = n * 2; s = peek(n); <button onClick={() => { n := n + 1 }}>{"" + d + s}</button> }')));
  assert.deepEqual(facts.diagnostics, []);
  const m = facts.modules[0];
  assert.ok(m.regions.some(r => r.endsWith("/component:App")));
  const reads = m.computations.flatMap(c => c.reads);
  assert.ok(reads.some(r => r.endsWith("::source:n tracked")));
  assert.ok(reads.some(r => r.endsWith("::source:n snapshot")));
  assert.ok(m.computations.some(c => c.kind === "handler" && c.writes.some(w => w.endsWith("::source:n write"))));
});

test("inferred-action contract: upstream AC-1b/AC-1c facts the frontend refuses on", () => {
  const [decl] = parseProgram("source n := 0").decls;
  assert.equal(decl.k, "source");
  assert.deepEqual(actionInference(parseStmts("n := 1; let v = await f(); n := v")), { trigger: "write+await", why: "it writes and awaits", held: ["n"] });
  assert.deepEqual(actionInference(parseStmts("let v = await f(); n := v")).held, []);
  assert.equal(actionInference(parseStmts("n := 1")).trigger, null);
  const source = `import { createSignal } from "solid-js";
import { request } from "./api";
export default function Counter() {
  const [n, setN] = createSignal(0);
  return <button onClick={async () => {
    setN(1);
    const result: number = await request();
    setN(result);
  }}>{n()}</button>;
}`;
  assert.throws(() => lowerTsx(source), /Solid applies n immediately, before the await/);
});

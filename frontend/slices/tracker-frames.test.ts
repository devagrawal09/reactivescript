// Slice 6: inferred server components over Solid 2's Frames (docs/RESULTS.md, "Slice 6"; plan/docs/PLAN-V2.md, "v2.2").
// The tracker-frames slice in RX and TSX (placement-free), its native explicit split (the oracle, N), the all-client twin
// (T, the authored TSX), the plan v2.2 lowered by plan/split.ts (J) and rust-solid's frames server (R), on Chromium with
// Solid's production client builds, then the dev builds. Gates: G1 (placement), G2 (bytes, Solid against Rust, and N
// against J), G3 (client behaviour: frames, requests, server host log, DOM) and G4 (zero client JS for server-only
// components).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { transform } from "@solidjs/compiler";
import { semanticFacts } from "../tsx/rx/facts.ts";
import { loadTsxModules } from "../tsx/modules.ts";
import { loadModules } from "../tsx/rx/compiler.ts";
import { resolvePlanFrames, framesTypes, type FramesPlan } from "../plan/resolve-frames.ts";
import { placement } from "../plan/placement.ts";
import { extractPlacement, projectPlacement } from "../frames/extract.ts";
import { loadSlice, runSliceLeg, type LegName } from "../frames/slice.ts";
import { closeBrowser, buildProgram, startNodeLeg, startRustLeg, type Trace } from "../frames/harness.ts";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const dir = here("./tracker-frames/");
const root = here("..");
const read = (p: string) => { try { return readFileSync(p, "utf8"); } catch { return undefined; } };
const emitCli = (...args: string[]) => spawnSync(process.execPath, ["--experimental-strip-types", "plan/emit.ts", ...args], { cwd: root, encoding: "utf8" });
const rust = process.env.RUST_FRAMES;
const slice = loadSlice("tracker-frames");
const steps = slice.steps as { frame: string }[];
const leg = (name: LegName, build: "prod" | "dev" = "prod") => runSliceLeg(slice, name, build, rust);
const noId = (t: Trace) => t.requests.map(({ id: _id, ...r }) => r);
const ok = (t: Trace, name: string) => assert.deepEqual(t.problems, [], name + " ran clean");

test.after(() => closeBrowser());

test("tracker-frames: TSX and RX have equal canonical facts (server fns over server hosts, components, props, sites)", () => {
  const rx = semanticFacts(loadModules("tracker-frames.rx", (p: string) => read(dir + p)) as never);
  const tsx = semanticFacts(loadTsxModules(dir + "tracker-frames.tsx", read, { frames: true }));
  assert.deepEqual(rx.diagnostics, []);
  assert.deepEqual(tsx, rx);
  const m = rx.modules[0];
  assert.ok(m.symbols.includes("/program::server:loadIssue"));
  assert.ok(m.symbols.includes("/program::import:assignIssue!io"), "assignIssue is io: claim is an io server fn");
  assert.ok(m.symbols.includes("/program::server:claim!io"));
  assert.deepEqual(m.computations.filter(c => c.kind === "prop").map(c => c.at), ["ClaimButton id", "ClaimButton assignee", "ClaimButton take", "Summary open", "Detail issue", "Detail take"]);
});

test("tracker-frames: RX and TSX emit one plan v2.2 through emit.ts, byte-identical to plan/tracker-frames.plan.json", () => {
  const saved = readFileSync(here("../plan/tracker-frames.plan.json"), "utf8");
  for (const f of ["tracker-frames.rx", "tracker-frames.tsx"]) {
    const r = emitCli("slices/tracker-frames/" + f);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, saved, f + " emits the saved plan");
    const forced = emitCli("--schema", "2.2", "slices/tracker-frames/" + f);
    assert.equal(forced.stdout, saved);
  }
  const plan = JSON.parse(saved) as FramesPlan;
  assert.equal(plan.version, 2.2);
  assert.deepEqual(plan.serverFns.map(f => f.id), ["loadList-59b2922c", "loadIssue-59b2922c", "loadSummary-59b2922c", "claim-59b2922c"]);
  assert.deepEqual(plan.memos.filter(m => "await" in m).map(m => [m.name, (m as { sunk?: string }).sunk ?? null]), [["issues", null], ["issue", "Detail$server"], ["open", "Summary$server"]]);
});

test("tracker-frames: G1 — placement(RX) == placement(TSX) == the saved table == extract(N), and the plan's block is its own recomputation", () => {
  const saved = JSON.parse(readFileSync(dir + "tracker-frames.placement.json", "utf8"));
  const rx = resolvePlanFrames(loadModules("tracker-frames.rx", (p: string) => read(dir + p)) as never, { stem: "tracker-frames" }) as FramesPlan;
  const tsx = resolvePlanFrames(loadTsxModules(dir + "tracker-frames.tsx", read, { frames: true }), { stem: "tracker-frames" }) as FramesPlan;
  assert.equal(JSON.stringify(rx.placement), JSON.stringify(saved));
  assert.equal(JSON.stringify(tsx.placement), JSON.stringify(saved));
  // A consumer recomputes the table from the rest of the plan (its annotations removed) and refuses a plan whose block
  // differs.
  const bare = structuredClone(rx) as FramesPlan;
  for (const m of bare.memos) delete (m as { sunk?: string }).sunk;
  const strip = (vs: FramesPlan["markup"]) => { for (const v of vs) { if (v.kind === "component") { delete v.place; delete v.server; } if ("children" in v) strip(v.children); if ("fallback" in v) strip(v.fallback); } };
  strip(bare.markup);
  assert.equal(JSON.stringify(placement(bare, framesTypes(bare).exprType).table), JSON.stringify(saved));
  // The oracle's split states the same placement (what TSX can state: no props map, no memo names, no reasons beyond
  // the entry and the islands' client marks).
  assert.deepEqual(extractPlacement(slice.programs.N.modules, "tracker-frames"), projectPlacement(saved));
  assert.deepEqual(extractPlacement(slice.programs.J.modules, "tracker-frames"), projectPlacement(saved));
});

test("tracker-frames: T, the all-client twin, renders the scenario's frames, each step's change in one frame", async () => {
  const t = await leg("T");
  ok(t, "T");
  assert.deepEqual(t.frames, steps.map(s => s.frame));
  for (const [i, seen] of t.seen.entries()) assert.ok(seen.length <= 2, "step " + i + " passed through " + JSON.stringify(seen));
  // The claim's server call, its three refreshes and the status write land together (C15).
  assert.deepEqual(t.seen[11], [steps[10].frame, steps[11].frame]);
});

test("tracker-frames: G3 — N, the native split, against T: equal frames and server host log; requests equal apart from the wire id", async () => {
  const [n, t] = [await leg("N"), await leg("T")];
  ok(n, "N");
  assert.deepEqual(n.frames, t.frames);
  assert.deepEqual(n.seen, t.seen);
  assert.deepEqual(n.hosts, t.hosts);
  assert.deepEqual(noId(n), noId(t));
  // The placement-dependent column: the questions issue and open are their server components' calls in N.
  assert.deepEqual(n.requests.map(r => r.id), ["Detail$server-59b2922c", "Detail$server-59b2922c", "claim-59b2922c", "loadList-59b2922c", "Detail$server-59b2922c", "Summary$server-59b2922c", "Detail$server-59b2922c", "claim-59b2922c"]);
  assert.deepEqual(t.requests.map(r => r.id.replace(/-.*/, "")), ["loadIssue", "loadIssue", "claim", "loadList", "loadIssue", "loadSummary", "loadIssue", "claim"]);
  assert.equal(n.requests.at(-1)!.outcome, "error", "the rejected claim");
});

test("tracker-frames: G2/G3 — J (the plan's canonical split) equals N: frames, requests, host log, DOM, every wire record byte for byte", async () => {
  const [n, j] = [await leg("N"), await leg("J")];
  ok(j, "J");
  for (const k of ["frames", "seen", "requests", "hosts", "dom"] as const) assert.deepEqual(j[k], n[k], k);
  assert.equal(j.wire.length, n.wire.length);
  for (const [i, w] of n.wire.entries()) assert.deepEqual(j.wire[i], w, "wire record " + i + " (" + w.method + " " + w.path + ")");
});

test("tracker-frames: G2/G3 — R (rust-solid's frames server) equals N: document, frame streams, data and error responses byte for byte; frames, requests, host log, DOM", { skip: !rust }, async () => {
  const [n, r] = [await leg("N"), await leg("R")];
  ok(r, "R");
  for (const k of ["frames", "seen", "requests", "hosts", "dom"] as const) assert.deepEqual(r[k], n[k], k);
  assert.equal(r.wire.length, n.wire.length);
  for (const [i, w] of n.wire.entries()) assert.deepEqual(r.wire[i], w, "wire record " + i + " (" + w.method + " " + w.path + ")");
  const kinds = n.wire.map(w => w.path === "/" ? "document" : w.headers.find(([k]) => k === "content-type")![1]);
  assert.deepEqual([...new Set(kinds)].sort(), ["application/json", "application/x-frame-stream", "document", "text/plain"]);
});

test("tracker-frames: the dev builds hydrate T, N, J and R and replay the scenario with no warning", async () => {
  for (const name of (rust ? ["T", "N", "J", "R"] : ["T", "N", "J"]) as LegName[]) {
    const t = await leg(name, "dev");
    ok(t, name + " (dev)");
    assert.deepEqual(t.frames, steps.map(s => s.frame), name + " (dev)");
  }
});

/** The DOM templates a component's client compile would ship (`_$template(`…`)` literals referenced in its body). */
function clientTemplates(source: string, component: string): string[] {
  const code = transform(source, { filename: "t.tsx", generate: "dom", hydratable: true }).code;
  const defs = new Map([...code.matchAll(/var (_tmpl\$\d*) = \/\* @__PURE__ \*\/ _\$template\((`[^`]*`)\)/g)].map(m => [m[1], m[2]]));
  const start = code.indexOf("function " + component + "(");
  const ends = ["\nfunction ", "\nexport "].map(k => code.indexOf(k, start + 1)).filter(i => i > 0);
  const body = code.slice(start, ends.length ? Math.min(...ends) : undefined);
  return [...new Set([...body.matchAll(/(_tmpl\$\d*)\b/g)].map(m => defs.get(m[1])!).filter(Boolean))];
}

test("tracker-frames: G4 — zero client JS for the server-only components Detail and Summary", async () => {
  const twinSource = readFileSync(dir + "tracker-frames.tsx", "utf8");
  const templates = [...clientTemplates(twinSource, "Detail"), ...clientTemplates(twinSource, "Summary")];
  assert.deepEqual(templates, ["`<article><h2></h2><p></p><!$><!/>`", "`<p>`"]);
  const legs: LegName[] = rust ? ["N", "J", "R"] : ["N", "J"];
  for (const name of legs) {
    const t = await leg(name);
    const server = t.modules.find(m => m.url === "/src/tracker-frames.server.js");
    // The client compile of the server module is exactly its references and their exports: one
    // `createServerReference("<id>")` per server function and server component, in reverse declaration order, then
    // their exports in declaration order (the oracle's text is pinned; J's and R's declare their server components in
    // site order).
    const names = [...slice.programs[name === "N" ? "N" : "J"].modules["tracker-frames.server.tsx"].matchAll(/export async function (\w+\$?\w*)\(/g)].map(m => m[1]);
    assert.equal(server?.text, "import { createServerReference as createServerReference_1 } from \"@solidjs/web/server-functions\";\n" +
      [...names].reverse().map(n => "const " + n + " = createServerReference_1(\"" + n + "-59b2922c\");\n").join("") +
      names.map(n => "export { " + n + " };\n").join(""), name);
    if (name === "N") assert.deepEqual(names, ["loadList", "loadIssue", "loadSummary", "claim", "Detail$server", "Summary$server"]);
    for (const m of t.modules) for (const tpl of templates) assert.ok(!m.text.includes(tpl), name + ": " + m.url + " ships " + tpl);
    assert.ok(!t.modules.some(m => /\/db(\.|$)/.test(m.url)), name + ": the server-only host module is not fetched");
  }
  // The control: the twin's graph does ship them, so the measurement can fail.
  const t = await leg("T");
  for (const tpl of templates) assert.ok(t.modules.some(m => m.text.includes(tpl)), "T ships " + tpl);
});

test("tracker-frames: G2 — a request without fetch metadata is refused 403, by Solid's server and by rust-solid's alike", async () => {
  const b = buildProgram(slice.programs.N);
  const servers = [await startNodeLeg(b)];
  if (rust) {
    const { writeFileSync, mkdirSync } = await import("node:fs");
    const d = here("../.out/frames/rust/403/");
    mkdirSync(d, { recursive: true });
    writeFileSync(d + "plan.json", JSON.stringify(slice.plan));
    writeFileSync(d + "answers.json", "[]");
    servers.push(await startRustLeg(rust, d + "plan.json", d + "answers.json"));
  }
  const records = [];
  try {
    for (const s of servers) {
      const r = await fetch("http://127.0.0.1:" + s.port + "/_server/data/claim-59b2922c", { method: "POST", body: "[3]", headers: { "x-server-function-format": "8" } });
      assert.equal(r.status, 403);
      records.push((await s.log()).wire.at(-1));
    }
  } finally { for (const s of servers) await s.close(); }
  assert.deepEqual(records[0], { method: "POST", path: "/_server/data/claim-59b2922c", body: "[3]", status: 403, headers: [["cache-control", "no-store"], ["vary", "Sec-Fetch-Site, Origin, Referer"], ["x-content-type-options", "nosniff"]], chunks: [] });
  if (rust) assert.deepEqual(records[1], records[0]);
});

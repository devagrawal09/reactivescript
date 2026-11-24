// node --experimental-strip-types rt/sizemap.ts <rx-worktree> <file.rx> <mode>
// node --experimental-strip-types rt/sizemap.ts report
//
// First esbuild pass of an .rx app (same compile + defines as rx-bundle.ts), minify on,
// metafile on. Attributes output bytes to input files and groups them. Writes nothing
// outside rt/. One variant per call; `report` runs the matrix, the marginal entries,
// and the counter function census, sequentially, in this process.
import { readFileSync, writeFileSync, mkdirSync, existsSync, realpathSync, symlinkSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve, basename, dirname } from "node:path";
import { gzipSync, brotliCompressSync } from "node:zlib";
import { createRequire } from "node:module";

const BENCH = "/home/lucifer/work/solidjs/store-proto-bench";
const RT = BENCH + "/rt";
const RESULTS = RT + "/results";
const TMP = RT + "/tmp";
const BASE = "/home/lucifer/work/solidjs/rx-store-proto-base";
const FEAT = "/home/lucifer/work/solidjs/rx-store-proto-features";
const APPS = ["counter.rx", "rows.rx", "optimistic.rx", "keyed.rx"];
const NAMES = ["accessors", "guards", "shallow", "families", "optimistic", "delete"];

// Group order. A row is omitted from a table only when every variant is 0.
const GROUP_ORDER = [
  "signals: core",
  "signals: API",
  "signals: scheduler",
  "signals: lanes/optimistic",
  "signals: verdict",
  "signals: async+action",
  "signals: errors",
  "signals: effects",
  "signals: owners/context",
  "signals: external",
  "signals: boundaries",
  "signals: reveal",
  "signals: deferred",
  "signals: from",
  "signals: flatten",
  "signals: affects",
  "signals: mapArray/repeat",
  "signals: barrel",
  "store: core",
  "store: barrel",
  "store: projection",
  "store: optimistic",
  "store: reconcile",
  "store: utils",
  "store: storePath",
  "store: affects",
  "store: edges",
  "dev/observe/attribution",
  "solid-js",
  "web",
  "seroval",
  "RX runtime",
  "compiled program",
  "entry glue",
  "esbuild helper",
  "UNMAPPED",
];

// What the classifier keys off. Printed in the report so the grouping can be checked
// against packages/signals/src headers and dist/{prod,select}/.
const MAPPING: { group: string; files: string; note: string }[] = [
  { group: "signals: core", files: "core/core.js, graph.js, heap.js, constants.js", note: "graph, read/write, recompute, scheduling heap, bit constants. core/types.ts is erased (no dist file)." },
  { group: "signals: API", files: "signals.js", note: "public wrappers: createSignal/memo/effect, refresh, onSettled, onFlush, onCleanup. Not in the suggested list; kept separate so it does not hide inside core." },
  { group: "signals: scheduler", files: "core/scheduler.js", note: "flush, transactions, holds, transitions." },
  { group: "signals: lanes/optimistic", files: "core/lanes.js, guesses.js, truth.js", note: "lane engine, guess layer, truth reads (until/refresh) and the two views of a lane node. seat.js is test-only (__TEST__); rollup does not emit it." },
  { group: "signals: verdict", files: "core/verdict.js", note: "isPending/latest probes. Split from lanes because it is its own file. It imports lanes.js, so using a probe still pulls the lane engine." },
  { group: "signals: async+action", files: "core/async.js, action.js", note: "async flight/pending machinery, and action()." },
  { group: "signals: errors", files: "core/error.js, error-hooks.js", note: "NotReadyError and the client error hook." },
  { group: "signals: effects", files: "core/effect.js", note: "effect / render-effect / tracked-effect nodes." },
  { group: "signals: owners/context", files: "core/owner.js, context.js", note: "owners, disposal, createContext/getContext/setContext." },
  { group: "signals: external", files: "core/external.js", note: "enableExternalSource. Not in the suggested list; own row so a leftover is visible." },
  { group: "signals: boundaries", files: "boundaries.js", note: "createLoadingBoundary / createErrorBoundary." },
  { group: "signals: reveal", files: "reveal.js", note: "createRevealOrder." },
  { group: "signals: deferred", files: "deferred.js", note: "createDeferred." },
  { group: "signals: from", files: "from.js", note: "from() push-source adapter." },
  { group: "signals: flatten", files: "flatten.js", note: "children-tree resolver. Carved out of boundaries so it is not a boundary feature." },
  { group: "signals: affects", files: "affects.js, affects-marks.js", note: "affects() and the mark core shared with createDeferred." },
  { group: "signals: mapArray/repeat", files: "map.js", note: "mapArray and repeat." },
  { group: "signals: barrel", files: "index.js", note: "package barrel. Usually a few re-exports after shaking." },
  { group: "store: core", files: "store/store.js, target.js, types.js, hooks.js", note: "plain store engine, target/ownership, brands, optional-machinery slots." },
  { group: "store: barrel", files: "store/index.js", note: "createStore dispatcher. The families flag folds the derived-store arm here." },
  { group: "store: projection", files: "store/projection.js", note: "createProjection / derived stores." },
  { group: "store: optimistic", files: "store/optimistic.js", note: "createOptimisticStore." },
  { group: "store: reconcile", files: "store/reconcile.js", note: "reconcile adoption channel." },
  { group: "store: utils", files: "store/utils.js", note: "merge / omit." },
  { group: "store: storePath", files: "store/storePath.js", note: "store path setter." },
  { group: "store: affects", files: "store/affects.js", note: "store half of affects(). Installed on first store mark, not by createStore." },
  { group: "store: edges", files: "store/edges.js", note: "deferred-hydration store names. Header says only the frames client imports it." },
  { group: "dev/observe/attribution", files: "core/dev.js, copies.js, identities.js, invariants.js, attribution*.js, dist attribution.js", note: "prod stubs and observe hooks. Should be ~0. identities.js is the signal-name seam for deferred hydration, not a console reporter; still counted here as a leftover." },
  { group: "solid-js", files: "packages/solid/dist/solid.js, internal.js", note: "one client bundle plus the internal entry web imports. Not split by export here; step 3 estimates sub-parts." },
  { group: "web", files: "packages/web/dist/web.js", note: "DOM runtime, Portal, Dynamic, hydrate, in one client file. seroval is only in the server build." },
  { group: "seroval", files: "seroval, seroval-plugins", note: "SSR serialization. Expected 0 on the client build." },
  { group: "RX runtime", files: "ref/compile/rt-web.ts, store-ops.ts, features.ts, prims-solid.ts, string-renderer.ts, other compile/*.ts", note: "the ReactiveScript browser runtime. File split is in the per-file table, not a separate group." },
  { group: "compiled program", files: "main.mjs, mN.mjs, api.mjs", note: "compiler output plus the harness api.mjs (buildRows/save/loadRows)." },
  { group: "entry glue", files: "entry.mjs", note: "createApp + mount. Not part of the program or the runtime." },
];

type Feat = { stores: boolean; accessors: boolean; guards: boolean; shallow: boolean; families: boolean; optimistic: boolean; delete: boolean; why: Record<string, string> };
type Imp = { from: string; kind: string; original?: string };
type FileRow = { path: string; short: string; group: string; bytesInOutput: number; sourceBytes: number; importedBy: Imp[] };
type Measure = {
  wt: string; file: string; mode: string; id: string;
  features: Feat | null;
  pass1: number; pass1Gzip: number;
  pass2: number; pass2Gzip: number; pass2Brotli: number;
  groups: { group: string; min: number; gzipSrc: number; files: number }[];
  files: FileRow[];
  residual: number;
  outDir: string;
  define: Record<string, string>;
  conditions: string[];
  // every metafile input, including files shaken to 0 output bytes, so a chain can walk through them
  graph: { path: string; importedBy: Imp[] }[];
};

function log(s: string) { process.stderr.write(s + "\n"); }

function classify(abs: string): string {
  const p = abs.replace(/\\/g, "/");
  if (p.includes("<runtime>") || p.endsWith("/<runtime>")) return "esbuild helper";
  const sig = p.match(/\/packages\/signals\/dist\/(?:prod|select|observe)\/(.+)$/);
  if (sig) return signalsGroup(sig[1]);
  if (/\/packages\/signals\/dist\/.*attribution/.test(p) || /\/packages\/signals\/dist\/dev/.test(p)) return "dev/observe/attribution";
  if (p.includes("/packages/solid/")) return "solid-js";
  if (p.includes("/packages/web/")) return "web";
  if (p.includes("seroval")) return "seroval";
  if (p.includes("/ref/compile/")) return "RX runtime";
  if (p.endsWith("/entry.mjs")) return "entry glue";
  if (p.endsWith("/api.mjs") || /\/rt\/tmp\/.*\.mjs$/.test(p)) return "compiled program";
  return "UNMAPPED";
}

function signalsGroup(rel: string): string {
  const base = rel.split("/").pop()!;
  const dir = rel.includes("/") ? rel.slice(0, rel.indexOf("/")) : "";
  if (dir === "core") {
    if (["core.js", "graph.js", "heap.js", "constants.js", "types.js"].includes(base)) return "signals: core";
    if (base === "scheduler.js") return "signals: scheduler";
    if (["lanes.js", "guesses.js", "truth.js", "seat.js"].includes(base)) return "signals: lanes/optimistic";
    if (base === "verdict.js") return "signals: verdict";
    if (["async.js", "action.js"].includes(base)) return "signals: async+action";
    if (["error.js", "error-hooks.js"].includes(base)) return "signals: errors";
    if (base === "effect.js") return "signals: effects";
    if (["owner.js", "context.js"].includes(base)) return "signals: owners/context";
    if (base === "external.js") return "signals: external";
    if (/^(dev|copies|identities|invariants|attribution)/.test(base)) return "dev/observe/attribution";
    return "UNMAPPED";
  }
  if (dir === "store") {
    if (["store.js", "target.js", "types.js", "hooks.js"].includes(base)) return "store: core";
    if (base === "index.js") return "store: barrel";
    if (base === "projection.js") return "store: projection";
    if (base === "optimistic.js") return "store: optimistic";
    if (base === "reconcile.js") return "store: reconcile";
    if (base === "utils.js") return "store: utils";
    if (base === "storePath.js") return "store: storePath";
    if (base === "affects.js") return "store: affects";
    if (base === "edges.js") return "store: edges";
    return "UNMAPPED";
  }
  if (base === "signals.js") return "signals: API";
  if (base === "index.js") return "signals: barrel";
  if (base === "boundaries.js") return "signals: boundaries";
  if (base === "reveal.js") return "signals: reveal";
  if (base === "deferred.js") return "signals: deferred";
  if (base === "from.js") return "signals: from";
  if (base === "flatten.js") return "signals: flatten";
  if (base === "affects.js" || base === "affects-marks.js") return "signals: affects";
  if (base === "map.js") return "signals: mapArray/repeat";
  if (base.startsWith("attribution")) return "dev/observe/attribution";
  return "UNMAPPED";
}

function shortPath(p: string): string {
  const n = p.replace(/\\/g, "/");
  const m = n.match(/packages\/signals\/dist\/(?:prod|select|observe)\/(.+)$/);
  if (m) return "signals/" + m[1];
  const s = n.match(/packages\/solid\/dist\/(.+)$/);
  if (s) return "solid/" + s[1];
  const w = n.match(/packages\/web\/dist\/(.+)$/);
  if (w) return "web/" + w[1];
  const c = n.match(/ref\/compile\/(.+)$/);
  if (c) return "rx/" + c[1];
  const t = n.match(/rt\/tmp\/[^/]+\/(.+)$/);
  if (t) return "app/" + t[1];
  if (n.includes("seroval")) {
    const i = n.indexOf("seroval");
    return n.slice(i).split("/").slice(0, 2).join("/");
  }
  return n.split("/").slice(-3).join("/");
}

function real(p: string): string {
  try { return realpathSync(p); } catch { return p; }
}

async function measure(wt: string, file: string, mode: string): Promise<Measure> {
  const id = `${basename(wt).replace("rx-store-proto-", "")}-${basename(file, ".rx")}-${mode}`;
  log(`measure ${id}`);
  const ref = (p: string) => import(pathToFileURL(`${wt}/ref/${p}`).href);
  const { loadModules } = await ref("src/modules.ts");
  const { checkModules } = await ref("src/check.ts");
  const { compileModules } = await ref("compile/emit.ts");
  const { lowerViews } = await ref("compile/jsx.ts");
  const { buildSync } = createRequire(`${wt}/ref/package.json`)("esbuild");
  const set = loadModules(resolve(file), (p: string) => existsSync(p) ? readFileSync(p, "utf8") : undefined);
  const { diags } = checkModules(set);
  if (diags.length) { console.error(diags); throw new Error(`check failed: ${id}`); }
  const compiled = compileModules(set);
  const out = `${TMP}/${id}/`;
  mkdirSync(out, { recursive: true });
  // The compiled program imports @solidjs/web. rx-bundle.ts writes under <wt>/ref/ so
  // resolution walks up to <wt>/ref/node_modules. We must not write there, so the out dir
  // gets a symlink at the same packages. Does not touch the worktree.
  const nm = out + "node_modules";
  if (!existsSync(nm)) symlinkSync(`${wt}/ref/node_modules`, nm);
  for (const [n, js] of lowerViews(compiled.files, "dom")) writeFileSync(out + n, js);
  writeFileSync(out + "api.mjs", `let id = 0;\nexport const buildRows = n => Array.from({ length: n }, () => ({ id: ++id, label: "row " + id, n: id }));\nexport const swapRows = rs => { const a = Array.from(rs); if (a.length > 3) { const t = a[1]; a[1] = a[a.length - 2]; a[a.length - 2] = t; } return a; };\nexport const buildDeep = n => Array.from({ length: n }, (_, i) => ({ id: i, a: { b: { c: "c" + i } } }));\nexport const save = t => new Promise(r => setTimeout(() => r(t), 100));\nexport const loadRows = p => new Promise(r => setTimeout(() => r(buildRows(10)), 100));\n`);
  writeFileSync(out + "entry.mjs", `import { createApp } from ${JSON.stringify(`${wt}/ref/compile/rt-web.ts`)};\nimport main from "./${compiled.entry}";\nimport * as api from "./api.mjs";\nconst app = createApp({ root: document.getElementById("app"), api });\napp.mount(main(app));\n`);
  const feats: Feat | null = (compiled as any).features ?? null;
  const define: Record<string, string> = { "process.env.NODE_ENV": '"production"' };
  if (mode === "manifest") {
    if (!feats) throw new Error("this worktree's compiler emits no manifest");
    for (const n of NAMES) define[`__SOLID_STORE_${n.toUpperCase()}__`] = String(feats[n]);
  }
  if (feats) {
    const on = mode !== "manifest";
    define.__RX_STORES__ = String(on || feats.stores);
    define.__RX_FAMILIES__ = String(on || feats.families);
    define.__RX_OPTIMISTIC__ = String(on || feats.optimistic);
  }
  const conditions = mode === "plain" ? ["browser"] : ["store-select", "browser"];
  const r1 = buildSync({
    entryPoints: [out + "entry.mjs"], bundle: true, write: false, format: "esm", platform: "browser",
    conditions, minify: true, treeShaking: true, tsconfigRaw: "{}", logLevel: "error", define, metafile: true,
  });
  const pass1 = r1.outputFiles[0].contents as Uint8Array;
  writeFileSync(out + "pass1.js", pass1);
  const r2 = buildSync({
    entryPoints: [out + "pass1.js"], bundle: true, write: false, format: "esm", platform: "browser",
    minify: true, treeShaking: true, logLevel: "error",
  });
  const pass2 = r2.outputFiles[0].contents as Uint8Array;
  const meta = r1.metafile;
  const outKey = Object.keys(meta.outputs)[0];
  const outInfo = meta.outputs[outKey];
  const importerOf = indexImporters(meta);
  const graph = [...new Set([...Object.keys(meta.inputs as object), ...importerOf.keys()])].map(path => ({
    path, importedBy: importersFor(path, importerOf),
  }));
  const files: FileRow[] = [];
  for (const [inp, contrib] of Object.entries(outInfo.inputs as Record<string, { bytesInOutput: number }>)) {
    const bytesInOutput = contrib.bytesInOutput ?? 0;
    if (bytesInOutput <= 0) continue;
    const srcBytes = (meta.inputs as any)[inp]?.bytes ?? 0;
    files.push({
      path: inp,
      short: shortPath(inp),
      group: classify(real(inp)),
      bytesInOutput,
      sourceBytes: srcBytes,
      importedBy: importersFor(inp, importerOf),
    });
  }
  files.sort((a, b) => b.bytesInOutput - a.bytesInOutput);
  const byGroup = new Map<string, FileRow[]>();
  for (const f of files) {
    const g = byGroup.get(f.group) ?? [];
    g.push(f);
    byGroup.set(f.group, g);
  }
  const groups = [...byGroup.entries()].map(([group, rows]) => ({
    group,
    min: rows.reduce((s, r) => s + r.bytesInOutput, 0),
    gzipSrc: gzipSources(rows.map(r => r.path)),
    files: rows.length,
  }));
  const attributed = groups.reduce((s, g) => s + g.min, 0);
  return {
    wt: basename(wt), file: basename(file), mode, id, features: feats,
    pass1: pass1.length, pass1Gzip: gzipSync(pass1, { level: 9 }).length,
    pass2: pass2.length, pass2Gzip: gzipSync(pass2, { level: 9 }).length, pass2Brotli: brotliCompressSync(pass2).length,
    groups, files, residual: pass1.length - attributed, outDir: out, define, conditions, graph,
  };
}

function indexImporters(meta: any): Map<string, Imp[]> {
  const by = new Map<string, Imp[]>();
  const add = (key: string, imp: Imp) => {
    const list = by.get(key) ?? [];
    list.push(imp);
    by.set(key, list);
  };
  for (const [src, info] of Object.entries(meta.inputs as Record<string, { imports?: any[] }>)) {
    for (const im of info.imports ?? []) {
      if (im.external) continue;
      const imp = { from: src, kind: im.kind ?? "", original: im.original };
      add(im.path, imp);
      const rp = real(im.path);
      if (rp !== im.path) add(rp, imp);
    }
  }
  return by;
}

function importersFor(inp: string, by: Map<string, Imp[]>): Imp[] {
  const seen = new Set<string>();
  const out: Imp[] = [];
  for (const key of [inp, real(inp)]) {
    for (const im of by.get(key) ?? []) {
      const k = im.from + "\0" + (im.original ?? "");
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(im);
    }
  }
  return out;
}

function gzipSources(paths: string[]): number {
  const chunks: Buffer[] = [];
  for (const p of [...paths].sort()) {
    const tryPath = existsSync(p) ? p : existsSync(real(p)) ? real(p) : "";
    if (!tryPath) continue;
    chunks.push(readFileSync(tryPath));
    chunks.push(Buffer.from("\n"));
  }
  if (!chunks.length) return 0;
  return gzipSync(Buffer.concat(chunks), { level: 9 }).length;
}

function importerMap(m: Measure): Map<string, Imp[]> {
  const by = new Map<string, Imp[]>();
  for (const g of m.graph) by.set(g.path, g.importedBy);
  return by;
}

// A path from this file to entry.mjs through the metafile import graph, including files
// that contributed 0 output bytes (a barrel can be the link and still be shaken flat).
function chainToEntry(file: string, by: Map<string, Imp[]>, seen = new Set<string>()): string | null {
  const label = shortPath(file);
  if (file.endsWith("/entry.mjs")) return label;
  if (seen.has(file)) return null;
  const next = new Set(seen);
  next.add(file);
  const imps = [...(by.get(file) ?? by.get(real(file)) ?? [])].sort((a, b) => rank(a.from) - rank(b.from));
  for (const im of imps) {
    const rest = chainToEntry(im.from, by, next);
    if (!rest) continue;
    const spec = im.original ? "`" + im.original + "`" : im.kind;
    return `${label} ← ${spec} in ${rest}`;
  }
  return null;
}

function directImporters(file: string, by: Map<string, Imp[]>): string {
  const imps = by.get(file) ?? by.get(real(file)) ?? [];
  if (!imps.length) return "(no importer in the metafile)";
  return imps.map(im => `${im.original ? "`" + im.original + "`" : im.kind} in ${shortPath(im.from)}`).join("; ");
}

function rank(p: string): number {
  if (p.endsWith("/entry.mjs")) return 0;
  if (p.includes("/rt-web.ts")) return 1;
  if (p.endsWith("/solid.js") || p.endsWith("/internal.js")) return 2;
  if (p.endsWith("/web.js")) return 2;
  if (p.endsWith("/signals.js") || p.endsWith("/store/index.js")) return 3;
  return 4;
}

function surprises(m: Measure): { file: string; bytes: number; group: string; reason: string; chain: string; direct: string }[] {
  const by = importerMap(m);
  const f = m.features;
  const out: { file: string; bytes: number; group: string; reason: string; chain: string; direct: string }[] = [];
  const push = (row: FileRow, reason: string) => out.push({
    file: row.short, bytes: row.bytesInOutput, group: row.group, reason,
    chain: chainToEntry(row.path, by) ?? "(no path to entry.mjs)",
    direct: directImporters(row.path, by),
  });
  for (const row of m.files) {
    if (row.group === "dev/observe/attribution") push(row, "dev/observe/attribution file has bytes in a production bundle");
    if (row.group === "seroval") push(row, "seroval is in a client bundle");
    if (row.group === "UNMAPPED") push(row, "unmapped input");
    if (row.group === "store: edges") push(row, "store/edges.js is documented as frames-client only");
    if (row.short.endsWith("string-renderer.ts")) push(row, "string-renderer is not on the browser runtime's import list");
    if (!f || m.mode !== "manifest") continue;
    if (!f.stores && row.group.startsWith("store:")) push(row, "manifest stores=false but a store module contributed bytes");
    if (!f.optimistic && (row.short.endsWith("guesses.js") || row.short.endsWith("store/optimistic.js"))) push(row, "manifest optimistic=false but this module contributed bytes");
    if (!f.families && row.short.endsWith("projection.js")) push(row, "manifest families=false but projection.js contributed bytes");
    if (!f.stores && row.short.endsWith("store-ops.ts")) push(row, "manifest stores=false but store-ops.ts contributed bytes");
  }
  // counter cannot reach these. Flag them on every app's manifest too, with the chain, so the pull is visible.
  if (m.file === "counter.rx" && m.mode === "manifest") {
    const optional = new Set([
      "signals: verdict", "signals: lanes/optimistic", "signals: boundaries", "signals: reveal",
      "signals: deferred", "signals: from", "signals: mapArray/repeat", "signals: affects",
      "signals: external", "store: projection", "store: optimistic", "store: reconcile",
      "store: utils", "store: storePath", "store: affects", "store: edges",
    ]);
    for (const row of m.files) {
      if (!optional.has(row.group)) continue;
      if (out.some(s => s.file === row.short)) continue;
      push(row, "counter.rx cannot use this feature; it is in the bundle anyway");
    }
  }
  return out;
}

// ---------------------------------------------------------------- marginal entries

type MargRow = { name: string; min: number; gzip: number; dMin: number; dGzip: number; byPkg: Record<string, number> };

function pkgOf(p: string): string {
  if (p.includes("/packages/signals/")) return "signals";
  if (p.includes("/packages/solid/")) return "solid";
  if (p.includes("/packages/web/")) return "web";
  if (p.includes("seroval")) return "seroval";
  return "other";
}

function bundleEntry(wt: string, code: string, name: string): { min: number; gzip: number; byPkg: Record<string, number> } {
  const dir = `${TMP}/marginal/`;
  mkdirSync(dir, { recursive: true });
  const nm = dir + "node_modules";
  if (!existsSync(nm)) symlinkSync(`${wt}/ref/node_modules`, nm);
  const entry = dir + name + ".mjs";
  writeFileSync(entry, code);
  const { buildSync } = createRequire(`${wt}/ref/package.json`)("esbuild");
  const r = buildSync({
    entryPoints: [entry], bundle: true, write: false, format: "esm", platform: "browser",
    conditions: ["browser"], minify: true, treeShaking: true, logLevel: "error",
    define: { "process.env.NODE_ENV": '"production"' },
    nodePaths: [`${wt}/ref/node_modules`],
    tsconfigRaw: "{}",
    metafile: true,
  });
  const bytes = r.outputFiles[0].contents as Uint8Array;
  const outKey = Object.keys(r.metafile.outputs)[0];
  const byPkg: Record<string, number> = {};
  for (const [inp, contrib] of Object.entries(r.metafile.outputs[outKey].inputs as Record<string, { bytesInOutput: number }>)) {
    const k = pkgOf(inp);
    byPkg[k] = (byPkg[k] ?? 0) + (contrib.bytesInOutput ?? 0);
  }
  return { min: bytes.length, gzip: gzipSync(bytes, { level: 9 }).length, byPkg };
}

function cumEntries(pkg: string, steps: { name: string; add: string[]; extra?: string }[]): { name: string; code: string }[] {
  const have: string[] = [];
  const extras: string[] = [];
  return steps.map((s, i) => {
    have.push(...s.add);
    if (s.extra) extras.push(s.extra);
    const uniq = [...new Set(have)];
    const code = `import { ${uniq.join(", ")} } from ${JSON.stringify(pkg)};\nexport const __keep = [${uniq.join(", ")}];\n${extras.join("\n")}\n`;
    return { name: String(i).padStart(2, "0") + "-" + s.name.replace(/[^a-z0-9+]+/gi, "-").slice(0, 40), code, label: s.name };
  }) as any;
}

function marginal(wt: string): { signals: MargRow[]; solid: MargRow[]; web: MargRow[] } {
  log("marginal entries");
  const empty = bundleEntry(wt, "export {}\n", "empty");
  const run = (rows: { name: string; code: string; label?: string }[], floorNote: string) => {
    const out: MargRow[] = [{ name: "(empty entry)", min: empty.min, gzip: empty.gzip, dMin: empty.min, dGzip: empty.gzip, byPkg: empty.byPkg }];
    let prev = empty;
    for (const row of rows) {
      log("  " + (row.label ?? row.name));
      const b = bundleEntry(wt, row.code, row.name);
      out.push({ name: row.label ?? row.name, min: b.min, gzip: b.gzip, dMin: b.min - prev.min, dGzip: b.gzip - prev.gzip, byPkg: b.byPkg });
      prev = b;
    }
    void floorNote;
    return out;
  };
  const sigSteps = cumEntries("@solidjs/signals", [
    { name: "{createSignal, createRoot, flush}", add: ["createSignal", "createRoot", "flush"] },
    { name: "+ createMemo", add: ["createMemo"] },
    { name: "+ createEffect, createRenderEffect", add: ["createEffect", "createRenderEffect"] },
    { name: "+ onCleanup, getOwner, runWithOwner, createContext, getContext, setContext", add: ["onCleanup", "getOwner", "runWithOwner", "createContext", "getContext", "setContext"] },
    { name: "+ untrack", add: ["untrack"] },
    { name: "+ action", add: ["action"] },
    { name: "+ createSignal(async) + refresh", add: ["refresh"], extra: "const [ag] = createSignal(async () => 1);\nrefresh(ag);\nexport const __async = ag;" },
    { name: "+ isPending, latest", add: ["isPending", "latest"] },
    { name: "+ createOptimistic", add: ["createOptimistic"] },
    { name: "+ createLoadingBoundary, createErrorBoundary", add: ["createLoadingBoundary", "createErrorBoundary"] },
    { name: "+ createRevealOrder", add: ["createRevealOrder"] },
    { name: "+ mapArray", add: ["mapArray"] },
    { name: "+ createStore", add: ["createStore"] },
    { name: "+ createProjection", add: ["createProjection"] },
    { name: "+ createOptimisticStore", add: ["createOptimisticStore"] },
    { name: "+ onSettled, onFlush", add: ["onSettled", "onFlush"] },
  ]);
  const solidSteps = cumEntries("solid-js", [
    { name: "{createComponent}", add: ["createComponent"] },
    { name: "+ Show", add: ["Show"] },
    { name: "+ For", add: ["For"] },
    { name: "+ Switch, Match", add: ["Switch", "Match"] },
    { name: "+ Loading", add: ["Loading"] },
    { name: "+ Errored", add: ["Errored"] },
    { name: "+ Reveal", add: ["Reveal"] },
    { name: "+ createContext, useContext", add: ["createContext", "useContext"] },
    { name: "+ lazy", add: ["lazy"] },
    { name: "+ hydration (enableHydration, Hydration, NoHydration, isHydrating, isHydratable, onHydrationEnd)", add: ["enableHydration", "Hydration", "NoHydration", "isHydrating", "isHydratable", "onHydrationEnd"] },
  ]);
  const webSteps = cumEntries("@solidjs/web", [
    { name: "{render, template, insert}", add: ["render", "template", "insert"] },
    { name: "+ delegateEvents, addEvent", add: ["delegateEvents", "addEvent"] },
    { name: "+ spread", add: ["spread"] },
    { name: "+ Portal", add: ["Portal"] },
    { name: "+ hydrate", add: ["hydrate"] },
    { name: "+ Dynamic", add: ["Dynamic"] },
  ]);
  return {
    signals: run(sigSteps, "signals"),
    solid: run(solidSteps, "solid"),
    web: run(webSteps, "web"),
  };
}

function topFns(m: Measure): { name: string; kind: string; bytes: number }[] {
  log("top-level names " + m.id);
  const { buildSync } = createRequire(`${FEAT}/ref/package.json`)("esbuild");
  const r1 = buildSync({
    entryPoints: [m.outDir + "entry.mjs"], bundle: true, write: false, format: "esm", platform: "browser",
    conditions: m.conditions, minify: false, treeShaking: true, tsconfigRaw: "{}", logLevel: "error", define: m.define,
  });
  writeFileSync(m.outDir + "unmin.js", r1.outputFiles[0].contents);
  const r2 = buildSync({
    entryPoints: [m.outDir + "unmin.js"], bundle: true, write: false, format: "esm", platform: "browser",
    minifyWhitespace: true, minifySyntax: true, minifyIdentifiers: false, treeShaking: true, logLevel: "error",
  });
  const code = r2.outputFiles[0].text as string;
  writeFileSync(m.outDir + "kept.js", code);
  const ts = createRequire(`${FEAT}/ref/package.json`)("typescript");
  const sf = ts.createSourceFile("kept.js", code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const rows: { name: string; kind: string; bytes: number }[] = [];
  const binding = (name: any): string => {
    if (!name) return "(anonymous)";
    if (ts.isIdentifier(name)) return name.text;
    if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) return "(pattern)";
    return "(binding)";
  };
  for (const stmt of sf.statements) {
    if (ts.isVariableStatement(stmt)) {
      for (const d of stmt.declarationList.declarations) {
        rows.push({ name: binding(d.name), kind: "const", bytes: d.end - d.getStart(sf) });
      }
    } else if (ts.isFunctionDeclaration(stmt)) {
      rows.push({ name: stmt.name?.text ?? "(anonymous fn)", kind: "function", bytes: stmt.end - stmt.getStart(sf) });
    } else if (ts.isClassDeclaration(stmt)) {
      rows.push({ name: stmt.name?.text ?? "(anonymous class)", kind: "class", bytes: stmt.end - stmt.getStart(sf) });
    } else {
      const bytes = stmt.end - stmt.getStart(sf);
      if (bytes >= 80) rows.push({ name: "(" + ts.SyntaxKind[stmt.kind] + ")", kind: "stmt", bytes });
    }
  }
  rows.sort((a, b) => b.bytes - a.bytes);
  return rows.slice(0, 40);
}

// ---------------------------------------------------------------- report

function pct(n: number, d: number): string { return d ? (100 * n / d).toFixed(1) : "0.0"; }
function n(x: number): string { return x.toLocaleString("en-US"); }

function groupMin(m: Measure, g: string): number { return m.groups.find(x => x.group === g)?.min ?? 0; }
function groupGz(m: Measure, g: string): number { return m.groups.find(x => x.group === g)?.gzipSrc ?? 0; }

function appTable(app: string, rows: Measure[]): string {
  const [base, sel, man] = rows;
  const present = GROUP_ORDER.filter(g => rows.some(m => groupMin(m, g) > 0));
  const head = "| group | base min | % | gz~ | select min | % | gz~ | manifest min | % | gz~ | sel−man |";
  const sep = "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|";
  const lines = [head, sep];
  for (const g of present) {
    const b = groupMin(base, g), s = groupMin(sel, g), mf = groupMin(man, g);
    lines.push(`| ${g} | ${n(b)} | ${pct(b, base.pass1)} | ${n(groupGz(base, g))} | ${n(s)} | ${pct(s, sel.pass1)} | ${n(groupGz(sel, g))} | ${n(mf)} | ${pct(mf, man.pass1)} | ${n(groupGz(man, g))} | ${n(s - mf)} |`);
  }
  const tot = (m: Measure) => `| **pass1 total** | **${n(m.pass1)}** | 100 | **${n(m.pass1Gzip)}** |`;
  lines.push(`| **pass1 total** | **${n(base.pass1)}** | 100 | **${n(base.pass1Gzip)}** | **${n(sel.pass1)}** | 100 | **${n(sel.pass1Gzip)}** | **${n(man.pass1)}** | 100 | **${n(man.pass1Gzip)}** | ${n(sel.pass1 - man.pass1)} |`);
  lines.push(`| pass2 shipped | ${n(base.pass2)} |  | ${n(base.pass2Gzip)} | ${n(sel.pass2)} |  | ${n(sel.pass2Gzip)} | ${n(man.pass2)} |  | ${n(man.pass2Gzip)} | ${n(sel.pass2 - man.pass2)} |`);
  lines.push(`| pass1−pass2 | ${n(base.pass1 - base.pass2)} |  |  | ${n(sel.pass1 - sel.pass2)} |  |  | ${n(man.pass1 - man.pass2)} |  |  |  |`);
  void tot;
  const why = man.features ? Object.entries(man.features.why).map(([k, v]) => `${k}: ${v}`).join("; ") : "(base compiler emits no manifest)";
  const kept = man.features ? ["stores", ...NAMES].filter(k => (man.features as any)[k]).join(", ") || "none" : "n/a";
  return `### ${app}\n\nmanifest kept: **${kept}**\n\n${why ? "why: " + why + "\n\n" : ""}${lines.join("\n")}\n\npass1 residual (output bytes not in any input's bytesInOutput): base ${base.residual}, select ${sel.residual}, manifest ${man.residual}.\n`;
}

function margTable(title: string, rows: MargRow[]): string {
  const lines = [
    `### ${title}`,
    "",
    "| entry | min | gzip | Δ min | Δ gzip | signals | solid | web | other |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|",
  ];
  for (const r of rows) {
    const p = r.byPkg;
    lines.push(`| ${r.name} | ${n(r.min)} | ${n(r.gzip)} | ${n(r.dMin)} | ${n(r.dGzip)} | ${n(p.signals ?? 0)} | ${n(p.solid ?? 0)} | ${n(p.web ?? 0)} | ${n(p.other ?? 0)} |`);
  }
  return lines.join("\n") + "\n";
}

function fileTable(files: FileRow[], byPath: Map<string, FileRow>): string {
  const lines = [
    "| # | bytes | group | file | pulled in by |",
    "|---:|---:|---|---|---|",
  ];
  files.slice(0, 40).forEach((f, i) => {
    const imps = f.importedBy.map(im => `${im.original ?? im.kind} (${shortPath(im.from)})`).join("; ") || "(entry)";
    lines.push(`| ${i + 1} | ${n(f.bytesInOutput)} | ${f.group} | ${f.short} | ${imps.replace(/\|/g, "\\|")} |`);
  });
  void byPath;
  return lines.join("\n") + "\n";
}

function fnTable(rows: { name: string; kind: string; bytes: number }[]): string {
  const lines = ["| # | bytes | kind | name |", "|---:|---:|---|---|"];
  rows.forEach((r, i) => lines.push(`| ${i + 1} | ${n(r.bytes)} | ${r.kind} | ${r.name.replace(/\|/g, "\\|")} |`));
  return lines.join("\n") + "\n";
}

function render(stamp: string, measures: Measure[], marg: { signals: MargRow[]; solid: MargRow[]; web: MargRow[] }, fns: { name: string; kind: string; bytes: number }[], counter: Measure): string {
  const cmds = [
    "```",
    "node --experimental-strip-types /home/lucifer/work/solidjs/store-proto-bench/rt/sizemap.ts report",
    "node --experimental-strip-types /home/lucifer/work/solidjs/store-proto-bench/rt/sizemap.ts <rx-worktree> <file.rx> <mode>",
    "```",
    "",
    "Per-variant commands the report ran:",
    "",
    "```",
  ];
  for (const app of APPS) {
    cmds.push(`node --experimental-strip-types rt/sizemap.ts ${BASE} ${BENCH}/${app} plain`);
    cmds.push(`node --experimental-strip-types rt/sizemap.ts ${FEAT} ${BENCH}/${app} select`);
    cmds.push(`node --experimental-strip-types rt/sizemap.ts ${FEAT} ${BENCH}/${app} manifest`);
  }
  cmds.push("```");

  const mapLines = ["| group | files | why |", "|---|---|---|"];
  for (const row of MAPPING) mapLines.push(`| ${row.group} | ${row.files} | ${row.note} |`);

  const byApp = new Map<string, Measure[]>();
  for (const m of measures) {
    const list = byApp.get(m.file) ?? [];
    list.push(m);
    byApp.set(m.file, list);
  }
  const appSections = APPS.map(app => appTable(app, byApp.get(app)!));

  const surpBlocks = measures.filter(m => m.mode === "manifest").map(m => {
    const surp = surprises(m);
    const body = surp.length
      ? surp.map(s => `- **${s.file}** ${n(s.bytes)} B (${s.group}) — ${s.reason}\n  - chain: ${s.chain}\n  - imports: ${s.direct}`).join("\n")
      : "- none under the automatic rules";
    return `### ${m.file}\n\n${body}`;
  }).join("\n\n");

  const rxFiles = counter.files.filter(f => f.group === "RX runtime");
  const rxLines = rxFiles.map(f => `- ${f.short}: ${n(f.bytesInOutput)} B`).join("\n") || "- none";

  return `# RX production bundle byte map

Generated ${stamp}. Attribution is the **first** esbuild pass (\`metafile: true\`, minify on), same compile, defines, and conditions as \`rx-bundle.ts\`. Group min bytes are \`metafile.outputs[*].inputs[file].bytesInOutput\`, summed. % is of that pass1 output.

A second esbuild pass (what \`rx-bundle.ts\` prints) drops what folded arms left unused. That pass has one input, so it cannot be attributed. **pass2 shipped** is that number. pass1 group bytes are an upper bound on the shipped bundle by \`pass1−pass2\`.

\`gz~\` is gzip level 9 of the **concatenated input source** of the files in the group that contributed any output bytes (full files, not the tree-shaken slice). It is not a partition of the bundle. **These do not sum**, and they do not sum to the true bundle gzip. The true gzip of the pass1 minified bundle is the \`gz~\` cell of the pass1 total row. pass2's gzip is the shipped gzip.

base is \`rx-store-proto-base\`, mode plain, Solid prod (\`store-proto-base\`). select and manifest are \`rx-store-proto-features\`, Solid \`store-select\` (\`store-proto-features\`). select defines the RX switches on and leaves \`__SOLID_STORE_*__\` undefined (the select build treats that as on). manifest defines each switch from the compiler manifest. base and features are different Solid checkouts, so base vs select is not a flag delta. sel−man is.

Compiled modules were written under \`rt/tmp/\`, not into the worktrees.

## Commands

${cmds.join("\n")}

## Mapping

${mapLines.join("\n")}

\`seat.js\` is not in \`dist/{prod,select}/core/\`. \`verdict.ts\` imports it, but only under \`__TEST__\`; the prod/select rollup drops the import. Noted so a 0 there is "not shipped", not "shaken".

## Apps

${appSections.join("\n")}

## Marginal sizes (single exports)

Packages resolved from \`${FEAT}/ref/node_modules\` (features Solid). esbuild \`conditions: ["browser"]\`, \`platform: "browser"\`, minify, tree shaking. signals has no \`browser\` condition, so this is \`dist/prod\`. solid-js resolves to \`dist/solid.js\`, web to \`dist/web.js\`.

Each row re-exports the cumulative set (entry exports are roots, so the bindings stay). Δ is against the row above. The package columns are that row's \`bytesInOutput\` split, not a delta. \`addEventListener\` is not an export; the non-delegated helper is \`addEvent\`, and \`delegateEvents\` is the delegated one. Both are imported on that row.

${margTable("@solidjs/signals", marg.signals)}
${margTable("solid-js", marg.solid)}
${margTable("@solidjs/web", marg.web)}

## counter.rx, features manifest

Smallest real bundle. Top 40 inputs by pass1 \`bytesInOutput\`.

${fileTable(counter.files, new Map(counter.files.map(f => [f.path, f])))}

RX runtime files in that bundle:

${rxLines}

### Top 40 top-level names

Unminified tree-shaken bundle with the same defines and conditions, then a second esbuild pass that tree-shakes again and minifies whitespace and syntax but **not identifiers**. Sizes are that identifier-kept text, split by top-level function / const / class. They are larger than the mangled production bytes and do not sum to the shipped bundle.

${fnTable(fns)}

## Surprises (automatic)

Rules: dev/observe/seroval/unmapped/edges/string-renderer with bytes; manifest flag false but the module that owns it still contributed; on counter manifest, feature groups the program cannot reach. The chain is the metafile import walk (\`inputs[x].imports\`), primary importer first, \`(+N)\` if there are more.

${surpBlocks}
`;
}

async function report() {
  mkdirSync(RESULTS, { recursive: true });
  mkdirSync(TMP, { recursive: true });
  const measures: Measure[] = [];
  for (const app of APPS) {
    for (const v of [
      { wt: BASE, mode: "plain" },
      { wt: FEAT, mode: "select" },
      { wt: FEAT, mode: "manifest" },
    ]) {
      measures.push(await measure(v.wt, `${BENCH}/${app}`, v.mode));
    }
  }
  const marg = marginal(FEAT);
  const counter = measures.find(m => m.file === "counter.rx" && m.mode === "manifest")!;
  const fns = topFns(counter);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const md = render(stamp, measures, marg, fns, counter);
  const mdPath = `${RESULTS}/sizemap-${stamp}.md`;
  const jsonPath = `${RESULTS}/sizemap-${stamp}.json`;
  writeFileSync(mdPath, md);
  const json = {
    stamp,
    mapping: MAPPING,
    measures: measures.map(m => ({ ...m, define: m.define })),
    marginal: marg,
    counterManifestTopFns: fns,
    counterManifestSurprises: surprises(counter),
  };
  writeFileSync(jsonPath, JSON.stringify(json, null, 2));
  log("wrote " + mdPath);
  log("wrote " + jsonPath);
  console.log(JSON.stringify({ md: mdPath, json: jsonPath }));
}

const args = process.argv.slice(2);
if (args[0] === "report") {
  await report();
} else {
  const [wt, file, mode] = args;
  if (!wt || !file || !mode) {
    console.error("usage: node --experimental-strip-types rt/sizemap.ts <rx-worktree> <file.rx> <mode>");
    console.error("       node --experimental-strip-types rt/sizemap.ts report");
    process.exit(1);
  }
  const m = await measure(wt, file, mode);
  console.log(JSON.stringify({
    id: m.id, pass1: m.pass1, pass1Gzip: m.pass1Gzip, pass2: m.pass2, pass2Gzip: m.pass2Gzip,
    residual: m.residual, features: m.features,
    groups: m.groups, top: m.files.slice(0, 15).map(f => ({ file: f.short, bytes: f.bytesInOutput, group: f.group, by: f.importedBy.map(i => i.original + " " + shortPath(i.from)) })),
    surprises: surprises(m),
  }, null, 2));
}

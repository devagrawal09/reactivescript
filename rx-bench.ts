// Per-process RX bench. One variant, its own Solid build (via the RX worktree).
// node --experimental-strip-types --conditions=browser rx-bench.ts --variant base --wt <rx-worktree> [--mem|--alloc]
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import v8 from "node:v8";
import { emit, measure, onlySet, parseArgs } from "./sample.mjs";

const require = createRequire(fileURLToPath(import.meta.url));
const args = parseArgs(process.argv);
const variant = String(args.variant || "");
const wt = String(args.wt || "");
const mem = args.mem === true;
const alloc = args.alloc === true;
const select = args.select === true;
const only = onlySet(args.only || process.env.BENCH_ONLY);
const minSamples = Number(process.env.BENCH_SAMPLES || 15);
const warmupOps = Number(process.env.BENCH_WARMUP_OPS || 30);
const warmupMs = Number(process.env.BENCH_WARMUP_MS || 300);
if (!variant || !wt) {
  console.error("need --variant and --wt");
  process.exit(2);
}

const heapStats = v8.getHeapStatistics() as { total_allocated_bytes?: number };
const hasAllocCounter = typeof heapStats.total_allocated_bytes === "number";

process.on("unhandledRejection", (e) => {
  console.error("unhandledRejection", e);
});

const here = dirname(fileURLToPath(import.meta.url));
const ref = (p: string) => import(pathToFileURL(`${wt}/ref/${p}`).href);

const { loadModules } = await ref("src/modules.ts");
const { checkModules } = await ref("src/check.ts");
const { compileModules } = await ref("compile/emit.ts");
const { lowerViews } = await ref("compile/jsx.ts");

const outDir = `${wt}/ref/compile/.out/bench-${process.pid}/`;
mkdirSync(outDir, { recursive: true });

function compile(name: string) {
  const file = resolve(here, name);
  const set = loadModules(file, (p: string) => {
    try { return readFileSync(p, "utf8"); } catch { return undefined; }
  });
  const { diags } = checkModules(set);
  if (diags.length) throw new Error(name + " checker: " + JSON.stringify(diags));
  const compiled = compileModules(set);
  let entry = "";
  for (const [n, code] of lowerViews(compiled.files, "universal")) {
    const wrapped = wrapCreateElement(code, n);
    const dest = outDir + name.replace(/\.rx$/, "") + "-" + n;
    writeFileSync(dest, wrapped);
    if (n === compiled.entry) entry = dest;
  }
  if (!entry) throw new Error("no entry for " + name);
  return { entry, features: compiled.features };
}

// string-renderer createElement ignores static props, so onClick never lands.
// Wrap it at the compiled call site. Mount-only; not inside the timed op.
function wrapCreateElement(code: string, name: string) {
  const re = /import \{ createElement as _\$createElement \} from ("[^"]+");/;
  if (!re.test(code)) throw new Error(name + ": no createElement import to wrap");
  return code.replace(
    re,
    `import { createElement as _$createElement0, setProp as _$setPropStatic } from $1;\nfunction _$createElement(tag, props) { const el = _$createElement0(tag); if (props) for (const k of Object.keys(props)) _$setPropStatic(el, k, props[k]); return el; }`
  );
}

const FEAT_NAMES = ["stores", "accessors", "guards", "shallow", "families", "optimistic", "delete"];
function keptOf(f: { [k: string]: unknown } | undefined) {
  if (!f) return "";
  return FEAT_NAMES.filter((n) => f[n]).join(",") || "none";
}
const compiled: Record<string, { entry: string; features?: { [k: string]: unknown } }> = {
  "rows.rx": compile("rows.rx"),
  "deep.rx": compile("deep.rx"),
  "optimistic.rx": compile("optimistic.rx")
};
for (const [program, c] of Object.entries(compiled)) {
  if (c.features) emit({ kind: "features", variant, program, kept: keptOf(c.features) });
}
let setGlobals: ((f: unknown) => void) | null = null;
if (select) {
  const feat = await ref("compile/features.ts");
  setGlobals = feat.setGlobals;
  const first = Object.values(compiled).find((c) => c.features);
  if (!first?.features) throw new Error("select mode but the compiler returned no feature manifest");
  setGlobals(first.features);
}
const { createApp, flush } = await ref("compile/rt.ts");
const rowsMain = (await import(pathToFileURL(compiled["rows.rx"].entry).href)).default;
const deepMain = (await import(pathToFileURL(compiled["deep.rx"].entry).href)).default;
const optMain = (await import(pathToFileURL(compiled["optimistic.rx"].entry).href)).default;

let nextId = 1;
const pending: { resolve: (v: unknown) => void; t: unknown }[] = [];

function buildRows(n: number) {
  const a = new Array(n);
  for (let i = 0; i < n; i++) {
    const id = nextId++;
    a[i] = { id, label: "r" + id, n: id };
  }
  return a;
}
function swapRows(rs: ArrayLike<unknown>) {
  const a = Array.from(rs).slice();
  if (a.length > 3) {
    const j = a.length - 2;
    const t = a[1];
    a[1] = a[j];
    a[j] = t;
  }
  return a;
}
function buildDeep(n: number) {
  const a = new Array(n);
  for (let i = 0; i < n; i++) {
    const id = nextId++;
    a[i] = { id, a: { b: { c: "c" + id } } };
  }
  return a;
}
function save(t: unknown) {
  return new Promise((resolve) => pending.push({ resolve, t }));
}
function resolveOldest() {
  const p = pending.shift();
  if (!p) throw new Error("no pending save");
  p.resolve(p.t);
}
function resetIds() {
  nextId = 1;
  pending.length = 0;
}

const api = { buildRows, swapRows, buildDeep, save };

type Node = { kind: string; tag?: string; text?: string; children?: Node[]; props?: Record<string, unknown> };

function buttons(root: Node) {
  const out: Node[] = [];
  const walk = (n: Node) => {
    if (!n || n.kind !== "el") return;
    if (n.tag === "button") out.push(n);
    for (const c of n.children || []) walk(c);
  };
  walk(root);
  return out;
}

function pageSig(app: { frame: () => string; root: Node }) {
  let cls = "";
  let classCount = 0;
  const walk = (n: Node) => {
    if (!n || n.kind !== "el") return;
    const c = n.props && n.props.class;
    if (c) { cls += n.tag + "=" + c + "\n"; classCount++; }
    for (const ch of n.children || []) walk(ch);
  };
  walk(app.root);
  const frame = app.frame();
  const frameHash = createHash("sha1").update(frame + "\n--\n" + cls).digest("hex").slice(0, 16);
  return { frameHash, frameHead: frame.slice(0, 180), classCount };
}

type App = {
  root: Node;
  frame: () => string;
  mount: (v: unknown) => () => void;
  asyncError: unknown;
};

function mount(main: (app: App) => unknown, program = "rows.rx"): { app: App; dispose: () => void; click: (i: number) => void } {
  if (setGlobals && compiled[program]?.features) setGlobals(compiled[program].features);
  const app = createApp({ api }) as App;
  const dispose = app.mount(main(app));
  flush();
  const btns = buttons(app.root);
  const click = (i: number) => {
    const fn = btns[i]?.props?.onClick;
    if (typeof fn !== "function") throw new Error(`button ${i} has no onClick (found ${btns.length})`);
    (fn as () => void)();
    flush();
  };
  return { app, dispose, click };
}

async function settle() {
  await new Promise((r) => setTimeout(r, 0));
  flush();
  await new Promise((r) => setTimeout(r, 0));
  flush();
}

const mopts = { minSamples, warmupOps, warmupMs };

function want(name: string) {
  return !only || only.has(name);
}

function gc2() {
  const g = (globalThis as { gc?: () => void }).gc;
  if (typeof g !== "function") throw new Error("heap mode needs node --expose-gc");
  g();
  g();
}

async function timeWorkloads() {
  if (want("create1k")) await timeRows("create1k", async ({ click }) => {
    const samples = await measure(() => click(0), { ...mopts, after: () => click(5) });
    return samples;
  }, async ({ click, app }) => {
    click(0);
    return pageSig(app);
  });

  if (want("replace1k")) await timeRows("replace1k", async ({ click }) => {
    click(0);
    return measure(() => click(0), mopts);
  }, async ({ click, app }) => {
    click(0);
    click(0);
    return pageSig(app);
  });

  if (want("update")) await timeRows("update", async ({ click }) => {
    click(0);
    return measure(() => { for (let i = 0; i < 100; i++) click(2); }, { ...mopts, divisor: 100 });
  }, async ({ click, app }) => {
    click(0);
    click(2); click(2); click(2);
    return pageSig(app);
  });

  if (want("select1k")) await timeRows("select1k", async ({ click }) => {
    click(0);
    return measure(() => click(3), mopts);
  }, async ({ click, app }) => {
    click(0);
    click(3); click(3); click(3);
    return pageSig(app);
  });

  if (want("select10k")) await timeRows("select10k", async ({ click }) => {
    click(1);
    return measure(() => click(3), mopts);
  }, async ({ click, app }) => {
    click(1);
    click(3); click(3); click(3);
    return pageSig(app);
  });

  if (want("swap")) await timeRows("swap", async ({ click }) => {
    click(0);
    return measure(() => click(4), mopts);
  }, async ({ click, app }) => {
    click(0);
    click(4);
    return pageSig(app);
  });

  if (want("bump-sum")) await timeRows("bump-sum", async ({ click }) => {
    click(0);
    return measure(() => click(6), mopts);
  }, async ({ click, app }) => {
    click(0);
    click(6); click(6); click(6);
    return pageSig(app);
  });

  if (want("clear1k")) await timeRows("clear1k", async ({ click }) => {
    return measure(() => click(5), { ...mopts, before: () => click(0) });
  }, async ({ click, app }) => {
    click(0);
    click(5);
    return pageSig(app);
  });

  if (want("create10k")) await timeRows("create10k", async ({ click }) => {
    return measure(() => click(1), { ...mopts, after: () => click(5) });
  }, async ({ click, app }) => {
    click(1);
    return pageSig(app);
  });

  if (want("deep-write")) await timeOne("deep-write", deepMain, async ({ click }) => {
    return measure(() => click(0), mopts);
  }, async ({ click, app }) => {
    click(0);
    click(0);
    click(0);
    return pageSig(app);
  }, "deep.rx");

  if (want("optimistic")) await timeOne("optimistic", optMain, async ({ click, app }) => {
    return measure(async () => {
      click(0);
      resolveOldest();
      await settle();
      if (app.asyncError) {
        const e = app.asyncError;
        app.asyncError = null;
        throw e;
      }
    }, mopts);
  }, async ({ click, app }) => {
    click(0);
    resolveOldest();
    await settle();
    if (app.asyncError) throw app.asyncError;
    return pageSig(app);
  }, "optimistic.rx");
}

async function timeRows(
  name: string,
  run: (h: { click: (i: number) => void; app: App }) => Promise<number[]>,
  verify: (h: { click: (i: number) => void; app: App }) => Promise<{ frameHash: string; frameHead: string; classCount: number }>
) {
  return timeOne(name, rowsMain, run, verify, "rows.rx");
}

async function timeOne(
  name: string,
  main: (app: App) => unknown,
  run: (h: { click: (i: number) => void; app: App }) => Promise<number[]>,
  verify: (h: { click: (i: number) => void; app: App }) => Promise<{ frameHash: string; frameHead: string; classCount: number }>,
  program = "rows.rx"
) {
  let dispose: (() => void) | undefined;
  try {
    const h = mount(main, program);
    dispose = h.dispose;
    const samples = await run(h);
    dispose();
    dispose = undefined;
    resetIds();
    let sig = { frameHash: "", frameHead: "", classCount: 0 };
    try {
      const v = mount(main, program);
      dispose = v.dispose;
      sig = await verify(v);
    } catch (e) {
      const err = e as Error;
      emit({ kind: "time", variant, workload: name, samples, frameHash: "", frameHead: "", classCount: 0 });
      emit({ kind: "error", variant, workload: name + ":verify", error: String(err?.message || err), stack: err?.stack || "" });
      console.error(`${variant} ${name} VERIFY ERROR ${err?.message || err}`);
      return;
    }
    emit({ kind: "time", variant, workload: name, samples, ...sig });
    console.error(`${variant} ${name} n=${samples.length}`);
  } catch (e) {
    const err = e as Error;
    emit({ kind: "error", variant, workload: name, error: String(err?.message || err), stack: err?.stack || "" });
    console.error(`${variant} ${name} ERROR ${err?.message || err}`);
  } finally {
    try { dispose?.(); } catch { /* already torn down */ }
    resetIds();
  }
}

function heapDelta(setup: () => { hold: unknown; dispose: () => void }) {
  gc2();
  const before = process.memoryUsage().heapUsed;
  const { hold, dispose } = setup();
  gc2();
  const after = process.memoryUsage().heapUsed;
  const value = after - before;
  dispose();
  return { value, hold };
}

function memWorkloads() {
  const keep: unknown[] = [];
  try {
    const h10 = heapDelta(() => {
      const h = mount(rowsMain, "rows.rx");
      h.click(1);
      return { hold: h.app, dispose: h.dispose };
    });
    keep.push(h10.hold);
    emit({ kind: "mem", variant, metric: "heap10k", value: h10.value });

    const h1 = heapDelta(() => {
      const h = mount(rowsMain, "rows.rx");
      h.click(0);
      return { hold: h.app, dispose: h.dispose };
    });
    keep.push(h1.hold);
    emit({ kind: "mem", variant, metric: "heap1k", value: h1.value });

    const hd = heapDelta(() => {
      const h = mount(deepMain, "deep.rx");
      return { hold: h.app, dispose: h.dispose };
    });
    keep.push(hd.hold);
    emit({ kind: "mem", variant, metric: "heapDeep1k", value: hd.value });
  } catch (e) {
    const err = e as Error;
    emit({ kind: "error", variant, workload: "mem", error: String(err?.message || err), stack: err?.stack || "" });
  }
  keep.length = 0;
}

async function allocOf(name: string, main: (app: App) => unknown, op: (h: ReturnType<typeof mount>) => void | Promise<void>, prep?: (h: ReturnType<typeof mount>) => void, program = "rows.rx") {
  const h = mount(main, program);
  try {
    if (prep) prep(h);
    let wops = 0;
    const w0 = process.hrtime.bigint();
    while (wops < 30 && Number(process.hrtime.bigint() - w0) / 1e6 < 300) {
      await op(h);
      wops++;
    }
    const N = 200;
    let bytes: number;
    let method: string;
    if (hasAllocCounter) {
      const v8req = require("node:v8") as { getHeapStatistics: () => { total_allocated_bytes: number } };
      const a0 = v8req.getHeapStatistics().total_allocated_bytes;
      for (let i = 0; i < N; i++) await op(h);
      const a1 = v8req.getHeapStatistics().total_allocated_bytes;
      bytes = (a1 - a0) / N;
      method = "total_allocated_bytes";
    } else {
      const a0 = process.memoryUsage().heapUsed;
      for (let i = 0; i < N; i++) await op(h);
      const a1 = process.memoryUsage().heapUsed;
      bytes = (a1 - a0) / N;
      method = "heapUsed-approx";
    }
    emit({
      kind: "alloc",
      variant,
      workload: name,
      bytesPerOp: bytes,
      method,
      note: method === "heapUsed-approx"
        ? "this Node has no v8.getHeapStatistics().total_allocated_bytes; heapUsed growth / 200 with no gc, --max-semi-space-size=256. Approximation, not allocated bytes."
        : ""
    });
  } catch (e) {
    const err = e as Error;
    emit({ kind: "error", variant, workload: "alloc:" + name, error: String(err?.message || err), stack: err?.stack || "" });
  } finally {
    try { h.dispose(); } catch { /* ignore */ }
  }
}

async function allocWorkloads() {
  if (!hasAllocCounter) {
    emit({
      kind: "note",
      variant,
      note: "v8.getHeapStatistics().total_allocated_bytes is missing in this Node. Alloc figures are heapUsed growth per op (approximation), measured with --max-semi-space-size=256 and no gc."
    });
  }
  if (want("update")) await allocOf("update", rowsMain, (h) => h.click(2), (h) => h.click(0));
  if (want("select1k")) await allocOf("select1k", rowsMain, (h) => h.click(3), (h) => h.click(0));
  if (want("bump-sum")) await allocOf("bump-sum", rowsMain, (h) => h.click(6), (h) => h.click(0));
  if (want("deep-write")) await allocOf("deep-write", deepMain, (h) => h.click(0), undefined, "deep.rx");
  // clear is inside the window so each op is a create on an empty list. heapUsed cannot split clear from create.
  if (want("create1k")) await allocOf("create1k", rowsMain, (h) => { h.click(0); h.click(5); });
}

emit({
  kind: "meta",
  variant,
  node: process.version,
  pid: process.pid,
  hasAllocCounter,
  select,
  mode: mem ? "mem" : alloc ? "alloc" : "time"
});

if (mem) memWorkloads();
else if (alloc) await allocWorkloads();
else await timeWorkloads();

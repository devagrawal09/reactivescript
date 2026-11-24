// Per-process Solid store microbench. One production signals bundle, absolute path.
// node solid-bench.mjs --variant <name> --signals <dist/prod/index.js> --mode proxy|target|plainData|targetPlain|targetWrite|targetSite|targetShape|targetAll|targetPruned [--mem]
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import v8 from "node:v8";
import { emit, measure, onlySet, parseArgs } from "./sample.mjs";

const args = parseArgs(process.argv);
const variant = String(args.variant || "");
const signals = String(args.signals || "");
const mode = String(args.mode || "proxy");
const mem = args.mem === true;
const only = onlySet(args.only || process.env.BENCH_ONLY);
const minSamples = Number(process.env.BENCH_SAMPLES || 15);
const warmupOps = Number(process.env.BENCH_WARMUP_OPS || 30);
const warmupMs = Number(process.env.BENCH_WARMUP_MS || 300);
if (!variant || !signals) {
  console.error("need --variant and --signals");
  process.exit(2);
}
const MODES = ["proxy", "target", "plainData", "targetPlain", "targetWrite", "targetSite", "targetShape", "targetAll", "targetPruned"];
if (!MODES.includes(mode)) {
  console.error("bad --mode " + mode);
  process.exit(2);
}
const useTarget = mode !== "proxy" && mode !== "plainData";
const useSite = mode === "targetSite" || mode === "targetAll";
const useShape = mode === "targetShape";
const useWrite = mode === "targetWrite" || mode === "targetAll";

const S = await import(pathToFileURL(signals).href);
const {
  createStore, createMemo, createRenderEffect, createRoot, createSignal, flush, mapArray, untrack, $TARGET
} = S;
const storeGet = S.storeGet;
const storeSet = S.storeSet;
if (useWrite && typeof S.storeWrite !== "function") throw new Error(mode + " needs storeWrite");
if (useSite && (typeof S.storeSite !== "function" || typeof S.storeGetAt !== "function")) throw new Error(mode + " needs storeSite/storeGetAt");
if (useShape && (typeof S.storeShape !== "function" || typeof S.storeGetShaped !== "function")) throw new Error(mode + " needs storeShape/storeGetShaped");
const rowShape = useShape ? S.storeShape(["id", "label", "n"]) : null;
const deepShape = useShape ? { root: S.storeShape(["a"]), a: S.storeShape(["b"]), b: S.storeShape(["c"]), c: S.storeShape(["d"]) } : null;
const hasAllocCounter = typeof v8.getHeapStatistics().total_allocated_bytes === "number";
const mopts = { minSamples, warmupOps, warmupMs };

function fieldGet(obj, key, site, shape) {
  if (!useTarget) return obj[key];
  if (useSite) return S.storeGetAt(site, obj, key);
  if (useShape) return S.storeGetShaped(obj, shape, key);
  return storeGet(obj, key);
}

function makeStore(init) {
  return mode === "plainData" || mode === "targetPlain" ? createStore(init, { plainData: true }) : createStore(init);
}

// Proxy ops read/write the object they are given (the store, or the setter draft).
// Target ops close over the store's target and never touch a proxy after that.
function opsFor(store) {
  if (!useTarget) {
    return {
      root: (s) => s,
      get: (o, k) => o[k],
      set: (o, k, v) => { o[k] = v; },
      list: (o, k) => o[k]
    };
  }
  const T = store[$TARGET];
  if (T == null) throw new Error("store has no $TARGET");
  return {
    root: () => T,
    get: (o, k) => storeGet(o, k),
    set: (o, k, v) => storeSet(o, k, v),
    list: (o, k) => storeGet(o, k)
  };
}

function buildRows(n) {
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    const id = i + 1;
    out[i] = { id, label: "r" + id, n: id };
  }
  return out;
}

function hash(s) {
  return createHash("sha1").update(String(s)).digest("hex").slice(0, 16);
}

function labelAt(ops, store, i) {
  const rows = ops.list(ops.root(store), "rows");
  const row = ops.get(rows, i);
  if (row == null) return "missing";
  const label = fieldGet(row, "label", useSite ? S.storeSite() : null, rowShape);
  return label == null ? "undef" : String(label);
}

function lenOf(ops, store) {
  return ops.get(ops.list(ops.root(store), "rows"), "length");
}

function want(name) {
  return !only || only.has(name);
}

function report(workload, samples, checksumRaw) {
  emit({ kind: "time", variant, workload, samples, checksum: hash(checksumRaw), checksumRaw: String(checksumRaw) });
  console.error(`${variant} ${workload} n=${samples.length}`);
}

function fail(workload, e) {
  emit({ kind: "error", variant, workload, error: String(e?.message || e), stack: e?.stack || "" });
  console.error(`${variant} ${workload} ERROR ${e?.message || e}`);
}

// Create the list graph. dispose is the caller's job so timing can leave it out.
function openRows(n) {
  let dispose = () => {};
  let store;
  let setStore;
  let ops;
  let runs = 0;
  createRoot((d) => {
    dispose = d;
    [store, setStore] = makeStore({ rows: buildRows(n) });
    ops = opsFor(store);
    const mapped = mapArray(() => ops.list(ops.root(store), "rows"), (row) => {
      const idSite = useSite ? S.storeSite() : null;
      const labelSite = useSite ? S.storeSite() : null;
      createRenderEffect(() => [
        fieldGet(row, "id", idSite, rowShape),
        fieldGet(row, "label", labelSite, rowShape)
      ], () => { runs++; });
      return 1;
    });
    createRenderEffect(() => mapped(), () => {});
    flush();
  });
  return { dispose, store, setStore, ops, runs: () => runs };
}

function rowChecksum(live, extra = "") {
  return [
    "runs=" + live.runs(),
    "len=" + lenOf(live.ops, live.store),
    "l0=" + labelAt(live.ops, live.store, 0),
    "l1=" + labelAt(live.ops, live.store, 1),
    "l10=" + labelAt(live.ops, live.store, 10),
    "l998=" + labelAt(live.ops, live.store, Math.min(998, lenOf(live.ops, live.store) - 1)),
    extra
  ].filter(Boolean).join(" ");
}

function writeLeaf(live, i, v) {
  if (useWrite) S.storeWrite(live.ops.root(live.store), ["rows", i, "label"], v);
  else {
    live.setStore((draft) => {
      const rows = live.ops.list(live.ops.root(draft), "rows");
      live.ops.set(live.ops.get(rows, i), "label", v);
    });
  }
  flush();
}

function writeLeafX100(live, tag) {
  if (useWrite) {
    const T = live.ops.root(live.store);
    for (let i = 0; i < 100; i++) S.storeWrite(T, ["rows", i, "label"], tag + i);
  } else if (useTarget) {
    for (let i = 0; i < 100; i++) {
      live.setStore(() => {
        const rows = live.ops.list(live.ops.root(live.store), "rows");
        live.ops.set(live.ops.get(rows, i), "label", tag + i);
      });
    }
  } else {
    for (let i = 0; i < 100; i++) {
      live.setStore((draft) => {
        const rows = live.ops.list(live.ops.root(draft), "rows");
        live.ops.set(live.ops.get(rows, i), "label", tag + i);
      });
    }
  }
  flush();
}

function write10(setStore, ops, v) {
  setStore((draft) => {
    const rows = ops.list(ops.root(draft), "rows");
    const len = ops.get(rows, "length");
    for (let j = 0; j < len; j += 10) ops.set(ops.get(rows, j), "label", v + ":" + j);
  });
  flush();
}

function pushRow(setStore, ops, row) {
  setStore((draft) => {
    const rows = ops.list(ops.root(draft), "rows");
    const len = ops.get(rows, "length");
    ops.set(rows, len, row);
  });
  flush();
}

function swapRows(setStore, ops) {
  setStore((draft) => {
    const rows = ops.list(ops.root(draft), "rows");
    const a = ops.get(rows, 1);
    const b = ops.get(rows, 998);
    ops.set(rows, 1, b);
    ops.set(rows, 998, a);
  });
  flush();
}

async function timeWorkloads() {
  if (want("read-tracked")) {
    try {
      const [store] = makeStore({ rows: buildRows(1000) });
      const ops = opsFor(store);
      const [tick, setTick] = createSignal(0);
      const nSites = [];
      const memo = createMemo(() => {
        tick();
        const rows = ops.list(ops.root(store), "rows");
        const len = ops.get(rows, "length");
        let s = 0;
        for (let i = 0; i < len; i++) {
          if (useSite) nSites[i] ??= S.storeSite();
          s += fieldGet(ops.get(rows, i), "n", nSites[i], rowShape);
        }
        return s;
      });
      memo();
      const samples = await measure(() => { setTick((v) => v + 1); flush(); memo(); }, mopts);
      report("read-tracked", samples, "sum=" + memo());
    } catch (e) { fail("read-tracked", e); }
  }

  if (want("read-untracked")) {
    try {
      const [store] = makeStore({ rows: buildRows(1000) });
      const ops = opsFor(store);
      const nSites = [];
      const sum = () => {
        const rows = ops.list(ops.root(store), "rows");
        const len = ops.get(rows, "length");
        let s = 0;
        for (let i = 0; i < len; i++) {
          if (useSite) nSites[i] ??= S.storeSite();
          s += fieldGet(ops.get(rows, i), "n", nSites[i], rowShape);
        }
        return s;
      };
      let last = 0;
      const samples = await measure(() => { last = untrack(sum); }, mopts);
      report("read-untracked", samples, "sum=" + last);
    } catch (e) { fail("read-untracked", e); }
  }

  if (want("read-deep")) {
    try {
      const [store] = makeStore({ a: { b: { c: { d: 1 } } } });
      const ops = opsFor(store);
      const [tick, setTick] = createSignal(0);
      const siteA = useSite ? S.storeSite() : null;
      const siteB = useSite ? S.storeSite() : null;
      const siteC = useSite ? S.storeSite() : null;
      const siteD = useSite ? S.storeSite() : null;
      const memo = createMemo(() => {
        tick();
        let s = 0;
        const root = ops.root(store);
        for (let i = 0; i < 1000; i++) {
          const a = fieldGet(root, "a", siteA, deepShape?.root);
          const b = fieldGet(a, "b", siteB, deepShape?.a);
          const c = fieldGet(b, "c", siteC, deepShape?.b);
          s += fieldGet(c, "d", siteD, deepShape?.c);
        }
        return s;
      });
      memo();
      const samples = await measure(() => { setTick((v) => v + 1); flush(); memo(); }, mopts);
      report("read-deep", samples, "sum=" + memo());
    } catch (e) { fail("read-deep", e); }
  }

  if (want("create-rows")) {
    try {
      let pending = null;
      let raw = "";
      const samples = await measure(() => {
        const live = openRows(1000);
        pending = live.dispose;
        raw = rowChecksum(live);
      }, { ...mopts, after: () => { pending?.(); pending = null; } });
      report("create-rows", samples, raw + " dispose=untimed");
    } catch (e) { fail("create-rows", e); }
  }

  if (want("write-leaf")) {
    let live;
    try {
      live = openRows(1000);
      let i = 0;
      const samples = await measure(() => {
        writeLeaf(live, i % 1000, "u" + i);
        i++;
      }, mopts);
      live.dispose();
      live = openRows(1000);
      const before = live.runs();
      for (let k = 0; k < 5; k++) writeLeaf(live, k, "u" + k);
      const labels = [0, 1, 2, 3, 4].map((k) => labelAt(live.ops, live.store, k)).join(",");
      report("write-leaf", samples, "delta=" + (live.runs() - before) + " labels=" + labels);
    } catch (e) { fail("write-leaf", e); }
    finally { try { live?.dispose(); } catch { /* ignore */ } }
  }

  if (want("write-leaf-x100")) {
    let live;
    try {
      live = openRows(1000);
      let gen = 0;
      const samples = await measure(() => { writeLeafX100(live, "x" + gen++ + ":"); }, mopts);
      live.dispose();
      live = openRows(1000);
      const before = live.runs();
      writeLeafX100(live, "x");
      const labels = [0, 1, 50, 99].map((k) => labelAt(live.ops, live.store, k)).join(",");
      report("write-leaf-x100", samples, "delta=" + (live.runs() - before) + " labels=" + labels);
    } catch (e) { fail("write-leaf-x100", e); }
    finally { try { live?.dispose(); } catch { /* ignore */ } }
  }

  if (want("mount-rows-10k")) {
    try {
      let pending = null;
      let raw = "";
      const samples = await measure(() => {
        const live = openRows(10000);
        pending = live.dispose;
        raw = rowChecksum(live);
      }, { ...mopts, after: () => { pending?.(); pending = null; } });
      report("mount-rows-10k", samples, raw + " dispose=untimed");
    } catch (e) { fail("mount-rows-10k", e); }
  }

  if (want("write-10pct")) {
    let live;
    try {
      live = openRows(1000);
      let gen = 0;
      const samples = await measure(() => { write10(live.setStore, live.ops, "w" + gen++); }, mopts);
      live.dispose();
      live = openRows(1000);
      const before = live.runs();
      write10(live.setStore, live.ops, "w0");
      const labels = [];
      for (let j = 0; j < 1000; j += 10) labels.push(labelAt(live.ops, live.store, j));
      report("write-10pct", samples, "delta=" + (live.runs() - before) + " labels=" + labels.join(","));
    } catch (e) { fail("write-10pct", e); }
    finally { try { live?.dispose(); } catch { /* ignore */ } }
  }

  if (want("push-row")) {
    let live;
    try {
      live = openRows(1000);
      let seq = 0;
      let since = 0;
      const samples = await measure(() => {
        const id = 1000000 + seq++;
        pushRow(live.setStore, live.ops, { id, label: "p" + id, n: id });
      }, {
        ...mopts,
        after: () => {
          since++;
          if (since % 200 === 0) {
            live.dispose();
            seq = 0;
            live = openRows(1000);
          }
        }
      });
      live.dispose();
      live = openRows(1000);
      const before = live.runs();
      for (let k = 0; k < 3; k++) {
        const id = 1000000 + k;
        pushRow(live.setStore, live.ops, { id, label: "p" + id, n: id });
      }
      report("push-row", samples, "delta=" + (live.runs() - before) + " len=" + lenOf(live.ops, live.store) + " last=" + labelAt(live.ops, live.store, lenOf(live.ops, live.store) - 1));
    } catch (e) { fail("push-row", e); }
    finally { try { live?.dispose(); } catch { /* ignore */ } }
  }

  if (want("swap-rows")) {
    let live;
    try {
      live = openRows(1000);
      const samples = await measure(() => { swapRows(live.setStore, live.ops); }, mopts);
      live.dispose();
      live = openRows(1000);
      const before = live.runs();
      swapRows(live.setStore, live.ops);
      report("swap-rows", samples, "delta=" + (live.runs() - before) + " l1=" + labelAt(live.ops, live.store, 1) + " l998=" + labelAt(live.ops, live.store, 998) + " l0=" + labelAt(live.ops, live.store, 0));
    } catch (e) { fail("swap-rows", e); }
    finally { try { live?.dispose(); } catch { /* ignore */ } }
  }
}

function gc2() {
  if (typeof global.gc !== "function") throw new Error("heap mode needs node --expose-gc");
  global.gc();
  global.gc();
}

function memWorkloads() {
  for (const [metric, n] of [["heap10k", 10000], ["heap100k", 100000]]) {
    let live;
    try {
      gc2();
      const before = process.memoryUsage().heapUsed;
      live = openRows(n);
      gc2();
      const value = process.memoryUsage().heapUsed - before;
      emit({ kind: "mem", variant, metric, value, rows: n, bytesPerRow: value / n });
      console.error(`${variant} ${metric} ${value}`);
    } catch (e) {
      fail(metric, e);
    } finally {
      try { live?.dispose(); } catch { /* ignore */ }
      try { gc2(); } catch { /* ignore */ }
    }
  }
}

emit({
  kind: "meta",
  variant,
  mode: mem ? "mem" : "time",
  ops: mode,
  node: process.version,
  pid: process.pid,
  hasAllocCounter,
  signals
});

if (mem) memWorkloads();
else await timeWorkloads();

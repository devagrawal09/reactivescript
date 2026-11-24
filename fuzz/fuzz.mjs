// Differential fuzzer: baseline proxy store vs a prototype variant.
//
//   node fuzz.mjs --variant NAME SEED_START SEED_COUNT [--steps N] [--all] [--sabotage]
//   node fuzz.mjs --variant NAME --replay file.json [--sabotage]
//   node fuzz.mjs --variant NAME --shrink file.json
//
// NAME: core | writes | sitecache | slots | features:<set>
// sets: none-off plain rxmin nofam noopt nodelete-nofam
//
// Reference is always the baseline prod build, proxy mode.
// The program is generated once, then executed on each build. No Math.random or Date in a run.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import * as esbuild from "/home/lucifer/work/solidjs/rx-store-proto-base/ref/node_modules/esbuild/lib/main.js";

const ROOT = "/home/lucifer/work/solidjs/store-proto-bench/fuzz";
const FAIL_DIR = ROOT + "/failures";
const LOG_DIR = ROOT + "/logs";
const BUILD_DIR = ROOT + "/builds";
const SELECT = "/home/lucifer/work/solidjs/store-proto-features/packages/signals/dist/select/index.js";
const COMBINED_SELECT = "/home/lucifer/work/solidjs/store-proto-combined/packages/signals/dist/select/index.js";
const BASE = "/home/lucifer/work/solidjs/store-proto-base/packages/signals/dist/prod/index.js";
const BUILDS = {
  core: "/home/lucifer/work/solidjs/store-proto-core/packages/signals/dist/prod/index.js",
  writes: "/home/lucifer/work/solidjs/store-proto-writes/packages/signals/dist/prod/index.js",
  sitecache: "/home/lucifer/work/solidjs/store-proto-sitecache/packages/signals/dist/prod/index.js",
  slots: "/home/lucifer/work/solidjs/store-proto-slots/packages/signals/dist/prod/index.js",
  combined: "/home/lucifer/work/solidjs/store-proto-combined/packages/signals/dist/prod/index.js"
};
const FLAG_NAMES = ["ACCESSORS", "GUARDS", "SHALLOW", "FAMILIES", "OPTIMISTIC", "DELETE"];
const FEATURE_OFF = {
  "none-off": [],
  plain: ["ACCESSORS", "GUARDS", "SHALLOW"],
  rxmin: ["ACCESSORS", "GUARDS", "SHALLOW", "FAMILIES", "OPTIMISTIC", "DELETE"],
  nofam: ["FAMILIES", "OPTIMISTIC"],
  noopt: ["OPTIMISTIC"],
  "nodelete-nofam": ["DELETE", "FAMILIES", "OPTIMISTIC"]
};
const SHAPE_KEYS = {
  store: ["bag", "extra", "flag", "list", "meta", "title"],
  row: ["id", "k", "label", "meta", "n", "on", "tags"],
  meta: ["nest", "note", "score"],
  bag: ["a", "b"],
  nest: ["deep", "z"],
  deep: ["w"],
  rowMeta: ["k", "v"],
  proj: ["count", "head", "rows", "total"]
};
const WRITE_OPS = new Set(["setLeaf", "inc", "setSubtree", "addKey", "replaceRow", "push"]);
const SABOTAGE_KEY = "n";

const rejBuf = [];
function errClass(e) {
  if (e && typeof e.name === "string" && e.name) return e.name;
  if (e && e.constructor && e.constructor.name) return e.constructor.name;
  return "Error";
}
process.on("unhandledRejection", e => {
  rejBuf.push(`UNHANDLED ${errClass(e)}`);
});

function tick() {
  return new Promise(r => setTimeout(r, 0));
}
function isObj(v) {
  return v !== null && typeof v === "object";
}
function errVal(e) {
  let message = "";
  try {
    message = (e && e.message) || "";
  } catch {
    message = "";
  }
  return `ERR ${(e && e.name) || "Error"}: ${message}`;
}
function isNR(e, NR) {
  return (NR && e instanceof NR) || (e && e.name === "NotReadyError");
}
export function show(v) {
  if (v === undefined) return "undefined";
  if (v === null) return "null";
  if (typeof v === "string") return JSON.stringify(v);
  if (typeof v === "number") return Object.is(v, -0) ? "-0" : String(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  if (Array.isArray(v)) {
    let s = "[";
    for (let i = 0; i < v.length; i++) {
      if (i) s += ",";
      s += show(v[i]);
    }
    return s + "]";
  }
  if (typeof v === "object") {
    const ks = Object.keys(v);
    let s = "{";
    for (let i = 0; i < ks.length; i++) {
      if (i) s += ",";
      s += JSON.stringify(ks[i]) + ":" + show(v[ks[i]]);
    }
    return s + "}";
  }
  return JSON.stringify(String(v));
}
function fmt(v) {
  if (v === "not-ready") return "not-ready";
  return show(v);
}
function rngOf(seed) {
  let a = seed >>> 0;
  return {
    next() {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    int(n) {
      return Math.floor(this.next() * n);
    },
    pick(a) {
      return a[this.int(a.length)];
    },
    chance(p) {
      return this.next() < p;
    }
  };
}
function bump(o, k) {
  o[k] = (o[k] || 0) + 1;
}
function emptyStats() {
  return {
    stepKinds: {},
    mutOps: {},
    readerRan: {},
    notReadyLines: 0,
    pendingTrue: 0,
    throwLines: 0,
    unhandledLines: 0,
    mapArrayRowRuns: 0,
    actions: 0,
    resolves: 0,
    rejects: 0,
    storeWrite: 0,
    shapedReads: 0,
    siteReads: 0,
    draftTarget: 0,
    draftFallback: 0,
    remounts: 0,
    asyncResolves: 0,
    asyncRejects: 0
  };
}

const apiCache = new Map();
async function loadApi(url) {
  if (apiCache.has(url)) return apiCache.get(url);
  const m = await import(pathToFileURL(url).href);
  apiCache.set(url, m);
  return m;
}

export function capsOf(variant) {
  const caps = {
    families: true,
    optimistic: true,
    delete: true,
    guards: true,
    accessors: true,
    shallow: true
  };
  const colon = variant.indexOf(":");
  if (colon < 0) return caps;
  const off = FEATURE_OFF[variant.slice(colon + 1)];
  if (!off) throw new Error("unknown feature set " + variant);
  for (const name of off) caps[name.toLowerCase()] = false;
  if (!caps.families) caps.optimistic = false;
  return caps;
}

async function bundleSelect(entry, prefix) {
  for (const [set, off] of Object.entries(FEATURE_OFF)) {
    const outfile = `${BUILD_DIR}/${prefix}-${set}.js`;
    const define = {};
    for (const name of FLAG_NAMES) define[`__SOLID_STORE_${name}__`] = off.includes(name) ? "false" : "true";
    await esbuild.build({
      entryPoints: [entry],
      bundle: true,
      format: "esm",
      platform: "node",
      outfile,
      define,
      logLevel: "silent"
    });
  }
}
export async function ensureBuilds() {
  mkdirSync(BUILD_DIR, { recursive: true });
  await bundleSelect(SELECT, "features");
  await bundleSelect(COMBINED_SELECT, "combined");
}

export async function loadVariant(name) {
  const ref = await loadApi(BASE);
  let url = BUILDS[name];
  let kind = name;
  if (name.startsWith("features:") || name.startsWith("combined:")) {
    const set = name.slice(name.indexOf(":") + 1);
    if (!FEATURE_OFF[set]) throw new Error("unknown feature set " + set);
    const family = name.startsWith("combined:") ? "combined" : "features";
    url = `${BUILD_DIR}/${family}-${set}.js`;
    kind = family;
  } else if (!url) throw new Error("unknown variant " + name);
  const variant = await loadApi(url);
  return { ref, variant, kind, name, caps: capsOf(name) };
}

function makeOps(api, opts, stats) {
  const mode = opts.mode;
  const kind = opts.kind;
  const sabotage = !!opts.sabotage && mode === "target";
  let calls = 0;
  let arm = false;
  const sites = new Map();
  const shared = new Map();
  const shapes = new Map();
  const ops = { mode, api, stats };
  const need = (op, o) => {
    if (!isObj(o)) throw new TypeError(`${op} on ${o === null ? "null" : typeof o}`);
  };
  const shapeObj = name => {
    if (!name || !SHAPE_KEYS[name] || !api.storeShape) return null;
    let s = shapes.get(name);
    if (!s) {
      s = api.storeShape(SHAPE_KEYS[name]);
      shapes.set(name, s);
    }
    return s;
  };
  const siteFor = (key, siteId) => {
    if (!api.storeSite) return null;
    if (opts.hostile) {
      const k = String(key);
      let s = shared.get(k);
      if (!s) {
        s = api.storeSite();
        shared.set(k, s);
      }
      return s;
    }
    if (!siteId) return null;
    let s = sites.get(siteId);
    if (!s) {
      s = api.storeSite();
      sites.set(siteId, s);
    }
    return s;
  };
  ops.root = store => (mode === "proxy" ? store : store[api.$TARGET]);
  ops.get = (o, k, hint) => {
    need("get", o);
    calls++;
    if (calls % 50 === 0) arm = true;
    if (sabotage && arm && String(k) === SABOTAGE_KEY) {
      arm = false;
      return undefined;
    }
    if (mode === "proxy") return o[k];
    const shapeName = hint && hint.shape;
    const useShape =
      kind === "slots" &&
      shapeName &&
      SHAPE_KEYS[shapeName] &&
      !(api.isStoreTarget && api.isStoreTarget(o) && o.ar === true);
    if (useShape) {
      stats.shapedReads++;
      return api.storeGetShaped(o, shapeObj(shapeName), k);
    }
    const siteId = hint && hint.siteId;
    if ((kind === "sitecache" || kind === "combined") && hint && hint.fixed && (siteId || opts.hostile)) {
      stats.siteReads++;
      return api.storeGetAt(siteFor(k, siteId), o, k);
    }
    return api.storeGet(o, k);
  };
  ops.has = (o, k) => {
    need("has", o);
    return mode === "proxy" ? k in o : api.storeHas(o, k);
  };
  ops.keys = o => {
    need("keys", o);
    return mode === "proxy" ? Object.keys(o) : api.storeKeys(o);
  };
  ops.set = (o, k, v) => {
    need("set", o);
    if (mode === "proxy") o[k] = v;
    else api.storeSet(o, k, v);
  };
  ops.del = (o, k) => {
    need("del", o);
    if (mode === "proxy") delete o[k];
    else api.storeDelete(o, k);
  };
  ops.len = o => {
    need("len", o);
    return mode === "proxy" ? o.length : api.storeGet(o, "length");
  };
  ops.list = o => o;
  ops.isArr = o => {
    if (!isObj(o)) return false;
    if (mode === "proxy") return Array.isArray(o);
    return !!(api.isStoreTarget && api.isStoreTarget(o) && o.ar === true);
  };
  ops.writable = o => {
    if (mode === "target" && isObj(o) && api.isStoreTarget && api.isStoreTarget(o)) return api.storeProxy(o);
    return o;
  };
  ops.writeAt = (rec, path, value) => {
    if (mode === "target" && api.storeWrite) {
      api.storeWrite(rec.store[api.$TARGET], path, value);
      stats.storeWrite++;
      return;
    }
    // Same unguarded walk a setter body does. A missing step throws; do not skip.
    rec.set(d => {
      let o = d;
      for (let i = 0; i < path.length - 1; i++) o = o[path[i]];
      o[path[path.length - 1]] = value;
    });
  };
  ops.draftSet = (draft, key, value) => {
    if (mode === "target" && api.isStoreTarget && api.$TARGET) {
      const t = draft[api.$TARGET];
      if (api.isStoreTarget(t)) {
        api.storeSet(t, key, value);
        stats.draftTarget++;
        return;
      }
    }
    draft[key] = value;
    if (mode === "target") stats.draftFallback++;
  };
  ops.draftDel = (draft, key) => {
    if (mode === "target" && api.isStoreTarget && api.$TARGET) {
      const t = draft[api.$TARGET];
      if (api.isStoreTarget(t)) {
        api.storeDelete(t, key);
        stats.draftTarget++;
        return;
      }
    }
    delete draft[key];
    if (mode === "target") stats.draftFallback++;
  };
  ops.plain = function plain(o, shape, depth = 0) {
    if (!isObj(o)) return o;
    if (depth > 12) return "[depth]";
    if (ops.isArr(o)) {
      const n = ops.len(o);
      if (typeof n !== "number" || n < 0 || n > 200) return { __len: n };
      const arr = new Array(n);
      const child = shape === "list" || shape === "rows" ? "row" : shape === "tags" ? null : "row";
      for (let i = 0; i < n; i++) {
        const k = String(i);
        arr[i] = ops.has(o, k) ? plain(ops.get(o, k, { shape: null, fixed: false }), child, depth + 1) : undefined;
      }
      return arr;
    }
    const ks = ops.keys(o);
    const obj = {};
    const lim = ks.length > 200 ? 200 : ks.length;
    for (let i = 0; i < lim; i++) {
      const k = ks[i];
      const child = childShape(shape, k);
      const v = ops.get(o, k, { shape, fixed: false });
      obj[k] = isObj(v) ? plain(v, child, depth + 1) : v;
    }
    if (ks.length > 200) obj.__keys = ks.length;
    return obj;
  };
  return ops;
}

function childShape(parent, key) {
  if (parent === "store" && key === "meta") return "meta";
  if (parent === "store" && key === "bag") return "bag";
  if (parent === "store" && key === "list") return "list";
  if (parent === "meta" && key === "nest") return "nest";
  if (parent === "nest" && key === "deep") return "deep";
  if (parent === "row" && key === "meta") return "rowMeta";
  if (parent === "row" && key === "tags") return "tags";
  if (parent === "proj" && key === "rows") return "rows";
  if (parent === "list" || parent === "rows") return "row";
  return null;
}

function readPath(ops, root, path, shape, sitePrefix) {
  let o = root;
  let sh = shape || null;
  for (let i = 0; i < path.length; i++) {
    if (!isObj(o)) return undefined;
    const key = path[i];
    const parentShape = ops.isArr(o) ? null : sh;
    o = ops.get(o, key, {
      shape: parentShape,
      fixed: true,
      siteId: sitePrefix ? `${sitePrefix}:${i}:${key}` : null
    });
    sh = childShape(sh, key);
  }
  return o;
}
function reveal(ops, v, shape) {
  if (!isObj(v)) return v;
  return ops.plain(v, shape);
}
function listFrom(ops, root, path, shape) {
  const o = path && path.length ? readPath(ops, root, path, shape, null) : root;
  return ops.isArr(o) ? o : null;
}
function copyRow(ops, row, sitePrefix) {
  if (!isObj(row)) return null;
  const g = (k, i) => ops.get(row, k, { shape: "row", fixed: true, siteId: sitePrefix ? `${sitePrefix}:c${i}` : null });
  const out = { id: g("id", 0), k: g("k", 1), label: g("label", 2), n: g("n", 3), on: g("on", 4) };
  if (ops.has(row, "tags")) {
    const tags = ops.get(row, "tags", { shape: "row", fixed: true, siteId: sitePrefix ? `${sitePrefix}:tags` : null });
    if (ops.isArr(tags)) {
      const n = ops.len(tags);
      const t = new Array(typeof n === "number" && n >= 0 && n <= 32 ? n : 0);
      for (let i = 0; i < t.length; i++) t[i] = ops.get(tags, String(i), { fixed: false });
      out.tags = t;
    } else out.tags = null;
  }
  if (ops.has(row, "meta")) {
    const meta = ops.get(row, "meta", { shape: "row", fixed: true, siteId: sitePrefix ? `${sitePrefix}:meta` : null });
    if (isObj(meta) && !ops.isArr(meta))
      out.meta = {
        k: ops.get(meta, "k", { shape: "rowMeta", fixed: true, siteId: sitePrefix ? `${sitePrefix}:mk` : null }),
        v: ops.get(meta, "v", { shape: "rowMeta", fixed: true, siteId: sitePrefix ? `${sitePrefix}:mv` : null })
      };
    else out.meta = null;
  }
  return out;
}

function applyMut(ops, root, mut, shape) {
  const hint = { shape, fixed: true };
  switch (mut.op) {
    case "setLeaf": {
      if (mut.field !== undefined && mut.index !== undefined) {
        const list = listFrom(ops, root, mut.path, shape);
        if (!list) return false;
        const n = ops.len(list);
        if (!n) return false;
        const row = ops.get(list, String(mut.index % n), { fixed: false });
        if (!isObj(row)) return false;
        ops.set(row, mut.field, mut.value);
        return true;
      }
      const parentPath = mut.path.slice(0, -1);
      const key = mut.path[mut.path.length - 1];
      const parent = parentPath.length ? readPath(ops, root, parentPath, shape, null) : root;
      if (!isObj(parent)) return false;
      ops.set(parent, key, mut.value);
      return true;
    }
    case "setSubtree": {
      const parentPath = mut.path.slice(0, -1);
      const key = mut.path[mut.path.length - 1];
      const parent = parentPath.length ? readPath(ops, root, parentPath, shape, null) : root;
      if (!isObj(parent)) return false;
      ops.set(parent, key, structuredClone(mut.value));
      return true;
    }
    case "deleteKey": {
      if (!ops.api.storeDelete && ops.mode === "target") return false;
      const parent = mut.path.length ? readPath(ops, root, mut.path, shape, null) : root;
      if (!isObj(parent)) return false;
      ops.del(parent, mut.key);
      return true;
    }
    case "addKey": {
      const parent = mut.path.length ? readPath(ops, root, mut.path, shape, null) : root;
      if (!isObj(parent)) return false;
      ops.set(parent, mut.key, structuredClone(mut.value));
      return true;
    }
    case "push": {
      const list = listFrom(ops, root, mut.path, shape);
      if (!list) return false;
      ops.set(list, String(ops.len(list)), structuredClone(mut.row));
      return true;
    }
    case "pop":
    case "removeAt": {
      const list = listFrom(ops, root, mut.path, shape);
      if (!list) return false;
      const n = ops.len(list);
      if (!n) return false;
      const i = mut.op === "pop" ? n - 1 : mut.index % n;
      const tail = [];
      for (let j = i + 1; j < n; j++) tail.push(ops.writable(ops.get(list, String(j), { fixed: false })));
      for (let j = 0; j < tail.length; j++) ops.set(list, String(i + j), tail[j]);
      ops.set(list, "length", n - 1);
      return true;
    }
    case "unshift": {
      const list = listFrom(ops, root, mut.path, shape);
      if (!list) return false;
      const n = ops.len(list);
      const held = [];
      for (let i = 0; i < n; i++) held.push(ops.writable(ops.get(list, String(i), { fixed: false })));
      ops.set(list, "0", structuredClone(mut.row));
      for (let i = 0; i < n; i++) ops.set(list, String(i + 1), held[i]);
      return true;
    }
    case "swap": {
      const list = listFrom(ops, root, mut.path, shape);
      if (!list) return false;
      const n = ops.len(list);
      if (!n) return false;
      const i = mut.i % n;
      const j = mut.j % n;
      const a = ops.writable(ops.get(list, String(i), { fixed: false }));
      const b = ops.writable(ops.get(list, String(j), { fixed: false }));
      ops.set(list, String(i), b);
      ops.set(list, String(j), a);
      return true;
    }
    case "setLength": {
      const list = listFrom(ops, root, mut.path, shape);
      if (!list) return false;
      const n = ops.len(list);
      const target = mut.length;
      if (target < n) {
        const tail = [];
        for (let j = target; j < n; j++) tail.push(null);
        void tail;
        ops.set(list, "length", target);
      } else {
        const fills = mut.fills || [];
        const can = Math.min(target, n + fills.length);
        for (let i = n; i < can; i++) ops.set(list, String(i), structuredClone(fills[i - n]));
      }
      return true;
    }
    case "replaceList": {
      const list = listFrom(ops, root, mut.path, shape);
      if (!list) return false;
      const n = ops.len(list);
      const out = [];
      for (let i = 0; i < n; i++) {
        const row = ops.get(list, String(i), { fixed: false });
        if (!isObj(row)) continue;
        let keep = true;
        if (mut.mode === "mod") {
          const field = ops.get(row, mut.field, { shape: "row", fixed: true });
          keep = typeof field === "number" && mut.mod > 0 && field % mut.mod === mut.eq;
        } else if (mut.mode === "drop") keep = i !== mut.index % n;
        if (keep) out.push(ops.plain(row, "row"));
      }
      if (!mut.path.length) {
        for (let i = 0; i < out.length; i++) ops.set(list, String(i), out[i]);
        ops.set(list, "length", out.length);
        return true;
      }
      const parentPath = mut.path.slice(0, -1);
      const key = mut.path[mut.path.length - 1];
      const parent = parentPath.length ? readPath(ops, root, parentPath, shape, null) : root;
      if (!isObj(parent)) return false;
      ops.set(parent, key, out);
      return true;
    }
    case "replaceRow": {
      const list = listFrom(ops, root, mut.path, shape);
      if (!list) return false;
      const n = ops.len(list);
      if (!n) return false;
      const i = mut.index % n;
      const row = ops.get(list, String(i), { fixed: false });
      if (!isObj(row)) return false;
      const fresh = structuredClone(mut.row);
      fresh.id = ops.get(row, "id", { shape: "row", fixed: true });
      fresh.k = ops.get(row, "k", { shape: "row", fixed: true });
      ops.set(list, String(i), fresh);
      return true;
    }
    case "inc": {
      if (mut.index !== undefined) {
        const list = listFrom(ops, root, mut.path, shape);
        if (!list) return false;
        const n = ops.len(list);
        if (!n) return false;
        const row = ops.get(list, String(mut.index % n), { fixed: false });
        if (!isObj(row)) return false;
        const cur = ops.get(row, mut.field, { shape: "row", fixed: true });
        if (typeof cur !== "number") return false;
        ops.set(row, mut.field, cur + mut.delta);
        return true;
      }
      const parentPath = mut.path.slice(0, -1);
      const key = mut.path[mut.path.length - 1];
      const parent = parentPath.length ? readPath(ops, root, parentPath, shape, null) : root;
      if (!isObj(parent)) return false;
      const cur = ops.get(parent, key, hint);
      if (typeof cur !== "number") return false;
      ops.set(parent, key, cur + mut.delta);
      return true;
    }
    default:
      return false;
  }
}

function singleWrite(ops, rec, mut, shape) {
  const root = ops.root(rec.store);
  if (mut.op === "setLeaf" && mut.field !== undefined && mut.index !== undefined) {
    const list = listFrom(ops, root, mut.path, shape);
    if (!list) return false;
    const n = ops.len(list);
    if (!n) return false;
    const i = mut.index % n;
    const row = ops.get(list, String(i), { fixed: false });
    if (!isObj(row)) return false;
    void row;
    ops.writeAt(rec, mut.path.concat(String(i), mut.field), mut.value);
    return true;
  }
  if (mut.op === "setLeaf" || mut.op === "setSubtree" || mut.op === "addKey") {
    const path = mut.op === "addKey" ? mut.path.concat(mut.key) : mut.path;
    const parentPath = path.slice(0, -1);
    const parent = parentPath.length ? readPath(ops, root, parentPath, shape, null) : root;
    if (!isObj(parent)) return false;
    const value = mut.op === "setLeaf" ? mut.value : structuredClone(mut.op === "addKey" ? mut.value : mut.value);
    ops.writeAt(rec, path, value);
    return true;
  }
  if (mut.op === "inc") {
    let cur;
    let path;
    if (mut.index !== undefined) {
      const list = listFrom(ops, root, mut.path, shape);
      if (!list) return false;
      const n = ops.len(list);
      if (!n) return false;
      const i = mut.index % n;
      const row = ops.get(list, String(i), { fixed: false });
      if (!isObj(row)) return false;
      cur = ops.get(row, mut.field, { shape: "row", fixed: true });
      if (typeof cur !== "number") return false;
      path = mut.path.concat(String(i), mut.field);
    } else {
      const parentPath = mut.path.slice(0, -1);
      const parent = parentPath.length ? readPath(ops, root, parentPath, shape, null) : root;
      if (!isObj(parent)) return false;
      cur = ops.get(parent, mut.path[mut.path.length - 1], { shape, fixed: true });
      if (typeof cur !== "number") return false;
      path = mut.path;
    }
    ops.writeAt(rec, path, cur + mut.delta);
    return true;
  }
  if (mut.op === "push") {
    const list = listFrom(ops, root, mut.path, shape);
    if (!list) return false;
    ops.writeAt(rec, mut.path.concat(String(ops.len(list))), structuredClone(mut.row));
    return true;
  }
  if (mut.op === "replaceRow") {
    const list = listFrom(ops, root, mut.path, shape);
    if (!list) return false;
    const n = ops.len(list);
    if (!n) return false;
    const i = mut.index % n;
    const row = ops.get(list, String(i), { fixed: false });
    if (!isObj(row)) return false;
    const fresh = structuredClone(mut.row);
    fresh.id = ops.get(row, "id", { shape: "row", fixed: true });
    fresh.k = ops.get(row, "k", { shape: "row", fixed: true });
    ops.writeAt(rec, mut.path.concat(String(i)), fresh);
    return true;
  }
  return false;
}

function keyOpt(spec) {
  if (!spec) return { key: "id" };
  if (spec.keyMode === "field") return { key: "k" };
  if (spec.keyMode === "fn") return { key: row => (row == null ? undefined : row.k) };
  if (spec.keyMode === "null") return { key: null };
  return { key: "id" };
}

export async function execute(programIn, api, opts) {
  const program = JSON.parse(JSON.stringify(programIn));
  const stats = emptyStats();
  const ops = makeOps(api, opts, stats);
  const NR = api.NotReadyError;
  const lines = [];
  const stepOf = [];
  const effectBuf = [];
  const pending = [];
  const asyncGates = [];
  let stepIndex = -1;
  let halted = false;
  let haltStack = "";
  const emit = line => {
    lines.push(line);
    stepOf.push(stepIndex);
    if (typeof line === "string" && line.startsWith("THROW")) stats.throwLines++;
    if (typeof line === "string" && line.startsWith("UNHANDLED")) stats.unhandledLines++;
    if (typeof line === "string" && line.includes("not-ready")) stats.notReadyLines++;
  };
  const drainEffects = () => {
    while (effectBuf.length) emit(effectBuf.shift());
  };
  const drainRej = () => {
    while (rejBuf.length) emit(rejBuf.shift());
  };
  const safeFlush = () => {
    try {
      api.flush();
      return true;
    } catch (e) {
      emit(`THROW ${errClass(e)}`);
      haltStack = e.stack || "";
      halted = true;
      try {
        api.resetErrorHalt();
      } catch {
        /* prod may not export it on a thrown flush */
      }
      return false;
    }
  };
  const catchNR = fn => {
    try {
      return fn();
    } catch (e) {
      if (isNR(e, NR)) return "not-ready";
      return errVal(e);
    }
  };

  const stores = [];
  const projections = [];
  const optimistics = [];
  let gen = null;
  let setGen = null;
  let flag = null;
  let setFlag = null;
  let asyncMemo = null;
  let readerDispose = null;
  const innerDisposes = [];

  const resolveRef = ref => {
    if (!ref) return null;
    if (ref.t === "s") return stores[ref.i] ? { h: ops.root(stores[ref.i].store), shape: "store", rec: stores[ref.i] } : null;
    if (ref.t === "p")
      return projections[ref.i]
        ? {
            h: ops.root(projections[ref.i].store),
            shape: projections[ref.i].spec.kind === "mutate" ? "proj" : "list",
            rec: null
          }
        : null;
    if (ref.t === "o")
      return optimistics[ref.i] ? { h: ops.root(optimistics[ref.i].store), shape: "list", rec: optimistics[ref.i] } : null;
    if (ref.t === "m") return { h: null, shape: null, memo: true };
    return null;
  };

  const watch = (id, kind, compute) => {
    api.createEffect(
      () => catchNR(compute),
      v => {
        effectBuf.push(`E${id}: ${fmt(v)}`);
        bump(stats.readerRan, kind);
        if (kind === "pending" && v === true) stats.pendingTrue++;
      }
    );
  };

  let dispose = () => {};
  try {
    dispose = api.createRoot(d => {
      const sig = api.createSignal(0);
      gen = sig[0];
      setGen = sig[1];
      const fl = api.createSignal(!!program.flag0);
      flag = fl[0];
      setFlag = fl[1];
      asyncMemo = api.createMemo(() => {
        const g = gen();
        let resolve, reject;
        const promise = new Promise((res, rej) => {
          resolve = res;
          reject = rej;
        });
        asyncGates.push({ resolve, reject, value: g * 10 + 1, settled: false, kind: "memo" });
        return promise;
      });
      for (let i = 0; i < program.stores.length; i++) {
        const [store, set] = api.createStore(structuredClone(program.stores[i].init));
        stores.push({ store, set, i });
      }
      for (let i = 0; i < program.projections.length; i++) {
        const spec = program.projections[i];
        const ko = keyOpt(spec);
        let store;
        if (spec.kind === "async") {
          store = api.createProjection(() => {
            const g = gen();
            let resolve, reject;
            const promise = new Promise((res, rej) => {
              resolve = res;
              reject = rej;
            });
            const rows = [];
            const n = 1 + (g % 3);
            for (let r = 0; r < n; r++)
              rows.push({ id: r + 1, k: "k" + (r + 1), label: "A" + g, n: g + r, on: r % 2 === 0 });
            asyncGates.push({ resolve, reject, value: rows, settled: false, kind: "proj" });
            return promise;
          }, [], ko);
        } else if (spec.kind === "return") {
          store = api.createProjection(() => {
            if (spec.readAsync) asyncMemo();
            const src = ops.root(stores[spec.source].store);
            const list = listFrom(ops, src, spec.listPath, "store");
            const out = [];
            if (!list) return out;
            const n = ops.len(list);
            for (let r = 0; r < n; r++) {
              const copy = copyRow(ops, ops.get(list, String(r), { fixed: false }), null);
              if (!copy) continue;
              if (spec.filter) {
                const field = copy[spec.filter.field];
                if (!(typeof field === "number" && field % spec.filter.mod === spec.filter.eq)) continue;
              }
              copy.tag = spec.tag;
              out.push(copy);
            }
            return out;
          }, [], ko);
        } else {
          store = api.createProjection(draft => {
            if (spec.readAsync) asyncMemo();
            const src = ops.root(stores[spec.source].store);
            const list = listFrom(ops, src, spec.listPath, "store");
            let sum = 0;
            let count = 0;
            let head = null;
            const rows = [];
            if (list) {
              count = ops.len(list);
              for (let r = 0; r < count; r++) {
                const copy = copyRow(ops, ops.get(list, String(r), { fixed: false }), null);
                if (!copy) continue;
                if (typeof copy.n === "number") sum += copy.n;
                if (head === null && typeof copy.label === "string") head = copy.label;
                rows.push(copy);
              }
            }
            ops.draftSet(draft, "total", sum);
            ops.draftSet(draft, "count", count);
            ops.draftSet(draft, "head", head);
            ops.draftSet(draft, "rows", rows);
          }, structuredClone(spec.seed), ko);
        }
        projections.push({ store, spec, i });
      }
      for (let i = 0; i < program.optimistic.length; i++) {
        const spec = program.optimistic[i];
        const [store, set] = api.createOptimisticStore(
          () => {
            const src = ops.root(stores[spec.source].store);
            const list = listFrom(ops, src, spec.listPath, "store");
            const out = [];
            if (!list) return out;
            const n = ops.len(list);
            for (let r = 0; r < n; r++) {
              const copy = copyRow(ops, ops.get(list, String(r), { fixed: false }), null);
              if (copy) out.push(copy);
            }
            return out;
          },
          structuredClone(spec.seed),
          keyOpt(spec)
        );
        optimistics.push({ store, set, spec, i });
      }
      for (let i = 0; i < program.readers.length; i++) {
        const rd = program.readers[i];
        watch(rd.id, rd.kind, () => {
          if (rd.kind === "async") return asyncMemo();
          if (rd.kind === "pending") {
            const root = rd.ref && rd.ref.t === "m" ? null : resolveRef(rd.ref);
            return api.isPending(() => {
              if (rd.ref && rd.ref.t === "m") return asyncMemo();
              if (!root || !isObj(root.h)) return undefined;
              return readPath(ops, root.h, rd.path, root.shape, `p${rd.id}`);
            });
          }
          if (rd.kind === "latest") {
            const root = rd.ref && rd.ref.t === "m" ? null : resolveRef(rd.ref);
            return api.latest(() => {
              if (rd.ref && rd.ref.t === "m") return asyncMemo();
              if (!root || !isObj(root.h)) return undefined;
              return reveal(ops, readPath(ops, root.h, rd.path, root.shape, `l${rd.id}`), null);
            });
          }
          const root = resolveRef(rd.ref);
          if (!root || !isObj(root.h)) return undefined;
          const pre = `r${rd.id}`;
          if (rd.kind === "leaf") return reveal(ops, readPath(ops, root.h, rd.path, root.shape, pre), childShape(root.shape, rd.path[0]));
          if (rd.kind === "plain") {
            const o = rd.path.length ? readPath(ops, root.h, rd.path, root.shape, pre) : root.h;
            return reveal(ops, o, rd.path.length ? childShape(root.shape, rd.path[rd.path.length - 1]) : root.shape);
          }
          if (rd.kind === "has") {
            const parent = rd.path.length ? readPath(ops, root.h, rd.path, root.shape, pre) : root.h;
            if (!isObj(parent)) return false;
            return ops.has(parent, rd.key);
          }
          if (rd.kind === "keys") {
            const o = rd.path.length ? readPath(ops, root.h, rd.path, root.shape, pre) : root.h;
            if (!isObj(o)) return null;
            return ops.keys(o);
          }
          if (rd.kind === "len") {
            const o = rd.path.length ? readPath(ops, root.h, rd.path, root.shape, pre) : root.h;
            if (!ops.isArr(o)) return -1;
            return ops.len(o);
          }
          if (rd.kind === "sum") {
            const list = listFrom(ops, root.h, rd.path, root.shape);
            if (!list) return null;
            const n = ops.len(list);
            let s = 0;
            for (let r = 0; r < n; r++) {
              const row = ops.get(list, String(r), { fixed: false });
              if (!isObj(row)) continue;
              const v = ops.get(row, rd.field, { shape: "row", fixed: true, siteId: `sum${rd.id}:n` });
              if (typeof v === "number") s += v;
            }
            return s;
          }
          return undefined;
        });
      }
      if (program.cond) {
        const spec = program.cond;
        api.createEffect(
          () =>
            catchNR(() => {
              if (!flag()) return "off";
              const root = resolveRef(spec.ref);
              if (!root || !isObj(root.h)) return undefined;
              return reveal(ops, readPath(ops, root.h, spec.path, root.shape, "cond"), null);
            }),
          v => {
            effectBuf.push(`G: ${fmt(v)}`);
          }
        );
      }
      const mountDisposable = () => {
        const spec = program.disposable;
        if (!spec) return;
        readerDispose = api.createRoot(dd => {
          api.createEffect(
            () =>
              catchNR(() => {
                const root = resolveRef(spec.ref);
                if (!root || !isObj(root.h)) return undefined;
                return reveal(ops, readPath(ops, root.h, spec.path, root.shape, "disp"), null);
              }),
            v => {
              effectBuf.push(`D: ${fmt(v)}`);
            }
          );
          return dd;
        });
        innerDisposes.push(readerDispose);
      };
      mountDisposable();
      ops.mountDisposable = mountDisposable;
      if (program.mapArray) {
        const spec = program.mapArray;
        let rowRuns = 0;
        const mapped = api.mapArray(
          () => {
            const root = resolveRef(spec.ref);
            if (!root || !isObj(root.h)) return [];
            const list = listFrom(ops, root.h, spec.path, root.shape);
            if (!list) return [];
            return ops.list(list);
          },
          row => {
            const rid = rowRuns++;
            stats.mapArrayRowRuns++;
            return api.createMemo(() =>
              catchNR(() => {
                if (!isObj(row)) return null;
                const out = [];
                for (let f = 0; f < spec.fields.length; f++)
                  out.push(
                    reveal(
                      ops,
                      ops.get(row, spec.fields[f], {
                        shape: "row",
                        fixed: true,
                        siteId: `row${rid}:${spec.fields[f]}`
                      }),
                      null
                    )
                  );
                return out;
              })
            );
          }
        );
        api.createEffect(
          () =>
            catchNR(() => {
              const arr = mapped();
              const vals = [];
              if (arr) {
                for (let i = 0; i < arr.length; i++) vals.push(arr[i]());
              }
              return { vals, runs: rowRuns };
            }),
          v => {
            effectBuf.push(`M: ${fmt(v)}`);
          }
        );
      }
      if (program.memo) {
        const spec = program.memo;
        const m0 = api.createMemo(() =>
          catchNR(() => {
            const root = resolveRef(spec.ref);
            if (!root || !isObj(root.h)) return undefined;
            return reveal(ops, readPath(ops, root.h, spec.path, root.shape, "memo"), null);
          })
        );
        const m1 = api.createMemo(() => {
          const v = m0();
          return typeof v === "number" ? v + 1 : v;
        });
        api.createEffect(
          () => m1(),
          v => {
            effectBuf.push(`C0: ${fmt(v)}`);
          }
        );
      }
      return d;
    });
    stepIndex = -1;
    emit("INIT");
    if (safeFlush()) {
      drainEffects();
      emitRead();
    }
  } catch (e) {
    emit(`THROW ${errClass(e)}`);
    haltStack = e.stack || haltStack;
    halted = true;
  }

  function emitRead() {
    try {
      api.untrack(() => {
        const parts = [];
        for (let i = 0; i < stores.length; i++) parts.push(ops.plain(ops.root(stores[i].store), "store"));
        for (let i = 0; i < projections.length; i++)
          parts.push(
            ops.plain(
              ops.root(projections[i].store),
              projections[i].spec.kind === "mutate" ? "proj" : "list"
            )
          );
        for (let i = 0; i < optimistics.length; i++) parts.push(ops.plain(ops.root(optimistics[i].store), "list"));
        emit("R: " + show(parts));
      });
    } catch (e) {
      emit(isNR(e, NR) ? "R: not-ready" : `R: ERR ${e.name || "Error"}: ${e.message || ""}`);
    }
    try {
      if (stores[0]) emit("S: " + show(api.snapshot(stores[0].store)));
    } catch (e) {
      emit(`S: ERR ${e.name || "Error"}: ${e.message || ""}`);
    }
  }

  const runStep = async step => {
    if (step.kind === "mutate") {
      const rec = stores[step.store];
      if (!rec) return;
      const shape = "store";
      if (step.via === "write" && step.calls.length === 1 && step.calls[0].length === 1) {
        const m = step.calls[0][0];
        if (singleWrite(ops, rec, m, shape)) bump(stats.mutOps, m.op);
        bump(stats.stepKinds, step.flush === false ? "write-noflush" : "write");
        return;
      }
      for (let c = 0; c < step.calls.length; c++) {
        const call = step.calls[c];
        rec.set(() => {
          const root = ops.root(rec.store);
          for (let i = 0; i < call.length; i++) {
            const m = call[i];
            if (m.op === "replaceRoot") return structuredClone(m.tree);
            if (applyMut(ops, root, m, shape)) bump(stats.mutOps, m.op);
          }
        });
      }
      bump(stats.stepKinds, step.flush === false ? "mutate-noflush" : step.calls.length > 1 ? "mutate-double" : "mutate");
      return;
    }
    if (step.kind === "flush") {
      bump(stats.stepKinds, "flush");
      return;
    }
    if (step.kind === "read") {
      emitRead();
      bump(stats.stepKinds, "read");
      return;
    }
    if (step.kind === "snap") {
      try {
        emit("S: " + show(api.snapshot(stores[step.store || 0].store)));
      } catch (e) {
        emit(`S: ERR ${e.name || "Error"}: ${e.message || ""}`);
      }
      bump(stats.stepKinds, "snap");
      return;
    }
    if (step.kind === "probe") {
      bump(stats.stepKinds, "probe");
      const root = step.ref && step.ref.t === "m" ? null : resolveRef(step.ref);
      if (step.which === "pending") {
        const v = catchNR(() =>
          api.isPending(() => {
            if (step.ref && step.ref.t === "m") return asyncMemo();
            if (!root || !isObj(root.h)) return undefined;
            return readPath(ops, root.h, step.path, root.shape, "probe");
          })
        );
        emit(`P: ${fmt(v)}`);
        if (v === true) stats.pendingTrue++;
      } else {
        const v = catchNR(() =>
          api.latest(() => {
            if (step.ref && step.ref.t === "m") return asyncMemo();
            if (!root || !isObj(root.h)) return undefined;
            return reveal(ops, readPath(ops, root.h, step.path, root.shape, "probeL"), null);
          })
        );
        emit(`L: ${fmt(v)}`);
      }
      return;
    }
    if (step.kind === "toggle") {
      setFlag(!flag());
      bump(stats.stepKinds, "toggle");
      return;
    }
    if (step.kind === "bump") {
      setGen(gen() + 1);
      bump(stats.stepKinds, "bump");
      return;
    }
    if (step.kind === "dispose-reader") {
      if (readerDispose) {
        readerDispose();
        readerDispose = null;
      }
      bump(stats.stepKinds, "dispose-reader");
      return;
    }
    if (step.kind === "remount-reader") {
      if (ops.mountDisposable) ops.mountDisposable();
      stats.remounts++;
      bump(stats.stepKinds, "remount-reader");
      return;
    }
    if (step.kind === "resolve-async" || step.kind === "reject-async") {
      let gate = null;
      while (asyncGates.length && !gate) {
        const g = asyncGates.shift();
        if (!g.settled) gate = g;
      }
      if (!gate) {
        bump(stats.stepKinds, step.kind + "-empty");
        return;
      }
      gate.settled = true;
      if (step.kind === "resolve-async") {
        gate.resolve(gate.value);
        stats.asyncResolves++;
      } else {
        gate.reject(new Error("async-reject"));
        stats.asyncRejects++;
      }
      bump(stats.stepKinds, step.kind);
      await tick();
      safeFlush();
      drainEffects();
      await tick();
      if (!halted) safeFlush();
      return;
    }
    if (step.kind === "action") {
      const opt = optimistics[step.opt];
      const src = stores[step.source];
      if (!src || (step.optimistic && !opt)) {
        bump(stats.stepKinds, "action-skip");
        return;
      }
      const yields = step.yields | 0;
      const gates = [];
      for (let i = 0; i < yields; i++) {
        let resolve, reject;
        const promise = new Promise((res, rej) => {
          resolve = res;
          reject = rej;
        });
        const gate = { promise, resolve, reject, settled: false };
        gates.push(gate);
        pending.push(gate);
      }
      stats.actions++;
      bump(stats.stepKinds, "action");
      api.action(function* () {
        if (opt && step.before && step.before.length) {
          opt.set(() => {
            const root = ops.root(opt.store);
            for (let i = 0; i < step.before.length; i++) if (applyMut(ops, root, step.before[i], "list"))
              bump(stats.mutOps, step.before[i].op);
          });
        }
        for (let y = 0; y < yields; y++) {
          yield gates[y].promise;
          const writes = (step.after && step.after[y]) || [];
          if (writes.length === 1 && WRITE_OPS.has(writes[0].op) && step.viaWrite) {
            if (singleWrite(ops, src, writes[0], "store")) bump(stats.mutOps, writes[0].op);
          } else if (writes.length) {
            src.set(() => {
              const root = ops.root(src.store);
              for (let i = 0; i < writes.length; i++) {
                const m = writes[i];
                if (m.op === "replaceRoot") return structuredClone(m.tree);
                if (applyMut(ops, root, m, "store")) bump(stats.mutOps, m.op);
              }
            });
          }
        }
      })();
      return;
    }
    if (step.kind === "resolve" || step.kind === "reject") {
      let gate = null;
      while (pending.length && !gate) {
        const g = pending.shift();
        if (!g.settled) gate = g;
      }
      if (!gate) {
        bump(stats.stepKinds, step.kind + "-empty");
        return;
      }
      gate.settled = true;
      if (step.kind === "resolve") {
        gate.resolve();
        stats.resolves++;
      } else {
        gate.reject(new Error("fuzz-reject"));
        stats.rejects++;
      }
      bump(stats.stepKinds, step.kind);
      await tick();
      safeFlush();
      drainEffects();
      await tick();
      if (!halted) safeFlush();
    }
  };

  if (!halted) {
    for (let i = 0; i < program.steps.length; i++) {
      stepIndex = i;
      const step = program.steps[i];
      emit(`STEP ${i} ${step.kind}${step.flush === false ? " noflush" : ""}`);
      try {
        await runStep(step);
      } catch (e) {
        emit(`THROW ${errClass(e)}`);
        haltStack = e.stack || haltStack;
      }
      if (halted) break;
      const noflush = step.kind === "mutate" && step.flush === false;
      if (!noflush) {
        if (!safeFlush()) break;
        drainEffects();
        if ((i + 1) % 5 === 0) emitRead();
      }
      drainRej();
    }
  }
  if (!halted) {
    stepIndex = program.steps.length;
    emit("END");
    await tick();
    if (safeFlush()) drainEffects();
    drainRej();
    await tick();
    if (!halted && safeFlush()) drainEffects();
    drainRej();
  }
  const leftover = pending.splice(0);
  const leftAsync = asyncGates.splice(0);
  try {
    dispose();
  } catch {
    /* outside the log */
  }
  for (let i = 0; i < innerDisposes.length; i++) {
    try {
      innerDisposes[i]();
    } catch {
      /* ignore */
    }
  }
  try {
    api.flush();
  } catch {
    halted = true;
    try {
      api.resetErrorHalt();
    } catch {
      /* ignore */
    }
  }
  for (let i = 0; i < leftover.length; i++) {
    if (!leftover[i].settled) {
      leftover[i].settled = true;
      try {
        leftover[i].resolve();
      } catch {
        /* ignore */
      }
    }
  }
  for (let i = 0; i < leftAsync.length; i++) {
    if (!leftAsync[i].settled) {
      leftAsync[i].settled = true;
      try {
        leftAsync[i].resolve(leftAsync[i].value);
      } catch {
        /* ignore */
      }
    }
  }
  await tick();
  try {
    api.flush();
  } catch {
    try {
      api.resetErrorHalt();
    } catch {
      /* ignore */
    }
  }
  await tick();
  rejBuf.length = 0;
  return { lines, stepOf, halted, haltStack, stats };
}

function row(rng, ids) {
  const id = ids.n++;
  const r = { id, k: "k" + id, label: "L" + rng.int(1000), n: rng.int(21) - 5, on: rng.chance(0.5) };
  if (rng.chance(0.5)) {
    const tags = [];
    const c = rng.int(3);
    for (let i = 0; i < c; i++) tags.push("t" + rng.int(6));
    r.tags = tags;
  }
  if (rng.chance(0.3)) r.meta = null;
  else r.meta = { k: "m" + rng.int(4), v: rng.int(8) };
  return r;
}
function tree(rng, ids) {
  const list = [];
  const n = rng.int(6);
  for (let i = 0; i < n; i++) list.push(row(rng, ids));
  return {
    title: "T" + rng.int(80),
    flag: rng.chance(0.5),
    extra: rng.chance(0.3) ? null : rng.int(30),
    meta: {
      note: "N" + rng.int(40),
      score: rng.int(20),
      nest: rng.chance(0.3) ? null : { z: rng.int(8), deep: { w: rng.int(8) } }
    },
    bag: { a: rng.int(5), b: rng.int(5) },
    list
  };
}
function fills(rng, ids, n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(row(rng, ids));
  return out;
}
function genMut(rng, ids, listPath, allowRoot, allowDelete) {
  const bag = ["setLeaf", "setLeaf", "setSubtree", "addKey", "push", "push", "pop", "unshift", "removeAt", "swap", "setLength", "replaceList", "replaceRow", "inc", "inc"];
  if (allowDelete) bag.push("deleteKey");
  if (allowRoot && rng.chance(0.12)) bag.push("replaceRoot");
  const op = rng.pick(bag);
  if (op === "setLeaf") {
    if (rng.chance(0.6))
      return {
        op,
        path: listPath,
        index: rng.int(6),
        field: rng.pick(["label", "n", "on"]),
        value: rng.chance(0.4) ? rng.int(20) - 2 : rng.chance(0.5) ? "Z" + rng.int(30) : rng.chance(0.5)
      };
    const path = rng.pick([["title"], ["flag"], ["extra"], ["meta", "score"], ["bag", "a"]]);
    const key = path[path.length - 1];
    let value = rng.int(15);
    if (key === "title") value = "S" + rng.int(20);
    else if (key === "flag") value = rng.chance(0.5);
    else if (key === "extra") value = rng.chance(0.3) ? null : rng.int(10);
    return { op, path, value };
  }
  if (op === "setSubtree")
    return {
      op,
      path: rng.chance(0.5) ? ["meta", "nest"] : ["bag"],
      value: rng.chance(0.5) ? { z: rng.int(5), deep: { w: rng.int(5) } } : { a: rng.int(4), b: rng.int(4) }
    };
  if (op === "deleteKey") return { op, path: ["bag"], key: rng.pick(["a", "b", "x0", "x1"]) };
  if (op === "addKey") return { op, path: ["bag"], key: "x" + rng.int(4), value: rng.int(8) };
  if (op === "push" || op === "unshift") return { op, path: listPath, row: row(rng, ids) };
  if (op === "pop") return { op, path: listPath };
  if (op === "removeAt" || op === "replaceRow")
    return { op, path: listPath, index: rng.int(6), row: op === "replaceRow" ? row(rng, ids) : undefined };
  if (op === "swap") return { op, path: listPath, i: rng.int(6), j: rng.int(6) };
  if (op === "setLength") return { op, path: listPath, length: rng.int(6), fills: fills(rng, ids, 6) };
  if (op === "replaceList")
    return rng.chance(0.5)
      ? { op, path: listPath, mode: "mod", field: "n", mod: 2 + rng.int(2), eq: rng.int(2) }
      : { op, path: listPath, mode: "drop", index: rng.int(4) };
  if (op === "inc")
    return rng.chance(0.7)
      ? { op, path: listPath, index: rng.int(6), field: "n", delta: rng.int(5) - 2 }
      : { op, path: ["meta", "score"], delta: rng.int(4) - 1 };
  if (op === "replaceRoot") return { op, tree: tree(rng, ids) };
  return { op: "pop", path: listPath };
}
function genOptMut(rng, ids) {
  const op = rng.pick(["push", "inc", "setLeaf", "replaceRow", "pop", "removeAt"]);
  const path = [];
  if (op === "push") return { op, path, row: row(rng, ids) };
  if (op === "inc") return { op, path, index: rng.int(5), field: "n", delta: rng.int(5) - 1 };
  if (op === "setLeaf")
    return { op, path, index: rng.int(5), field: rng.pick(["n", "label"]), value: rng.chance(0.5) ? rng.int(12) : "G" + rng.int(10) };
  if (op === "replaceRow") return { op, path, index: rng.int(5), row: row(rng, ids) };
  if (op === "removeAt") return { op, path, index: rng.int(5) };
  return { op: "pop", path };
}
function cleanMut(m) {
  if (m && m.row === undefined) delete m.row;
  return m;
}
function mutBatch(rng, ids, allowDelete, n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(cleanMut(genMut(rng, ids, ["list"], true, allowDelete)));
  if (out.some(m => m.op === "replaceRoot")) return [out.find(m => m.op === "replaceRoot")];
  return out;
}

function readerFor(rng, ref, kind, id) {
  if (ref.t === "m") return { id, kind, ref, path: [] };
  if (ref.t === "p" && ref.shape === "object") {
    if (kind === "leaf" || kind === "latest" || kind === "pending")
      return { id, kind, ref, path: rng.pick([["total"], ["count"], ["head"]]) };
    if (kind === "plain") return { id, kind, ref, path: [] };
    if (kind === "has") return { id, kind, ref, path: [], key: rng.pick(["total", "rows", "nope"]) };
    if (kind === "keys") return { id, kind, ref, path: [] };
    return { id, kind, ref, path: ["rows"], field: "n" };
  }
  if (ref.t === "p" || ref.t === "o") {
    if (kind === "leaf" || kind === "latest" || kind === "pending")
      return { id, kind, ref, path: rng.pick([["0", "n"], ["0", "label"], ["0", "k"]]) };
    if (kind === "plain") return { id, kind, ref, path: [] };
    if (kind === "has") return { id, kind, ref, path: [], key: "0" };
    if (kind === "keys") return { id, kind, ref, path: [] };
    return { id, kind, ref, path: [], field: "n" };
  }
  if (kind === "leaf" || kind === "latest" || kind === "pending")
    return { id, kind, ref, path: rng.pick([["title"], ["meta", "score"], ["bag", "a"], ["list", "0", "n"], ["flag"]]) };
  if (kind === "plain") return { id, kind, ref, path: rng.pick([["meta"], ["bag"], ["list"]]) };
  if (kind === "has") return { id, kind, ref, path: ["bag"], key: rng.pick(["a", "b", "missing"]) };
  if (kind === "keys") return { id, kind, ref, path: rng.pick([["bag"], ["meta"], ["list"]]) };
  if (kind === "len") return { id, kind, ref, path: ["list"] };
  return { id, kind, ref, path: ["list"], field: "n" };
}

function pickKeyMode(rng) {
  return rng.pick(["id", "field", "fn", "null"]);
}

export function generate(seed, stepsOpt, caps) {
  const rng = rngOf((seed + 1) * 0x9e3779b1);
  const ids = { n: 1 };
  const allowDelete = caps.delete !== false;
  const families = caps.families !== false;
  const optimisticOn = caps.optimistic !== false && families;
  const stores = [{ init: tree(rng, ids) }];
  if (rng.chance(0.4)) stores.push({ init: tree(rng, ids) });
  const keyMode = families ? pickKeyMode(rng) : "id";
  const projections = [];
  if (families && rng.chance(0.55)) {
    projections.push({
      kind: "return",
      source: 0,
      listPath: ["list"],
      filter: rng.chance(0.5) ? { field: "n", mod: 2, eq: rng.int(2) } : null,
      tag: "p0",
      keyMode,
      readAsync: rng.chance(0.45)
    });
  }
  if (families && rng.chance(0.45)) {
    projections.push({
      kind: "mutate",
      source: 0,
      listPath: ["list"],
      seed: { total: 0, count: 0, head: null, rows: [] },
      keyMode,
      readAsync: rng.chance(0.35)
    });
  }
  if (families && rng.chance(0.7)) projections.push({ kind: "async", keyMode, source: 0 });
  const optimistic = [];
  if (optimisticOn && rng.chance(0.55))
    optimistic.push({ source: 0, listPath: ["list"], seed: [], keyMode: pickKeyMode(rng) });
  const refs = [{ t: "s", i: 0 }];
  if (stores.length > 1) refs.push({ t: "s", i: 1 });
  for (let i = 0; i < projections.length; i++)
    refs.push({ t: "p", i, shape: projections[i].kind === "mutate" ? "object" : "array" });
  for (let i = 0; i < optimistic.length; i++) refs.push({ t: "o", i, shape: "array" });
  const kinds = ["leaf", "plain", "has", "keys", "len", "sum", "pending", "latest"];
  const readerN = 4 + rng.int(4);
  const readers = [{ id: 0, kind: "async", ref: { t: "m" }, path: [] }];
  readers.push({ id: 1, kind: "pending", ref: { t: "m" }, path: [] });
  readers.push({ id: 2, kind: "latest", ref: { t: "m" }, path: [] });
  for (let i = 0; i < readerN; i++) {
    const kind = kinds[i % kinds.length];
    let ref = refs[rng.int(refs.length)];
    if ((kind === "pending" || kind === "latest") && optimistic.length && rng.chance(0.5))
      ref = { t: "o", i: 0, shape: "array" };
    readers.push(readerFor(rng, ref, kind, readers.length));
  }
  let mapArraySpec = null;
  if (rng.chance(0.65)) {
    let ref = { t: "s", i: 0 };
    let path = ["list"];
    if (optimistic.length && rng.chance(0.35)) {
      ref = { t: "o", i: 0 };
      path = [];
    } else if (projections.some(p => p.kind === "return" || p.kind === "async") && rng.chance(0.3)) {
      ref = { t: "p", i: projections.findIndex(p => p.kind === "return" || p.kind === "async") };
      path = [];
    }
    mapArraySpec = { ref, path, fields: rng.chance(0.5) ? ["label", "n"] : ["n", "k"] };
  }
  const memo = rng.chance(0.55)
    ? { ref: { t: "s", i: 0 }, path: rng.pick([["meta", "score"], ["list", "0", "n"], ["flag"]]) }
    : null;
  const stepsN = stepsOpt == null ? 30 + rng.int(51) : stepsOpt;
  const steps = [];
  for (let i = 0; i < stepsN; i++) {
    const roll = rng.int(100);
    if (roll < 50) {
      const single = rng.chance(0.72);
      const calls = [];
      if (single) {
        let m = cleanMut(genMut(rng, ids, ["list"], false, allowDelete));
        let guard = 0;
        while (!WRITE_OPS.has(m.op) && guard++ < 6) m = cleanMut(genMut(rng, ids, ["list"], false, allowDelete));
        if (!WRITE_OPS.has(m.op)) m = { op: "inc", path: ["list"], index: rng.int(4), field: "n", delta: 1 };
        calls.push([m]);
        steps.push({ kind: "mutate", store: 0, flush: rng.chance(0.15) ? false : true, via: "write", calls });
      } else {
        const nCalls = rng.chance(0.2) ? 2 : 1;
        for (let c = 0; c < nCalls; c++) calls.push(mutBatch(rng, ids, allowDelete, 1 + rng.int(3)));
        steps.push({
          kind: "mutate",
          store: stores.length > 1 && rng.chance(0.25) ? 1 : 0,
          flush: rng.chance(0.18) ? false : true,
          calls
        });
      }
    } else if (roll < 48) steps.push({ kind: "flush" });
    else if (roll < 58) steps.push({ kind: "bump" });
    else if (roll < 68) steps.push({ kind: rng.chance(0.8) ? "resolve-async" : "reject-async" });
    else if (roll < 78 && optimistic.length) {
      const yields = rng.chance(0.25) ? 0 : rng.chance(0.6) ? 1 : 2;
      const before = [];
      for (let b = 0; b < rng.int(3); b++) before.push(genOptMut(rng, ids));
      const after = [];
      for (let y = 0; y < yields; y++) after.push(mutBatch(rng, ids, allowDelete, rng.chance(0.5) ? 1 : 1 + rng.int(2)));
      steps.push({
        kind: "action",
        opt: 0,
        source: optimistic[0].source,
        optimistic: true,
        yields,
        before,
        after,
        viaWrite: true
      });
    } else if (roll < 84 && optimistic.length) steps.push({ kind: rng.chance(0.7) ? "resolve" : "reject" });
    else if (roll < 90) steps.push({ kind: "read" });
    else if (roll < 94) steps.push({ kind: "toggle" });
    else if (roll < 97) steps.push({ kind: "snap", store: 0 });
    else
      steps.push({
        kind: "probe",
        which: rng.chance(0.5) ? "pending" : "latest",
        ref: { t: "m" },
        path: []
      });
  }
  const used = new Set();
  const put = (at, step) => {
    if (!steps.length) return;
    let i = Math.min(steps.length - 1, Math.max(0, Math.floor(at)));
    while (used.has(i) && i < steps.length - 1) i++;
    if (used.has(i)) return;
    steps[i] = step;
    used.add(i);
  };
  put(0, { kind: "resolve-async" });
  put(1, { kind: "resolve-async" });
  put(stepsN * 0.16, { kind: "bump" });
  put(stepsN * 0.24, { kind: "resolve-async" });
  put(stepsN * 0.28, { kind: "resolve-async" });
  put(stepsN * 0.4, { kind: "bump" });
  put(stepsN * 0.48, { kind: "resolve-async" });
  put(stepsN * 0.56, { kind: "dispose-reader" });
  put(stepsN * 0.64, { kind: "remount-reader" });
  put(stepsN * 0.7, { kind: "toggle" });
  put(stepsN * 0.76, { kind: "snap", store: 0 });
  if (optimistic.length) {
    put(stepsN * 0.32, {
      kind: "action",
      opt: 0,
      source: 0,
      optimistic: true,
      yields: 1,
      before: [genOptMut(rng, ids)],
      after: [mutBatch(rng, ids, allowDelete, 1)],
      viaWrite: true
    });
    put(stepsN * 0.36, { kind: "resolve" });
  } else if (rng.chance(0.5)) {
    put(stepsN * 0.32, {
      kind: "action",
      opt: 0,
      source: 0,
      optimistic: false,
      yields: 1,
      before: [],
      after: [mutBatch(rng, ids, allowDelete, 1)],
      viaWrite: true
    });
    put(stepsN * 0.36, { kind: "resolve" });
  }
  return {
    seed,
    caps,
    stores,
    projections,
    optimistic,
    readers,
    mapArray: mapArraySpec,
    memo,
    cond: { ref: { t: "s", i: 0 }, path: ["title"] },
    disposable: { ref: { t: "s", i: 0 }, path: ["meta", "score"] },
    flag0: rng.chance(0.7),
    steps
  };
}

function firstDiff(a, b) {
  const n = Math.max(a.lines.length, b.lines.length);
  for (let i = 0; i < n; i++) if (a.lines[i] !== b.lines[i]) return i;
  if (a.halted !== b.halted) return a.lines.length;
  return -1;
}
function context(lines, i) {
  const out = [];
  for (let j = Math.max(0, i - 5); j <= Math.min(lines.length - 1, i + 5); j++)
    out.push((j === i ? ">" : " ") + String(j).padStart(4) + " " + lines[j]);
  return out.join("\n");
}
function writeFailure(variant, seed, program, proxy, target, index) {
  mkdirSync(FAIL_DIR, { recursive: true });
  const file = `${FAIL_DIR}/${variant.replace(/:/g, "-")}-seed-${seed}.json`;
  const stepIndex = index < 0 ? null : (proxy.stepOf && proxy.stepOf[index]) ?? null;
  writeFileSync(
    file,
    JSON.stringify(
      {
        variant,
        seed,
        stepIndex,
        diffIndex: index,
        program,
        proxyLog: proxy.lines,
        targetLog: target.lines,
        proxyHalted: proxy.halted,
        targetHalted: target.halted,
        proxyStack: proxy.haltStack || "",
        targetStack: target.haltStack || ""
      },
      null,
      2
    )
  );
  const repro = `${FAIL_DIR}/repro-${variant.replace(/:/g, "-")}-${seed}.mjs`;
  writeFileSync(
    repro,
    `import { execute, loadVariant, ensureBuilds } from "${ROOT}/fuzz.mjs";\nconst variant = ${JSON.stringify(variant)};\nawait ensureBuilds();\nconst apis = await loadVariant(variant);\nconst program = ${JSON.stringify(program)};\nconst proxy = await execute(program, apis.ref, { mode: "proxy", kind: "ref" });\nconst target = await execute(program, apis.variant, { mode: "target", kind: apis.kind, hostile: (apis.kind === "sitecache" || apis.kind === "combined") && program.seed % 2 === 0, sabotage: false });\nconsole.log("--- proxy ---");\nfor (const l of proxy.lines) console.log(l);\nconsole.log("--- target ---");\nfor (const l of target.lines) console.log(l);\nif (proxy.haltStack) console.log("PROXY STACK\\n" + proxy.haltStack);\nif (target.haltStack) console.log("TARGET STACK\\n" + target.haltStack);\nconst n = Math.max(proxy.lines.length, target.lines.length);\nfor (let i = 0; i < n; i++) if (proxy.lines[i] !== target.lines[i]) { console.log("DIFF", i); console.log("proxy", proxy.lines[i]); console.log("target", target.lines[i]); break; }\n`
  );
  return { file, repro, stepIndex };
}
function printDiff(variant, seed, program, proxy, target, index) {
  const { file, repro, stepIndex } = writeFailure(variant, seed, program, proxy, target, index);
  console.log(`DIFF ${variant} seed ${seed} step ${stepIndex} logIndex ${index}`);
  console.log("proxy:  " + (proxy.lines[index] ?? "<missing>"));
  console.log("target: " + (target.lines[index] ?? "<missing>"));
  if (proxy.haltStack) console.log("PROXY STACK\n" + proxy.haltStack);
  if (target.haltStack) console.log("TARGET STACK\n" + target.haltStack);
  console.log("--- proxy context ---");
  console.log(context(proxy.lines, Math.max(0, index)));
  console.log("--- target context ---");
  console.log(context(target.lines, Math.max(0, index)));
  console.log("wrote " + file);
  console.log("repro " + repro);
  return file;
}

function mergeStats(into, s, program, hostile) {
  into.seeds++;
  into.steps += program.steps.length;
  for (const k of Object.keys(s.stepKinds)) into.stepKinds[k] = (into.stepKinds[k] || 0) + s.stepKinds[k];
  for (const k of Object.keys(s.mutOps)) into.mutOps[k] = (into.mutOps[k] || 0) + s.mutOps[k];
  for (const k of Object.keys(s.readerRan)) into.readerRan[k] = (into.readerRan[k] || 0) + s.readerRan[k];
  into.notReadyLines += s.notReadyLines;
  into.pendingTrue += s.pendingTrue;
  into.throwLines += s.throwLines;
  into.unhandledLines += s.unhandledLines;
  into.mapArrayRowRuns += s.mapArrayRowRuns;
  into.actions += s.actions;
  into.resolves += s.resolves;
  into.rejects += s.rejects;
  into.storeWrite += s.storeWrite;
  into.shapedReads += s.shapedReads;
  into.siteReads += s.siteReads;
  into.draftTarget += s.draftTarget;
  into.draftFallback += s.draftFallback;
  into.remounts += s.remounts;
  into.asyncResolves += s.asyncResolves;
  into.asyncRejects += s.asyncRejects;
  if (s.notReadyLines) into.seedsWithNotReady++;
  if (s.pendingTrue) into.seedsWithPending++;
  if (s.throwLines || s.unhandledLines) into.seedsWithThrow++;
  if (program.mapArray) into.mapArrayPrograms++;
  into.asyncMemoPrograms++;
  for (const p of program.projections) {
    if (p.kind === "return") into.projectionReturn++;
    else if (p.kind === "mutate") into.projectionMutate++;
    else if (p.kind === "async") into.asyncProjectionPrograms++;
    bump(into.keyModes, p.keyMode || "id");
  }
  if (program.optimistic.length) {
    into.optimisticPrograms++;
    bump(into.keyModes, "opt:" + (program.optimistic[0].keyMode || "id"));
  }
  if (hostile) into.sharedSiteSeeds++;
  if (program.disposable) into.disposablePrograms++;
}

function emptyTotal() {
  return {
    seeds: 0,
    diffs: 0,
    steps: 0,
    stepKinds: {},
    mutOps: {},
    readerRan: {},
    notReadyLines: 0,
    pendingTrue: 0,
    throwLines: 0,
    unhandledLines: 0,
    seedsWithNotReady: 0,
    seedsWithPending: 0,
    seedsWithThrow: 0,
    mapArrayPrograms: 0,
    mapArrayRowRuns: 0,
    projectionReturn: 0,
    projectionMutate: 0,
    asyncProjectionPrograms: 0,
    asyncMemoPrograms: 0,
    optimisticPrograms: 0,
    actions: 0,
    resolves: 0,
    rejects: 0,
    storeWrite: 0,
    shapedReads: 0,
    siteReads: 0,
    draftTarget: 0,
    draftFallback: 0,
    remounts: 0,
    asyncResolves: 0,
    asyncRejects: 0,
    sharedSiteSeeds: 0,
    disposablePrograms: 0,
    keyModes: {}
  };
}

async function runSeed(seed, stepsOpt, apis, sabotage) {
  const program = generate(seed, stepsOpt, apis.caps);
  const hostile = (apis.kind === "sitecache" || apis.kind === "combined") && seed % 2 === 0;
  const proxy = await execute(program, apis.ref, { mode: "proxy", kind: "ref", sabotage: false });
  if (proxy.halted) {
    return {
      program,
      proxy,
      target: { lines: ["<not run: reference halted>"], stepOf: [null], halted: true, stats: emptyStats(), haltStack: "" },
      hostile,
      poisoned: true
    };
  }
  const target = await execute(program, apis.variant, {
    mode: "target",
    kind: apis.kind,
    hostile,
    sabotage
  });
  return { program, proxy, target, hostile, poisoned: target.halted };
}

function parseArgs(argv) {
  const positional = [];
  let steps = null;
  let replay = null;
  let shrinkFile = null;
  let sabotage = false;
  let all = false;
  let variant = "core";
  let log = null;
  let orderInsensitive = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--steps") steps = Number(argv[++i]);
    else if (a === "--replay") replay = argv[++i];
    else if (a === "--shrink") shrinkFile = argv[++i];
    else if (a === "--sabotage") sabotage = true;
    else if (a === "--all") all = true;
    else if (a === "--variant") variant = argv[++i];
    else if (a === "--log") log = argv[++i];
    else if (a === "--order-insensitive") orderInsensitive = true;
    else positional.push(a);
  }
  return { positional, steps, replay, shrinkFile, sabotage, all, variant, log, orderInsensitive };
}

function multisetEqual(a, b) {
  if (a.length !== b.length) return false;
  const n = new Map();
  for (const l of a) n.set(l, (n.get(l) || 0) + 1);
  for (const l of b) {
    const c = n.get(l) || 0;
    if (!c) return false;
    if (c === 1) n.delete(l);
    else n.set(l, c - 1);
  }
  return n.size === 0;
}
function countPrefix(lines, prefix) {
  let n = 0;
  for (const l of lines) if (typeof l === "string" && l.startsWith(prefix)) n++;
  return n;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await ensureBuilds();
  const apis = await loadVariant(args.variant);
  const logLines = [];
  const say = line => {
    console.log(line);
    logLines.push(line);
  };
  if (args.replay) {
    const raw = JSON.parse(readFileSync(args.replay, "utf8"));
    const program = raw.program || raw;
    const hostile = (apis.kind === "sitecache" || apis.kind === "combined") && program.seed % 2 === 0;
    const proxy = await execute(program, apis.ref, { mode: "proxy", kind: "ref" });
    const target = await execute(program, apis.variant, {
      mode: "target",
      kind: apis.kind,
      hostile,
      sabotage: args.sabotage
    });
    const index = firstDiff(proxy, target);
    if (index < 0 && !proxy.halted && !target.halted) {
      say(`ok ${args.variant} seed ${program.seed} lines ${proxy.lines.length}`);
      process.exit(0);
    }
    printDiff(args.variant, program.seed, program, proxy, target, Math.max(0, index));
    process.exit(1);
  }
  if (args.positional.length < 2) {
    console.error("usage: node fuzz.mjs --variant NAME SEED_START SEED_COUNT [--steps N] [--all] [--sabotage]");
    process.exit(2);
  }
  const start = Number(args.positional[0]);
  const count = Number(args.positional[1]);
  const t0 = performance.now();
  const total = emptyTotal();
  let orderOnly = 0;
  let contentDiff = 0;
  let proxyThrows = 0;
  let targetThrows = 0;
  for (let s = start; s < start + count; s++) {
    const { program, proxy, target, hostile, poisoned } = await runSeed(s, args.steps, apis, args.sabotage);
    mergeStats(total, target.stats, program, hostile);
    proxyThrows += countPrefix(proxy.lines, "THROW ");
    targetThrows += countPrefix(target.lines, "THROW ");
    const index = firstDiff(proxy, target);
    if (index >= 0 || proxy.halted || target.halted) {
      total.diffs++;
      const order = !proxy.halted && !target.halted && multisetEqual(proxy.lines, target.lines);
      if (order) orderOnly++;
      else contentDiff++;
      if (!args.orderInsensitive) printDiff(args.variant, s, program, proxy, target, Math.max(0, index));
      if (!args.all && !args.orderInsensitive) break;
      if (poisoned && !args.all && !args.orderInsensitive) break;
    }
    if ((s - start + 1) % 25 === 0)
      console.error(`progress ${args.variant} ${s - start + 1}/${count} diffs ${total.diffs}`);
    if (poisoned && !args.all && !args.orderInsensitive) break;
  }
  total.wallMs = Math.round(performance.now() - t0);
  total.variant = args.variant;
  total.proxyThrows = proxyThrows;
  total.targetThrows = targetThrows;
  if (args.orderInsensitive) {
    total.orderOnly = orderOnly;
    total.contentDiff = contentDiff;
  }
  say("STATS " + JSON.stringify(total));
  mkdirSync(LOG_DIR, { recursive: true });
  const logPath = args.log || `${LOG_DIR}/${args.variant.replace(/:/g, "-")}-${start}-${count}${args.sabotage ? "-sabotage" : ""}.log`;
  writeFileSync(logPath, logLines.join("\n") + "\n");
  if (total.diffs) process.exit(1);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch(e => {
    console.error(e);
    process.exit(1);
  });
}

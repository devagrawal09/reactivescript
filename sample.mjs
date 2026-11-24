import { existsSync } from "node:fs";
import { spawn } from "node:child_process";

// Shared sampler. Warmup stops at warmupOps or warmupMs, whichever comes first.
// A sample is a batch aimed at >= sampleMs. before/after run outside the timer.
// Times are µs per timed() call, divided by `divisor` (update reports per click).

export async function measure(timed, opts = {}) {
  const warmupOps = opts.warmupOps ?? 30;
  const warmupMs = opts.warmupMs ?? 300;
  const minSamples = opts.minSamples ?? 15;
  const sampleMs = opts.sampleMs ?? 20;
  const divisor = opts.divisor ?? 1;
  const before = opts.before;
  const after = opts.after;

  let wops = 0;
  const w0 = process.hrtime.bigint();
  while (wops < warmupOps && Number(process.hrtime.bigint() - w0) / 1e6 < warmupMs) {
    if (before) await before();
    await timed();
    if (after) await after();
    wops++;
  }

  const probeN = 3;
  let probe = 0n;
  for (let i = 0; i < probeN; i++) {
    if (before) await before();
    const a = process.hrtime.bigint();
    await timed();
    probe += process.hrtime.bigint() - a;
    if (after) await after();
  }
  const nsPer = Number(probe) / probeN;
  let batch = Math.max(1, Math.min(20000, Math.ceil((sampleMs * 1e6) / Math.max(nsPer, 1))));

  const samples = [];
  for (let s = 0; s < minSamples; s++) {
    let acc = 0n;
    for (let i = 0; i < batch; i++) {
      if (before) await before();
      const a = process.hrtime.bigint();
      await timed();
      acc += process.hrtime.bigint() - a;
      if (after) await after();
    }
    const ms = Number(acc) / 1e6;
    samples.push(Number(acc) / batch / divisor / 1e3);
    if (ms < sampleMs * 0.6 && batch < 20000) {
      batch = Math.min(20000, Math.max(batch + 1, Math.ceil((batch * sampleMs) / Math.max(ms, 0.05))));
    }
  }
  return samples;
}

export function quantile(sorted, q) {
  if (!sorted.length) return NaN;
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  if (lo === hi) return sorted[lo];
  return sorted[lo] * (hi - i) + sorted[hi] * (i - lo);
}

export function summarize(samples) {
  const s = samples.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (!s.length) return { n: 0, median: NaN, min: NaN, iqr: NaN };
  const q1 = quantile(s, 0.25);
  const q3 = quantile(s, 0.75);
  return { n: s.length, median: quantile(s, 0.5), min: s[0], iqr: q3 - q1 };
}

export function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const eq = a.indexOf("=");
    const k = eq === -1 ? a.slice(2) : a.slice(2, eq);
    const inline = eq === -1 ? null : a.slice(eq + 1);
    if (inline != null) out[k] = inline;
    else {
      const v = argv[i + 1];
      if (v != null && !v.startsWith("--")) {
        out[k] = v;
        i++;
      } else out[k] = true;
    }
  }
  return out;
}

export function emit(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

export function onlySet(arg) {
  if (!arg) return null;
  return new Set(String(arg).split(",").map((s) => s.trim()).filter(Boolean));
}

export function fmt(n, d = 2) {
  if (n == null || !Number.isFinite(n)) return "n/a";
  return n.toFixed(d);
}

export function fmtRatio(n) {
  if (n == null || !Number.isFinite(n)) return "n/a";
  return n.toFixed(3);
}

export async function waitForFiles(paths, log = console.error) {
  const missing = () => paths.filter((p) => !existsSync(p));
  const start = Date.now();
  let gone = missing();
  while (gone.length) {
    if (Date.now() - start > 20 * 60 * 1000) {
      throw new Error("dist not ready after 20 min: " + gone.join(", "));
    }
    log("waiting 60s for " + gone.join(", "));
    await new Promise((r) => setTimeout(r, 60000));
    gone = missing();
  }
}

export function runChild(nodeFlags, scriptArgs) {
  const node = process.execPath;
  const taskset = existsSync("/usr/bin/taskset");
  const cmd = taskset ? "taskset" : node;
  const argv = taskset ? ["-c", "2", node, ...nodeFlags, ...scriptArgs] : [...nodeFlags, ...scriptArgs];
  const env = { ...process.env };
  delete env.NODE_OPTIONS;
  return new Promise((resolve) => {
    const child = spawn(cmd, argv, { env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { err += d; });
    const timer = setTimeout(() => child.kill("SIGKILL"), 8 * 60 * 1000);
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, out, err, argv: [cmd, ...argv] });
    });
  });
}

export function jsonLines(text) {
  const rows = [];
  for (const line of text.split("\n")) {
    const s = line.trim();
    if (!s.startsWith("{")) continue;
    try { rows.push(JSON.parse(s)); } catch { /* not a result line */ }
  }
  return rows;
}

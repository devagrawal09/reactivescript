// Round 8 statistics (PREREG-fuzz-8.md): per-app hole rates from `harness/fuzz.mjs --json` results, H8a (one-sided
// permutation test on mean rates, React vs .rx, 100,000 relabellings, seed 5), H8b (one-sided Fisher's exact test on
// apps with at least one hole), and the tables reported alongside (per arm and task, holes by kind).
// Usage: node harness/fuzz-stats.mjs <dir of json results> [--json out.json]
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const mean = xs => xs.reduce((s, x) => s + x, 0) / xs.length;

/** P(mean(a) - mean(b) >= observed) under random relabelling */
function permutation(a, b, n = 100000, seed = 5) {
  const r = rng(seed); const all = [...a, ...b]; const obs = mean(a) - mean(b); let hits = 0;
  for (let i = 0; i < n; i++) {
    const xs = [...all];
    for (let j = xs.length - 1; j > 0; j--) { const k = Math.floor(r() * (j + 1)); [xs[j], xs[k]] = [xs[k], xs[j]]; }
    if (mean(xs.slice(0, a.length)) - mean(xs.slice(a.length)) >= obs - 1e-12) hits++;
  }
  return { observed: obs, p: hits / n };
}

const lf = n => { let s = 0; for (let i = 2; i <= n; i++) s += Math.log(i); return s; };
/** one-sided Fisher: P(first group has >= a successes) given the margins */
function fisher(a, n1, c, n2) {
  const k = a + c; const N = n1 + n2; let p = 0;
  for (let x = a; x <= Math.min(k, n1); x++) p += Math.exp(lf(n1) - lf(x) - lf(n1 - x) + lf(n2) - lf(k - x) - lf(n2 - k + x) - lf(N) + lf(k) + lf(N - k));
  return Math.min(1, p);
}

export function stats(dir) {
  const apps = [];
  for (const f of readdirSync(dir).filter(f => f.endsWith(".json")).sort()) {
    const j = JSON.parse(readFileSync(path.join(dir, f), "utf8"));
    const name = path.basename(j.dir); const round = path.basename(path.dirname(j.dir));
    const arm = name.match(/-(react|rx|solid|foldkit)-\d+$/)[1]; const task = name.replace(/-(react|rx|solid|foldkit)-\d+$/, "");
    apps.push({ round, name, arm, task, build: j.build, seeds: j.seeds, holes: j.violations.length, kinds: j.violations.map(v => v.kind), rate: j.build ? j.violations.length / j.seeds : null });
  }
  const built = apps.filter(a => a.build);
  const react = built.filter(a => a.arm === "react"); const rx = built.filter(a => a.arm === "rx");
  const h8a = permutation(react.map(a => a.rate), rx.map(a => a.rate));
  const reverse = permutation(rx.map(a => a.rate), react.map(a => a.rate));
  const withHole = xs => xs.filter(a => a.holes > 0).length;
  const h8b = { react: [withHole(react), react.length], rx: [withHole(rx), rx.length], p: fisher(withHole(react), react.length, withHole(rx), rx.length), reverseP: fisher(withHole(rx), rx.length, withHole(react), react.length) };
  const groups = {};
  for (const a of built) { const k = `${a.round} ${a.task} ${a.arm}`; (groups[k] ??= []).push(a.holes); }
  const kinds = {};
  for (const a of built) for (const k of a.kinds) { kinds[a.arm] ??= {}; kinds[a.arm][k] = (kinds[a.arm][k] ?? 0) + 1; }
  const perArm = {};
  for (const arm of ["react", "rx", "solid", "foldkit"]) { const xs = built.filter(a => a.arm === arm); if (xs.length) perArm[arm] = { apps: xs.length, meanRate: mean(xs.map(a => a.rate)), withHole: withHole(xs), seedsWithHole: xs.reduce((s, a) => s + a.holes, 0), seeds: xs.reduce((s, a) => s + a.seeds, 0) }; }
  return { apps, unbuilt: apps.filter(a => !a.build).map(a => `${a.round}/${a.name}`), h8a: { reactMean: mean(react.map(a => a.rate)), rxMean: mean(rx.map(a => a.rate)), ...h8a, reverseP: reverse.p }, h8b, perArm, groups, kinds };
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const a = process.argv.slice(2); const s = stats(path.resolve(a[0]));
  const pct = x => `${(100 * x).toFixed(1)}%`;
  console.log(`apps: ${s.apps.length} (${s.unbuilt.length} did not build: ${s.unbuilt.join(", ") || "none"})`);
  console.log(`H8a: React mean hole rate ${pct(s.h8a.reactMean)} vs .rx ${pct(s.h8a.rxMean)}; one-sided p (React > .rx) = ${s.h8a.p.toFixed(4)}; reverse p = ${s.h8a.reverseP.toFixed(4)}`);
  console.log(`H8b: apps with a hole React ${s.h8b.react.join("/")} vs .rx ${s.h8b.rx.join("/")}; Fisher one-sided p = ${s.h8b.p.toFixed(4)}; reverse p = ${s.h8b.reverseP.toFixed(4)}`);
  console.log("\nper arm:"); for (const [k, v] of Object.entries(s.perArm)) console.log(`  ${k.padEnd(8)} ${v.apps} apps, mean rate ${pct(v.meanRate)}, ${v.withHole} with a hole, ${v.seedsWithHole}/${v.seeds} seeds`);
  console.log("\nholes per app (of 50 seeds), by round, task and arm:"); for (const [k, v] of Object.entries(s.groups)) console.log(`  ${k.padEnd(32)} ${v.join(" ")}`);
  console.log("\nholes by kind:"); for (const [arm, ks] of Object.entries(s.kinds)) console.log(`  ${arm}: ${Object.entries(ks).sort((x, y) => y[1] - x[1]).map(([k, n]) => `${k} ${n}`).join(", ")}`);
  const o = a.indexOf("--json"); if (o >= 0) writeFileSync(a[o + 1], JSON.stringify(s, null, 2) + "\n");
}

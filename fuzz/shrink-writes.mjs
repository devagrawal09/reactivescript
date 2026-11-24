import { readFileSync, writeFileSync } from "node:fs";
import { execute, loadVariant, ensureBuilds } from "./fuzz.mjs";

await ensureBuilds();
const apis = await loadVariant("writes");
const raw = JSON.parse(readFileSync("/home/lucifer/work/solidjs/store-proto-bench/fuzz/failures/writes-seed-10.json", "utf8"));
let program = raw.program;
program = { ...program, steps: program.steps.slice(0, 25) };

async function buggy(prog) {
  const proxy = await execute(prog, apis.ref, { mode: "proxy", kind: "ref" });
  const target = await execute(prog, apis.variant, { mode: "target", kind: "writes" });
  const hit =
    target.lines.some(l => typeof l === "string" && l.includes("reading 'rr'")) &&
    !proxy.lines.some(l => typeof l === "string" && l.includes("reading 'rr'"));
  return hit;
}

if (!(await buggy(program))) {
  console.log("seed no longer bugs");
  process.exit(1);
}

let changed = true;
let pass = 0;
while (changed && pass < 8) {
  changed = false;
  pass++;
  for (let i = program.steps.length - 1; i >= 0; i--) {
    const trial = { ...program, steps: program.steps.filter((_, j) => j !== i) };
    if (await buggy(trial)) {
      program = trial;
      changed = true;
      console.error("drop step", i, "left", program.steps.length);
    }
  }
  if (program.readers.length > 1) {
    for (let i = program.readers.length - 1; i >= 0; i--) {
      const trial = { ...program, readers: program.readers.filter((_, j) => j !== i) };
      if (await buggy(trial)) {
        program = trial;
        changed = true;
      }
    }
  }
  if (program.mapArray) {
    const trial = { ...program, mapArray: null };
    if (await buggy(trial)) {
      program = trial;
      changed = true;
      console.error("drop mapArray");
    }
  }
  if (program.memo) {
    const trial = { ...program, memo: null };
    if (await buggy(trial)) {
      program = trial;
      changed = true;
    }
  }
  if (program.cond) {
    const trial = { ...program, cond: null };
    if (await buggy(trial)) {
      program = trial;
      changed = true;
    }
  }
  if (program.disposable) {
    const trial = { ...program, disposable: null };
    if (await buggy(trial)) {
      program = trial;
      changed = true;
    }
  }
  if (program.optimistic.length) {
    const trial = { ...program, optimistic: [] };
    if (await buggy(trial)) {
      program = trial;
      changed = true;
      console.error("drop optimistic");
    }
  }
  if (program.projections.length) {
    for (let i = program.projections.length - 1; i >= 0; i--) {
      const trial = { ...program, projections: program.projections.filter((_, j) => j !== i) };
      if (await buggy(trial)) {
        program = trial;
        changed = true;
        console.error("drop projection", i);
      }
    }
  }
}
writeFileSync("/home/lucifer/work/solidjs/store-proto-bench/fuzz/failures/writes-seed-10.min.json", JSON.stringify({ program }, null, 2));
console.log("steps", program.steps.length);
console.log(program.steps.map((s, i) => i + " " + s.kind + " " + (s.via || "") + " " + JSON.stringify(s.calls || s.after || s.before || "").slice(0, 120)).join("\n"));
console.log("proj", program.projections.map(p => p.kind));
console.log("opt", program.optimistic.length, "map", !!program.mapArray, "readers", program.readers.length);

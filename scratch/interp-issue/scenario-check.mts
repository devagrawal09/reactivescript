import { readFileSync, writeFileSync } from "node:fs";
import { runScenario } from "/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/src/scenario.ts";
const here = import.meta.dirname + "/";
const frames = JSON.parse(readFileSync(here + "frames.json", "utf8"));
const actions = { U1: ["mount", "handler n := 2; save()", 'resolve "request:1" 0'], U2: ["mount", "handler save(2)", "handler save(3)", 'resolve "request:2" 5', 'resolve "request:3" 0'] };
const results = {};
for (const name of ["U1", "U2"]) {
  const sc = { name, program: readFileSync(here + name + ".rx", "utf8"), entry: here + name + ".rx", modules: new Map(), rejected: [], divergences: [], server: [], before: [], css: null, tables: [{ title: "Frames", program: null, rows: actions[name].map((action, instant) => ({ instant, action, frame: frames[name].native[instant].frame, effects: [] })) }] };
  results[name] = runScenario(sc);
}
writeFileSync(here + "scenario-results.json", JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));

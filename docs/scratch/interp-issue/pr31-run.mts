import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { transform } from "@solidjs/compiler";
import { loadModules } from "/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/src/modules.ts";
import { checkModules } from "/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/src/check.ts";
import { Runtime } from "./pr31-runtime.ts";
import { compileModules } from "/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/emit.ts";
import { lowerViews, STRING_RENDERER } from "/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/jsx.ts";
import { createApp, flush } from "/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/reactivescript/ref/compile/rt.ts";

const here = import.meta.dirname + "/";
const renderer = here + "renderer.ts";
const scripts = { U1: [0, { amount: 1, value: 0 }], U2: [0, 1, { amount: 2, value: 5 }, { amount: 3, value: 0 }] };
const result = {};
const settle = async () => { for (let i = 0; i < 3; i++) { await new Promise(done => setImmediate(done)); flush(); } };
const buttons = node => node?.tag === "button" ? [node] : (node?.children ?? []).flatMap(buttons);
const ibuttons = items => items.flatMap(item => item.k === "el" && item.tag === "button" ? [item] : ibuttons(item.children ?? item.inst?.items ?? []));

for (const name of ["U1", "U2"]) {
  const rx = readFileSync(here + name + ".rx", "utf8");
  const entry = here + name + ".rx";
  const set = loadModules(entry, p => { try { return readFileSync(p, "utf8"); } catch { return undefined; } });
  const diags = checkModules(set).diags;
  if (diags.length) throw new Error(JSON.stringify(diags));
  const rt = new Runtime(set);
  let frame = rt.step([]).at(-1).frame;
  const interpreted = [{ step: "mount", frame }];
  for (const step of scripts[name]) {
    if (typeof step === "object") frame = rt.land(JSON.stringify("request:" + step.amount), step.value).at(-1).frame;
    else {
      const b = ibuttons(rt.view.items)[step];
      b.attrs.find(a => a.name === "onClick").node.compute(rt)();
      frame = rt.handler([]).at(-1).frame;
    }
    interpreted.push({ step: typeof step === "object" ? "resolve request(" + step.amount + ") = " + step.value : "click " + step, frame });
  }
  console.log(name, "interpreter", JSON.stringify(interpreted));
  rt.root.dispose();
  result[name] = interpreted;
}
writeFileSync(here + "pr31-frames.json", JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result, null, 2));

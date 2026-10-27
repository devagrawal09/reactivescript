// ReactiveScript's front end for @solidjs/vite-plugin's `frontends` hook (prototype):
//
//   solid({ frontends: { ".rx": rx({ entry: "src/main.rx" }) } })
//
// The crate (compiler/, `rxc app`) already hands each module to Solid's compiler (spec/11 CP-1), so a `.rx` module
// comes back as Solid's output for the environment's `generate` — with its source map onto the `.rx` and, on the entry,
// the program's stylesheet. Solid's plugin then takes it the way it takes lowered `.tsrx`: primitive names, `lazy()`,
// the HMR refresh pass, server functions (12 SF-7a), the stylesheet as a CSS module.
//
// The program is checked and compiled whole, from `entry` (CP-2: a module's lowering depends on its imports'
// signatures), once per target, and again when one of its files changes; each module takes its piece.
import { execFileSync } from "node:child_process";
import { statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const RXC = fileURLToPath(new URL("../compiler/target/release/rxc", import.meta.url));
const mtime = file => { try { return statSync(file).mtimeMs; } catch { return -1; } };

/** @param {{ entry: string, rxc?: string }} options @returns {import("@solidjs/vite-plugin").Frontend} */
export default function rx(options) {
  const builds = new Map();   // target → { out, stamps }
  function build(entry, target, moduleName) {
    const key = `${entry}\0${target}\0${moduleName}`;
    const prior = builds.get(key);
    if (prior && [...prior.stamps].every(([f, t]) => mtime(f) === t)) return prior.out;
    const out = JSON.parse(execFileSync(options.rxc ?? RXC, ["app", entry, "--target", target, "--module-name", moduleName], { maxBuffer: 1 << 30 }).toString());
    if (out.modules) out.modules = Object.fromEntries(Object.entries(out.modules).map(([p, m]) => [path.resolve(p), m]));
    const files = out.modules ? Object.keys(out.modules) : out.diagnostics ? [...new Set([entry, ...out.diagnostics.map(d => d.file)])] : [entry];
    builds.set(key, { out, stamps: new Map(files.map(f => [f, mtime(f)])) });
    return out;
  }
  return {
    compile(_source, { id, root, solid, addWatchFile }) {
      const entry = path.resolve(root, options.entry);
      const file = path.resolve(id);
      const out = build(entry, solid.generate === "ssr" ? "ssr" : solid.generate === "universal" ? "universal" : "dom", solid.moduleName ?? "@solidjs/web");
      if (out.diagnostics) throw new Error(out.diagnostics.map(d => `${d.file}:${d.line}: error ${d.code} [${d.rule}] ${d.msg}`).join("\n"));
      if (out.error) throw new Error(out.error);
      const m = out.modules[file];
      if (!m) throw new Error(`${file} is not part of the program ${entry} imports`);
      for (const p of Object.keys(out.modules)) if (p !== file) addWatchFile(p);
      // CSS-4: the program's stylesheet, linked once, from its entry
      return { code: m.code, map: m.map, css: file === entry ? out.css : "" };
    },
  };
}

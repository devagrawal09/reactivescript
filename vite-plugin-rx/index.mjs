// vite-plugin-rx (prototype): `.rx` modules in a Vite app, through ReactiveScript's crate (compiler/, `rxc app`). Use it
// before @solidjs/vite-plugin: the crate already hands each module to Solid's compiler (spec/11 CP-1), so a `.rx` module
// leaves this plugin as plain JavaScript for the environment's target — ssr for a server environment, dom (hydratable)
// otherwise — with its source map onto the `.rx` and the stylesheet as a CSS module the entry imports. Solid's plugin
// then treats it as an ordinary module; its server-functions pass extracts `"use server"` (12 SF-7a) when its filter
// includes `.rx`.
//
// The program is checked and compiled whole, from `entry` (CP-2: a module's lowering depends on its imports'
// signatures), once per target and again after any `.rx`/`.d.rx` change; each module's transform takes its piece.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const CSS = "virtual:rx-styles.css";
const RXC = fileURLToPath(new URL("../compiler/target/release/rxc", import.meta.url));

/** @param {{ entry: string, rxc?: string, moduleName?: string }} options */
export default function rx(options) {
  let root = process.cwd();
  let entry = "";
  const builds = new Map();   // target → the compiled program
  const build = target => {
    if (!builds.has(target)) {
      const args = ["app", entry, "--target", target, ...(options.moduleName ? ["--module-name", options.moduleName] : [])];
      const out = JSON.parse(execFileSync(options.rxc ?? RXC, args, { maxBuffer: 1 << 30 }).toString());
      if (out.modules) out.modules = Object.fromEntries(Object.entries(out.modules).map(([p, m]) => [path.resolve(p), m]));
      builds.set(target, out);
    }
    return builds.get(target);
  };
  const isRx = id => /\.rx$/.test(id.split("?")[0]);
  return {
    name: "reactivescript",
    enforce: "pre",
    configResolved(config) {
      root = config.root;
      entry = path.resolve(root, options.entry);
    },
    resolveId(id) {
      if (id === CSS) return "\0" + CSS;
    },
    load(id) {
      if (id === "\0" + CSS) return build("dom").css ?? "";
    },
    transform(_code, id, opts) {
      if (!isRx(id)) return null;
      const file = path.resolve(id.split("?")[0]);
      const server = this.environment ? this.environment.config.consumer === "server" : !!opts?.ssr;
      const out = build(server ? "ssr" : "dom");
      if (out.diagnostics) {
        const [d] = out.diagnostics;
        this.error({ message: out.diagnostics.map(d => `${d.file}:${d.line}: error ${d.code} [${d.rule}] ${d.msg}`).join("\n"), id: d.file, loc: { line: d.line, column: 0 } });
      }
      if (out.error) this.error(out.error);
      const m = out.modules[file];
      if (!m) this.error(`${file} is not part of the program ${entry} imports`);
      for (const p of Object.keys(out.modules)) if (p !== file) this.addWatchFile(p);
      // the stylesheet rides on the entry (CSS-4: linked, not injected by the runtime)
      const css = file === entry && !server && out.css ? `import ${JSON.stringify(CSS)};\n` : "";
      const map = m.map ? JSON.parse(m.map) : null;
      if (map && css) map.mappings = ";" + map.mappings;
      return { code: css + m.code, map };
    },
    watchChange(id) {
      if (/\.(d\.)?rx$/.test(id)) builds.clear();
    },
    hotUpdate({ file, modules }) {
      if (!/\.(d\.)?rx$/.test(file)) return;
      builds.clear();
      // a module's output depends on the whole program's: every `.rx` module is stale, and its importers take it up
      return [...this.environment.moduleGraph.idToModuleMap.values()].filter(m => m.id && isRx(m.id)).concat(modules);
    },
  };
}

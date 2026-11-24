// ReactiveScript's front end for @solidjs/vite-plugin. The plugin loads it from `@reactivescript/compiler/vite` when
// the project has the package, so `solid()` compiles `.rx` with no option; `solid({ frontends: { ".rx": rx() } })`
// names it explicitly.
//
// The crate (its Node-API build, `src/node.rs`: what `rxc app` does) already hands each module to Solid's compiler
// (spec/11 CP-1), so a `.rx` module comes back as Solid's output for the environment's `generate`, with its source map onto the `.rx` and
// its own stylesheet. Solid's plugin then takes it the way it takes lowered `.tsrx`: primitive
// names, `lazy()`, the HMR refresh pass, server functions (12 SF-7a), the stylesheet as a CSS module.
//
// Entries find themselves. JavaScript imports only a program's entry (its default export mounts the app); an `.rx`
// dependency is a factory over the app (09 MO-1b) that only `.rx` imports. So an `.rx` module imported plainly is an
// entry: the program is checked and compiled whole from it (CP-2), once per target and again when one of its files
// changes. The crate's output imports its dependencies as `./x.rx?rx-dep`, and a dependency is served from the build
// of a program that contains it. A module several programs share is one module: its instance is keyed by its factory
// (11 CP-4b `module`), not by its place in a program.
//
// Dev (Solid's `dev`, the client): each source's and equation's creating calls run under its key (11 CP-4b `key`), so
// the devtools see `rx:<key>` names; a key's module is relative to the project root. If the project has
// `@reactivescript/map`, a program's entry also registers the program's map (`@reactivescript/map/live`), drawn from the
// resolved model, for the devtools' Map view. Builds that are not dev, and the server's, are as before.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const { app, model } = createRequire(import.meta.url)("./index.js");
const DEP = "rx-dep";
// the page each code points to: the package's copy (scripts/guide.mjs), else the repository's
const GUIDE = [path.join(path.dirname(fileURLToPath(import.meta.url)), "guide/diagnostics.md"), path.join(path.dirname(fileURLToPath(import.meta.url)), "../guide/diagnostics.md")].find(existsSync)
  ?? "https://github.com/solidjs/reactivescript/blob/main/guide/diagnostics.md";
const at = d => d.range ? `${d.range.start.line}:${d.range.start.column + 1}` : `${d.line}`;
/** The diagnostics as `rxc check` prints them, then, once per code, where its fix is explained. */
const report = ds => [
  ...ds.map(d => `${d.file}:${at(d)}: error ${d.code} [${d.rule}] ${d.msg}`),
  "",
  ...[...new Set(ds.map(d => d.code))].map(c => `${c}: why, and the fix — ${GUIDE}#${c.toLowerCase()}`),
].join("\n");
const mtime = file => { try { return statSync(file).mtimeMs; } catch { return -1; } };
const isDep = moduleId => new URLSearchParams(moduleId.split("?")[1] ?? "").has(DEP);
// `import __m0 from "./catalog.rx";` → `"./catalog.rx?rx-dep"` (one line each: the module's map is by line, CP-1c)
const tagDeps = code => code.replace(/^(import \w+ from ")(\.{1,2}\/[^"?]*\.rx)(";?)$/gm, `$1$2?${DEP}$3`);

/** A source map (JSON text) for code that now starts `lines` lines later: each line is a `;` in `mappings`. */
const shiftMap = (map, lines) => { const m = JSON.parse(map); m.mappings = ";".repeat(lines) + m.mappings; return JSON.stringify(m); };

const RX_IMPORT = /^import\b[^"']*?\bfrom\s+(["'])(\.{1,2}\/[^"'?]*\.rx)\1/gm;
/** The `.rx` files under `root` from which `file` is reached by imports: first those no other `.rx` file imports. */
function entriesOf(file, root) {
  const importers = new Map();
  const walk = dir => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".rx")) for (const [, , spec] of readFileSync(p, "utf8").matchAll(RX_IMPORT)) {
        const dep = path.resolve(path.dirname(p), spec);
        importers.set(dep, [...(importers.get(dep) ?? []), p]);
      }
    }
  };
  walk(root);
  const seen = new Set([file]);
  for (const f of seen) for (const i of importers.get(f) ?? []) seen.add(i);
  seen.delete(file);
  const top = f => !importers.has(f);
  return [...seen].sort().sort((a, b) => top(b) - top(a));
}

/** Dev: the lines a program's entry starts with when the project has `@reactivescript/map` — its map, registered for the
 *  devtools — or "" when it does not. `buildGraph` is the project's copy, as the browser takes `./live` from it. */
function liveMap(entry, root) {
  let req;
  try { req = createRequire(path.join(root, "package.json")); req.resolve("@reactivescript/map/live"); } catch { return ""; }
  const { buildGraph } = req("@reactivescript/map/graph");
  const graph = buildGraph(JSON.parse(model([entry], root)), { root });
  return `import { register as __rxMap } from "@reactivescript/map/live";\n__rxMap(${JSON.stringify(graph)});\n`;
}

/** @returns {import("@solidjs/vite-plugin").Frontend} */
export default function rx() {
  const builds = new Map();   // entry\0target\0moduleName\0spa\0dev → { entry, target, moduleName, spa, dev, out, stamps }
  const fresh = b => [...b.stamps].every(([f, t]) => mtime(f) === t);
  /** `dev`: the project root, for a dev build (keys relative to it); null otherwise. */
  function build(entry, target, moduleName, spa, dev = null) {
    const key = `${entry}\0${target}\0${moduleName}\0${spa}\0${dev ?? ""}`;
    const prior = builds.get(key);
    if (prior && fresh(prior)) return prior;
    const out = JSON.parse(dev === null ? app(entry, target, moduleName, spa) : app(entry, target, moduleName, spa, true, dev));
    if (out.modules) out.modules = Object.fromEntries(Object.entries(out.modules).map(([p, m]) => [path.resolve(p), m]));
    const files = out.modules ? Object.keys(out.modules) : out.diagnostics ? [...new Set([entry, ...out.diagnostics.map(d => d.file)])] : [entry];
    const b = { entry, target, moduleName, spa, dev, out, stamps: new Map(files.map(f => [f, mtime(f)])) };
    builds.set(key, b);
    return b;
  }
  const built = (file, target, moduleName, spa, dev) =>
    [...builds.values()].filter(b => b.target === target && b.moduleName === moduleName && b.spa === spa && b.dev === dev && b.out.modules?.[file]);
  /** A dependency: from a build of a program that has it, rebuilt if that program changed. */
  function containing(file, target, moduleName, spa, root, dev) {
    const has = built(file, target, moduleName, spa, dev);
    const b = has.find(fresh) ?? has[0];
    if (b) return build(b.entry, target, moduleName, spa, dev);
    // the entry's compile was skipped (Vitest's `fsModuleCache` served it), so find the program from the files
    let failed;
    for (const entry of entriesOf(file, root)) {
      const found = build(entry, target, moduleName, spa, dev);
      if (found.out.modules?.[file]) return found;
      if (!failed && found.out.diagnostics) failed = found;   // the program holds it but does not compile: report why
    }
    if (failed) return failed;
    throw new Error(`${file} is imported as an .rx dependency, but no program under ${root} contains it`);
  }
  return {
    compile(_source, { id, moduleId, root, solid, addWatchFile }) {
      const file = path.resolve(id);
      const target = solid.generate === "ssr" ? "ssr" : solid.generate === "universal" ? "universal" : "dom";
      const moduleName = solid.moduleName ?? "@solidjs/web";
      // 08 CN-3d: a client-only build (no SSR, nothing hydrates) has nothing to show on a first load nothing holds
      const spa = target === "dom" && solid.hydratable === false;
      const dep = isDep(moduleId);
      const base = path.resolve(root ?? process.cwd());
      const dev = solid.dev === true && target === "dom" ? base : null;
      const { out } = dep ? containing(file, target, moduleName, spa, base, dev) : build(file, target, moduleName, spa, dev);
      if (out.diagnostics) throw new Error(report(out.diagnostics));
      if (out.error) throw new Error(out.error);
      const m = out.modules[file];
      for (const p of Object.keys(out.modules)) if (p !== file) addWatchFile(p);
      // dev: a program's entry registers its map, when the project has @reactivescript/map; the lines go first, and the
      // module's map is shifted by them
      const live = dev !== null && !dep ? liveMap(file, base) : "";
      const map = live && m.map ? shiftMap(m.map, live.split("\n").length - 1) : m.map;
      // CSS-4: each module links its own stylesheet, so a module several programs share links it once
      return { code: live + tagDeps(m.code), map, css: m.css ?? "" };
    },
  };
}

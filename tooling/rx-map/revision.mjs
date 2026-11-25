// The builds a dev server loaded, against the packages on disk now. A rebuilt compiler or runtime under a running dev
// server leaves it serving the old build (stale stamps, a disconnected page) until it restarts.
import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGES = ["@reactivescript/compiler", "@reactivescript/runtime", "@reactivescript/map"];
const own = dirname(fileURLToPath(import.meta.url));

/** A package's build: its version, and its newest built file (top-level code, native addons, `dist/`). */
function buildOf(dir) {
  let version, newest = 0;
  try { version = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).version; } catch {}
  const look = (d, deep) => {
    let entries;
    try { entries = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = join(d, e.name);
      if (e.isDirectory()) { if (deep || e.name === "dist") look(p, true); continue; }
      if (!/\.(?:node|mjs|js|cjs|json)$/.test(e.name)) continue;
      try { newest = Math.max(newest, statSync(p).mtimeMs); } catch {}
    }
  };
  look(dir, false);
  return { version, built: newest };
}

/** The packages as the project resolves them (the map: this copy), each with its build. */
export function captureRevisions(root) {
  const require = createRequire(join(root, "package.json"));
  const out = [];
  for (const name of PACKAGES) {
    let dir;
    if (name === "@reactivescript/map") dir = own;
    else try { dir = dirname(require.resolve(`${name}/package.json`)); } catch { continue; }
    try { dir = realpathSync(dir); } catch {}
    out.push({ name, dir, ...buildOf(dir) });
  }
  return out;
}

const when = ms => new Date(ms).toISOString().replace("T", " ").replace(/\.\d+Z$/, "Z");
/** One `STALE:` line for each package rebuilt (or re-versioned) since `loaded` was captured. */
export function staleBanner(loaded) {
  return loaded.flatMap(p => {
    const now = buildOf(p.dir);
    if (now.built === p.built && now.version === p.version) return [];
    const v = now.version !== p.version ? ` (${p.version} → ${now.version})` : "";
    return [`STALE: the dev server loaded ${p.name} built ${p.built ? when(p.built) : "(unknown)"}; the package on disk was rebuilt ${now.built ? when(now.built) : "(missing)"}${v} — restart the dev server`];
  }).join("\n");
}

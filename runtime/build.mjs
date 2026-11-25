// The runtime's source is the reference's (ref/compile/rt-web.ts and rt-server.ts, spec/11 CP-4a), so the package
// runs what the scenarios run: each is transpiled to dist/ as it is (Solid stays external, a peer of the app's), with
// its declarations.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { build } from "esbuild";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(here, "../ref/compile");
const dist = path.join(here, "dist");
// Build away from the live exports. A linked dev host must never resolve a
// half-written module or find dist missing while the compiler is running.
const staging = mkdtempSync(path.join(here, ".dist-build-"));
const config = path.join(staging, "tsconfig.json");
try {
for (const [from, to] of [["rt-web.ts", "web"], ["rt-server.ts", "server"]]) for (const dev of [false, true]) {
  await build({ entryPoints: [path.join(src, from)], outfile: path.join(staging, `${to}${dev ? ".dev" : ""}.js`), format: "esm", platform: "neutral", target: "es2022", bundle: true, packages: "external", logLevel: "warning", minifySyntax: true,
    plugins: [{ name: "rx-runtime-tier", setup(build) {
      build.onLoad({ filter: /rt-(web|server)\.ts$/ }, ({ path }) => ({
        loader: "ts", contents: readFileSync(path, "utf8")
          .replace(/^const RX_(?:INSTRUMENT|HARNESS) = .*;\n/gm, "")
          .replace(/\bRX_INSTRUMENT\b/g, dev ? "!!DEV" : "false")
          .replace(/\bRX_HARNESS\b/g, String(dev)),
      }));
    } }],
  });
}
// declarations, unchecked: the runtime uses Solid internals its types leave out (createErrorBoundary, sharedConfig,
// runInServerComponentScope); Solid's types resolve from this package's node_modules
const tsc = createRequire(import.meta.url).resolve("typescript/bin/tsc");
writeFileSync(config, JSON.stringify({
  compilerOptions: { declaration: true, emitDeclarationOnly: true, outDir: "types", rootDir: src, module: "nodenext", moduleResolution: "nodenext", target: "es2022", skipLibCheck: true, allowImportingTsExtensions: true, noCheck: true, paths: { "*": ["../node_modules/*"] } },
  files: [path.join(src, "rt-web.ts"), path.join(src, "rt-server.ts")],
}));
execFileSync(process.execPath, [tsc, "-p", config], { stdio: "inherit", cwd: here });
for (const [from, to] of [["rt-web", "web"], ["rt-server", "server"]]) writeFileSync(path.join(staging, `${to}.d.ts`), `export * from "./types/${from}.js";\n`);
const publish = (from, to) => {
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name), dst = path.join(to, entry.name);
    if (entry.isDirectory()) publish(src, dst);
    else renameSync(src, dst);
  }
};
publish(staging, dist);
} finally { rmSync(staging, { recursive: true, force: true }); }

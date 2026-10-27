// Packs the extension into dist/: the client, the language server (tooling/rx-language-server) with its dependencies
// bundled, and the crate's WebAssembly build as rxc.wasm, which the server loads in process: one .vsix for every
// platform. TypeScript is not bundled; the server loads the workspace's, or the one VS Code ships (client.js).
//   node build.js        needs `npm install` here and in ../rx-language-server, and
//                        `cargo build --lib --release --target wasm32-unknown-unknown` in ../../compiler
const esbuild = require("esbuild");
const fs = require("node:fs");
const path = require("node:path");

const wasm = process.env.RX_WASM || path.resolve(__dirname, "../../compiler/target/wasm32-unknown-unknown/release/reactivescript.wasm");
if (!fs.existsSync(wasm)) {
  console.error(`no ${wasm}: cargo build --lib --release --target wasm32-unknown-unknown --manifest-path compiler/Cargo.toml`);
  process.exit(1);
}
fs.rmSync(path.join(__dirname, "dist"), { recursive: true, force: true });
const common = { bundle: true, platform: "node", format: "cjs", target: "node18", minify: true, sourcemap: false, logLevel: "warning" };
Promise.all([
  esbuild.build({ ...common, entryPoints: [path.join(__dirname, "client.js")], outfile: "dist/client.js", external: ["vscode"] }),
  esbuild.build({ ...common, entryPoints: [path.resolve(__dirname, "../rx-language-server/bin/server.js")], outfile: "dist/server.js", external: ["typescript"] }),
]).then(() => {
  fs.copyFileSync(wasm, path.join(__dirname, "dist/rxc.wasm"));
  for (const f of fs.readdirSync("dist")) console.log(`dist/${f}  ${(fs.statSync(path.join("dist", f)).size / 1024).toFixed(0)} KB`);
}, () => process.exit(1));

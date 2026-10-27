// Puts the crate's WebAssembly build in the package (src/rxc.wasm, where src/rxc.js looks first), before `npm pack` or
// `npm publish`: $RX_WASM, else the repository's build
// (`cargo build --lib --release --target wasm32-unknown-unknown --manifest-path compiler/Cargo.toml`).
const fs = require("node:fs");
const path = require("node:path");

const from = process.env.RX_WASM || path.resolve(__dirname, "../../../compiler/target/wasm32-unknown-unknown/release/reactivescript.wasm");
if (!fs.existsSync(from)) {
  console.error(`no ${from}: cargo build --lib --release --target wasm32-unknown-unknown --manifest-path compiler/Cargo.toml`);
  process.exit(1);
}
fs.copyFileSync(from, path.join(__dirname, "../src/rxc.wasm"));

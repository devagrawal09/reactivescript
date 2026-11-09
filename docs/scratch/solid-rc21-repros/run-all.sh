#!/usr/bin/env bash
# Runs every repro against the built solid-next 2105ffb8 (rc.21) packages, prod and dev builds,
# and records stdout+stderr and the exit code in out/<name>.<build>.txt. Needs Node 24 on PATH
# (here: nix shell nixpkgs#nodejs_24 -c bash run-all.sh).
cd "$(dirname "$0")"
# The repository's pinned Solid checkout (scripts/setup.sh), unless SOLID_PACKAGES is set. Exported, because the
# dev copies of the issue-3 repros below run from out/, where their own relative default would not resolve.
export SOLID_PACKAGES=${SOLID_PACKAGES:-$(cd ../../.. && pwd)/solid-next/packages/}
PKG=$SOLID_PACKAGES
mkdir -p out
node --version > out/node-version.txt
for f in 1-take-held 2a-plain-store-hole 2b-optimistic-has-get 2c-optimistic-lasting-hole 4a-effect-undefined 4b-error-object-as-value 4b-seed629 4d-error-object-as-prev 4c-latest-undefined; do
  node $f.mjs > out/$f.prod.txt 2>&1; echo "[exit code $?]" >> out/$f.prod.txt
  SOLID_JS=${PKG}solid/dist/solid.dev.js node --conditions=development $f.mjs > out/$f.dev.txt 2>&1; echo "[exit code $?]" >> out/$f.dev.txt
done
for f in 3-universal-shared-node 3b-bulk-removal-arm; do
  node --conditions=browser $f.mjs > out/$f.prod.txt 2>&1; echo "[exit code $?]" >> out/$f.prod.txt
  sed "s#solid/dist/solid.js#solid/dist/solid.dev.js#; s#universal/dist/universal.js#universal/dist/universal.dev.js#" $f.mjs > out/.$f.dev.mjs
  node --conditions=browser --conditions=development out/.$f.dev.mjs > out/$f.dev.txt 2>&1; echo "[exit code $?]" >> out/$f.dev.txt
  rm -f out/.$f.dev.mjs
done
node --conditions=browser 3-dom-comparison.mjs > out/3-dom-comparison.prod.txt 2>&1; echo "[exit code $?]" >> out/3-dom-comparison.prod.txt

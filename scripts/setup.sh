#!/bin/sh
# Sets up the pinned layout the gates run in, from the repository root. Idempotent: a checkout already at its pin is
# left alone, and Solid is rebuilt only when its checkout moved or a build output is missing.
#
#   reactivescript/  ryansolid/reactivescript at frontend/pins.json's commit, ref/ installed with npm ci
#   solid-next/      solidjs/solid at that commit's ref/SOLID_NEXT, built as reactivescript's ref/scripts/solid-next.sh
#                    builds it (signals, solid, web and universal: build, then types if present; the native compiler)
#   frontend/        upstream -> ../reactivescript (symlink, created here; gitignored), then npm ci (its Solid
#                    packages are file:../solid-next/packages/*)
#   rust-solid/      cargo build
#
# Both checkouts are gitignored and must stay clean: the frontend gate's pins check (frontend/scripts/verify-pinned.sh)
# resolves frontend/upstream -> ../reactivescript and ../solid-next beside it, and requires both clean at the pins.
#
#   nix shell nixpkgs#nodejs_24 -c sh scripts/setup.sh           set up (needs git, Node 24 with npm, and Rust)
#   nix shell nixpkgs#nodejs_24 -c sh scripts/setup.sh --check   change nothing; report whether the layout is ready
#   SETUP_REBUILD=1 sh scripts/setup.sh                           rebuild Solid even if its outputs exist
set -eu
ROOT=$(cd "$(dirname "$0")/.." && pwd)
RX_REPO=https://github.com/ryansolid/reactivescript
RX_COMMIT=fdbcad921c6bc1cae59cbebe9905eeabc480e88f
SOLID_REPO=https://github.com/solidjs/solid
SOLID_COMMIT=2105ffb8ca2fced55f5fac0763177fc93f97c2c2
PNPM="npx -y pnpm@11.1.1"   # solid-next's packageManager at the pin
RX=$ROOT/reactivescript
SOLID=$ROOT/solid-next
CHECK=0
for a in "$@"; do case $a in --check) CHECK=1;; *) echo "unknown option $a"; exit 2;; esac; done

say() { printf '== %s\n' "$*"; }
fail() { printf 'setup: %s\n' "$*" >&2; exit 1; }

# The pins here must be the frontend's pins.
pin() { node -e "process.stdout.write(require('$ROOT/frontend/pins.json')$1)"; }
[ "$(pin .reactivescript.commit)" = "$RX_COMMIT" ] || fail "frontend/pins.json's reactivescript commit is not $RX_COMMIT"
[ "$(pin .solid.commit)" = "$SOLID_COMMIT" ] || fail "frontend/pins.json's Solid commit is not $SOLID_COMMIT"

# checkout DIR URL COMMIT: clone DIR if it is absent and put it at COMMIT (detached). Prints "moved" when HEAD changed.
# A checkout with local changes is never moved.
checkout() {
  dir=$1; url=$2; commit=$3; fresh=0
  if [ ! -e "$dir" ]; then git clone -q --no-checkout "$url" "$dir" >&2; fresh=1; fi
  [ -e "$dir/.git" ] || fail "$dir exists but is not a git checkout"
  if [ $fresh = 0 ]; then
    [ "$(git -C "$dir" rev-parse HEAD)" = "$commit" ] && return 0
    [ -z "$(git -C "$dir" status --porcelain --untracked-files=normal)" ] || fail "$dir has local changes; not moving it to $commit"
  fi
  git -C "$dir" cat-file -e "$commit^{commit}" 2>/dev/null || git -C "$dir" fetch -q origin "$commit" >&2
  git -C "$dir" checkout -q --detach "$commit" >&2
  echo moved
}

# What ref/ links and the frontend imports: each package's dist entry, and the native compiler.
SOLID_OUTPUTS="packages/signals/dist/prod/index.js packages/solid/dist/solid.js packages/web/dist/web.js
  packages/universal/dist/universal.js packages/compiler/compiler.node"
solid_built() { for f in $SOLID_OUTPUTS; do [ -e "$SOLID/$f" ] || return 1; done; }

if [ $CHECK = 1 ]; then
  ok=0
  for c in "$RX $RX_COMMIT" "$SOLID $SOLID_COMMIT"; do
    set -- $c
    if [ ! -e "$1/.git" ]; then echo "missing: $1"; ok=1; continue; fi
    head=$(git -C "$1" rev-parse HEAD)
    [ "$head" = "$2" ] || { echo "$1 is at $head, not $2"; ok=1; }
    [ -z "$(git -C "$1" status --porcelain --untracked-files=normal)" ] || { echo "$1 is not clean"; ok=1; }
  done
  [ -L "$ROOT/frontend/upstream" ] || { echo "frontend/upstream is not a symlink to ../reactivescript"; ok=1; }
  solid_built || { echo "solid-next is not built"; ok=1; }
  [ -d "$RX/ref/node_modules" ] || { echo "reactivescript/ref has no node_modules"; ok=1; }
  [ -d "$ROOT/frontend/node_modules" ] || { echo "frontend has no node_modules"; ok=1; }
  [ $ok = 0 ] && echo "layout ready" || echo "layout not ready: run sh scripts/setup.sh"
  exit $ok
fi

# frontend/upstream -> ../reactivescript, which the frontend's "#rx/*" imports (package.json), its type check and
# frontend/scripts/verify-pinned.sh resolve reactivescript through. It is not committed (the commit API this repository
# is pushed through rejects symlinks), so it is created here, before npm ci and the gates; it is gitignored.
say "frontend/upstream -> ../reactivescript"
if [ ! -L "$ROOT/frontend/upstream" ]; then
  [ ! -e "$ROOT/frontend/upstream" ] || fail "frontend/upstream exists and is not a symlink"
  ln -s ../reactivescript "$ROOT/frontend/upstream"
fi

say "reactivescript @ $RX_COMMIT"
checkout "$RX" "$RX_REPO" "$RX_COMMIT" > /dev/null
NEXT=$(cat "$RX/ref/SOLID_NEXT")
[ "$NEXT" = "$SOLID_COMMIT" ] || fail "reactivescript's ref/SOLID_NEXT is $NEXT, not $SOLID_COMMIT"

say "solid-next @ $SOLID_COMMIT"
moved=$(checkout "$SOLID" "$SOLID_REPO" "$SOLID_COMMIT")
if [ -n "$moved" ] || [ "${SETUP_REBUILD:-0}" = 1 ] || ! solid_built; then
  # As ref/scripts/solid-next.sh does, with its pnpm pinned.
  (
    cd "$SOLID"
    $PNPM install --frozen-lockfile
    for p in signals solid web universal; do (cd "packages/$p" && $PNPM run build && $PNPM run --if-present types); done
    (cd packages/compiler && $PNPM run build)   # the native Oxc compiler (needs a Rust toolchain)
  )
  solid_built || fail "the Solid build did not produce: $SOLID_OUTPUTS"
else
  echo "already built"
fi

say "reactivescript/ref: npm ci"
(cd "$RX/ref" && npm ci)

say "frontend: npm ci"
(cd "$ROOT/frontend" && npm ci)

say "rust-solid: cargo build"
(cd "$ROOT/rust-solid" && cargo build)

for c in "$RX $RX_COMMIT" "$SOLID $SOLID_COMMIT"; do
  set -- $c
  [ -z "$(git -C "$1" status --porcelain --untracked-files=normal)" ] || fail "$1 is not clean after setup; the pins check will fail"
done

cat <<'EOF'

Setup done. The gates (README.md, "Gates"):
  cd frontend && npm run verify:subset            # PASS 106/106 (default RUST_SOLID=../rust-solid)
  cd rust-solid && cargo test                     # 132 passed
  cd rust-solid && cargo fmt --all -- --check && cargo clippy --all-targets -- -D warnings
  cd rust-solid && cargo run -q --bin scenario -- crates/runtime/tests/fixtures/tracker.plan.json crates/runtime/tests/fixtures/tracker.scenario.json
  cd rust-solid && cargo run -q --bin scenario -- crates/runtime/tests/fixtures/like.plan.json crates/runtime/tests/fixtures/like.scenario.json
  cd rust-solid && node fuzz/run.mjs --slice1 --seeds 1000 --start 1 --out out/slice1   # also --slice2a/--slice2b/--slice2c/--render/--strings
Prefix node and npm commands with `nix shell nixpkgs#nodejs_24 -c` in the Tembo sandbox.
EOF

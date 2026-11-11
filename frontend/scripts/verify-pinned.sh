#!/bin/sh
# --subset checks the kept frontends and fixed fuzz run. The full check also gates on upstream exits.
set -u
HERE=$(cd "$(dirname "$0")/.." && pwd)
RX=$(cd "$HERE/upstream" && pwd -P)
SOLID=$(cd "$RX/../solid-next" && pwd -P)
OUT=${OUT:-$HERE/.out/verify}
mkdir -p "$OUT"; OUT=$(cd "$OUT" && pwd)
SUBSET=0; RUST=0; CANARY=0
for a in "$@"; do case $a in --subset) SUBSET=1;; --rust) RUST=1;; --canary) CANARY=1;; *) echo "unknown option $a"; exit 2;; esac; done
: > "$OUT/exits.txt"
record() { echo "$1 $2" | tee -a "$OUT/exits.txt"; }
pin() { node -e "process.stdout.write(require('$HERE/pins.json')$1)"; }
export RUSTUP_TOOLCHAIN=$(pin .toolchain.rust)
[ $CANARY = 0 ] || export RX_CANARY=1
pins=0
HEAD=$(git -C "$RX" rev-parse HEAD); SOLID_HEAD=$(git -C "$SOLID" rev-parse HEAD); NEXT=$(cat "$RX/ref/SOLID_NEXT")
[ -z "$(git -C "$RX" status --porcelain --untracked-files=normal)" ] || { echo "upstream must be clean"; pins=1; }
[ -z "$(git -C "$SOLID" status --porcelain --untracked-files=normal)" ] || { echo "Solid must be clean"; pins=1; }
[ "$SOLID_HEAD" = "$NEXT" ] || pins=1
if [ $CANARY = 0 ]; then
  [ "$HEAD" = "$(pin .reactivescript.commit)" ] || pins=1
  [ "$SOLID_HEAD" = "$(pin .solid.commit)" ] || pins=1
fi
printf 'reactivescript %s\nSolid %s\n' "$HEAD" "$SOLID_HEAD" | tee "$OUT/pins.txt"
record pins $pins
cd "$HERE"
# The plan tests run Rust Solid's scenario binary (plan v1 for like, plan v2 for the tracker, picked by the plan's
# version) from the sibling rust-solid folder (the repository's rust-solid/), or from RUST_SOLID; a missing build fails
# the suite.
RUST_SOLID=${RUST_SOLID:-$HERE/../rust-solid}
(cd "$RUST_SOLID" && cargo build -q --bin scenario --bin plan-trace --bin ssr --bin frames-server) > "$OUT/rust-solid-build.log" 2>&1; record rust-solid-build $?
export RUST_SCENARIO=$RUST_SOLID/target/debug/scenario
# The plan fuzz's Rust leg (plan/plan-fuzz.test.ts and the plan-fuzz step below): rust-solid's plan-trace.
export RUST_PLAN_TRACE=$RUST_SOLID/target/debug/plan-trace
# Slice 5 (docs/RESULTS.md, "Slice 5: server rendering"): rust's server renderer, for ssr/ssr.test.ts and the SSR fuzz.
export RUST_SSR=$RUST_SOLID/target/debug/ssr
# Slice 6 (docs/RESULTS.md, "Slice 6: inferred server components"): rust's frames server (R), for
# slices/tracker-frames.test.ts and the placement fuzz; baselines/subset-tests.json lists the R test, so a run without
# it fails.
export RUST_FRAMES=$RUST_SOLID/target/debug/frames-server
# The gate requires a plan v2 consumer. RUST_PLAN_V2=1 makes plan/plan.test.ts register the tracker's Rust leg, which
# baselines/subset-tests.json lists, so a run that does not run it, or whose binary refuses v2, fails
# (plan/docs/PLAN-V2.md, Gate).
export RUST_PLAN_V2=1
node --experimental-strip-types scripts/check-types.ts --out "$OUT"; record types $?
node --experimental-strip-types --conditions=browser --conditions=development --test \
  --test-reporter=spec --test-reporter-destination="$OUT/suite.spec.txt" \
  --test-reporter=./scripts/jsonl-reporter.mjs --test-reporter-destination="$OUT/suite.jsonl" tsx/*.test.ts yield/*.test.ts slices/*.test.ts plan/*.test.ts eval/*.test.ts ssr/*.test.ts
record suite $?
node --experimental-strip-types --conditions=browser --conditions=development scripts/fuzz.ts --seeds 200 --start 0 --no-reduce > "$OUT/fuzz.log" 2>&1
record fuzz $?
cp .out/fuzz/run-0-200/summary.json "$OUT/fuzz.json"
# The plan fuzz (plan/docs/PLAN-V2.md, "Plan fuzz"): seeds 1..100 on native Solid, compiled RX, solid-plan.ts and Rust's
# plan-trace, full host logs; report.ts checks the summary against baselines/plan-fuzz.json.
node --experimental-strip-types --conditions=browser scripts/plan-fuzz.ts --seeds 100 --start 1 --rust "$RUST_PLAN_TRACE" --out "$OUT/plan-fuzz/" > "$OUT/plan-fuzz.log" 2>&1
record plan-fuzz $?
cp "$OUT/plan-fuzz/summary.json" "$OUT/plan-fuzz.json" 2>/dev/null || echo '{}' > "$OUT/plan-fuzz.json"
# The eval fuzz (docs/EVAL.md, "Eval fuzz"): seeds 1..100, each plan fuzz program split into an enclosing component and
# evaluated code, on the static twin, createEval, the plan and Rust's plan-trace with the host's eval table, full host
# logs; report.ts checks the summary against baselines/eval-fuzz.json.
node --experimental-strip-types --conditions=browser scripts/eval-fuzz.ts --seeds 100 --start 1 --rust "$RUST_PLAN_TRACE" --out "$OUT/eval-fuzz/" > "$OUT/eval-fuzz.log" 2>&1
record eval-fuzz $?
cp "$OUT/eval-fuzz/summary.json" "$OUT/eval-fuzz.json" 2>/dev/null || echo '{}' > "$OUT/eval-fuzz.json"
# Plan v2.1 (plan/docs/PLAN-V2.md, "Plan fuzz v2.1"; docs/EVAL.md, "Async data"): the async plan fuzz and the async eval
# fuzz, seeds 1..100 each. Native Solid (the static twin), compiled RX / createEval, solid-plan.ts and Rust's plan-trace
# (the plan v2.1 consumer) must agree, full host logs; a Rust refusal of the version (rust-unsupported) is never
# agreement and is not in the baselines. report.ts checks the summaries against baselines/plan-fuzz-async.json and
# baselines/eval-fuzz-async.json.
node --experimental-strip-types --conditions=browser scripts/plan-fuzz.ts --async --seeds 100 --start 1 --rust "$RUST_PLAN_TRACE" --out "$OUT/plan-fuzz-async/" > "$OUT/plan-fuzz-async.log" 2>&1
record plan-fuzz-async $?
cp "$OUT/plan-fuzz-async/summary.json" "$OUT/plan-fuzz-async.json" 2>/dev/null || echo '{}' > "$OUT/plan-fuzz-async.json"
node --experimental-strip-types --conditions=browser scripts/eval-fuzz.ts --async --seeds 100 --start 1 --rust "$RUST_PLAN_TRACE" --out "$OUT/eval-fuzz-async/" > "$OUT/eval-fuzz-async.log" 2>&1
record eval-fuzz-async $?
cp "$OUT/eval-fuzz-async/summary.json" "$OUT/eval-fuzz-async.json" 2>/dev/null || echo '{}' > "$OUT/eval-fuzz-async.json"
# The SSR fuzz (docs/RESULTS.md, "Slice 5"): seeds 1..100 of the plan fuzz's generator; Rust's server HTML must be
# Solid's byte for byte, and Chromium must hydrate both (production builds, and the Rust HTML again on the dev builds)
# and replay the recorded scenario. report.ts checks the summary against baselines/ssr-fuzz.json.
node --experimental-strip-types scripts/ssr-fuzz.ts --seeds 100 --start 1 --dev --rust "$RUST_SSR" --out "$OUT/ssr-fuzz/" > "$OUT/ssr-fuzz.log" 2>&1
record ssr-fuzz $?
cp "$OUT/ssr-fuzz/summary.json" "$OUT/ssr-fuzz.json" 2>/dev/null || echo '{}' > "$OUT/ssr-fuzz.json"
# The SSR fuzz v2.1 (docs/RESULTS.md, "Slice 5: async data"): seeds 1..100 of the async generator; Rust's renderToStream
# chunks and event log under Solid's realized server answers, and its renderToString HTML, must be Solid's byte for byte;
# Chromium feeds each stream chunk by chunk, hydrates it (after the shell and after the last chunk; the dev builds after
# the shell), and every Rust run must observe what the run of Solid's own stream observed; each renderToString HTML
# replays the scenario native Solid recorded from mount. report.ts checks the summary against
# baselines/ssr-fuzz-async.json.
node --experimental-strip-types scripts/ssr-fuzz.ts --async --seeds 100 --start 1 --dev --rust "$RUST_SSR" --out "$OUT/ssr-fuzz-async/" > "$OUT/ssr-fuzz-async.log" 2>&1
record ssr-fuzz-async $?
cp "$OUT/ssr-fuzz-async/summary.json" "$OUT/ssr-fuzz-async.json" 2>/dev/null || echo '{}' > "$OUT/ssr-fuzz-async.json"
# The placement fuzz (docs/RESULTS.md, "Slice 6", "Placement fuzz"): seeds 1..100 of frames/fuzz/gen.ts; RX and TSX
# emit one v2.2 plan (or refuse by one code), its placement is the generator's own model's and the oracle split's, and
# the twin (T), the oracle split (N), the plan's split (J) and rust's frames server (R) replay the scenario recorded on
# T. report.ts checks the summary against baselines/frames-fuzz.json.
node --experimental-strip-types scripts/frames-fuzz.ts --seeds 100 --start 1 --jobs 4 --rust "$RUST_FRAMES" --out "$OUT/frames-fuzz/" > "$OUT/frames-fuzz.log" 2>&1
record frames-fuzz $?
cp "$OUT/frames-fuzz/summary.json" "$OUT/frames-fuzz.json" 2>/dev/null || echo '{}' > "$OUT/frames-fuzz.json"
if [ $SUBSET = 0 ]; then
  for s in test oracle compiled types ssr; do
    (cd "$RX/ref" && NODE_PATH="$HERE/node_modules" npm run -s "$s" > "$OUT/upstream-$s.log" 2>&1); record upstream-$s $?
  done
fi
if [ $RUST = 1 ]; then
  for m in check lower project; do
    arg=""; [ "$m" = check ] || arg="--$m"
    (cd "$RX/ref" && npm run -s crate -- $arg > "$OUT/rust-$m.log" 2>&1); record rust-$m $?
  done
  (cd "$RX/compiler" && cargo test --release > "$OUT/rust-test.log" 2>&1); record rust-test $?
fi
node --experimental-strip-types scripts/report.ts --out "$OUT" "$@"

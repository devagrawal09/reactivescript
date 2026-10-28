#!/bin/sh
# Full verification of the pinned stack: pins, strict types, the whole ported suite, browser hydration, and the
# unmodified upstream runners. Results are classified against baselines/known-failures.json by scripts/report.ts.
#   sh scripts/verify-pinned.sh [--skip-upstream] [--rust] [--canary]
# --canary is used by scripts/canary.sh: pins may differ from the checkout (reported, not enforced).
set -u
HERE=$(cd "$(dirname "$0")/.." && pwd)
RX=$(cd "$HERE/upstream" && pwd -P)
SOLID=$(cd "$RX/../solid-next" && pwd -P)
OUT=${OUT:-$HERE/.out/verify-$(date +%Y%m%d-%H%M%S)}
mkdir -p "$OUT"
SKIP_UPSTREAM=0; RUST=0; CANARY=0
for a in "$@"; do case $a in --skip-upstream) SKIP_UPSTREAM=1;; --rust) RUST=1;; --canary) CANARY=1;; *) echo "unknown option $a"; exit 2;; esac; done
[ $CANARY = 1 ] && export RX_CANARY=1
status=0

pin() { node -e "process.stdout.write(require('$HERE/pins.json')$1)"; }
RX_HEAD=$(git -C "$RX" rev-parse HEAD); SOLID_HEAD=$(git -C "$SOLID" rev-parse HEAD); SOLID_NEXT=$(cat "$RX/ref/SOLID_NEXT")
{
  echo "reactivescript $RX_HEAD (pin $(pin .reactivescript.commit))"
  echo "ref/SOLID_NEXT $SOLID_NEXT; solid checkout $SOLID_HEAD (pin $(pin .solid.commit))"
  echo "node $(node --version); rustc $(RUSTUP_TOOLCHAIN=$(pin .toolchain.rust) rustc --version 2>/dev/null)"
  [ -z "$(git -C "$RX" status --porcelain)" ] && echo "upstream checkout clean" || { echo "upstream checkout has local changes:"; git -C "$RX" status --porcelain; }
} | tee "$OUT/pins.txt"
if [ "$SOLID_HEAD" != "$SOLID_NEXT" ]; then echo "MISMATCH: solid checkout is not ref/SOLID_NEXT"; status=1; fi
if [ $CANARY = 0 ]; then
  [ "$RX_HEAD" = "$(pin .reactivescript.commit)" ] || { echo "MISMATCH: reactivescript is not the pinned commit"; status=1; }
  [ "$SOLID_HEAD" = "$(pin .solid.commit)" ] || { echo "MISMATCH: solid is not the pinned commit"; status=1; }
fi

cd "$HERE"
echo "== adapter/type/API: strict types"; node --experimental-strip-types scripts/check-types.ts --out "$OUT" || status=1
echo "== ported suite"
node --experimental-strip-types --conditions=browser --conditions=development --test \
  --test-reporter=spec --test-reporter-destination="$OUT/suite.spec.txt" \
  --test-reporter=./scripts/jsonl-reporter.mjs --test-reporter-destination="$OUT/suite.jsonl" tsx/*.test.ts
tail -8 "$OUT/suite.spec.txt"
echo "== browser (Chromium via Playwright)"
node --experimental-strip-types --test \
  --test-reporter=spec --test-reporter-destination="$OUT/browser.spec.txt" \
  --test-reporter=./scripts/jsonl-reporter.mjs --test-reporter-destination="$OUT/browser.jsonl" tsx/browser.ts
tail -8 "$OUT/browser.spec.txt"

if [ $SKIP_UPSTREAM = 0 ]; then
  echo "== unmodified upstream runners (playwright resolved from this package for ssr)"
  for s in test oracle compiled types ssr; do
    (cd "$RX/ref" && NODE_PATH="$HERE/node_modules" npm run -s $s > "$OUT/upstream-$s.log" 2>&1); echo "upstream $s exit $?"; tail -1 "$OUT/upstream-$s.log"
  done
  if [ $RUST = 1 ]; then
    for m in "" --lower --project; do
      (cd "$RX/ref" && RUSTUP_TOOLCHAIN=$(pin .toolchain.rust) npm run -s crate -- $m > "$OUT/upstream-crate$m.log" 2>&1); echo "upstream crate$m exit $?"; tail -1 "$OUT/upstream-crate$m.log"
    done
  fi
fi

node --experimental-strip-types scripts/report.ts --out "$OUT" --candidate "$OUT/candidate-known-failures.json" > /dev/null || status=1
echo "report: $OUT/REPORT.md"
exit $status

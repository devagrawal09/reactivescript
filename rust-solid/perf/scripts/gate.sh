#!/bin/sh
# Differential gate for rust-solid perf work: cargo test, the plan-diff fixtures, the live fuzzers.
# Usage (from anywhere in reactivescript, Node 24 on PATH): sh rust-solid/perf/scripts/gate.sh OUTDIR [quick]
# quick: 300 seeds per fuzzer instead of 1000.
set -u
OUT=$1; N=1000; [ "${2:-}" = quick ] && N=300

ROOT=$(git rev-parse --show-toplevel); mkdir -p "$OUT"
log() { echo "$(date +%T) $*" | tee -a "$OUT/gate.log"; }
# The last JSON summary in a fuzzer log, in one line: total, agreeing, invalid, the disagreement classes.
summary() { node -e 'const s=require("fs").readFileSync(process.argv[1],"utf8");const i=s.lastIndexOf("\n{");try{const j=JSON.parse(s.slice(i+1));console.log(`${j.agreement}/${j.total} agree, ${j.invalid??0} invalid, classes ${JSON.stringify(j.classes??{})}`)}catch{console.log(s.trim().split("\n").slice(-3).join(" | "))}' "$1"; }
cd "$ROOT/rust-solid"
cargo build -q 2>>"$OUT/build.err" && log "debug build ok" || log "debug build FAILED"
cargo test -q --release 2>&1 | grep -E '^test result' | awk '{p+=$4; f+=$6} END {print "cargo test", p, "passed", f, "failed"}' | tee -a "$OUT/gate.log"
F=crates/runtime/tests/fixtures
for pair in "tracker.plan.json tracker.scenario.json" "like.plan-v2.json like.scenario.json" "tracker-async.plan.json tracker-async.scenario.json"; do
  set -- $pair
  r=$(node --conditions=browser fuzz/plan-diff.mjs $F/$1 $F/$2 2>&1 | tail -1 | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);console.log(`agree ${j.agree}, ${j.entries.rust}/${j.entries.oracle} entries, first difference ${j.firstDifference}`)}catch{console.log(s.trim())}})'); log "plan-diff $1: $r"
done
for mode in slice1 slice2a slice2b slice2c render strings boundaries; do
  extra=""; case $mode in slice2a|slice2c|boundaries) extra=--no-reduce;; esac
  node fuzz/run.mjs --$mode --seeds $N --start 1 $extra --out "$OUT/$mode" > "$OUT/$mode.log" 2>&1
  log "$mode: $(summary "$OUT/$mode.log")"
done
cd "$ROOT/frontend"
for f in "plan-fuzz" "plan-fuzz --async" "eval-fuzz" "eval-fuzz --async"; do
  tag=$(echo "$f" | tr ' ' '_')
  # The mode flag goes after --, or npm takes --async as its own option.
  name=${f%% *}; extra=$(echo "$f" | sed -n 's/^[^ ]* //p')
  RUST_SOLID=$ROOT/rust-solid npm run -s $name -- $extra --seeds $N --start 1 > "$OUT/$tag.log" 2>&1
  log "$f: $(tail -3 "$OUT/$tag.log" | tr '\n' ' ')"
done
log done

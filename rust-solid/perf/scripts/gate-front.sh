# The frontend half of gate.sh (plan and eval fuzzers), for a rerun.
set -u; OUT=$1; N=${2:-1000}; 
ROOT=$(git rev-parse --show-toplevel); mkdir -p "$OUT"
log() { echo "$(date +%T) $*" | tee -a "$OUT/gate.log"; }
cd $ROOT/rust-solid; cargo build -q 2>>"$OUT/build.err" && log "debug build ok"
cd $ROOT/frontend
for f in "plan-fuzz" "plan-fuzz --async" "eval-fuzz" "eval-fuzz --async"; do
  tag=$(echo "$f" | tr ' ' '_'); name=${f%% *}; extra=$(echo "$f" | sed -n 's/^[^ ]* //p')
  RUST_SOLID=$ROOT/rust-solid npm run -s $name -- $extra --seeds $N --start 1 > "$OUT/$tag.log" 2>&1
  log "$f: $(grep -A12 '"total"' "$OUT/$tag.log" | tr -d ' \n' | cut -c1-200)"
done
log done

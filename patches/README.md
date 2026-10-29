# Upstream patch queue

Policy: the clean upstream checkout (`../reactivescript`) stays at the pinned commit, unmodified. A patch is carried
only for a defect reproduced on the pin with handwritten RX (no TSX lowering), narrowly scoped, and not expressible as
adapter work. Each `NNNN-name.patch` has a `NNNN-name.md` record: base SHA, defect, repro, regression test, Rust
counterpart status (a reference-only fix never counts as production compiler coverage), upstream issue (none filed
without approval) and removal condition.

`sh scripts/apply-patches.sh ../reactivescript ../reactivescript-patched` rebuilds the patched tree (a detached
worktree at the same commit plus the queue); `frontend/upstream` points at it. verify-pinned.sh fails unless the
patched tree equals its commit plus exactly the queue, and canary.sh reports a queue that no longer applies as its own
category. Patches are never committed to any upstream checkout and never applied to the original worktree.

Queue at aa85cbde: **0001-server-question-keys** (docs/UPSTREAM-ISSUES.md #1). Legacy prototype patches in
`legacy-f3c6771/` are evidence only (docs/PATCHES.md).

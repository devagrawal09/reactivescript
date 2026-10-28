# Upstream patch queue

Policy: the upstream checkout stays unmodified. A patch is carried only for a defect that is reproduced on the
current pin with a small handwritten RX program (no TSX lowering involved), is narrowly scoped, and cannot be worked
around in this package. Each carried patch is a separate `NNNN-name.patch` file next to a header file
`NNNN-name.md` recording: origin (the base SHA it applies to), reason, the RX repro and the regression test,
any upstream issue link, the Rust counterpart status (a reference-only fix never counts as production compiler
coverage), and the removal condition. Patches are applied only to a disposable checkout by tooling, never committed
into the upstream checkout, and never to the original `/Users/devagr/reactivescript` worktree.

Current queue at reactivescript aa85cbde: **empty**. See ../docs/PATCHES.md for the evaluation of the old
prototype's patches (`legacy-f3c6771/`, kept verbatim as evidence only; they do not apply to the pin).

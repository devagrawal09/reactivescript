# Local v3 preparation

No pushes or GitHub writes. Shared RX pin fdbcad921c6bc1cae59cbebe9905eeabc480e88f; Solid pin 2105ffb8ca2fced55f5fac0763177fc93f97c2c2. Both push URLs remain NO_PUSH. Solid build, ref npm ci, Rust release build and frontend npm ci succeeded. reactivescript-patched is unused and untouched.

## Workspace subset (exit 0): exact output

```text

> verify:subset
> sh scripts/verify-pinned.sh --subset

reactivescript fdbcad921c6bc1cae59cbebe9905eeabc480e88f
Solid 2105ffb8ca2fced55f5fac0763177fc93f97c2c2
pins 0
package diagnostics: 0
upstream strict diagnostics: 12 (baseline 12)
types 0
suite 0
fuzz 0
# Frontend subset

Result: PASS
Tests: 53, pass 53, fail 0
Fuzz: {"ok":179,"divergent: upstream: interpreter vs compiled":21}


Upstream failures are not waived. S-store-8 is documented in docs/UPSTREAM-ISSUES.md.

```

## Workspace full with --rust (exit 1): exact output

```text
reactivescript fdbcad921c6bc1cae59cbebe9905eeabc480e88f
Solid 2105ffb8ca2fced55f5fac0763177fc93f97c2c2
pins 0
package diagnostics: 0
upstream strict diagnostics: 12 (baseline 12)
types 0
suite 0
fuzz 0
upstream-test 1
upstream-oracle 0
upstream-compiled 0
upstream-types 0
upstream-ssr 0
rust-check 0
rust-lower 0
rust-project 0
rust-test 0
# Full pinned check

Result: FAIL
Tests: 53, pass 53, fail 0
Fuzz: {"ok":179,"divergent: upstream: interpreter vs compiled":21}
test: 111 pass, 1 fail
oracle: 112 pass, 0 fail, 0 skip
compiled: 112 pass, 0 fail, 0 skip
types: 152 pass, 0 fail
ssr: 105 pass, 0 fail, 7 skip

- upstream-test exit 1

Upstream failures are not waived. S-store-8 is documented in docs/UPSTREAM-ISSUES.md.

```

## Committed in-tree subset (exit 0): exact output

```text

> verify:subset
> sh scripts/verify-pinned.sh --subset

reactivescript cc1e6e90f3ef2ead92aa2546c02210086cf9f189
Solid 2105ffb8ca2fced55f5fac0763177fc93f97c2c2
pins 0
package diagnostics: 0
upstream strict diagnostics: 12 (baseline 12)
types 0
suite 0
fuzz 0
# Frontend subset

Result: PASS
Tests: 53, pass 53, fail 0
Fuzz: {"ok":179,"divergent: upstream: interpreter vs compiled":21}


Upstream failures are not waived. S-store-8 is documented in docs/UPSTREAM-ISSUES.md.

```

Additional in-tree seeds 0–499: {"ok":454,"divergent: upstream: interpreter vs compiled":46}. The fuzzer process exited 0. These upstream differences do not establish full parity.

Branch: tsx-frontend-demo-v3. One commit: cc1e6e90f3ef2ead92aa2546c02210086cf9f189. Against fdbcad92: 58 files, 9692 added lines, 0 deleted lines; all under tsx-frontend/.

PR draft: scratch/pr21-v3-body.md. Old ignored build outputs preserved at scratch/pr-v2-ignored-leftovers. Canary dry-run succeeded.

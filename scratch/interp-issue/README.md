# Interpreter/action repros

Review draft: `issue.md`. Nothing was posted.

Main repro files: `U1.rx`, `U2.rx`; equivalent native programs: `U1.tsx`, `U2.tsx`.
Exact full-frame results: `frames.json`. Upstream scenario API results: `scenario-results.json`.

```sh
cd /Users/devagr/rx-tsx-refresh/scratch/interp-issue
node --experimental-strip-types --conditions=browser --conditions=development --import ./register.mjs run.mts
node --experimental-strip-types --import ./register.mjs scenario-check.mts
```

`run.mts` imports all RX code from the clean `reactivescript/` checkout, not `reactivescript-patched/`. The scratch-only resolver imports npm packages from the installed canary export (the built Solid checkout, rc.21). The copied string renderer retains initial element properties so the driver can click buttons; native and compiled use the same copy. The native compiler output is saved as `.mts` so Node removes its remaining type annotations. No TSX-frontend compiler or interpreter wrapper is imported.

The supplied main commit was checked against GitHub main: `fdbcad921c6bc1cae59cbebe9905eeabc480e88f`. Clean checkout git status was empty before and after the runs. All generated code and logs are inside this directory; no frontend `.out` was touched.

Upstream suites: `interpreter-suite.log` (111 pass, existing S-store-8 fail) and `compiled-suite.log` (112 pass, zero fail/skip). `compiled-suite.mts` is the upstream compiled runner with source imports and the scenario directory made absolute; its output directory stays in scratch.

Duplicate-check records: `triage.txt`, `pr31-pr32.json.txt`, `pr31.diff`, `pr32.diff`. Any PR-runtime experiment uses a scratch copy of that PR head runtime with the rest of main, not a complete PR checkout; it is supplementary, not a claim that those complete PRs pass or fail.

# Placement fuzz summaries (slice 6)

Copies of the frontend's placement-fuzz summaries (`frontend/scripts/frames-fuzz.ts --rust …/frames-server`, written
to `frontend/.out/frames-fuzz/run-<start>-<seeds>/summary.json`), recorded 2026-11-10/11 at fdbcad92 / Solid rc.21:

- `summary-1-1000.json`: seeds 1..1000;
- `summary-1001-3000.json`: seeds 1001..3000 (held out; the run directory is `run-1001-2000`, start and count);
- `families-*.json`: `frontend/scripts/frames-classify.ts` on each run: the divergent seeds grouped by the suspected
  Solid issue they show (`docs/scratch/solid-rc21-issues.md`, issues 8 to 11, or `unstable`: the twin itself does not
  replay its recording every time), with the replay evidence.

What the fuzz checks, its outcomes and the results are in `frontend/docs/RESULTS.md`, "Slice 6", and `../FRAMES.md`,
"Placement fuzz, the R leg". The gate runs seeds 1..100 against `frontend/baselines/frames-fuzz.json`.

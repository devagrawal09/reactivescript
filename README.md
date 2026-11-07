# Project status dashboard

A local-only, one-page dashboard. Uses Node 24 built-ins; no install needed. Existing `git` and signed-in `gh` are needed to collect repo and GitHub status.

## Start

```sh
cd /Users/devagr/rx-tsx-refresh/dashboard
nohup node server.mjs > server.log 2>&1 &
echo $! > server.pid
```

Open http://127.0.0.1:4173/. If that port is busy, the next free port is used. The actual port is in `server.port`; the PID is in `server.pid`. The server only binds to 127.0.0.1. Logs are in `server.log`.

## Stop

```sh
cd /Users/devagr/rx-tsx-refresh/dashboard
kill "$(cat server.pid)"
```

This stops any gate child processes too.

## Edit the narrative

Edit `notes.json`, keeping valid JSON and the existing keys: `goal`, `milestones`, `slice1`, `agents`, `findings`, `parked`, `decisions`, and `next`. It contains the supplied notes unchanged. The dashboard rereads it every minute. Click **Refresh sources** to see edits sooner; no restart is needed.

## Updates

- Page polls every 30 seconds. Local sources refresh every 60 seconds; GitHub every 5 minutes. Their jobs run separately so a slow GitHub request does not block local updates.
- Every source section has `collectedAt`, `intervalSeconds`, and either data or a clear error. Errors do not stop other sections. Snapshots are written atomically.
- `GET /refresh` refreshes local and GitHub sources, but never starts a gate.
- `node collect.mjs` writes a one-off snapshot without running gates. Do not use it at the same time as the server.
- Header health uses gate results for the current SHAs, the originals check, PR #21 head sync, errors and freshness. Amber means pending work or data older than 3 times its interval; red means a failed check.
- Amber GitHub rows show a latest comment not yet marked seen in this browser, excluding comments by `devagrawal09`. **Mark seen** stores only comment IDs in local browser storage.

## Source safety and gates

Status collection uses only read-only git commands, with optional git locks disabled. GitHub calls use `gh api --method GET`. Nothing is fetched, checked out, stashed or committed in the source repos.

Gates run **in place**, in frontend main and slice1-js HEAD. No copies or worktrees are created. A gate starts only when the target worktree is clean and still at the queued SHA. A dirty tree shows **skipped: worktree dirty**, not failure. Skips are not cached, so a clean tree can run at the same SHA later. If files or HEAD change during a run, that result is also skipped rather than labelled as a valid result for the old SHA.

The verification script supports `OUT`; it is set to `dashboard/cache/gates/<target>/<sha>/verify/`. Its fuzz step also writes the worktree's existing, gitignored `.out/fuzz/` directory. This is the only permitted source-tree output. Temporary files and npm cache are kept inside this dashboard. Source paths must retain their original relative layout.

Each completed SHA is cached in `cache/gates/<target>/<sha>.json`, with output in `.log`. There is at most one gate at a time, with a 10-minute process timeout. Frontend main must already be checked out at main; the dashboard never changes branches.

To retry a cached failed/error result for the same SHA, stop the server, remove only that SHA JSON under `dashboard/cache/gates/`, and restart.

The originals check expects ReactiveScript at `f3c6771962a4c98cf76fe528b367806adb83c89f` with 13 porcelain status entries; Solid Next at `2a0da2fc5c53d97f655b6b713bdbb95c5aec1eb5` and clean; Solid Yield clean.

## Checks

```sh
node --test test.mjs
curl -fsS http://127.0.0.1:4173/status.json
```

Generated snapshots, caches, logs, port and PID files are ignored by git.

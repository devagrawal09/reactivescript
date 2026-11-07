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

## Read-only sources and gates

All dashboard writes stay in this folder. Source git commands are read-only and have optional git locks disabled. GitHub calls use `gh api --method GET` only. Nothing is fetched, checked out, stashed or changed in the source repos.

The gate target is frontend main and, if present, slice1-js HEAD. Each SHA runs once, with at most one gate process at a time and a 10-minute process timeout. Results and output are in `cache/gates/<target>/<sha>.json` and `.log`.

Gate source files and dependencies are copied into `cache/workspaces/`. `npm run verify:subset` runs there with a macOS write sandbox, plus HOME, temporary files and npm cache inside this dashboard. A git wrapper also refuses all commands except the allowed read-only commands. If the sandbox is unavailable, the gate records an error rather than running without protection.

Frontend main must already be checked out at main. Tracked changes block a gate rather than label a result with the wrong SHA. Source changes during copying are also detected. Missing worktrees are skipped.

To retry a cached failed/error result for the same SHA, stop the server, remove only that SHA JSON under `dashboard/cache/gates/`, and restart. Never remove or edit anything in a source repo.

The originals check expects ReactiveScript at `f3c6771962a4c98cf76fe528b367806adb83c89f` with 13 porcelain status entries; Solid Next at `2a0da2fc5c53d97f655b6b713bdbb95c5aec1eb5` and clean; Solid Yield clean.

## Checks

```sh
node --test test.mjs
curl -fsS http://127.0.0.1:4173/status.json
```

Generated snapshots, caches, logs, port and PID files are ignored by git.

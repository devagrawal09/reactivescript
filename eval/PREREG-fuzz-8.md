# Round 8: an async timing fuzzer over the finished apps

Pre-registration, fixed and committed before the fuzzer runs on any agent's app.

## Why

Rounds 2-7 graded apps with hand-written hidden tests. Frontier agents guard the races a careful person would test,
so those tests found few holes in any arm. Ryan (2026-10-30): agents build to the task; a hole nobody thought of is
never found, by the agent or by the grader. .rx's claim is correctness by construction rather than by diligence, so
the grader has to look for holes nobody wrote a test for. No new agent runs: the fuzzer runs on the apps rounds 5-7
already produced.

## The fuzzer (`harness/fuzz.mjs`)

- **Session**: from a seed, 30 random steps on the issue desk, then every request still in the air answered in random
  order. A step is either a user move drawn from what is on screen (select a row, change the user, assign, rename,
  close, row assign, row close, add or remove a label, post a comment, switch the filter, leave for the help page,
  come back) or, with probability 0.5 while requests are in the air, an answer to one of them, chosen at random:
  writes are declined with probability 0.3, reads fail with probability 0.1.
- **Fake server**: keeps the truth (issues, comments, labels) and applies a write when its answer lands.
- **Oracle, every frame** (after each step, once the page settles): on the issues page, each row shows the server's
  title and assignee or the value of a write still in the air; the open list shows no issue the server has closed and
  misses no open issue unless a close of it is in the air; the closed list shows no open issue; the detail shows the
  selected issue, with the server's title or one being written. A page error is a hole.
- **Oracle, at rest** (nothing in the air, at the end): the list shows exactly the server's issues for the filter, in
  order, with the server's titles and assignees; the tab count equals the open rows shown; the selected issue's
  heading, labels and comments match the server.
- **Allowances**, the same for every arm, each from a brief or a ruling:
  - A1 (H-11, ruled desired 2026-10-28): a declined write's value, or a declined close's missing row, may show while
    anything is still in the air.
  - A2 (row actions brief, point 5): with several writes to one field accepted in a busy period, the field may show the
    newest started instead of the one the server took last.
  - A3: the count is checked only at rest, on the issues page, with the open list on screen.
  - A4 (desk brief: a discarded page's requests change nothing): a write made on a page since left may land without
    showing on the new page.
  - A5 (Ryan, 2026-10-28: an input change under a pending action holds): a filter switch or a selection made while
    requests are in the air may keep showing the previous list or detail until nothing is in the air.
- A session stops at its first hole; the result per app is the number of seeds (of 50) that found one, with the first
  hole and the steps that led to it.

Validation before this file: on the chain 4 references (all features), the React reference showed 0 holes in 25 seeds
before a fuzzer fix for repeated request keys; the .rx reference showed 17 of 50, including a page error in our web
runtime (an imperative read of a pending equation, `shown.includes(...)`, while labels load) and accepted closes whose
row reappears while other closes are out. These are reported, not tuned away.

## Apps

Every desk-family run directory from rounds 5-7 that builds: round 5 React, Solid and .rx (labels, related, count;
54), round 5b .rx (18), round 6 Foldkit (18), round 7 chains React and .rx (48). Seeds 1-50, 30 steps, for every app.

## Hypotheses and tests

- **H8a** (primary): React apps have more holes than .rx apps. Per app hole rate (seeds with a hole / 50), React
  (round 5 + round 7, 42 apps) against .rx (round 5, 5b and round 7, 60 apps); one-sided permutation test on the
  means, 100,000 relabellings, seed 5.
- **H8b**: more React apps than .rx apps have at least one hole; Fisher's exact test, one-sided.
- Reported alongside: Solid and Foldkit rates; holes by kind; per round and task; the reverse direction of H8a.

The direction is the claim being tested. A null or reversed result is reported as plainly.

## Limits

- The oracle encodes my reading of the briefs; the allowances can hide a hole that a stricter reading would count.
- Features differ by task (labels only in labels and chain apps, count only in count and chain 2+ apps), so per-app
  rates are compared within the same task family as well as overall.
- Sessions are random, not exhaustive; 50 seeds per app.
- Published as is, whatever the outcome.

## Addendum (before any final run, after a partial first run)

A first run over 59 round 5 apps was stopped and discarded. Two oracle errors it exposed were fixed, both applying to
every arm:

- at rest, the closed list need not gain an issue closed after it loaded (no brief asks for it); it must still hold no
  open issue. This was the only kind of hole found in React apps;
- A5 kept the selection or filter from before the latest click instead of the one before the busy period began.

Replays confirmed two kinds the partial run found in the .rx apps are real and stay counted: switching the filter
back to open shows the closed rows with no `loading open issues` while the open list reloads, and an accepted rename's
title flashes back to the old one until its refresh answers. Results come from a full rerun with the fixed fuzzer.

A second full run was also discarded, because A5 was implemented more narrowly than written: it allowed only the
view from before the first click of a busy period. It now allows any filter or selection the user left during the
busy period, and a held list may keep rows that were on screen when the switch was made (values in a held view are not
checked). This only removes holes, and only from apps that hold views (the .rx and Solid apps). Final results come
from a third run with this fuzzer.

## Addendum 3 (after the final run, before reading per-arm results into anything)

Replaying holes to classify them found two fuzzer faults, both fixed for every arm:

- A2 tracked a write by its request key, so a second identical write asked while the first was in the air (rename
  Bravo, rename Alpha, rename Bravo) kept its first start position: the oracle took Alpha as the newest started and
  flagged a detail showing Bravo. A re-asked write now moves to the newest started. This produced all 5 React
  `detail title` holes (chain 3).
- A page that crashed or hung the browser stopped the whole run for that app (chain4-rx-2 never finished). A crash
  or a session over 120 s is now a hole of its own (`page crash`) and the next seed gets a fresh browser.

Both changes only remove holes or turn a crash into one, so an app with no hole in the final run cannot change.
The 101 apps with at least one hole, and chain4-rx-2, were run again with the fixed fuzzer (same seeds, the
compiler as committed at 1246c76); the results report that run, and the final run's numbers beside it.

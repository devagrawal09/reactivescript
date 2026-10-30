# Round 8 results: async timing fuzzer

Pre-registration: `eval/PREREG-fuzz-8.md` (08228fd; addenda cfb74e7, 1246c76, 210d9f4). The fuzzer
(`harness/fuzz.mjs`) ran 50 seeded sessions of 30 random user moves and backend answers on each of the 138 desk apps
from rounds 5 to 7: React (42), .rx (60), Solid (18), Foldkit (18). A session stops at its first hole. The final run is
in the scratch history. The 101 apps with a hole, plus one app the final run could not finish, were run again after
addendum 3. `runs/` holds every app's result after that rerun. `stats.json` is `harness/fuzz-stats.mjs` and
`classes.json` is `harness/fuzz-classes.mjs` over `runs/`.

## H8a and H8b: not supported, reversed

| | React | .rx | Solid | Foldkit |
| --- | --- | --- | --- | --- |
| Apps | 42 | 60 | 18 | 18 |
| Apps with a hole (H8b) | 18 | 60 | 18 | 3 |
| Mean share of seeds with a hole (H8a) | 0.9% | 19.9% | 10.1% | 0.3% |

In the pre-registered direction (React has more holes) both one-sided tests give p = 1.0. In the other direction
(.rx has more) both give p < 0.0001: a permutation test with 100,000 relabellings, and Fisher's exact test. The final run
before addendum 3 gave React 1.1% (20 of 42 apps with a hole) and .rx 20.0% (59 of 59 apps that finished). Addendum 3
removed 5 React holes and recorded chain4-rx-2's browser crash as a hole of its own.

Seeds with a hole per app (of 50), by round, task and arm:

| | React | .rx | Solid | Foldkit |
| --- | --- | --- | --- | --- |
| r5 count | 0 0 0 0 0 0 | 12 6 6 6 6 6 | 2 2 2 2 2 2 | (r6) 0 0 0 0 0 0 |
| r5 labels | 0 0 1 1 1 1 | 11 11 9 11 11 11 | 8 6 8 8 8 8 | (r6) 1 0 1 0 1 0 |
| r5 related | 0 0 0 0 0 0 | 10 5 5 5 5 5 | 7 5 5 6 5 5 | (r6) 0 0 0 0 0 0 |
| r5b count / labels / related | | 12×6 / 9-11 / 5×6 | | |
| r7 chain 1 | 1 1 0 1 1 1 | 11 11 11 9 9 11 | | |
| r7 chain 2 | 1 1 0 1 1 1 | 11 11 10 13 9 15 | | |
| r7 chain 3 | 1 1 0 0 1 1 | 12 14 12 15 11 16 | | |
| r7 chain 4 | 0 0 0 0 0 0 | 14 15 10 14 18 15 | | |

Within a task the counts are nearly the same for every app. Each round-5 agent changed one feature of a base desk
written by the eval's author, and the fuzzer mostly finds holes in that shared base. The arms differ mainly because
the base desks differ, so this is the same author writing the same desk carefully in React with TanStack Query and in
.rx.

## What the holes are

Every kind of hole was replayed (`harness/replay.mjs`). The classes below follow Ryan's terms (2026-10-30), assigned
after the run:

- **tear**: the screen disagrees with itself or with what the server accepted, and stays that way;
- **flickered reversion**: an accepted change visibly goes back until a refresh answers;
- **silent hold**: a consistent held view with nothing on screen acknowledging it (no `pending?`, `latest` or guess);
- **never settles**: still loading once everything has answered;
- **crash**: a page error.

A long hold that is consistent and settles is not a defect, and the fuzzer does not count it.

| Class | React | .rx | Solid | Foldkit |
| --- | --- | --- | --- | --- |
| crash: a handler reads a value that is absent or failing (R-8) | | 209 | | |
| crash: unhandled rejection | | | 6 | |
| crash: the browser crashes | | 1 | | |
| tear | 18 | 133 | 23 | 3 |
| tear: rows render empty (solid#4440) | | 16 | | |
| flickered reversion | | 127 | 62 | |
| silent hold | | 65 | | |
| never settles (solid#4437) | | 47 | | |

What each one is:

- **React and Foldkit (all tears):** one hole. The add of a label is answered after a later remove. React's guard keeps
  the newest *response*, so it drops the add, and the labels stay wrong until the next load. Foldkit does the same in
  its update. Holds prevent this by construction.
- **.rx crashes, 209 (labels and chain apps only):** the `add label` button sits outside the labels' `loading`
  region and reads `shown.some(…)` from its handler. Before the labels' first answer the read gets no value
  (`snapshot(...).some is not a function`). After a failed load it throws the load's error out of the click. New rule
  R-8 (`spec/04-rows.md`, taken by default, 064513d) makes this a compile error, `UNGUARDED_SNAPSHOT`. On the eval
  apps it fires on exactly these 36 apps and the labels and chain references, and on nothing else.
  `disabled={pending? shown}` plus a `catch` on the read passes the check. With that fix labels-rx-1 drops from 11
  seeds with a hole to 5, and none of the 5 is a page error. But a bare `disabled` outside any region holds the
  detail on the labels' first load, and that breaks the desk's tests. The labels and chain references now put the
  button in its own `loading on(id)` and `errored` region, with `disabled={pending? shown}`, and pass every suite
  (#4425 aside, as before).
- **never settles, 47:** a failed load of the selected issue leaves `loading #n` up for good. The detail's source
  `found(await fetchIssue(selected), selected)` hoists its `await` into a memo, which the optimistic store reads, and
  solid#4437 swallows the error.
- **tear, rows render empty (#4440):** an assignment is answered while its refresh is out, then a close guesses on
  the list. When the refresh lands, rows show as `# ()`. This needs a `Loading` around the list and an effect reading
  `issues.length` (the count). Plain-Solid repro: `solid-empty-rows.spec.tsx`, filed as solidjs/solid#4440. It is also
  chain4-rx-5's `# ()` rows from round 7.
- **tear, the other 133 .rx and 23 Solid (29 distinct sessions):** mostly mixed lists. After a filter switch the
  closed list shows open rows held from before next to closed ones, or an open row goes missing. The replays point
  to the keyed optimistic store merging a held list with a new answer by position. A related case is reduced and
  filed: two closes are out, one is accepted, and its refresh brings the accepted row back (`solid-row-comes-back.spec.tsx`,
  solidjs/solid#4441). The other sessions are not each reduced.
- **flickered reversion:** an accepted rename or assignment made while the list or the detail was loading, or on a
  row that had no guess, shows the old value until the refresh answers. The .rx and Solid desks refresh after a
  write and take the answer from the refresh. The React desks write the write's response into the cache. Also here:
  a row closed by an accepted close coming back (#4441).
- **silent hold, 65 (count task):** the count's effect reads `issues` outside every boundary. Switching the filter
  back to open holds the closed list, consistently, until the open list answers, and nothing on screen says so.
  Ryan: a hold after first paint is a transition, and this is a missing affordance, not a tear. Solid's dev
  attribution already reports it at run time (`SILENT_HOLD`).

Without the classes that are now compile errors (R-8) or filed Solid bugs (#4437, #4440), and without the silent
holds, at most 261 of .rx's 3,000 seeds have a hole (8.7%), against Solid's 10.1% and React's 0.9%. That is an upper
bound on the improvement: a session stops at its first hole, so removing that hole can expose a later one. The
clean measure is to run the same seeds again once the Solid bugs are fixed and the apps compile under R-8.

## Reading

The claim tested was that hand-written async guards leave holes nobody wrote a test for, and that .rx's holds close
them by construction. Against the same author's base desks the fuzzer found the opposite. React with TanStack Query and
hand-written guards had one hole kind, a real one: out-of-order answers, the case holds exist for. .rx inherits Solid's
holds, and those did their job: no .rx hole comes from an answer applied out of order. The .rx holes came from three
other sources:

- **the runtime underneath:** three bugs in Solid's keyed optimistic store (#4437, #4440, #4441), now filed with
  plain-Solid repros;
- **a gap the language now closes:** handler reads of values that may not be there (R-8);
- **the desks' own choices:** refreshing instead of using a write's answer, and an effect outside every boundary.

Foldkit (Elm-style messages, round 6, three tasks) matched React on the same tasks.

## Limits

- The base desks dominate: within a task, every app inherits the same holes, so 138 apps carry far less independent
  evidence than their number suggests.
- The oracle encodes the author's reading of the briefs. Allowances A1-A5 apply to every arm. Addendum 3's fix came
  after the final run, was found by replaying, and was applied to every arm.
- The classes were assigned after the run. Most come from the hole's kind and last step, checked against replays. The
  133 .rx tears are not each reduced.
- Solid ran only round 5 and Foldkit only round 6.
- A session stops at its first hole, so later holes in that session go unseen.

## Files

- `runs/`: one result per app (holes with seed, step, detail and the steps that led to it).
- `stats.json`: H8a, H8b, and the per-arm and per-task tables.
- `classes.json`: holes by class.
- `solid-empty-rows.spec.tsx` (#4440) and `solid-row-comes-back.spec.tsx` (#4441): plain-Solid repros that run in Solid's
  `packages/web/test`.

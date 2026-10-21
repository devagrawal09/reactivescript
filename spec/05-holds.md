# 05 — Holds

**Status: OPEN (2026-10-21).** What the screen does with pending readers.
This document restates Solid 2.0's fundamentals (`RULES-FUNDAMENTALS.md`,
F-1…F-12, `solidjs/solid@next`) over the calculus of 02–04. Each H-rule
cites the F-rule it restates and must agree with it; an open question there
(Q-n) is open here. This document does not rule on Solid's open questions.

---

## The model: two versions of state

The synchronous core (02 §4) has one state `σ`. Holds add a second:

- **Committed `σ`.** What readers show, what apply blocks and snapshots see.
  Always a whole frame (F-1).
- **In-flight `σ′`.** The state an open hold is moving toward. Writes of a
  held instant live here; async answers land here; equations settle against
  it. Only probes read it (R-9).

Membership is per **change**: every write and every flight belongs to the
instant that made it, and a reader that consumes a held change joins it.
Changes merge when one reader consumes two; a merged group commits as one
frame when no reader is pending on it and no flight it opened is still
awaited by a display. (Revised 2026-10-21 after porting Solid S-2 and S-4:
the first draft had one in-flight version that every later instant joined,
which showed `A 0` where Solid shows `A 1` — S-hold-3.)

---

## H — Rules

- **H-1 (The screen is whole).** [F-1] Every frame is `σ` after a commit: a
  value and everything on screen derived from it changed in the same frame.
  The one exception is declared lag (`deferred`, 06): it may lag the screen,
  never lead it.

- **H-2 (A change is held by its pending readers).** [F-2] An instant is a
  change. Its writes and the flights it opens belong to it. After settle, the
  change is **held** iff some reader that consumed it is pending (H-4) or a
  flight it opened is still awaited by a display (a served reader, H-3). A
  held change commits nothing: `σ` is unchanged and the screen keeps its
  frame. When nothing holds it, it commits as one frame — its writes and
  landed answers become `σ`, the structure it mounted attaches, its readers
  show — and then the observe phase runs (apply blocks see the committed
  instant). Instant 0 (mount) can be held; the screen shows nothing until it
  commits. `action { … }` keeps one change open across its awaited work.

- **H-3 (Served, or joined).** [F-2, Solid D-1, D-3, D-4] A reader in change
  `d` that **directly** reads a value held by an open change `c ≠ d` — an
  uncommitted write, or a flight still pending — is *served* `σ`'s value for
  it and shows now; it holds nothing, but `c` stays open while a display is
  still waiting on that flight. An **equation** never serves: it computes on
  `σ′`, and a reader that consumes a value derived from `c`'s held writes, or
  a landed answer of `c`, **joins** `c` — its reveal belongs to `c`'s commit
  and `d` merges into `c`'s group. A reader that consumed `d`'s own fresh
  writes shows at `d`'s commit. A new question on a source already in flight
  supersedes the flight (R-4). So two unrelated changes do not wait for each
  other (S-solid-4: `1:0` beside a stale `detailsA`), while a shared
  derivation makes them one (`sum` variant), and nothing derived from a held
  write ever shows ahead (S-solid-2: `Panel 1` beside `Count 0` is
  impossible).

- **H-4 (Who holds).** [F-3] A reader holds the group it joined iff it is
  pending after its pass, it is still the display (its region is live and it
  will still be a reader after the instant), no armed boundary catches it
  (H-5 — the catch takes precedence over being served), and it is not a lane
  reader (H-7). A reader the instant itself removes holds nothing; a reader
  behind a fallback holds nothing; an effect's compute half, an unread
  equation, a snapshot, or a probe holds nothing. A held reader's pass is
  re-run every instant: it is the display, and serving happens in the pass.

- **H-5 (Armed boundary catches).** [F-4] A `loading` region is **armed**
  until it has shown content, and again after `on`. While armed, pending
  readers under it belong to the boundary, not the hold: the hold does not
  wait for them, and the boundary shows its fallback in their place. The
  fallback belongs to the frame of whatever armed the boundary (the mount, or
  the `on` change) and appears with that frame — possibly never, if that
  frame is itself held until the content is ready.

- **H-6 (Disarmed boundary forwards).** [F-5] Once a `loading` region has
  shown content it is disarmed: pending readers under it are forwarded into
  the instant's hold exactly as if the boundary were not there; the content
  stays on screen. `on` re-arms it: a change to anything `on` reads makes
  its readers leave the hold and the boundary show its fallback with that
  change's frame. The value `on` yields is never compared; children are not
  recreated.

- **H-7 (Lanes).** [F-6] A reader whose equation carries `lane(x)` (R-10)
  renders from `σ′` for `x` and what is derived from it, beside the held
  screen, and never holds the instant. But pending work *inside* the lane —
  an `await` over `latest x`, a derivation of it that is pending — holds the
  lane: the lane's readers keep what they showed and reveal together when
  it lands. A lane hold and the instant's hold are independent on both sides.

- **H-8 (Nothing else reveals early).** [F-7] Content derived from a held
  instant — a derivation, a new mount's content, a boundary's content —
  appears with the commit. Only probes (H-7) and the fallbacks they arm show
  ahead of it.

- **H-9 (Verdicts).** [F-9] A verdict is final only at commit: lane readers
  are settled again after the hold decision, against the committed world, so
  a `pending?` that was `true` during settle reads `false` in the frame that
  commits the answer (found by `ref/`: S-hold-1 instant 3). `pending? x` is `true` iff `x`'s value in `σ` is
  not the final answer to a *new question*: an input changed and the answer
  is not committed, or a landed answer waits in a hold, or in-flight work
  declared `affects x`. A re-ask (`refresh`, polling, a confirming refetch)
  is quiet: `pending? x` stays `false` and the fresh value reveals silently.
  A node with no committed value has no verdict (R-9). Pending is per node —
  per object key for structured values — never store-wide.

- **H-10 (A write is visible at its instant's settle).** [F-10] Between
  `x := v` in an imperative run and the end of that run, nothing sees `v`:
  not `σ`, not `σ′`, not a probe. The instant begins when the run ends
  (W-3); from then `v` is in `σ′` (probes see it) and in `σ` at commit.

- **H-11 (Optimistic).** [F-11] `optimistic x := e`, legal only inside an
  open hold (an `action` body), writes a *guess* into the screen's version
  for `x` — shown now, verdict-inert (`pending? x` unaffected by the guess
  alone), `latest x` unaffected — for as long as that hold is open. When
  `x`'s own source answers: equal confirms silently; different corrects at
  the hold's commit, atomically with the hold's other writes, and
  `pending? x` is `true` while they differ. The hold closing without a commit
  reverts the guess. A newer hold's guess on `x` wins over an older hold's
  late answer. (Full form, targets, lowering: 06-stores.)

- **H-12 (Errors).** [F-12] An error value reaching a reader under `errored`
  sends that region to its fallback, which is then the display (H-4: readers
  behind it hold nothing). Pending is never an error: `errored` does not
  catch it — and it is not an answer either: an `errored` region on its
  fallback stays there while the content under it is pending, and leaves
  only when a value replaces the error (Solid D-39; found by `ref/`:
  S-hold-5 instant 2). An error that escapes every boundary halts the instant and the
  reactive system. Apply-block errors are imperative and ordinary; compute-
  half errors are values (E-12).

---

## What this document inherits without ruling

- Solid Q-7 (`loadingValue` after a shown failure) and the U-table items in
  `OPEN-QUESTIONS.md`. Scenarios that touch them are marked `inherits Q-n`
  and the expected frame is whichever column Solid rules.

## Scenarios

Ports of Solid's `SCENARIOS.md` are `S-solid-n` (same `n`); `S-hold-n` are
this spec's own. Ported so far: S-1, S-2, S-4. Divergences found and fixed
by porting are recorded in the rule they changed.

Scenario actions gain `resolve x v` and `reject x e`, which land the current
flight of equation `x`. Frames list, per instant, the screen and the probe
verdicts a reader of `pending? x` would show.

- `S-hold-1`: first load reaches a boundary; later update is held; `latest`
  on the control, `pending?` on the content (F-2, F-6, F-9).
- `S-hold-2`: shared input, three panels, slowest wins; one `on` boundary
  releases its panel (F-2, F-4, F-5).
- `S-hold-3`: joining — second write during a hold lands in the same `σ′`
  (H-3).
- `S-hold-4`: lane: `await` over `latest x` holds the lane, not the instant
  (H-7).
- `S-hold-5`: `errored` under a hold; error is an answer (H-12).

# 06 — Stores, questions, actions

**Status: OPEN (2026-10-21).** Structured values, sources with a standing
question, drafts, keys, streams, and the imperative forms that tie writes to
async work: `action`, `optimistic`, `refresh`, `affects`. Rules cite Solid's
F-9, F-11 and the derived rules they restate.

---

## ST — Structured values

- **ST-1 (Structured vs atomic is the type).** A source or equation whose
  value is an object or array is structured; there is no separate store
  primitive. Atomic lowers to `createSignal`/`createMemo`, structured to
  `createStore`/`createProjection`.
- **ST-2 (Dependencies are per object identity, per key).** A read of `o.k`
  depends on `(o, k)`; a read of a reactive name depends on its root. Reaching
  `o` through `x` tracks every step. A shared object reached through two
  names notifies readers through either (S-region-3 instant 6).
- **ST-2a (Writes).** `x := v` replaces the root; E-6 per-path equality
  applies (an equal-by-paths value is a no-op and keeps the old identity).
  `x.a.b := v` mutates in place and notifies `(x.a, b)`; readers of `x`
  alone are not notified. Several path writes in one imperative run are one
  change (W-3).
- **ST-2b (Equation results).** A structured equation result is compared per
  path with its previous value (E-6): equal → cut, keep old identity;
  otherwise the root changed. With a key (ST-4) the result is reconciled
  instead.
- **ST-2c (Pending is per key).** [Solid D-30, S-37] A held path write makes
  `pending? x.a` true and leaves `pending? x.b` false; a re-ask of a source
  with a question (ST-5) makes the whole family pending.

## ST-3 — Draft

An equation may write only its own draft, in its own body:

```
selected = draft(pre selected -> {}) { d[id] := true; d[prevId] := false }
```

- **ST-3a.** `draft(e) Block` evaluates `e` (normally `pre x -> seed`),
  binds a copy of it to `d` in the block, runs the block (the only place
  `:=` appears in reactive scope, and only on paths rooted at `d`), and the
  equation's value is `d`. Writes are the delta (O(changes)); identity of
  untouched sub-objects is preserved.
- **ST-3b.** The block is reactive scope for reads: every read is an input.
  It is not imperative scope: no `io` calls, no writes to anything but `d`
  (W-1 applies), no `await` except as an equation input.
- **ST-3c.** A draft never escapes its body: a closure that captures `d` and
  runs later is rejected (O-3). Late answers are `yield` (ST-6), not
  callbacks into a draft.

## ST-4 — Key

- **ST-4a.** `x: T[] key k = e` declares that elements of `x` have identity
  `k`. A new result is **reconciled** by `k`: rows with the same key keep
  their object identity and receive per-key path updates; new keys create,
  missing keys remove. `pending?` and `latest` on an element follow the key.
- **ST-4b.** `for u in x` over a keyed collection uses the key for row
  identity (RG-2a). An unkeyed `for` over records whose values change is a
  diagnostic (`UNSTABLE_LIST_IDENTITY`, bin S).
- **ST-4c.** Solid: `createProjection(fn, seed, { key })`, `<For keyed>`.

## ST-5 — A source with a standing question

- **ST-5a.** `source x = e` (not `:=`) declares a source whose value is the
  equation `e` **until written**: it re-derives when `e`'s inputs change, and
  a write `x := v` overrides it until the next re-derivation. `e` may
  `await`. Solid: `createSignal(fn)`, `createStore(fn, seed)`.
- **ST-5b.** Its question (V-9) is `e`'s inputs. `refresh x` re-asks it
  quietly; `affects x` declares that in-flight work will change it (H-9).
- **ST-5c.** It is the only legal target of `optimistic` (AC-3): a guess
  needs a truth that will confirm or correct it.

## ST-6 — Streams

- **ST-6a.** `yield v` in an equation body is another answer to the same
  question: a quiet update (F-9), each landing its own change. A change to
  an input restarts the body (R-4) and runs its `finally`. `yield` has no
  meaning in imperative scope.
- **ST-6b.** `await` of an async iterable is its latest answer; the loop is
  implied. A keyed structured stream reconciles each answer (ST-4).
- **ST-6c.** Solid: an async-generator memo/projection; `live(fn)`.

---

## AC — Actions and guesses (imperative forms)

- **AC-1 (action).** `action name(params) { … }` declares an `io` function
  whose body is **one change** across its awaited work: every write between
  entry and return belongs to that change and is held until the body returns
  and everything it put in flight has landed (F-2's explicit form).
  `action { … }` inline in a handler is the same for one run. There is no
  escape: a write after an `await` is still the action's (the language has
  the scope, so none of 2.0's generator plumbing — S-9's "fresh write
  escapes" is unwritable). A rejection inside the body ends the change
  without a commit: its writes and guesses revert.
- **AC-2 (Not special).** An action is only a way to tie writes to async
  work; the hold is the thing (H-2). `refresh`, `affects` and probes behave
  the same inside and outside one.
- **AC-3 (optimistic).** `optimistic x := e`, legal only inside an open
  change (an action body) and only on a source with a question (ST-5):
  writes a guess that is the displayed value for `x` from the instant's
  settle, verdict-inert, until the hold commits or `x`'s own answer differs
  (H-11). Equal confirms silently; different corrects at the commit; the
  hold ending without a commit reverts; a newer hold's guess wins over an
  older hold's late answer. Lowers to `createOptimistic`/
  `createOptimisticStore` by usage.
- **AC-4 (refresh).** `refresh x`, in imperative scope anywhere, re-asks
  `x`'s question (ST-5) or re-runs an `await` equation for the same inputs:
  quiet — `pending? x` stays `false`, the fresh value reveals silently. An
  awaited `refresh x` resolves when the re-ask lands.
- **AC-5 (affects).** `affects x`, in imperative scope anywhere, declares
  that work now in flight will change `x`: `pending? x` is `true` until
  that work (the enclosing change, or the next re-ask of `x`) lands.
- **AC-6 (until).** `await until(cond)` in an action holds the change until
  the reactive predicate `cond` settles truthy, reading the authoritative
  view with the action's own guesses carved out (so optimism cannot confirm
  itself). It is a function, not syntax.

---

## Diagnostics this document makes unwritable or static

| code                            | bin | rule                                             |
| ------------------------------- | --- | ------------------------------------------------ |
| `ASYNC_STORE_SETTER`            | U   | ST-3b: a draft block has no `await` statement    |
| `IMMUTABLE_UPDATE_IN_STORE`     | U   | ST-3: a structured equation is a delta over `pre`|
| `UNSTABLE_LIST_IDENTITY`        | S   | ST-4b                                            |
| `ACTION_CALLED_IN_OWNED_SCOPE`  | U   | AC-1: an action is `io` (IO-2)                   |
| `INVALID_REFRESH_TARGET`        | S   | AC-4: not a source with a question / await eq    |
| `INVALID_AFFECTS_TARGET`        | S   | AC-5                                             |
| `OPTIMISTIC_OUTSIDE_HOLD` (new) | U   | AC-3: no open change                             |
| `OPTIMISTIC_NO_QUESTION` (new)  | S   | AC-3 / ST-5c                                     |

## Scenarios

- `S-store-1`: path writes, per-key pending (ST-2, S-37).
- `S-store-2`: draft delta keeps identity (ST-3).
- `S-store-3`: keyed reconcile; rows keep identity across a new result (ST-4).
- `S-store-4`: `source x = e` derived until written; refresh is quiet (ST-5, AC-4).
- `S-store-5`: yield stream, restart on input change (ST-6).
- Solid ports: S-8, S-9 (as the unwritable escape), S-15, S-20, S-26 rows
  4–7, S-32…S-35, S-37.

# S-await-1 — `await` where a view reads it, and `await … catch` as a statement

Rules: R-1, E-11, R-7, R-f-4, AC-1, AC-7, R-f-6.

## Program

```rx
error Declined(reason: string) => `declined: ${reason}`
component Badge(props: { v: string }) {
  <b>{props.v}</b>
}
export default component App() {
  source status := ""
  source more := false
  action place() {
    let r = await fetch("checkout") catch (e) => "none"
    status := `got ${r}`
  }

  errored fallback(e) { <p>error: {e.message}</p> } {
    loading fallback { <p>…</p> } {
      <p>{await fetch("x")} <Badge v={await fetch("y")} /> {more ? await fetch("z") : "-"} {status}</p>
    }
  }
}
```

07 §3: `await` may appear anywhere a view reads. A reader is not an
equation's memo, so each of its awaits is a flight of its own (R-1), asked
only while the conditions that reach it hold (E-11): `fetch("z")` is not
asked until `more` is true.

## Frames

| instant | action                    | frame              |
| ------- | ------------------------- | ------------------ |
| 0       | mount                     | `…`                |
| 1       | resolve "x" "a"           | `…`                |
| 2       | resolve "y" "b"           | `a b -`            |
| 3       | handler `place()`         | `a b -`            |
| 4       | reject "checkout" "no"    | `a b - got none`   |
| 5       | handler `more := true`    | `a b - got none`   |
| 6       | resolve "z" "c"           | `a b c got none`   |

Instant 4: the statement `let r = await fetch("checkout") catch (e) =>
"none"` is AC-1's statement-level await with R-f-4's catch: the rejection
is the statement's value, the body goes on, and the write lands with the
action's end. Instant 5: the reader re-asks with `more` true; the held
`loading` keeps showing the settled frame while `z` is in flight (H-5).

## Variant: a catch arm can rethrow to the `try` around it

```rx
export default component App() {
  source status := ""
  action place() {
    try {
      let r = await fetch("checkout") catch (e) { Error => { throw e } }
      status := `got ${r}`
    } catch (e) {
      status := `failed: ${e.message}`
    }
  }

  <p>{status}</p>
}
```

| instant | action                    | frame          |
| ------- | ------------------------- | -------------- |
| 0       | mount                     | ``             |
| 1       | handler `place()`         | ``             |
| 2       | reject "checkout" "no"    | `failed: no`   |

The prelude's `fetch` fails with `Error`. The arm rethrows it (R-f-4,
AC-7); it leaves the expression catch and the `try` around the statement
catches it.

## Rejected variants

```rx
-- reject: AWAIT_IN_EXPRESSION
export default component App() {
  source status := ""
  action place() {
    try { status := `got ${await fetch("checkout")}` } catch {}
  }
  <p>{status}</p>
}
```

AC-1: a run suspends only at a statement — `await e`, `let v = await e`,
either with a `catch`. An `await` inside an imperative expression is
refused: bind it first (`let r = await fetch("checkout")`).

```rx
-- reject: UNCAUGHT_ACTION_FAILURE
export default component App() {
  source status := ""
  action place() {
    let r = await fetch("checkout") catch (e) { Error => { throw e } }
    status := `got ${r}`
  }
  <p>{status}</p>
}
```

R-f-6: the arm rethrows `Error`, which the body lets out.

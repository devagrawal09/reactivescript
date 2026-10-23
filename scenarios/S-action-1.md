# S-action-1 — try/catch in an action: the catch is still the action's change

Rules: AC-7, AC-1, AC-3, W-6.

## Program

```
source cart = [1, 2]
source status := ""
source orders := 0
action placeOrder() {
  optimistic cart := []
  status := "placing"
  try {
    let receipt = await fetch("checkout")
    cart := []
    orders := orders + 1
    status := `ok ${receipt}`
  } catch (e) {
    status := `failed: ${e.message}`
  } finally {
    orders := n => n + 100
  }
}
<p>{cart.length} items / {status} / {orders}</p>
```

## Frames

| instant | action                      | frame                        |
| ------- | --------------------------- | ---------------------------- |
| 0       | mount                       | `2 items /  / 0`             |
| 1       | handler `placeOrder()`      | `0 items /  / 0`             |
| 2       | reject "checkout" "declined" | `2 items / failed: declined / 100` |

Instant 1: the guess shows now; `status := "placing"` is held with the
action. Instant 2: the rejection is thrown at the `await` and caught
*inside* the body — the catch's writes are the same change, the body then
ends normally (the finally ran too) and one frame commits: the guess
reverts to the truth, `status` and `orders` land. Nothing is reported as
a failed action: the action handled it.

## Variant: uncaught — the body rejects

```
source cart = [1, 2]
source status := ""
action placeOrder() {
  optimistic cart := []
  status := "placing"
  let receipt = await fetch("checkout")
  cart := []
  status := "ok"
}
<p>{cart.length} items / {status}</p>
```

| instant | action                      | frame                  |
| ------- | --------------------------- | ---------------------- |
| 0       | mount                       | `2 items / `           |
| 1       | handler `placeOrder()`      | `0 items / `           |
| 2       | reject "checkout" "declined" | `2 items / placing`   |

AC-1 / DV-2: an uncaught rejection ends the body like a return — the held
plain write `status := "placing"` commits, the guess reverts. `throw`
inside the body is the same rejection.

## Variant: throw caught in a plain handler

```
source status := ""
<p>{status}</p>
```

| instant | action | frame |
| ------- | ------ | ----- |
| 1       | handler `try { throw fail("boom") } catch (e) { status := e.message }` | `boom` |

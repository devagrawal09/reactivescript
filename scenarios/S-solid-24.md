# S-solid-24 — an armed boundary lets a lane reveal immediately; a disarmed one forwards (Solid S-24; D-21, F-5, F-6)

## Program

```
source id := 0
details = await fetch("d:" + latest id)
<div><b>{latest id}</b> {loading fallback { <p>loading</p> } { <p>{details}</p> }}</div>
```

## Frames

| instant | action              | frame          |
| ------- | ------------------- | -------------- |
| 0       | mount               | `0 loading`    |
| 1       | handler `id := 1`   | `1 loading`    |
| 2       | resolve details 1   | `1 1`          |

The first load is the boundary's; the flight does not hold the lane, so the
header reveals now.

## Variant: once the boundary has shown content, the lane holds on `details`

```
source id := 0
details = await fetch("d:" + latest id)
<div><b>{latest id}</b> {loading fallback { <p>loading</p> } { <p>{details}</p> }}</div>
```

| instant | action              | frame          |
| ------- | ------------------- | -------------- |
| 0       | mount               | `0 loading`    |
| 1       | resolve details 0   | `0 0`          |
| 2       | handler `id := 1`   | `0 0`          |
| 3       | resolve details 1   | `1 1`          |

The disarmed boundary forwards, so `details`' pending holds the lane
exactly as with no boundary there: header `1` beside details `0` is the
rejected screen.

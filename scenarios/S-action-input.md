# S-action-input — action arguments survive selection reset

Rules: AC-1, W-4. An action retains the input values from its call, including
arrays and records nested inside an argument.

## Program

```rx
export default component App() {
  source selected := ["a", "b"]
  source packet := { nested: [["c"]] }
  source sent := ""
  action bulk(ids: string[], payload: { nested: string[][] }) {
    await fetch("ready") catch (e) => ""
    sent := ids.join(",") + ":" + (payload.nested[0]?.join(",") ?? "")
  }
  <p>{selected.length}:{sent}</p>
}
```

## Frames

| instant | action | frame |
| --- | --- | --- |
| 0 | mount | `2:` |
| 1 | handler `bulk(selected, packet)` | `2:` |
| 2 | handler `selected := []; packet.nested[0] := []` | `0:` |
| 3 | resolve `"ready"` `"ok"` | `0:a,b:c` |

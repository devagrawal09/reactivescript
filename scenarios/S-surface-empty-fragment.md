# S-surface-empty-fragment — no text from an empty fragment

Rules: 07 §4 (Markup), DV-13.

## Program

```rx
component Empty() {
  <></>
}

export default component App() {
  <>start<Empty/>middle</>
  <p>end<></></p>
}
```

## Frames

| instant | action | frame |
| ------- | ------ | ----- |
| 0 | mount | startmiddleend |

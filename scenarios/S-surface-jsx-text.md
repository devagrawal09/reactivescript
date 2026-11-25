# S-surface-jsx-text — JSX text keeps inline spaces

Rules: 07 §4 (Markup).

## Program

```rx
export default component App(props: { id?: string }) {
  <p><b>x</b><span> · note</span></p>
  <p><b>foo</b> bar </p>
  <p><b>baz</b> <b>qux</b></p>
  <p>
    <b id={props.id}>a</b>
    <b id={props.id}>b</b>
    two

      lines
  </p>
  <p>c</p>
}
```

## Frames

| instant | action | frame |
| ------- | ------ | ----- |
| 0 | mount | x · notefoo bar baz quxabtwo linesc |

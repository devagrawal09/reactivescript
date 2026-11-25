# S-pure-globals — pure JS operations without an import

Rule: SV-7a. Native conversions and selected static members are value calculations.

## Program

```rx
export default component App() {
  data = JSON.parse(JSON.stringify({ a: 2 }))
  copy = Object.fromEntries(Object.entries(data))
  names = Object.keys(copy)
  values = Object.values(copy)
  count = Math.round(Number("2.1")) + Number.parseInt("3")
  text = String(count) + String.fromCharCode(33)
  <p>{Array.isArray(values)}:{names[0]}:{values[0]}:{text}</p>
}
```

## Frames

| instant | action | frame |
| --- | --- | --- |
| 0 | mount | `true:a:2:5!` |

## Rejected

```rx
-- reject: UNBOUND
export default component App() { <p>{Math.random()}</p> }
```

```rx
-- reject: UNBOUND
export default component App() { <p>{Date.now()}</p> }
```

```rx
-- reject: UNBOUND
export default component App() { <p>{Object.assign({}, {})}</p> }
```

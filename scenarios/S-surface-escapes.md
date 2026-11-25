# S-surface-escapes — quoted and template string escapes

Rules: 07 §3 (Expressions).

## Program

```rx
export default component App() {
  a = "a\nb\t\"\\"
  b = '\b\f\r\v\0\'\x41\u0042\u{1F30D}\uD83C\uDF0D'
  c = `c\td\n\`\${escaped}\\${1 + 1}\r`
  d = "join\
ed"
  e = `join\
ed`
  <p>{a.length}:{a.charCodeAt(1)}:{a.charCodeAt(3)}:{a.charCodeAt(4)}:{a.charCodeAt(5)}</p>
  <p>{b.charCodeAt(0)}:{b.charCodeAt(1)}:{b.charCodeAt(2)}:{b.charCodeAt(3)}:{b.charCodeAt(4)}:{b.charCodeAt(5)}:{b.slice(6)}</p>
  <p>{c.charCodeAt(1)}:{c.charCodeAt(3)}:{c.charCodeAt(4)}:{c.slice(5, -1)}:{c.charCodeAt(c.length - 1)}</p>
  <p>{d}:{e}</p>
}
```

## Frames

| instant | action | frame |
| ------- | ------ | ----- |
| 0 | mount | 6:10:9:34:928:12:13:11:0:39:AB🌍🌍9:10:96:${escaped}\2:13joined:joined |

## Rejected variants

```rx
-- reject: PARSE
{"\x0Z"}
```

```rx
-- reject: PARSE
{`\u{110000}`}
```

```rx
-- reject: PARSE
{"\uD800"}
```

```rx
-- reject: PARSE
{"\01"}
```

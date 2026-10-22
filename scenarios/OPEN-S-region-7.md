# S-region-7 — downstream registration is an effect with a cleanup; context carries the target

**OPEN (2026-10-22):** the frames below assume functional writes (proposed
W-6: `x := f` applies `f` to the slot at the instant, so writes to one slot
in one instant compose). Without W-6 two fields mounting in the same
instant lose a registration (last value write wins) and a cleanup's remove
is lost to the re-run's add. Not run until ruled (`OPEN-` prefix).

Rules: RG-7, O-2, O-3, EF.

A form provides its field store; each rendered field registers itself from
an effect and the effect's cleanup unregisters it when the region ends.
Storing a value is not an escape (O-3 is about closures that capture
region-local names); re-registration on change is the effect re-running.

## Program

```
source showEmail := true
source name := ""
source email := ""
component Form(props) {
  source fields := []
  provide fields = fields
  valid = every(fields, f => f.ok)
  <div>{props.children} <p>{len(fields)} {valid ? "valid" : "invalid"}</p></div>
}
component Field(props) {
  ok = props.value != ""
  effect (ok) {
    let row = { ok: $0 }
    use fields := f => [...f, row]
    () => { use fields := f => filter(f, x => x != row) }
  }
  <i>{props.value}</i>
}
<Form>
  <Field value={name} />
  {if showEmail { <Field value={email} /> }}
</Form>
```

## Frames

| instant | action                        | frame             |
| ------- | ----------------------------- | ----------------- |
| 0       | mount                         | `0 valid`         |
| 1       | (effect)                      | `2 invalid`       |
| 2       | handler `name := "a"`         | `a 2 invalid`     |
| 3       | (effect)                      | `a 2 invalid`     |
| 4       | handler `email := "e"`        | `a e 2 invalid`   |
| 5       | (effect)                      | `a e 2 valid`     |
| 6       | handler `showEmail := false`  | `a 2 valid`       |
| 7       | (effect)                      | `a 1 valid`       |
| 8       | handler `showEmail := true`   | `a e 1 valid`     |
| 9       | (effect)                      | `a e 2 invalid`   |

Registration lands one instant after the render that caused it (an
effect's writes begin the next instant, EF-5); the cleanup unregisters when
the email field's region ends (instant 6→7). No `register`/`unregister`
pair to keep in step.

## Rejected variants

```
-- reject: RG-7b
component Field(props) {
  ok = props.value != ""
  <i>{props.value} {len(use fields)}</i>
}
<Field value={"x"} />
```

No provision for `fields` above the field.

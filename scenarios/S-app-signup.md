# S-app-signup — examples/signup.rx

A form: validation as equations, an async username check as a question
with a first paint, `submitted` gating the error display, an action for
the submit, an `errored` region around the result.

## Program

file: ../examples/signup.rx

## Frames

| instant | action | frame |
| ------- | ------ | ----- |
| 0       | mount |`Username Email Password Sign up` |
| 1       | handler `submit()` |`Username required Email not an email Password at least 8 characters Sign up` |
| 2       | handler `username := "ry"` |`Username at least 3 characters Email not an email Password at least 8 characters Sign up` |
| 3       | handler `username := "ryan"` |`Username checking… Email not an email Password at least 8 characters Sign up` |
| 4       | resolve "checkUsername:ryan" true |`Username already taken Email not an email Password at least 8 characters Sign up` |
| 5       | handler `username := "ryansolid"` |`Username checking… already taken Email not an email Password at least 8 characters Sign up` |
| 6       | resolve "checkUsername:ryansolid" false |`Username Email not an email Password at least 8 characters Sign up` |
| 7       | handler `email := "r@x.dev"` |`Username Email Password at least 8 characters Sign up` |
| 8       | handler `password := "hunter2hunter2"` |`Username Email Password Sign up` |
| 9       | handler `submit()` |`Username Email Password Sign up` |
| 10      | resolve "register:ryansolid,r@x.dev,hunter2hunter2" { ok: true, message: "welcome" } |`Username Email Password Sign up welcome` |

Instant 1: a submit with nothing valid shows every error. Instant 5: while
`ryansolid` is being checked, `latest usernameTaken` is the committed
answer for `ryan` — the form keeps "already taken" beside "checking…"
rather than holding (H-7); the app chose display-ahead over a held frame.

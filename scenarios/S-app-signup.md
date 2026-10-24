# S-app-signup — examples/signup.rx

A form: validation as equations, an async username check as a question
with a first paint, `submitted` gating the error display, an action for
the submit, an `errored` region around the result.

## Program

file: ../examples/signup.rx

## Frames

| instant | action | frame |
| ------- | ------ | ----- |
| 0       | mount |`UsernameEmailPasswordSign up` |
| 1       | handler `submit()` |`UsernamerequiredEmailnot an emailPasswordat least 8 charactersSign up` |
| 2       | handler `username := "ry"` |`Usernameat least 3 charactersEmailnot an emailPasswordat least 8 charactersSign up` |
| 3       | handler `username := "ryan"` |`Usernamechecking…Emailnot an emailPasswordat least 8 charactersSign up` |
| 4       | resolve "checkUsername:ryan" true |`Usernamealready takenEmailnot an emailPasswordat least 8 charactersSign up` |
| 5       | handler `username := "ryansolid"` |`Usernamechecking…already takenEmailnot an emailPasswordat least 8 charactersSign up` |
| 6       | resolve "checkUsername:ryansolid" false |`UsernameEmailnot an emailPasswordat least 8 charactersSign up` |
| 7       | handler `email := "r@x.dev"` |`UsernameEmailPasswordat least 8 charactersSign up` |
| 8       | handler `password := "hunter2hunter2"` |`UsernameEmailPasswordSign up` |
| 9       | handler `submit()` |`UsernameEmailPasswordSign up` |
| 10      | resolve "register:ryansolid,r@x.dev,hunter2hunter2" { ok: true, message: "welcome" } |`UsernameEmailPasswordSign upwelcome` |

Instant 1: a submit with nothing valid shows every error. Instant 5: while
`ryansolid` is being checked, `latest usernameTaken` is the committed
answer for `ryan` — the form keeps "already taken" beside "checking…"
rather than holding (H-7); the app chose display-ahead over a held frame.

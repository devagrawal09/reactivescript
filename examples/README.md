# examples — real programs in the 07 surface

Each `.rx` file is an app; `scenarios/S-app-*.md` runs it (`file: ../examples/x.rx`)
through the reference interpreter and the Solid oracle with a scripted
sequence of handler calls and landings.

| file | what it exercises |
| --- | --- |
| `todo.rx` | sources and equations, functional writes (W-6), per-row components, filters, imperative `if`/`return` in an action |
| `users.rx` | a derived source with a first paint (ST-5, R-7), optimistic rename over a structured value plus an optimistic UI flag, a held page change with `latest`, an `on(query)` boundary |
| `signup.rx` | validation as equations, an async question with `latest`/`pending?` display-ahead, context-free components with children, an action with an early return, `errored fallback(e)` |

The prelude for the scenario runners: `import pure { len, str, … } from "./prelude"`,
`import { log } from "./prelude"` (io), and every function imported from
`"./api"` is a flight keyed by its arguments (`resolve "saveUser:1,Anne" …`).

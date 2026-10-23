# examples — real programs in the 07 surface

Each `.rx` file is an app; `scenarios/S-app-*.md` runs it (`file: ../examples/x.rx`)
through the reference interpreter and the Solid oracle with a scripted
sequence of handler calls and landings.

| file | what it exercises |
| --- | --- |
| `todo.rx` | sources and equations, functional writes (W-6), per-row components, filters, imperative `if`/`return` in an action |
| `users.rx` | a derived source with a first paint (ST-5, R-7), optimistic rename over a structured value plus an optimistic UI flag, a held page change with `latest`, an `on(query)` boundary |
| `cart.rx` | written cold by a fresh agent from the spec alone (the AI-readability test): an optimistic checkout with `affects` for the spinner, a coupon question shown ahead with `latest`, functional root writes over a structured question source |
| `signup.rx` | validation as equations, an async question with `latest`/`pending?` display-ahead, context-free components with children, an action with an early return, `errored fallback(e)` |

The prelude for the scenario runners: `import pure { len, str, … } from "./prelude"`,
`import { log } from "./prelude"` (io), and every function imported from
`"./api"` is a flight keyed by its name and its arguments formatted as the
frames format values — strings bare, objects and arrays as JSON
(`resolve "saveUser:1,Anne" …`, `resolve "checkout:[{"id":1,"qty":2}],SAVE10" …`).
A key is one flight for the program's lifetime: calling the same function
with the same arguments again lands the old answer at once (a "retry" in a
scenario must differ in its arguments).

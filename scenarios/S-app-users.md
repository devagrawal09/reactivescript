# S-app-users — examples/users.rx

An async table: a derived source over `page`/`query` with an empty first
paint, an optimistic rename (the guess and the closed editor show now, the
plain write lands at the commit), a next page held with its lag shown by
`latest page`, and a search that re-arms the `on(query)` boundary.

## Program

file: ../examples/users.rx

## Frames

| instant | action | frame |
| ------- | ------ | ----- |
| 0       | mount |`0 users Next page (1)` |
| 1       | resolve "fetchUsers:1," [{ id: 1, name: "Ann", email: "a@x" }, { id: 2, name: "Bob", email: "b@x" }] |`2 users 1 Ann a@x 2 Bob b@x Next page (1)` |
| 2       | handler `editing := 1` |`2 users 1 a@x 2 Bob b@x Next page (1)` |
| 3       | handler `rename(1, "Anne")` |`2 users 1 Anne a@x 2 Bob b@x Next page (1)` |
| 4       | resolve "saveUser:1,Anne" { id: 1, name: "Anne", email: "a@x" } |`2 users 1 Anne a@x 2 Bob b@x Next page (1)` |
| 5       | handler `nextPage()` |`loading… 1 Anne a@x 2 Bob b@x Next page (2)` |
| 6       | resolve "fetchUsers:2," [{ id: 3, name: "Cy", email: "c@x" }] |`1 users 3 Cy c@x Next page (2)` |
| 7       | handler `search("c")` |`loading… Searching… Next page (1)` |
| 8       | resolve "fetchUsers:1,c" [{ id: 3, name: "Cy", email: "c@x" }] |`1 users 3 Cy c@x Next page (1)` |

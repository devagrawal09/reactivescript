# S-app-todo — examples/todo.rx

A real program (07) run as a scenario. Handlers call the actions the UI's
own handlers would.

## Program

file: ../examples/todo.rx

## Frames

| instant | action                                  | frame |
| ------- | --------------------------------------- | ----- |
| 0       | mount                                   | `Add 0 left allopendone` |
| 1       | handler `draft := "write spec"`         | `Add 0 left allopendone` |
| 2       | handler `add()`                         | `Add write spec × 1 left allopendone` |
| 3       | handler `draft := "lex"`                | `Add write spec × 1 left allopendone` |
| 4       | handler `add()`                         | `Add write spec × lex × 2 left allopendone` |
| 5       | handler `toggle(1)`                     | `Add write spec × lex × 1 left allopendone` |
| 6       | handler `filter := "open"`              | `Add lex × 1 left allopendone` |
| 7       | handler `remove(2)`                     | `Add 0 left allopendone` |
| 8       | handler `filter := "done"`              | `Add write spec × 0 left allopendone` |

A handler is one instant: `draft := "lex"; add()` in one run would see the
committed `draft` (H-10) and add nothing — the input event and the submit
are two instants, as in a browser.

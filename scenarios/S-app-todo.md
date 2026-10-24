# S-app-todo — examples/todo.rx

A real program (07) run as a scenario. Handlers call the actions the UI's
own handlers would.

## Program

file: ../examples/todo.rx

## Frames

| instant | action                                  | frame |
| ------- | --------------------------------------- | ----- |
| 0       | mount                                   | `Add0 leftallopendone` |
| 1       | handler `draft := "write spec"`         | `Add0 leftallopendone` |
| 2       | handler `add()`                         | `Addwrite spec×1 leftallopendone` |
| 3       | handler `draft := "lex"`                | `Addwrite spec×1 leftallopendone` |
| 4       | handler `add()`                         | `Addwrite spec×lex×2 leftallopendone` |
| 5       | handler `toggle(1)`                     | `Addwrite spec×lex×1 leftallopendone` |
| 6       | handler `filter := "open"`              | `Addlex×1 leftallopendone` |
| 7       | handler `remove(2)`                     | `Add0 leftallopendone` |
| 8       | handler `filter := "done"`              | `Addwrite spec×0 leftallopendone` |

A handler is one instant: `draft := "lex"; add()` in one run would see the
committed `draft` (H-10) and add nothing — the input event and the submit
are two instants, as in a browser.

# Findings: a forms-and-tables app in evaluated RX

What came up writing `src/todo.rx`'s input and `src/inventory.rx` (a table with search, filter, sort, column toggles,
an add/edit form with inline validation, row toggle and delete, all optimistic). Each item has a minimal repro, what
the checker or the page did, and what was done about it. `test/inventory.test.ts` asserts every quoted refusal, so a
finding that stops being true fails the tests. Repros are eval code checked against `read n: number; action go(string)`.

Legend: **fixed** (a gated change in `frontend/`), **worked around** (in the RX or the host), **recorded** (left as is).

## Bugs

1. **A `<select value={x}>` showed the wrong option on mount. Fixed.** `solid-plan.ts` set attributes in `declare`,
   before the element's children were appended, so a select's value was set with no `<option>`s and the browser kept
   the first one. Seen as a live edit to `source cat := "parts"` filtering to parts while the select said "all
   categories". Repro: `source s := "b"; <select value={s}>…<option value="b">b</option></select>`.
   Fix: attributes now apply at the end of `exprs`, after children are appended and inserted, the order Solid's
   compiler gives a template's effects. Test: "an attribute is set after the element's children are in place".
2. **`e.target.value` typed on every element. Fixed.** `<div onClick={e => { s := e.target.value }}>` was accepted,
   then `get value: no such field` at run time (a div has no `value`). The event is now typed per element: an
   `<input>` has `value` and `checked`, `<textarea>`/`<select>` have `value`, anything else neither
   (`TYPE: div onClick: no field value in {  }`).
3. **Plan version 2.2 means two things. Recorded.** DOM input plans (`docs/EVAL.md`) and slice 6 frames plans
   (`plan/docs/PLAN-V2.md`, "v2.2: server functions, components and placement") both say `version: 2.2`. A consumer
   can't tell from the version which forms to expect. Not changed here: it's a schema decision.

## Gaps in the DOM input (v2.2)

4. **A checkbox's state. Fixed (gated).** `onChange={e => { b := e.target.checked }}` was
   `TYPE: input onChange: no field checked in { value: string }`. `checked: boolean` is now on an `<input>`'s event
   (only with `opts.dom`, i.e. evaluated code; authored plans still refuse handler parameters). The inventory's column
   toggles and the form's "active" use it. (`b := !b` without the event also works, and the row toggle uses that.)
5. **No `e.key`, so no "Enter adds". Worked around.** `<input onKeyDown={e => { s := e.key }} />` is
   `TYPE: … no field key`, and even with the key, a handler can't branch (item 7). Instead the input sits in a
   `<form>`: Enter in a form clicks its first enabled button, and a disabled one blocks it, so
   `<button disabled={draft == ""}>` is the guard for both click and Enter. The page's renderer
   (`client/eval.ts`) stops a form in evaluated code from submitting/navigating. Adding `key` was skipped because it
   would be useless without conditional steps.
6. **A `<select>`'s change value works as is.** `onChange={e => { cat := e.target.value }}` needed nothing new.

## Gaps in the plan v2 subset

7. **No `if` statement in a handler or action.** `<button onClick={() => { if (s != "") { go(s) } }}>` is
   `PLAN: unsupported step sif`. Guards are expressions: a `disabled={…}` attribute, or a markup `if` choosing which
   button exists (the inventory's add vs save/cancel). Validation is memos (`nameErr`, `qtyErr`, `valid`) shown
   inline and gating the submit button.
8. **Statement `if` and markup `if` are spelled differently.** In markup `{if c { … }}`; in a block `if (c) { … }`.
   Writing the markup spelling in a handler is a parse error that doesn't say why: `PARSE: … expected '}' near
   's != "" { go(s) } }}'`. Recorded.
9. **No number parsing.** No `parseInt`/`Number`. The quantity field is typed text, parsed by looking it up:
   `qty = indexOf(digits, d => d == fqty)` over `digits = map(upto, n => "" + n)` and a literal `upto := [0, …, 99]`.
   So quantities are 0–99, and a non-number is `qty < 0`. Also, `indexOf` is `findIndex`: `indexOf(l, "a")` is
   `PLAN: a builtin or updater takes one (x) => expression`.
10. **No `-` at all, so no negative literals.** `n == -1` is `PLAN: unsupported operator -`. Written as `qty < 0`.
11. **No sort, and no string comparison.** `sort(…)` is `UNBOUND: sort is not declared here`, and `a < "y"` is
    `TYPE: comparison of string and string (integers only)`. Sorting by quantity is a bucket loop:
    `{for n in (sortBy == "qtyUp" ? upto : downfrom) { {for r in filter(rows, i => i.qty == n) { <tr>… }} }}`, with a
    second literal list for descending (reversing would need `-`). 100 filters per render, fine at this size. Sorting
    by name isn't expressible; "server order" is by name because the host keeps the store sorted.
12. **No substring test, no lowercase.** `a.includes("b")` is `PLAN: unsupported call`. Search is exact match against
    a host-built index: each item carries `words`, every lowercase prefix of every word of its name, and the filter is
    `indexOf(i.words, w => w == q) >= 0`. A capitalized query finds nothing. An optimistic rename keeps the old
    `words` until the server answers.
13. **No sum or reduce.** `reduce(…)` is `UNBOUND`. The summary row has counts (`filter(…).length`: shown, total, low on
    stock) but no total quantity.
14. **No components.** `<Row />` is `CHECK: UNKNOWN_COMPONENT`. The row markup is written twice (server order and
    quantity order), with its column toggles and buttons.
15. **No spreads.** `map(xs, x => { ...x, a: 2 })` is `PLAN: object spreads are outside plan v2`. An optimistic edit
    rebuilds the whole record, carrying `words: i.words` along.
16. **No append.** With no spread or concat, a guess can't add a row to `shown`. The pending new item is its own
    optimistic source (`adding`, seeded `noItem`) shown in the table's `<tfoot>`, as todo.rx does.
17. **An action can't call an action.** `action b() { a(); }` is `PLAN: an action calling an action (nested
    transactions) is outside plan v2`. The row's active toggle (`setActive`) repeats `update`'s guess and call so it
    doesn't also reset the form.

## Runtime behaviour (Solid 2)

18. **An action's plain writes show only when it settles.** In `action create(…) { optimistic adding := …; fname := "";
    … await addItem(…) }`, the guess shows at once but the cleared form only after the server answers (a Solid 2
    transition holds the action's writes). So the form, and todo.rx's draft, now clear after a successful await,
    which also keeps the typed values for a retry when it fails.
19. **A host's own writes during an action are held too.** The fake server's request log (`setLog`, called
    synchronously inside the RX action via the host call) stayed empty until the action settled, so a request never
    showed "pending". The server now writes its pending entry in a microtask, outside the action.
20. **Rollbacks behaved.** With "fail every request" on, an add, a delete and a row toggle in flight together all rolled
    back, each with its status line, and the form kept its values. A rolled-back row is a new row (`For` keys by
    identity and the guess made a new record), so a controlled checkbox comes back with the right `checked`.

## Not hit

No parser hangs while editing inventory.rx in the page (the checker worker's timeout is the guard). No runtime errors
in the console during the browser pass.

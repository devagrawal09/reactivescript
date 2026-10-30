# Change request: row actions

The app in `src/` is an issue desk that already works. `BASE.md` is the brief it was built to, with the changes made
since. Keep everything it does, and let the user assign and close an issue from its row in the list, without
selecting it.

## The API (`src/api.js`, given; do not change it)

Everything in `BASE.md`. Nothing new.

## What to add

Elements the tests look for carry these `data-testid`s. Text in quotes must appear exactly as written.

1. **Row buttons.** Next to each row of the list, in the row order, two buttons. They sit outside the row's `issue`
   element, which keeps reading exactly as before:
   - `row-assign`, reading `assign to <current user>` (`assign to guest`);
   - `row-close`, reading `close`, only while the list shows open issues.
   Clicking a row button does not select its issue.
2. **Row assign.** Clicking `row-assign` does for that row's issue what the detail's `assign` does: the row shows the
   current user as its assignee straight away; it calls `assign(id, user)`; if the server declines, the row goes back
   to the assignee it had before; if the server accepts, the row keeps the new assignee.
3. **Row close.** Clicking `row-close` does for that row's issue what the detail's `close` does: the row leaves the
   list of open issues straight away (if that issue is selected, the detail keeps showing it); it calls
   `closeIssue(id)`; if the server declines, the row comes back where it was; if the server accepts, it stays out.
   The `tab-issues` count follows row closes as it follows the detail's.
4. **Row errors.** When the server declines a row action, the issues page shows `row error: <message>` in an
   element `row-error` (`row error: declined`). A row error is cleared when the next row action starts. Row actions
   do not show or clear the detail's errors, and the detail's actions do not clear a row error.
5. While an issue has more than one assignment out, from its row or its detail, its row shows the newest one
   started until that one is answered.

# Change request: open-issue count

The app in `src/` is an issue desk that already works. `BASE.md` is the brief it was built to. Keep everything it
does, and show how many issues are open on the issues tab.

## The API (`src/api.js`, given; do not change it)

Everything in `BASE.md`. Nothing new.

## What to add

Elements the tests look for carry these `data-testid`s. Text in quotes must appear exactly as written.

1. The `tab-issues` button reads `Issues (<n>)`, where `<n>` is the number of rows in the list of open issues
   (`Issues (3)`). It shows on every page. Until the open issues have loaded once, it reads `Issues`.
2. The count follows the list of open issues as the issues page shows it: whenever the open issues load again (the
   issues page opening again, or its filter switching back to open), the count follows the new answer. While the
   list shows closed issues, is loading, or failed, and while another page is open, the count keeps the last number
   it showed.
3. **Closing.** Clicking `close` on an open issue takes one off the count straight away, as its row leaves the
   list. If the server declines, the count goes back; if it accepts, the count stays down.

# Change request: close an issue

The app in `src/` is an issue tracker that already works. `BASE.md` is the brief it was built to. Keep everything it
does, and add closing an issue.

## The API (`src/api.js`, given; do not change it)

Everything in `BASE.md`, and one new function:

- `closeIssue(id: number): Promise<{ id: number }>`: closes the issue on the server. May reject with an `Error` (the
  server declined).

## What to add

Elements the tests look for carry these `data-testid`s. Text in quotes must appear exactly as written.

1. While an issue is selected, the detail has a button `close` (`data-testid="close"`).
2. Clicking `close`:
   - removes the issue's row from the list of open issues straight away (the detail keeps showing the issue);
   - calls `closeIssue(id)`;
   - if the server declines, the row comes back where it was, and the detail shows `close error: <message>`
     (`close error: declined`);
   - if the server accepts, the row stays out of the open issues.
3. A close error is cleared when a new close starts or another issue is selected.

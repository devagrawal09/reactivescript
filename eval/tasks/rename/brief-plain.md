# Change request: rename an issue

The app in `src/` is an issue tracker that already works. `BASE.md` is the brief it was built to. Keep everything it
does, and add renaming an issue.

## The API (`src/api.js`, given; do not change it)

Everything in `BASE.md`, and one new function:

- `renameIssue(id: number, title: string): Promise<{ id: number; title: string }>`: renames the issue on the server.
  May reject with an `Error` (the server declined).

## What to add

Elements the tests look for carry these `data-testid`s. Text in quotes must appear exactly as written.

1. While an issue is selected, the detail has a text input `title-input`, empty when the issue is selected, and a
   button `rename` (`data-testid="rename"`).
2. Clicking `rename` while `title-input` holds a title:
   - shows the new title in the issue's list row and in the detail's heading (`#<id> <title>`) straight away;
   - calls `renameIssue(id, title)`;
   - if the server declines, the row and the heading go back to the title they had before, and the detail shows
     `rename error: <message>` (`rename error: declined`);
   - if the server accepts, the row and the heading keep the new title.
3. A rename error is cleared when a new rename starts or another issue is selected.

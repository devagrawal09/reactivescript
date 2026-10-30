# Change request: related help

The app in `src/` is an issue desk that already works. `BASE.md` is the brief it was built to, with the changes made since. Keep everything it
does, and show help related to the selected issue, which opens on the help page.

## The API (`src/api.js`, given; do not change it)

Everything in `BASE.md`. Nothing new: related help comes from `search`.

## What to add

Elements the tests look for carry these `data-testid`s. Text in quotes must appear exactly as written.

1. **Related help.** While an issue is selected and its detail has loaded, the detail has an element `related`.
   - It calls `search(<the issue's title>)` (for `#3 Crash on save`: `search("Crash on save")`), and shows
     `finding related help` until the hits arrive.
   - Then one button per hit, at most the first three, `data-testid="related-hit"`, reading the hit's name; or
     `no related help` when there are none.
   - If the search fails: `related help failed: <message>`.
2. **Opening a related hit.** Clicking a `related-hit` opens the help page as if the user had typed the issue's title
   into `query` and clicked that hit: `query` holds the title, the results area shows the results for it, the hit is
   selected (`> <name>`), and the help pane shows the item from `fetchItem(id)` (`loading…` until it answers).
3. Opening the help page with its tab still starts it as before: empty query, nothing selected.

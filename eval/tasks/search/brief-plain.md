# Search with a detail pane

Build a page where the user searches a catalogue and opens one result in a detail pane.

## The API (`src/api.js`, given; do not change it)

- `search(q: string): Promise<{ id: number; name: string }[]>`: the hits for `q`, in order. It may reject with an `Error`.
- `fetchItem(id: number): Promise<{ id: number; name: string; blurb: string } | null>`: one item, or `null` when there is
  no item with that id. It may reject with an `Error`.

## What the page must do

Elements the tests look for carry these `data-testid`s. Text in quotes must appear exactly as written.

1. A text input, `query`. What the user types is the query.
2. A results area, `results`.
   - Empty query: the results area shows nothing, and nothing is asked.
   - A query of one character: the results area shows `too short: <q>` (for `a`: `too short: a`). Nothing is asked.
   - Two characters or more: call `search(q)` and show `searching…` until the results arrive. Results already on
     screen stay there until the new ones replace them.
   - The results: a line `<n> results for <q>` (`2 results for ap`) and one list item per hit, `data-testid="hit"`,
     whose text is the hit's name.
   - If the search fails: `search failed: <message>`.
3. Clicking a hit selects it. The selected hit's text starts with `> ` (`> apple pie`); the others have no prefix.
4. A detail pane, `detail`.
   - Nothing selected: `pick a result`.
   - When a hit is selected, call `fetchItem(id)` and show `loading…` until it answers.
   - The answer is an item: the pane shows its name and its blurb.
   - The answer is `null`: `item <id> not found`.
   - It fails: `failed: <message>` and a button `retry` (`data-testid="retry"`) that calls `fetchItem(id)` again and
     shows its answer.

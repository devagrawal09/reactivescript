# Search with a detail pane

Build a page where the user searches a catalogue and opens one result in a detail pane.

## The API (`src/api.js`, given; do not change it)

- `search(q: string): Promise<{ id: number; name: string }[]>`: the hits for `q`, in order. It may reject with an `Error`.
- `fetchItem(id: number): Promise<{ id: number; name: string; blurb: string } | null>`: one item, or `null` when there is
  no item with that id. It may reject with an `Error`.

Answers take an unknown time and can arrive in any order.

## What the page must do

Elements the tests look for carry these `data-testid`s. Text in quotes must appear exactly as written.

1. A text input, `query`. What the user types is the query.
2. A results area, `results`.
   - Empty query: the results area shows nothing, and nothing is asked.
   - A query of one character: the results area shows `too short: <q>` (for `a`: `too short: a`). Nothing is asked.
   - Two characters or more: call `search(q)`. While an answer for the current query is outstanding, the results area
     shows `searching…`. If results were already on screen, they stay on screen until the new ones arrive.
   - When the results for the current query arrive: a line `<n> results for <q>` (`2 results for ap`) and one list item
     per hit, `data-testid="hit"`, whose text is the hit's name. `searching…` is gone.
   - If the search for the current query fails: `search failed: <message>`.
   - Only answers for the query currently typed may ever show. An answer, or a failure, for a query the user has since
     changed must never appear.
3. Clicking a hit selects it. The selected hit's text starts with `> ` (`> apple pie`); the others have no prefix.
4. A detail pane, `detail`.
   - Nothing selected: `pick a result`.
   - When a hit is selected, call `fetchItem(id)`. Until it answers, the pane shows `loading…`, and nothing from a
     previously selected item (its content or its error).
   - The answer is an item: the pane shows its name and its blurb.
   - The answer is `null`: `item <id> not found`.
   - It fails: `failed: <message>` and a button `retry` (`data-testid="retry"`) that asks `fetchItem(id)` again. When
     the new answer arrives, it replaces the failure.
   - Only the answer for the currently selected item may ever show.
5. Nothing that happens in the detail pane (loading, not found, failure) changes the results area.

# Change request: labels

The app in `src/` is an issue desk that already works. `BASE.md` is the brief it was built to. Keep everything it
does, and add labels to the selected issue.

## The API (`src/api.js`, given; do not change it)

Everything in `BASE.md`, and three new functions:

- `fetchLabels(id: number): Promise<string[]>`: the issue's labels, in order. May reject with an `Error`.
- `addLabel(id: number, label: string): Promise<string[]>`: adds a label at the end on the server; answers the
  issue's labels after the change. May reject with an `Error` (the server declined).
- `removeLabel(id: number, label: string): Promise<string[]>`: removes a label on the server; answers the issue's
  labels after the change. May reject with an `Error` (the server declined).

## What to add

Elements the tests look for carry these `data-testid`s. Text in quotes must appear exactly as written.

1. **Labels.** While an issue is selected, the detail has an element `labels` with that issue's labels, from
   `fetchLabels(id)`.
   - While they load: `loading labels`.
   - Then, per label, an element `data-testid="label"` reading the label (`bug`), and next to it a button
     `data-testid="remove-label"` reading `remove <label>` (`remove bug`).
   - If it fails: `labels error: <message>`.
2. **Adding.** The detail has a text input `label-input` and a button `add-label`. Clicking `add-label` while
   `label-input` holds a label the issue does not have yet:
   - adds the label as the last one straight away and empties the input;
   - calls `addLabel(id, label)`;
   - if the server declines, the label goes away, and the detail shows `label error: <message>`
     (`label error: declined`);
   - if the server accepts, the label stays.
   - A label the issue already shows is not added again, and nothing is asked.
3. **Removing.** Clicking a label's `remove-label` button:
   - removes the label straight away;
   - calls `removeLabel(id, label)`;
   - if the server declines, the label comes back where it was, and the detail shows `label error: <message>`;
   - if the server accepts, the label stays out.
4. A label error is cleared when a new label change (an add or a remove) starts or another issue is selected.

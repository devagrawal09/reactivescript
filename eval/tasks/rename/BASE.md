# Issue tracker

Build an issue tracker: a filtered list of issues beside the selected issue's detail, and a button that assigns the
selected issue to the current user.

## The API (`src/api.js`, given; do not change it)

- `fetchIssues(filter: "open" | "closed"): Promise<{ id: number; title: string; assignee: string | null }[]>`. May
  reject with an `Error`.
- `fetchIssue(id: number): Promise<{ id: number; title: string; body: string } | null>`: `null` when there is no such
  issue. May reject with an `Error`.
- `assign(id: number, user: string): Promise<{ id: number; assignee: string }>`: assigns the issue on the server. May
  reject with an `Error` (the server declined).

## What the page must do

Elements the tests look for carry these `data-testid`s. Text in quotes must appear exactly as written.

1. **Current user.** A text input, `user`, holding the current user's name. It starts as `guest`.
2. **Filter.** Two buttons, `filter-open` and `filter-closed`. The filter starts as `open`.
3. **List**, `list`, of the issues for the current filter, from `fetchIssues(filter)`.
   - While they load (when the page opens or the filter changes): `loading <filter> issues` (`loading closed issues`).
   - Then one row per issue, `data-testid="issue"`, reading `#<id> <title> (<assignee>)`, or `(unassigned)` when the
     assignee is `null`: `#3 Crash on save (unassigned)`.
   - If it fails: `list error: <message>`.
4. **Detail**, `detail`.
   - Nothing selected: `select an issue`. Clicking a row selects its issue.
   - The selected issue comes from `fetchIssue(id)`. While it loads: `loading #<id>`.
   - An issue: `#<id> <title>` and its body.
   - `null`: `detail error: issue #<id> not found`. A failure: `detail error: <message>`.
   - A button `retry` (`data-testid="retry"`) calls `fetchIssue(id)` again and shows its answer.
5. **Assign.** While an issue is selected, the detail has a button `assign` (`data-testid="assign"`) reading
   `assign to <current user>`. Clicking it:
   - shows the current user as the issue's assignee in its list row straight away;
   - calls `assign(id, user)`;
   - if the server declines, the row goes back to the assignee it had before, and the detail shows the server's
     message (`declined`);
   - if the server accepts, the row keeps the new assignee.
   - An assignment error is cleared when a new assignment starts or another issue is selected.

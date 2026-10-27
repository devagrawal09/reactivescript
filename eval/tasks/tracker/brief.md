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

Answers take an unknown time and can arrive in any order.

## What the page must do

Elements the tests look for carry these `data-testid`s. Text in quotes must appear exactly as written.

1. **Current user.** A text input, `user`, holding the current user's name. It starts as `guest`.
2. **Filter.** Two buttons, `filter-open` and `filter-closed`. The filter starts as `open`.
3. **List**, `list`.
   - Ask `fetchIssues(filter)` for the current filter. Until its answer arrives after the page loads or the filter
     changes, the list shows `loading <filter> issues` (`loading closed issues`).
   - Then one row per issue, `data-testid="issue"`, reading `#<id> <title> (<assignee>)`, or `(unassigned)` when the
     assignee is `null`: `#3 Crash on save (unassigned)`.
   - If it fails: `list error: <message>`.
   - Only the answer for the current filter may ever show.
4. **Detail**, `detail`.
   - Nothing selected: `select an issue`. Clicking a row selects its issue.
   - When an issue is selected, ask `fetchIssue(id)`. Until it answers: `loading #<id>`, and nothing from the
     previously selected issue.
   - An issue: `#<id> <title>` and its body.
   - `null`: `detail error: issue #<id> not found`. A failure: `detail error: <message>`.
   - A button `retry` (`data-testid="retry"`) asks `fetchIssue(id)` again; its answer replaces what is shown.
   - Only the answer for the currently selected issue may ever show.
5. **Assign.** While an issue is selected, the detail has a button `assign` (`data-testid="assign"`) reading
   `assign to <current user>`. Clicking it:
   - shows the current user as the issue's assignee in its list row at once, before the server answers;
   - calls `assign(id, user)`;
   - if the server declines, the row goes back to the assignee it had before, and the detail shows the server's
     message (`declined`);
   - if the server accepts, the row keeps the new assignee.
   - An assignment error is cleared when a new assignment starts or another issue is selected.
6. A failure in the list never changes the detail, and a failure in the detail never changes the list.

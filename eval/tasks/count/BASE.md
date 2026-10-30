# Issue desk

Build an issue desk: three pages behind a row of tabs. The issues page is an issue tracker with assigning, renaming,
closing and comments; the help page searches a help catalogue; the settings page edits the user's settings.

## The API (`src/api.js`, given; do not change it)

Issues:

- `fetchIssues(filter: "open" | "closed"): Promise<{ id: number; title: string; assignee: string | null }[]>`. May
  reject with an `Error`.
- `fetchIssue(id: number): Promise<{ id: number; title: string; body: string } | null>`: `null` when there is no such
  issue. May reject with an `Error`.
- `assign(id: number, user: string): Promise<{ id: number; assignee: string }>`: assigns the issue on the server. May
  reject with an `Error` (the server declined).
- `renameIssue(id: number, title: string): Promise<{ id: number; title: string }>`: renames the issue on the server.
  May reject with an `Error` (the server declined).
- `closeIssue(id: number): Promise<{ id: number }>`: closes the issue on the server. May reject with an `Error` (the
  server declined).
- `fetchComments(id: number): Promise<{ author: string; text: string }[]>`: the issue's comments, oldest first. May
  reject with an `Error`.
- `addComment(id: number, author: string, text: string): Promise<{ author: string; text: string }>`: adds a comment
  on the server. May reject with an `Error` (the server declined).

Help:

- `search(q: string): Promise<{ id: number; name: string }[]>`: the hits for `q`, in order. It may reject with an
  `Error`.
- `fetchItem(id: number): Promise<{ id: number; name: string; blurb: string } | null>`: one item, or `null` when there
  is no item with that id. It may reject with an `Error`.

Settings:

- `loadSettings(): Promise<{ name: string; theme: "light" | "dark"; density: "comfortable" | "compact" }>`. May
  reject with an `Error`.
- `saveSettings(s: { name: string; theme: "light" | "dark"; density: "comfortable" | "compact" }): Promise<same shape>`:
  answers the settings as saved. May reject with an `Error`.

## What the app must do

Elements the tests look for carry these `data-testid`s. Text in quotes must appear exactly as written.

### Tabs

1. Three buttons, `tab-issues`, `tab-help` and `tab-settings`, always on screen. The app opens on the issues page.
2. Only the open page is on screen. Leaving a page discards it: opening it again starts it as it starts when the app
   opens (it loads again, nothing selected, inputs at their starting values). A request a discarded page made may
   still answer; it must not show on, or change, any page.

### The issues page

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
6. **Rename.** While an issue is selected, the detail has a text input `title-input`, empty when the issue is
   selected, and a button `rename` (`data-testid="rename"`). Clicking `rename` while `title-input` holds a title:
   - shows the new title in the issue's list row and in the detail's heading (`#<id> <title>`) straight away;
   - calls `renameIssue(id, title)`;
   - if the server declines, the row and the heading go back to the title they had before, and the detail shows
     `rename error: <message>` (`rename error: declined`);
   - if the server accepts, the row and the heading keep the new title.
   - A rename error is cleared when a new rename starts or another issue is selected.
7. **Close.** While an issue is selected, the detail has a button `close` (`data-testid="close"`). Clicking it:
   - removes the issue's row from the list of open issues straight away (the detail keeps showing the issue);
   - calls `closeIssue(id)`;
   - if the server declines, the row comes back where it was, and the detail shows `close error: <message>`
     (`close error: declined`);
   - if the server accepts, the row stays out of the open issues.
   - A close error is cleared when a new close starts or another issue is selected.
8. **Comments.** While an issue is selected, the detail has an element `comments` with that issue's comments, from
   `fetchComments(id)`.
   - While they load: `loading comments`.
   - Then one row per comment, `data-testid="comment"`, reading `<author>: <text>` (`dana: seen it too`).
   - If it fails: `comments error: <message>`.
9. **Posting.** The detail has a text input `comment-input` and a button `post` (`data-testid="post"`). Clicking
   `post` while `comment-input` holds text:
   - adds the comment as the last row straight away, reading `<current user>: <text> (sending…)`, and empties the
     input;
   - calls `addComment(id, user, text)`;
   - if the server declines, the row goes away, and the detail shows `post error: <message>` (`post error: declined`);
   - if the server accepts, the row stays and reads `<current user>: <text>`.
   - A post error is cleared when a new post starts or another issue is selected.

### The help page

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
4. A help pane, `item`.
   - Nothing selected: `pick a result`.
   - When a hit is selected, call `fetchItem(id)` and show `loading…` until it answers.
   - The answer is an item: the pane shows its name and its blurb.
   - The answer is `null`: `item <id> not found`.
   - It fails: `failed: <message>` and a button `retry-item` (`data-testid="retry-item"`) that calls `fetchItem(id)`
     again and shows its answer.

### The settings page

1. **Loading.** Call `loadSettings()` when the page opens. Until it answers, an element `load` shows
   `Loading settings…`. If it fails, `load` shows `Could not load settings: <message>` and a button `retry-load`
   calls `loadSettings()` again and shows the settings it answers.
2. **Saved line**, `saved`, once the settings have loaded: `Saved: <name> · <theme> · <density>`
   (`Saved: Ann · light · compact`).
3. **The draft.** Once loaded, a form is filled from the loaded settings and then belongs to the user:
   - an input `name` (the display name), a counter `name-count` reading `<length>/20`;
   - `name-error`, shown only when the name is invalid: `Display name is required` when empty,
     `Display name must be at most 20 characters, not <length>` when longer than 20;
   - buttons `theme-light` and `theme-dark` that set the draft's theme; a button `density-toggle` that switches the
     draft's density between `comfortable` and `compact`;
   - `preview` reading `Preview: <draft theme> / <draft density>`.
4. **Save**, a button `save`.
   - With an invalid name it does nothing (nothing is asked).
   - Otherwise it calls `saveSettings(draft)`. Straight away the saved line shows the values being saved followed by
     ` (saving…)` (`Saved: Bea · dark · compact (saving…)`), and any previous save error disappears.
   - When the save succeeds, the saved line shows the saved settings, without `(saving…)`.
   - When it fails, the saved line goes back to what was saved before, without `(saving…)`, and `save-error` shows
     `Save failed: <message>`.
   - Saving never changes the draft.

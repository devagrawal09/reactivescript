# Settings page

Build a settings page: it loads the user's settings, lets them edit a draft, and saves it.

## The API (`src/api.js`, given; do not change it)

- `loadSettings(): Promise<{ name: string; theme: "light" | "dark"; density: "comfortable" | "compact" }>`. May
  reject with an `Error`.
- `saveSettings(s: { name: string; theme: "light" | "dark"; density: "comfortable" | "compact" }): Promise<same shape>`:
  answers the settings as saved. May reject with an `Error`.

## What the page must do

Elements the tests look for carry these `data-testid`s. Text in quotes must appear exactly as written.

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

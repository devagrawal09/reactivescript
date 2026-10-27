# Change request: comments

The app in `src/` is an issue tracker that already works. `BASE.md` is the brief it was built to. Keep everything it
does, and add comments to the selected issue.

## The API (`src/api.js`, given; do not change it)

Everything in `BASE.md`, and two new functions:

- `fetchComments(id: number): Promise<{ author: string; text: string }[]>`: the issue's comments, oldest first. May
  reject with an `Error`.
- `addComment(id: number, author: string, text: string): Promise<{ author: string; text: string }>`: adds a comment
  on the server. May reject with an `Error` (the server declined).

## What to add

Elements the tests look for carry these `data-testid`s. Text in quotes must appear exactly as written.

1. **Comments.** While an issue is selected, the detail has an element `comments` with that issue's comments, from
   `fetchComments(id)`.
   - While they load: `loading comments`.
   - Then one row per comment, `data-testid="comment"`, reading `<author>: <text>` (`dana: seen it too`).
   - If it fails: `comments error: <message>`.
2. **Posting.** The detail has a text input `comment-input` and a button `post` (`data-testid="post"`). Clicking
   `post` while `comment-input` holds text:
   - adds the comment as the last row straight away, reading `<current user>: <text> (sending…)`, and empties the
     input;
   - calls `addComment(id, user, text)`;
   - if the server declines, the row goes away, and the detail shows `post error: <message>` (`post error: declined`);
   - if the server accepts, the row stays and reads `<current user>: <text>`.
3. A post error is cleared when a new post starts or another issue is selected.

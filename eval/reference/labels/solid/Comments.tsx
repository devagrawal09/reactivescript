import { action, createEffect, createMemo, createOptimisticStore, createSignal, Errored, For, Loading, onFlush, refresh, Show } from "solid-js";
import { addComment, fetchComments } from "./api";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

type Sending = { id: number; author: string; text: string };

// The selected issue's comments, and posting one. Posts in flight live in their own store, so changing the selection
// never waits for them, and each shows only under its own issue.
export default function Comments(props: { id: number; user: string }) {
  const comments = createMemo(() => fetchComments(props.id));
  const [sending, setSending] = createOptimisticStore<Sending[]>([]);
  const [postError, setPostError] = createSignal("");
  const [commentInput, setCommentInput] = createSignal("");

  // a post error belongs to the issue it was made on: selecting another clears it
  createEffect(() => props.id, () => {
    setPostError("");
  });

  const post = action(function* (id: number, author: string, text: string) {
    try {
      setSending(s => { s.push({ id, author, text }); });
      yield addComment(id, author, text);
      refresh(comments);
    } catch (e) {
      setPostError(message(e));
    }
  });

  return (
    <div>
      <div data-testid="comments">
        <Loading on={props.id} fallback={<p>loading comments</p>}>
          <Errored fallback={e => <p>comments error: {message(e())}</p>}>
            <ul>
              <For each={comments()}>{c => <li data-testid="comment">{c.author}: {c.text}</li>}</For>
              <For each={sending.filter(s => s.id === props.id)}>
                {s => <li data-testid="comment">{s.author}: {s.text} (sending…)</li>}
              </For>
            </ul>
          </Errored>
        </Loading>
      </div>
      <input data-testid="comment-input" value={commentInput()} onInput={e => setCommentInput(e.currentTarget.value)} />
      <button
        data-testid="post"
        onClick={() => {
          const text = commentInput();
          if (text === "") return;
          onFlush(() => {
            setCommentInput("");
            setPostError("");
          });
          post(props.id, props.user, text);
        }}
      >
        post
      </button>
      <Show when={postError()}>
        <p>post error: {postError()}</p>
      </Show>
    </div>
  );
}

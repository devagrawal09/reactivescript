import { action, createEffect, createMemo, createOptimistic, createOptimisticStore, createSignal, Errored, For, latest, Loading, onFlush, refresh, Show } from "solid-js";
import { assign, closeIssue, fetchIssue, fetchIssues, renameIssue, type Issue, type IssueDetail } from "./api";
import Comments from "./Comments";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export default function IssuesPage(props: { onOpenCount: (n: number) => void }) {
  const [user, setUser] = createSignal("guest");
  const [filter, setFilter] = createSignal<"open" | "closed">("open");
  const [selected, setSelected] = createSignal<number | null>(null);
  const [titleInput, setTitleInput] = createSignal("");
  const [assignError, setAssignError] = createSignal("");
  const [renameError, setRenameError] = createSignal("");
  const [closeError, setCloseError] = createSignal("");

  // the list for the filter; writes in an action are guesses until it settles
  const [issues, setIssues] = createOptimisticStore<Issue[]>(() => fetchIssues(filter()), [], { key: "id" });
  const [detail, setDetail] = createOptimistic<IssueDetail | null>(async () => {
    const id = selected();
    if (id === null) return null;
    const d = await fetchIssue(id);
    if (d === null) throw new Error(`issue #${id} not found`);
    return d;
  });

  // the open list as shown (closes in flight already out of it) is the tab's count; other lists, loads and failures
  // leave the count as it was
  const openCount = createMemo(() => {
    try {
      return filter() === "open" ? issues.length : -1;
    } catch {
      return -1;
    }
  });
  createEffect(openCount, n => {
    if (n >= 0) props.onOpenCount(n);
  });

  const assignTo = action(function* (id: number, who: string) {
    try {
      setIssues(list => {
        const row = list.find(t => t.id === id);
        if (row) row.assignee = who;
      });
      yield assign(id, who);
      refresh(issues);
    } catch (e) {
      setAssignError(message(e));
    }
  });

  const renameTo = action(function* (id: number, title: string) {
    try {
      setIssues(list => {
        const row = list.find(t => t.id === id);
        if (row) row.title = title;
      });
      setDetail(d => (d && d.id === id ? { ...d, title } : d));
      yield renameIssue(id, title);
      refresh(issues);
      refresh(detail);
    } catch (e) {
      setRenameError(message(e));
    }
  });

  const closeOne = action(function* (id: number) {
    try {
      setIssues(list => {
        const i = list.findIndex(t => t.id === id);
        if (i >= 0) list.splice(i, 1);
      });
      yield closeIssue(id);
      refresh(issues);
    } catch (e) {
      setCloseError(message(e));
    }
  });

  const select = (id: number) => {
    setSelected(id);
    setTitleInput("");
    onFlush(() => {
      setAssignError("");
      setRenameError("");
      setCloseError("");
    });
  };

  return (
    <main>
      <div>
        <label>
          user <input data-testid="user" value={user()} onInput={e => setUser(e.currentTarget.value)} />
        </label>
      </div>
      <div>
        <button data-testid="filter-open" onClick={() => setFilter("open")}>open</button>
        <button data-testid="filter-closed" onClick={() => setFilter("closed")}>closed</button>
      </div>
      <div data-testid="list">
        <Loading on={filter()} fallback={<p>loading {latest(filter)} issues</p>}>
          <Errored fallback={e => <p>list error: {message(e())}</p>}>
            <ul>
              <For each={issues}>
                {it => (
                  <li data-testid="issue" onClick={() => select(it.id)}>
                    #{it.id} {it.title} ({it.assignee ?? "unassigned"})
                  </li>
                )}
              </For>
            </ul>
          </Errored>
        </Loading>
      </div>
      <div data-testid="detail">
        <Show when={selected() !== null} fallback={<p>select an issue</p>}>
          <Loading on={selected()} fallback={<p>loading #{latest(selected)}</p>}>
            <Errored fallback={e => <p>detail error: {message(e())}</p>}>
              <h2>#{detail()?.id} {detail()?.title}</h2>
              <p>{detail()?.body}</p>
            </Errored>
            <button data-testid="retry" onClick={() => refresh(detail)}>retry</button>
          </Loading>
          <button
            data-testid="assign"
            onClick={() => {
              onFlush(() => setAssignError(""));
              assignTo(selected()!, user());
            }}
          >
            assign to {user()}
          </button>
          <Show when={assignError()}>
            <p data-testid="assign-error">{assignError()}</p>
          </Show>
          <input data-testid="title-input" value={titleInput()} onInput={e => setTitleInput(e.currentTarget.value)} />
          <button
            data-testid="rename"
            onClick={() => {
              if (titleInput() === "") return;
              onFlush(() => setRenameError(""));
              renameTo(selected()!, titleInput());
            }}
          >
            rename
          </button>
          <Show when={renameError()}>
            <p>rename error: {renameError()}</p>
          </Show>
          <button
            data-testid="close"
            onClick={() => {
              onFlush(() => setCloseError(""));
              closeOne(selected()!);
            }}
          >
            close
          </button>
          <Show when={closeError()}>
            <p>close error: {closeError()}</p>
          </Show>
          <Comments id={selected()!} user={user()} />
        </Show>
      </div>
    </main>
  );
}

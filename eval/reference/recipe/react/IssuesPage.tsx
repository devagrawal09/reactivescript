import { useEffect, useState } from "react";
import { useMutation, useMutationState, useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { addComment, assign, closeIssue, fetchComments, fetchIssue, fetchIssues, renameIssue } from "./api";
import type { Comment, Issue, IssueDetail as Detail } from "./api";
import { errorMessage } from "./errors";
import IssueList from "./IssueList";
import IssueDetail from "./IssueDetail";
import type { Sending } from "./CommentList";

type Filter = "open" | "closed";
// what onMutate saved, for onError to put back
type Snapshot = { previous: [QueryKey, unknown][] };

// Writes follow TanStack Query's "Optimistic Updates" guide (via the cache): onMutate cancels the queries the write
// touches, saves them and writes the guess into them; onError puts the saved data back; onSettled invalidates them so
// they refetch the server's truth. Refetches are started, not awaited, so a declined write's message shows at once.
export default function IssuesPage({ onOpenCount, onOpenHelp }: { onOpenCount: (n: number) => void; onOpenHelp: (query: string, id: number) => void }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState("guest");
  const [filter, setFilter] = useState<Filter>("open");
  const [selected, setSelected] = useState<number | null>(null);
  const [titleInput, setTitleInput] = useState("");
  const [commentInput, setCommentInput] = useState("");
  const [rowError, setRowError] = useState<string | null>(null);

  const list = useQuery({ queryKey: ["issues", filter], queryFn: () => fetchIssues(filter) });

  const detail = useQuery({
    queryKey: ["issue", selected],
    queryFn: async () => {
      const id = selected as number;
      const d = await fetchIssue(id);
      if (d === null) throw new Error(`issue #${id} not found`);
      return d;
    },
    enabled: selected !== null,
  });

  const comments = useQuery({
    queryKey: ["comments", selected],
    queryFn: () => fetchComments(selected as number),
    enabled: selected !== null,
  });

  // cancel, save and write a guess into every query under `keys`
  const guess = async (keys: QueryKey[], update: (key: QueryKey, old: unknown) => unknown): Promise<Snapshot> => {
    const previous: [QueryKey, unknown][] = [];
    for (const queryKey of keys) {
      await queryClient.cancelQueries({ queryKey });
      for (const [key, data] of queryClient.getQueriesData({ queryKey })) {
        previous.push([key, data]);
        queryClient.setQueryData(key, (old: unknown) => (old === undefined ? old : update(key, old)));
      }
    }
    return { previous };
  };
  const rollback = (snapshot: Snapshot | undefined) => {
    for (const [key, data] of snapshot?.previous ?? []) queryClient.setQueryData(key, data);
  };

  const assignOptions = (fromRow: boolean) => ({
    mutationFn: ({ id, user }: { id: number; user: string }) => assign(id, user),
    onMutate: async ({ id, user }: { id: number; user: string }) => {
      if (fromRow) setRowError(null);
      return guess([["issues"]], (_, old) => (old as Issue[]).map(i => (i.id === id ? { ...i, assignee: user } : i)));
    },
    onError: (e: Error, _: unknown, snapshot: Snapshot | undefined) => {
      rollback(snapshot);
      if (fromRow) setRowError(errorMessage(e));
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["issues"] });
    },
  });
  const assignMutation = useMutation(assignOptions(false));
  const rowAssign = useMutation(assignOptions(true));

  const renameMutation = useMutation({
    mutationFn: ({ id, title }: { id: number; title: string }) => renameIssue(id, title),
    onMutate: ({ id, title }) =>
      guess([["issues"], ["issue", id]], (key, old) =>
        key[0] === "issues" ? (old as Issue[]).map(i => (i.id === id ? { ...i, title } : i)) : { ...(old as Detail), title },
      ),
    onError: (_e, _v, snapshot) => rollback(snapshot),
    onSettled: (_d, _e, { id }) => {
      void queryClient.invalidateQueries({ queryKey: ["issues"] });
      void queryClient.invalidateQueries({ queryKey: ["issue", id] });
    },
  });

  const closeOptions = (fromRow: boolean) => ({
    mutationFn: (id: number) => closeIssue(id),
    onMutate: async (id: number) => {
      if (fromRow) setRowError(null);
      return guess([["issues", "open"]], (_, old) => (old as Issue[]).filter(i => i.id !== id));
    },
    onError: (e: Error, _: unknown, snapshot: Snapshot | undefined) => {
      rollback(snapshot);
      if (fromRow) setRowError(errorMessage(e));
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["issues"] });
    },
  });
  const closeMutation = useMutation(closeOptions(false));
  const rowClose = useMutation(closeOptions(true));

  // a comment being sent shows from the mutation's variables until the comments refetch (the guide's "via the UI"): an
  // accepted post stays pending until the refetch answers, so the row never disappears in between
  const postMutation = useMutation({
    mutationKey: ["addComment"],
    mutationFn: ({ id, author, text }: { id: number; author: string; text: string }) => addComment(id, author, text),
    onSettled: (_d, e, { id }) => {
      const refetch = queryClient.invalidateQueries({ queryKey: ["comments", id] });
      if (!e) return refetch;
    },
  });
  const sendingAll = useMutationState({
    filters: { mutationKey: ["addComment"], status: "pending" },
    select: m => ({ seq: m.state.submittedAt, ...(m.state.variables as { id: number; author: string; text: string }) }),
  });
  const sending: Sending[] = sendingAll.filter(s => s.id === selected).map(s => ({ seq: s.seq, issueId: s.id, author: s.author, text: s.text }));

  // the open list is the tab's count; other lists, loads and failures leave the count as it was
  const openCount = filter === "open" && list.data ? list.data.length : null;
  useEffect(() => {
    if (openCount !== null) onOpenCount(openCount);
  }, [openCount, onOpenCount]);

  const detailMutations = [assignMutation, renameMutation, closeMutation, postMutation];
  const select = (id: number) => {
    setSelected(id);
    setTitleInput("");
    for (const m of detailMutations) m.reset();
  };

  // a detail error shows while the issue it was made on is selected
  const errorOf = (m: { error: Error | null; variables?: unknown }) => {
    const v = m.variables as number | { id: number } | undefined;
    const id = typeof v === "number" ? v : v?.id;
    return m.error && id === selected ? errorMessage(m.error) : null;
  };

  return (
    <div style={{ display: "flex", gap: "2rem" }}>
      <section>
        <label>
          user <input data-testid="user" value={user} onChange={e => setUser(e.target.value)} />
        </label>
        <div>
          <button type="button" data-testid="filter-open" aria-pressed={filter === "open"} onClick={() => setFilter("open")}>
            open
          </button>
          <button type="button" data-testid="filter-closed" aria-pressed={filter === "closed"} onClick={() => setFilter("closed")}>
            closed
          </button>
        </div>
        {rowError !== null && <p data-testid="row-error">row error: {rowError}</p>}
        <div data-testid="list">
          <IssueList
            filter={filter}
            issues={list.data}
            isPending={list.isPending}
            error={list.error}
            selected={selected}
            onSelect={select}
            user={user}
            onRowAssign={id => rowAssign.mutate({ id, user })}
            onRowClose={id => rowClose.mutate(id)}
          />
        </div>
      </section>
      <section data-testid="detail">
        {selected === null ? (
          <p>select an issue</p>
        ) : (
          <IssueDetail
            id={selected}
            user={user}
            detail={detail.data}
            loading={detail.isPending || (detail.isFetching && !detail.data)}
            error={detail.error}
            onRetry={() => void detail.refetch()}
            onAssign={() => assignMutation.mutate({ id: selected, user })}
            assignError={errorOf(assignMutation)}
            titleInput={titleInput}
            onTitleInput={setTitleInput}
            onRename={() => {
              if (titleInput !== "") renameMutation.mutate({ id: selected, title: titleInput });
            }}
            renameError={errorOf(renameMutation)}
            onClose={() => closeMutation.mutate(selected)}
            closeError={errorOf(closeMutation)}
            comments={comments.data as Comment[] | undefined}
            commentsPending={comments.isPending}
            commentsError={comments.error}
            sending={sending}
            commentInput={commentInput}
            onCommentInput={setCommentInput}
            onPost={() => {
              if (commentInput !== "") {
                setCommentInput("");
                postMutation.mutate({ id: selected, author: user, text: commentInput });
              }
            }}
            postError={errorOf(postMutation)}
            onOpenHelp={onOpenHelp}
          />
        )}
      </section>
    </div>
  );
}

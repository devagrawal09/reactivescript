import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { addComment, assign, closeIssue, fetchComments, fetchIssue, fetchIssues, renameIssue } from "./api";
import type { Issue, IssueDetail as Detail } from "./api";
import { errorMessage, type IssueError } from "./errors";
import IssueList from "./IssueList";
import IssueDetail from "./IssueDetail";
import type { Sending } from "./CommentList";

type Filter = "open" | "closed";
// a write still in the air: `seq` orders writes to the same issue, the latest one is what the issue shows
type Guess<T> = { seq: number; value: T };
type Guesses<T> = Record<number, Guess<T>[]>;

const latest = <T,>(guesses: Guesses<T>, id: number): T | undefined => guesses[id]?.at(-1)?.value;
const addGuess = <T,>(prev: Guesses<T>, id: number, g: Guess<T>): Guesses<T> => ({ ...prev, [id]: [...(prev[id] ?? []), g] });
const dropGuess = <T,>(prev: Guesses<T>, id: number, seq: number): Guesses<T> => {
  const rest = (prev[id] ?? []).filter(g => g.seq !== seq);
  const next = { ...prev };
  if (rest.length) next[id] = rest;
  else delete next[id];
  return next;
};

export default function IssuesPage() {
  const queryClient = useQueryClient();
  const [user, setUser] = useState("guest");
  const [filter, setFilter] = useState<Filter>("open");
  const [selected, setSelected] = useState<number | null>(null);
  const seqRef = useRef(0);
  const nextSeq = () => ++seqRef.current;

  // assignments in the air, and the newest one confirmed per issue (an older answer must not overwrite it)
  const [assigning, setAssigning] = useState<Guesses<string>>({});
  const [assignError, setAssignError] = useState<IssueError | null>(null);
  const lastAssignRef = useRef(0);
  const confirmedAssignRef = useRef<Record<number, number>>({});

  const [renaming, setRenaming] = useState<Guesses<string>>({});
  const [renameError, setRenameError] = useState<IssueError | null>(null);
  const [titleInput, setTitleInput] = useState("");
  const lastRenameRef = useRef(0);
  const confirmedRenameRef = useRef<Record<number, number>>({});

  // closes in the air, by issue id, with how many are out
  const [closing, setClosing] = useState<Record<number, number>>({});
  const [closeError, setCloseError] = useState<IssueError | null>(null);
  const lastCloseRef = useRef(0);

  const [sending, setSending] = useState<Sending[]>([]);
  const [postError, setPostError] = useState<IssueError | null>(null);
  const [commentInput, setCommentInput] = useState("");
  const lastPostRef = useRef(0);

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

  const shownIssues = list.data
    ?.filter(issue => !(filter === "open" && closing[issue.id]))
    .map(issue => ({
      ...issue,
      title: latest(renaming, issue.id) ?? issue.title,
      assignee: latest(assigning, issue.id) ?? issue.assignee,
    }));
  const shownDetail = detail.data && { ...detail.data, title: latest(renaming, detail.data.id) ?? detail.data.title };

  const select = (id: number) => {
    setSelected(id);
    setTitleInput("");
    setAssignError(null);
    setRenameError(null);
    setCloseError(null);
    setPostError(null);
  };

  const doAssign = async (id: number, who: string) => {
    const seq = nextSeq();
    lastAssignRef.current = seq;
    setAssignError(null);
    setAssigning(prev => addGuess(prev, id, { seq, value: who }));
    try {
      const res = await assign(id, who);
      if ((confirmedAssignRef.current[id] ?? 0) < seq) {
        confirmedAssignRef.current[id] = seq;
        queryClient.setQueriesData<Issue[]>({ queryKey: ["issues"] }, old =>
          old?.map(i => (i.id === id ? { ...i, assignee: res.assignee } : i)),
        );
      }
    } catch (e) {
      // only report the failure if no later assignment has started since
      if (lastAssignRef.current === seq) setAssignError({ issueId: id, message: errorMessage(e) });
    } finally {
      setAssigning(prev => dropGuess(prev, id, seq));
    }
  };

  const doRename = async (id: number, title: string) => {
    const seq = nextSeq();
    lastRenameRef.current = seq;
    setRenameError(null);
    setRenaming(prev => addGuess(prev, id, { seq, value: title }));
    try {
      const res = await renameIssue(id, title);
      if ((confirmedRenameRef.current[id] ?? 0) < seq) {
        confirmedRenameRef.current[id] = seq;
        queryClient.setQueriesData<Issue[]>({ queryKey: ["issues"] }, old =>
          old?.map(i => (i.id === id ? { ...i, title: res.title } : i)),
        );
        queryClient.setQueryData<Detail>(["issue", id], old => (old ? { ...old, title: res.title } : old));
      }
    } catch (e) {
      if (lastRenameRef.current === seq) setRenameError({ issueId: id, message: errorMessage(e) });
    } finally {
      setRenaming(prev => dropGuess(prev, id, seq));
    }
  };

  const doClose = async (id: number) => {
    const seq = nextSeq();
    lastCloseRef.current = seq;
    setCloseError(null);
    setClosing(prev => ({ ...prev, [id]: (prev[id] ?? 0) + 1 }));
    try {
      await closeIssue(id);
      queryClient.setQueryData<Issue[]>(["issues", "open"], old => old?.filter(i => i.id !== id));
    } catch (e) {
      if (lastCloseRef.current === seq) setCloseError({ issueId: id, message: errorMessage(e) });
    } finally {
      setClosing(prev => {
        const next = { ...prev };
        if ((next[id] ?? 0) > 1) next[id] -= 1;
        else delete next[id];
        return next;
      });
    }
  };

  const doPost = async (id: number, author: string, text: string) => {
    const seq = nextSeq();
    lastPostRef.current = seq;
    setPostError(null);
    setCommentInput("");
    setSending(prev => [...prev, { seq, issueId: id, author, text }]);
    try {
      const res = await addComment(id, author, text);
      queryClient.setQueryData<{ author: string; text: string }[]>(["comments", id], old => (old ? [...old, res] : old));
    } catch (e) {
      if (lastPostRef.current === seq) setPostError({ issueId: id, message: errorMessage(e) });
    } finally {
      setSending(prev => prev.filter(p => p.seq !== seq));
    }
  };

  const errorFor = (e: IssueError | null) => (e && e.issueId === selected ? e.message : null);

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
        <div data-testid="list">
          <IssueList
            filter={filter}
            issues={shownIssues}
            isPending={list.isPending}
            error={list.error}
            selected={selected}
            onSelect={select}
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
            detail={shownDetail}
            loading={detail.isFetching || detail.isPending}
            error={detail.error}
            onRetry={() => void detail.refetch()}
            onAssign={() => void doAssign(selected, user)}
            assignError={errorFor(assignError)}
            titleInput={titleInput}
            onTitleInput={setTitleInput}
            onRename={() => {
              if (titleInput !== "") void doRename(selected, titleInput);
            }}
            renameError={errorFor(renameError)}
            onClose={() => void doClose(selected)}
            closeError={errorFor(closeError)}
            comments={comments.data}
            commentsPending={comments.isPending}
            commentsError={comments.error}
            sending={sending.filter(p => p.issueId === selected)}
            commentInput={commentInput}
            onCommentInput={setCommentInput}
            onPost={() => {
              if (commentInput !== "") void doPost(selected, user, commentInput);
            }}
            postError={errorFor(postError)}
          />
        )}
      </section>
    </div>
  );
}

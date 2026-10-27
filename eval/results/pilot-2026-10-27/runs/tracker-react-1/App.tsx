import { useEffect, useRef, useState } from "react";
import { assign, fetchIssue, fetchIssues } from "./api.js";
import type { Issue, IssueDetail } from "./api.js";

type Filter = "open" | "closed";

type ListState =
  | { version: number; status: "ok"; items: Issue[] }
  | { version: number; status: "error"; message: string };

type DetailState =
  | { status: "loading"; id: number }
  | { status: "ok"; id: number; issue: IssueDetail }
  | { status: "error"; id: number; message: string };

type PendingAssign = { seq: number; id: number; user: string };

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export default function App() {
  const [user, setUser] = useState("guest");

  // ---- list ----
  const [filter, setFilter] = useState<Filter>("open");
  const [version, setVersion] = useState(0);
  const [list, setList] = useState<ListState | null>(null);

  useEffect(() => {
    let current = true;
    fetchIssues(filter).then(
      items => {
        if (current) setList({ version, status: "ok", items });
      },
      (e: unknown) => {
        if (current) setList({ version, status: "error", message: messageOf(e) });
      },
    );
    return () => {
      current = false;
    };
  }, [filter, version]);

  const chooseFilter = (f: Filter) => {
    if (f === filter) return;
    setFilter(f);
    setVersion(v => v + 1);
  };

  // ---- detail ----
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<DetailState | null>(null);
  const detailToken = useRef(0);
  const selectionEpoch = useRef(0);

  const loadDetail = (id: number) => {
    const token = ++detailToken.current;
    fetchIssue(id).then(
      issue => {
        if (token !== detailToken.current) return;
        setDetail(
          issue
            ? { status: "ok", id, issue }
            : { status: "error", id, message: `issue #${id} not found` },
        );
      },
      (e: unknown) => {
        if (token !== detailToken.current) return;
        setDetail({ status: "error", id, message: messageOf(e) });
      },
    );
  };

  const select = (id: number) => {
    if (id === selectedId) return;
    selectionEpoch.current++;
    setSelectedId(id);
    setDetail({ status: "loading", id });
    setAssignError(null);
    loadDetail(id);
  };

  const retry = () => {
    if (selectedId === null) return;
    loadDetail(selectedId);
  };

  // ---- assign ----
  const [pending, setPending] = useState<PendingAssign[]>([]);
  const [assignError, setAssignError] = useState<string | null>(null);
  const assignSeq = useRef(0);
  const confirmedSeq = useRef(new Map<number, number>());

  const doAssign = () => {
    if (selectedId === null) return;
    const id = selectedId;
    const who = user;
    const seq = ++assignSeq.current;
    const epoch = selectionEpoch.current;
    setAssignError(null);
    setPending(p => [...p, { seq, id, user: who }]);
    assign(id, who).then(
      result => {
        const last = confirmedSeq.current.get(id) ?? 0;
        if (seq > last) {
          confirmedSeq.current.set(id, seq);
          setList(prev =>
            prev && prev.status === "ok"
              ? {
                  ...prev,
                  items: prev.items.map(it => (it.id === id ? { ...it, assignee: result.assignee } : it)),
                }
              : prev,
          );
        }
        setPending(p => p.filter(op => op.seq !== seq));
      },
      (e: unknown) => {
        setPending(p => p.filter(op => op.seq !== seq));
        if (epoch === selectionEpoch.current) setAssignError(messageOf(e));
      },
    );
  };

  const assigneeOf = (issue: Issue): string | null => {
    let shown: PendingAssign | null = null;
    for (const op of pending) if (op.id === issue.id && (!shown || op.seq > shown.seq)) shown = op;
    return shown ? shown.user : issue.assignee;
  };

  // ---- render ----
  let listBody;
  if (!list || list.version !== version) {
    listBody = <p>loading {filter} issues</p>;
  } else if (list.status === "error") {
    listBody = <p>list error: {list.message}</p>;
  } else {
    listBody = (
      <ul>
        {list.items.map(issue => (
          <li
            key={issue.id}
            data-testid="issue"
            onClick={() => select(issue.id)}
            style={{ cursor: "pointer", fontWeight: issue.id === selectedId ? "bold" : undefined }}
          >
            {`#${issue.id} ${issue.title} (${assigneeOf(issue) ?? "unassigned"})`}
          </li>
        ))}
      </ul>
    );
  }

  let detailBody;
  if (selectedId === null || !detail) {
    detailBody = <p>select an issue</p>;
  } else {
    let content;
    if (detail.status === "loading") content = <p>{`loading #${detail.id}`}</p>;
    else if (detail.status === "error") content = <p>detail error: {detail.message}</p>;
    else
      content = (
        <>
          <h2>{`#${detail.issue.id} ${detail.issue.title}`}</h2>
          <p>{detail.issue.body}</p>
        </>
      );
    detailBody = (
      <>
        {content}
        <button data-testid="retry" onClick={retry}>
          retry
        </button>
        <button data-testid="assign" onClick={doAssign}>
          {`assign to ${user}`}
        </button>
        {assignError !== null && <p>{assignError}</p>}
      </>
    );
  }

  return (
    <main>
      <label>
        user{" "}
        <input data-testid="user" value={user} onChange={e => setUser(e.target.value)} />
      </label>
      <div>
        <button data-testid="filter-open" onClick={() => chooseFilter("open")} aria-pressed={filter === "open"}>
          open
        </button>
        <button data-testid="filter-closed" onClick={() => chooseFilter("closed")} aria-pressed={filter === "closed"}>
          closed
        </button>
      </div>
      <div style={{ display: "flex", gap: "2rem" }}>
        <section data-testid="list">{listBody}</section>
        <section data-testid="detail">{detailBody}</section>
      </div>
    </main>
  );
}

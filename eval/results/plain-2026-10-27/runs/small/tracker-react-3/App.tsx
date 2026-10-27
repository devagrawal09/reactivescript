import { useEffect, useState } from "react";
import { assign, fetchIssue, fetchIssues } from "./api.js";
import type { Issue, IssueDetail } from "./api.js";

type Filter = "open" | "closed";

/** the list for `filter`: `issues` once loaded, `error` if the load failed */
type ListResult = { filter: Filter; issues?: Issue[]; error?: string };
/** the detail for issue `id`: `detail` is null when there is no such issue */
type DetailResult = { id: number; detail?: IssueDetail | null; error?: string };
type AssignError = { id: number; message: string };

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export default function App() {
  const [user, setUser] = useState("guest");
  const [filter, setFilter] = useState<Filter>("open");
  const [list, setList] = useState<ListResult | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [detail, setDetail] = useState<DetailResult | null>(null);
  const [assignError, setAssignError] = useState<AssignError | null>(null);

  // Load the list for the current filter. A result that arrives after the filter
  // has changed is ignored by the cleanup.
  useEffect(() => {
    let live = true;
    fetchIssues(filter).then(
      issues => { if (live) setList({ filter, issues }); },
      e => { if (live) setList({ filter, error: messageOf(e) }); },
    );
    return () => { live = false; };
  }, [filter]);

  // Load the selected issue. `attempt` changes on retry.
  useEffect(() => {
    if (selectedId === null) return;
    let live = true;
    fetchIssue(selectedId).then(
      d => { if (live) setDetail({ id: selectedId, detail: d }); },
      e => { if (live) setDetail({ id: selectedId, error: messageOf(e) }); },
    );
    return () => { live = false; };
  }, [selectedId, attempt]);

  function chooseFilter(f: Filter) {
    if (f === filter) return;
    setFilter(f);
    setList(null);
  }

  function select(id: number) {
    if (id === selectedId) return;
    setSelectedId(id);
    setDetail(null);
    setAssignError(null);
  }

  function retry() {
    setDetail(null);
    setAttempt(a => a + 1);
  }

  function setAssignee(id: number, assignee: string | null) {
    setList(prev =>
      prev?.issues
        ? { ...prev, issues: prev.issues.map(i => (i.id === id ? { ...i, assignee } : i)) }
        : prev,
    );
  }

  async function assignSelected() {
    if (selectedId === null) return;
    const id = selectedId;
    const who = user;
    const before = list?.issues?.find(i => i.id === id)?.assignee ?? null;
    setAssignError(null);
    setAssignee(id, who);
    try {
      await assign(id, who);
    } catch (e) {
      setAssignee(id, before);
      setAssignError({ id, message: messageOf(e) });
    }
  }

  const detailLoading = selectedId !== null && (detail === null || detail.id !== selectedId);
  const detailFailed = selectedId !== null && !detailLoading && detail !== null
    && (detail.error !== undefined || detail.detail === null);

  let listContent;
  if (list === null) {
    listContent = <p>{`loading ${filter} issues`}</p>;
  } else if (list.error !== undefined) {
    listContent = <p role="alert">{`list error: ${list.error}`}</p>;
  } else {
    listContent = (
      <ul>
        {(list.issues ?? []).map(i => (
          <li
            key={i.id}
            data-testid="issue"
            role="button"
            tabIndex={0}
            onClick={() => select(i.id)}
            onKeyDown={e => {
              if (e.key === "Enter" || e.key === " ") select(i.id);
            }}
          >
            {`#${i.id} ${i.title} (${i.assignee ?? "unassigned"})`}
          </li>
        ))}
      </ul>
    );
  }

  let detailContent;
  if (selectedId === null) {
    detailContent = <p>select an issue</p>;
  } else if (detailLoading || detail === null) {
    detailContent = <p>{`loading #${selectedId}`}</p>;
  } else if (detail.error !== undefined) {
    detailContent = <p role="alert">{`detail error: ${detail.error}`}</p>;
  } else if (detail.detail === null || detail.detail === undefined) {
    detailContent = <p role="alert">{`detail error: issue #${selectedId} not found`}</p>;
  } else {
    detailContent = (
      <>
        <h2>{`#${detail.detail.id} ${detail.detail.title}`}</h2>
        <p>{detail.detail.body}</p>
      </>
    );
  }

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", display: "flex", gap: "2rem", padding: "1rem" }}>
      <section style={{ flex: "1 1 0", minWidth: 0 }}>
        <label>
          User <input data-testid="user" value={user} onChange={e => setUser(e.target.value)} />
        </label>
        <div style={{ margin: "0.5rem 0" }}>
          <button
            data-testid="filter-open"
            aria-pressed={filter === "open"}
            onClick={() => chooseFilter("open")}
          >
            open
          </button>{" "}
          <button
            data-testid="filter-closed"
            aria-pressed={filter === "closed"}
            onClick={() => chooseFilter("closed")}
          >
            closed
          </button>
        </div>
        <div data-testid="list">{listContent}</div>
      </section>

      <section data-testid="detail" style={{ flex: "1 1 0", minWidth: 0 }}>
        {detailContent}
        {detailFailed && (
          <button data-testid="retry" onClick={retry}>retry</button>
        )}
        {selectedId !== null && (
          <div style={{ marginTop: "1rem" }}>
            <button data-testid="assign" onClick={assignSelected}>{`assign to ${user}`}</button>
            {assignError !== null && assignError.id === selectedId && (
              <p role="alert">{assignError.message}</p>
            )}
          </div>
        )}
      </section>
    </main>
  );
}

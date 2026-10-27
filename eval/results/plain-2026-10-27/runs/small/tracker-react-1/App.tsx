import { useEffect, useState } from "react";
import { assign, fetchIssue, fetchIssues } from "./api.js";
import type { Issue, IssueDetail } from "./api.js";

type Filter = "open" | "closed";

type ListState =
  | { filter: Filter; ok: true; issues: Issue[] }
  | { filter: Filter; ok: false; message: string };

type DetailResult = { value: IssueDetail | null } | { message: string };

type DetailState = { id: number; attempt: number; result: DetailResult };

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export default function App() {
  const [user, setUser] = useState("guest");
  const [filter, setFilter] = useState<Filter>("open");
  const [list, setList] = useState<ListState | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [detail, setDetail] = useState<DetailState | null>(null);
  const [assignError, setAssignError] = useState<{ id: number; message: string } | null>(null);

  // Load the issues for the current filter. Results from a filter that is no longer
  // current are dropped by the cleanup.
  useEffect(() => {
    let live = true;
    fetchIssues(filter).then(
      issues => { if (live) setList({ filter, ok: true, issues }); },
      e => { if (live) setList({ filter, ok: false, message: errorMessage(e) }); },
    );
    return () => { live = false; };
  }, [filter]);

  // Load the selected issue's detail, again whenever a retry is asked for.
  useEffect(() => {
    if (selected === null) return;
    let live = true;
    const id = selected;
    const at = attempt;
    const done = (result: DetailResult) => { if (live) setDetail({ id, attempt: at, result }); };
    fetchIssue(id).then(
      value => done({ value }),
      e => done({ message: errorMessage(e) }),
    );
    return () => { live = false; };
  }, [selected, attempt]);

  const changeFilter = (next: Filter) => {
    if (next === filter) return;
    setList(null);
    setFilter(next);
  };

  const select = (id: number) => {
    setAssignError(null);
    setDetail(null);
    setSelected(id);
  };

  const retry = () => {
    setDetail(null);
    setAttempt(a => a + 1);
  };

  const setAssignee = (id: number, assignee: string | null) =>
    setList(l => (l && l.ok ? { ...l, issues: l.issues.map(i => (i.id === id ? { ...i, assignee } : i)) } : l));

  const assignSelected = async (id: number) => {
    const who = user;
    const row = list?.ok ? list.issues.find(i => i.id === id) : undefined;
    const before = row ? row.assignee : null;
    setAssignError(null);
    setAssignee(id, who);
    try {
      const updated = await assign(id, who);
      setAssignee(id, updated.assignee);
    } catch (e) {
      setAssignee(id, before);
      setAssignError({ id, message: errorMessage(e) });
    }
  };

  const listLoading = list === null || list.filter !== filter;

  let listContent;
  if (listLoading) {
    listContent = <p>{`loading ${filter} issues`}</p>;
  } else if (!list.ok) {
    listContent = <p>{`list error: ${list.message}`}</p>;
  } else {
    listContent = (
      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {list.issues.map(i => (
          <li key={i.id}>
            <button
              type="button"
              data-testid="issue"
              aria-current={i.id === selected ? "true" : undefined}
              onClick={() => select(i.id)}
              style={{ width: "100%", textAlign: "left", padding: "6px 8px", background: i.id === selected ? "#e8eefc" : "transparent" }}
            >
              {`#${i.id} ${i.title} (${i.assignee ?? "unassigned"})`}
            </button>
          </li>
        ))}
      </ul>
    );
  }

  const detailCurrent = detail !== null && detail.id === selected && detail.attempt === attempt;

  let detailContent;
  if (selected === null) {
    detailContent = <p>select an issue</p>;
  } else if (!detailCurrent) {
    detailContent = <p>{`loading #${selected}`}</p>;
  } else if ("message" in detail.result) {
    detailContent = <p>{`detail error: ${detail.result.message}`}</p>;
  } else if (detail.result.value === null) {
    detailContent = <p>{`detail error: issue #${selected} not found`}</p>;
  } else {
    detailContent = (
      <>
        <h2>{`#${detail.result.value.id} ${detail.result.value.title}`}</h2>
        <p>{detail.result.value.body}</p>
      </>
    );
  }
  const showRetry = detailCurrent && ("message" in detail.result || detail.result.value === null);

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", padding: 16 }}>
      <header style={{ marginBottom: 12 }}>
        <label>
          Current user{" "}
          <input data-testid="user" value={user} onChange={e => setUser(e.target.value)} />
        </label>
      </header>
      <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
        <section style={{ flex: "1 1 0", minWidth: 0 }}>
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <button
              type="button"
              data-testid="filter-open"
              aria-pressed={filter === "open"}
              onClick={() => changeFilter("open")}
            >
              open
            </button>
            <button
              type="button"
              data-testid="filter-closed"
              aria-pressed={filter === "closed"}
              onClick={() => changeFilter("closed")}
            >
              closed
            </button>
          </div>
          <div data-testid="list">{listContent}</div>
        </section>
        <section data-testid="detail" style={{ flex: "1 1 0", minWidth: 0 }}>
          {detailContent}
          {showRetry && (
            <button type="button" data-testid="retry" onClick={retry}>
              retry
            </button>
          )}
          {selected !== null && (
            <div style={{ marginTop: 12 }}>
              <button
                type="button"
                data-testid="assign"
                onClick={() => assignSelected(selected)}
              >
                {`assign to ${user}`}
              </button>
              {assignError !== null && assignError.id === selected && (
                <p>{`detail error: ${assignError.message}`}</p>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

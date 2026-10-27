import { useEffect, useState } from "react";
import { assign, fetchIssue, fetchIssues } from "./api.js";
import type { Issue, IssueDetail } from "./api.js";

type Filter = "open" | "closed";

type ListRequest = { seq: number; filter: Filter };
type ListResult =
  | { seq: number; ok: true; issues: Issue[] }
  | { seq: number; ok: false; message: string };

type Selection = { id: number; selSeq: number; fetchSeq: number };
type DetailResult = {
  id: number;
  selSeq: number;
  fetchSeq: number;
  detail: IssueDetail | null;
  error: string | null;
};

type Pending = { seq: number; user: string };
type Assignments = Record<
  number,
  { pending: Pending[]; confirmed: { seq: number; user: string } | null }
>;

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

export default function App() {
  const [user, setUser] = useState("guest");
  const [listReq, setListReq] = useState<ListRequest>({ seq: 0, filter: "open" });
  const [listResult, setListResult] = useState<ListResult | null>(null);

  const [selection, setSelection] = useState<Selection | null>(null);
  const [detailResult, setDetailResult] = useState<DetailResult | null>(null);

  const [assignments, setAssignments] = useState<Assignments>({});
  const [assignSeq, setAssignSeq] = useState(0);
  const [assignToken, setAssignToken] = useState(0);
  const [assignError, setAssignError] = useState<{ token: number; message: string } | null>(null);

  // List loading
  useEffect(() => {
    let live = true;
    const { seq, filter } = listReq;
    fetchIssues(filter).then(
      (issues) => {
        if (live) setListResult({ seq, ok: true, issues });
      },
      (e: unknown) => {
        if (live) setListResult({ seq, ok: false, message: messageOf(e) });
      },
    );
    return () => {
      live = false;
    };
  }, [listReq]);

  // Detail loading
  useEffect(() => {
    if (!selection) return;
    let live = true;
    const { id, selSeq, fetchSeq } = selection;
    fetchIssue(id).then(
      (detail) => {
        if (live) setDetailResult({ id, selSeq, fetchSeq, detail, error: null });
      },
      (e: unknown) => {
        if (live) setDetailResult({ id, selSeq, fetchSeq, detail: null, error: messageOf(e) });
      },
    );
    return () => {
      live = false;
    };
  }, [selection]);

  const chooseFilter = (filter: Filter) => {
    setListReq((r) => ({ seq: r.seq + 1, filter }));
  };

  const select = (id: number) => {
    if (selection && selection.id === id) return;
    setSelection((s) => ({ id, selSeq: (s?.selSeq ?? 0) + 1, fetchSeq: 0 }));
    setAssignToken((t) => t + 1);
    setAssignError(null);
  };

  const retry = () => {
    setSelection((s) => (s ? { ...s, fetchSeq: s.fetchSeq + 1 } : s));
  };

  const doAssign = () => {
    if (!selection) return;
    const id = selection.id;
    const who = user;
    const seq = assignSeq + 1;
    const token = assignToken + 1;
    setAssignSeq(seq);
    setAssignToken(token);
    setAssignError(null);
    setAssignments((a) => {
      const cur = a[id] ?? { pending: [], confirmed: null };
      return { ...a, [id]: { ...cur, pending: [...cur.pending, { seq, user: who }] } };
    });
    assign(id, who).then(
      (res) => {
        setAssignments((a) => {
          const cur = a[id] ?? { pending: [], confirmed: null };
          const pending = cur.pending.filter((p) => p.seq !== seq);
          const confirmed =
            cur.confirmed && cur.confirmed.seq > seq ? cur.confirmed : { seq, user: res.assignee ?? who };
          return { ...a, [id]: { pending, confirmed } };
        });
      },
      (e: unknown) => {
        setAssignments((a) => {
          const cur = a[id] ?? { pending: [], confirmed: null };
          return { ...a, [id]: { ...cur, pending: cur.pending.filter((p) => p.seq !== seq) } };
        });
        setAssignError({ token, message: messageOf(e) });
      },
    );
  };

  const assigneeOf = (issue: Issue): string | null => {
    const a = assignments[issue.id];
    if (a) {
      if (a.pending.length) return a.pending[a.pending.length - 1].user;
      if (a.confirmed) return a.confirmed.user;
    }
    return issue.assignee;
  };

  // List view
  let listView;
  if (!listResult || listResult.seq !== listReq.seq) {
    listView = <p>loading {listReq.filter} issues</p>;
  } else if (!listResult.ok) {
    listView = <p>list error: {listResult.message}</p>;
  } else {
    listView = (
      <ul>
        {listResult.issues.map((issue) => {
          const assignee = assigneeOf(issue);
          return (
            <li
              key={issue.id}
              data-testid="issue"
              onClick={() => select(issue.id)}
              style={{
                cursor: "pointer",
                fontWeight: selection?.id === issue.id ? "bold" : undefined,
              }}
            >
              #{issue.id} {issue.title} ({assignee ?? "unassigned"})
            </li>
          );
        })}
      </ul>
    );
  }

  // Detail view
  let detailView;
  if (!selection) {
    detailView = <p>select an issue</p>;
  } else {
    const shown =
      detailResult && detailResult.id === selection.id && detailResult.selSeq === selection.selSeq
        ? detailResult
        : null;
    let content;
    if (!shown) {
      content = <p>loading #{selection.id}</p>;
    } else if (shown.error !== null) {
      content = <p>detail error: {shown.error}</p>;
    } else if (shown.detail === null) {
      content = <p>detail error: issue #{selection.id} not found</p>;
    } else {
      content = (
        <>
          <h2>
            #{shown.detail.id} {shown.detail.title}
          </h2>
          <p>{shown.detail.body}</p>
        </>
      );
    }
    detailView = (
      <>
        {content}
        <button data-testid="retry" onClick={retry}>
          retry
        </button>
        <button data-testid="assign" onClick={doAssign}>
          assign to {user}
        </button>
        {assignError && assignError.token === assignToken && <p>{assignError.message}</p>}
      </>
    );
  }

  return (
    <div>
      <label>
        user <input data-testid="user" value={user} onChange={(e) => setUser(e.target.value)} />
      </label>
      <div>
        <button data-testid="filter-open" onClick={() => chooseFilter("open")}>
          open
        </button>
        <button data-testid="filter-closed" onClick={() => chooseFilter("closed")}>
          closed
        </button>
      </div>
      <div style={{ display: "flex", gap: "2rem" }}>
        <div data-testid="list">{listView}</div>
        <div data-testid="detail">{detailView}</div>
      </div>
    </div>
  );
}

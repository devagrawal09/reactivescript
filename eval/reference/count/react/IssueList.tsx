import type { Issue } from "./api";
import { errorMessage } from "./errors";

type Props = {
  filter: "open" | "closed";
  issues: Issue[] | undefined;
  isPending: boolean;
  error: unknown;
  selected: number | null;
  onSelect: (id: number) => void;
};

export default function IssueList({ filter, issues, isPending, error, selected, onSelect }: Props) {
  if (isPending) return <p>loading {filter} issues</p>;
  if (error || !issues) return <p>list error: {errorMessage(error)}</p>;
  return (
    <ul>
      {issues.map(issue => (
        <li key={issue.id}>
          <button type="button" data-testid="issue" aria-pressed={issue.id === selected} onClick={() => onSelect(issue.id)}>
            #{issue.id} {issue.title} ({issue.assignee ?? "unassigned"})
          </button>
        </li>
      ))}
    </ul>
  );
}

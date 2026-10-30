import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { addLabel, fetchLabels, removeLabel } from "./api";
import { errorMessage } from "./errors";

type Change = { issueId: number; kind: "add" | "remove"; label: string };

// Label changes follow TanStack Query's "Optimistic Updates" guide (via the cache), like the issues page's writes.
export default function Labels({ id }: { id: number }) {
  const queryClient = useQueryClient();
  const labels = useQuery({ queryKey: ["labels", id], queryFn: () => fetchLabels(id) });
  const [labelInput, setLabelInput] = useState("");

  const change = useMutation({
    mutationFn: ({ issueId, kind, label }: Change) => (kind === "add" ? addLabel(issueId, label) : removeLabel(issueId, label)),
    onMutate: async ({ issueId, kind, label }: Change) => {
      await queryClient.cancelQueries({ queryKey: ["labels", issueId] });
      const previous = queryClient.getQueryData<string[]>(["labels", issueId]);
      queryClient.setQueryData<string[]>(["labels", issueId], old =>
        old && (kind === "add" ? [...old, label] : old.filter(l => l !== label)),
      );
      return { previous };
    },
    onError: (_e, { issueId }, snapshot) => queryClient.setQueryData(["labels", issueId], snapshot?.previous),
    onSettled: (_d, _e, { issueId }) => {
      void queryClient.invalidateQueries({ queryKey: ["labels", issueId] });
    },
  });

  // a label error belongs to the issue it was made on: selecting another clears it
  const reset = change.reset;
  useEffect(() => reset(), [id, reset]);

  const shown = labels.data ?? [];
  return (
    <div>
      <div data-testid="labels">
        {labels.isPending ? (
          <p>loading labels</p>
        ) : labels.isError ? (
          <p>labels error: {errorMessage(labels.error)}</p>
        ) : (
          <ul>
            {shown.map(l => (
              <li key={l}>
                <span data-testid="label">{l}</span>{" "}
                <button type="button" data-testid="remove-label" onClick={() => change.mutate({ issueId: id, kind: "remove", label: l })}>
                  remove {l}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <input data-testid="label-input" value={labelInput} onChange={e => setLabelInput(e.target.value)} />
      <button
        type="button"
        data-testid="add-label"
        onClick={() => {
          if (labelInput !== "" && !shown.includes(labelInput)) {
            setLabelInput("");
            change.mutate({ issueId: id, kind: "add", label: labelInput });
          }
        }}
      >
        add label
      </button>
      {change.error && change.variables?.issueId === id && <p>label error: {errorMessage(change.error)}</p>}
    </div>
  );
}

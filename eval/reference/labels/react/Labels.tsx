import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { addLabel, fetchLabels, removeLabel } from "./api";
import { errorMessage } from "./errors";

// a label change in the air, on one issue
type Change = { seq: number; issueId: number; label: string };

export default function Labels({ id }: { id: number }) {
  const queryClient = useQueryClient();
  const labels = useQuery({ queryKey: ["labels", id], queryFn: () => fetchLabels(id) });
  const [adding, setAdding] = useState<Change[]>([]);
  const [removing, setRemoving] = useState<Change[]>([]);
  const [labelError, setLabelError] = useState("");
  const [labelInput, setLabelInput] = useState("");
  const seqRef = useRef(0);

  // a label error belongs to the issue it was made on: selecting another clears it
  useEffect(() => setLabelError(""), [id]);

  const shown = [
    ...(labels.data ?? []).filter(l => !removing.some(r => r.issueId === id && r.label === l)),
    ...adding.filter(a => a.issueId === id).map(a => a.label),
  ];

  const change = async (kind: "add" | "remove", issueId: number, label: string) => {
    const seq = ++seqRef.current;
    const set = kind === "add" ? setAdding : setRemoving;
    setLabelError("");
    set(prev => [...prev, { seq, issueId, label }]);
    try {
      const after = await (kind === "add" ? addLabel(issueId, label) : removeLabel(issueId, label));
      queryClient.setQueryData(["labels", issueId], after);
    } catch (e) {
      if (seqRef.current === seq) setLabelError(errorMessage(e));
    } finally {
      set(prev => prev.filter(c => c.seq !== seq));
    }
  };

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
                <button type="button" data-testid="remove-label" onClick={() => void change("remove", id, l)}>
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
            void change("add", id, labelInput);
          }
        }}
      >
        add label
      </button>
      {labelError && <p>label error: {labelError}</p>}
    </div>
  );
}

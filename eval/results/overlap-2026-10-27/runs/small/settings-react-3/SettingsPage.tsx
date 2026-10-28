import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { loadSettings, saveSettings } from "./api.js";
import type { Settings } from "./api.js";
import SettingsForm from "./SettingsForm";

const SETTINGS_KEY = ["settings"] as const;

function describeSettings(s: Settings): string {
  return `${s.name} · ${s.theme} · ${s.density}`;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: SETTINGS_KEY,
    queryFn: () => loadSettings(),
  });
  const mutation = useMutation({
    mutationFn: (s: Settings) => saveSettings(s),
    onSuccess: (saved) => {
      queryClient.setQueryData(SETTINGS_KEY, saved);
    },
  });

  if (!query.data) {
    if (query.isFetching || query.isPending) {
      return <p data-testid="load">Loading settings…</p>;
    }
    return (
      <div>
        <p data-testid="load">Could not load settings: {messageOf(query.error)}</p>
        <button type="button" data-testid="retry-load" onClick={() => void query.refetch()}>
          Retry
        </button>
      </div>
    );
  }

  const savedText =
    mutation.isPending && mutation.variables
      ? `Saved: ${describeSettings(mutation.variables)} (saving…)`
      : `Saved: ${describeSettings(query.data)}`;

  return (
    <main>
      <p data-testid="saved">{savedText}</p>
      <SettingsForm initial={query.data} onSave={(s) => mutation.mutate(s)} />
      {mutation.isError && (
        <p data-testid="save-error">Save failed: {messageOf(mutation.error)}</p>
      )}
    </main>
  );
}

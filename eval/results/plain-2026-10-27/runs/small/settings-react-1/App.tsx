import { useState } from "react";
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { loadSettings, saveSettings } from "./api.js";
import type { Settings } from "./api.js";

const SETTINGS_KEY = ["settings"] as const;
const MAX_NAME = 20;

function nameError(name: string): string | null {
  if (name.trim() === "") return "Display name is required";
  if (name.length > MAX_NAME) {
    return `Display name must be at most ${MAX_NAME} characters, not ${name.length}`;
  }
  return null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function SettingsForm({ saved }: { saved: Settings }) {
  const queryClient = useQueryClient();
  // The draft is seeded once from the first loaded settings and then belongs to the user.
  const [draft, setDraft] = useState<Settings>(saved);

  const save = useMutation({
    mutationFn: (settings: Settings) => saveSettings(settings),
    onSuccess: (result) => {
      queryClient.setQueryData(SETTINGS_KEY, result);
    },
  });

  const error = nameError(draft.name);
  const pending = save.isPending ? save.variables : undefined;
  const shown = pending ?? saved;
  const savedText =
    `Saved: ${shown.name} · ${shown.theme} · ${shown.density}` +
    (pending ? " (saving…)" : "");

  const onSave = () => {
    if (nameError(draft.name) !== null) return;
    save.mutate(draft);
  };

  return (
    <div>
      <p data-testid="saved">{savedText}</p>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSave();
        }}
      >
        <label>
          Display name
          <input
            data-testid="name"
            value={draft.name}
            onChange={(event) => {
              const name = event.target.value;
              setDraft((d) => ({ ...d, name }));
            }}
          />
        </label>
        <span data-testid="name-count">{`${draft.name.length}/${MAX_NAME}`}</span>
        {error !== null && <p data-testid="name-error">{error}</p>}

        <fieldset>
          <legend>Theme</legend>
          <button
            type="button"
            data-testid="theme-light"
            aria-pressed={draft.theme === "light"}
            onClick={() => setDraft((d) => ({ ...d, theme: "light" }))}
          >
            Light
          </button>
          <button
            type="button"
            data-testid="theme-dark"
            aria-pressed={draft.theme === "dark"}
            onClick={() => setDraft((d) => ({ ...d, theme: "dark" }))}
          >
            Dark
          </button>
        </fieldset>

        <button
          type="button"
          data-testid="density-toggle"
          onClick={() =>
            setDraft((d) => ({
              ...d,
              density: d.density === "compact" ? "comfortable" : "compact",
            }))
          }
        >
          {`Density: ${draft.density}`}
        </button>

        <p data-testid="preview">{`Preview: ${draft.theme} / ${draft.density}`}</p>

        <button type="button" data-testid="save" onClick={onSave}>
          Save
        </button>
      </form>

      {save.isError && (
        <p data-testid="save-error">{`Save failed: ${errorMessage(save.error)}`}</p>
      )}
    </div>
  );
}

function SettingsPage() {
  const query = useQuery({
    queryKey: SETTINGS_KEY,
    queryFn: () => loadSettings(),
    retry: false,
    refetchOnWindowFocus: false,
  });

  if (query.data === undefined) {
    if (query.isError) {
      return (
        <div>
          <p data-testid="load">{`Could not load settings: ${errorMessage(query.error)}`}</p>
          <button type="button" data-testid="retry-load" onClick={() => void query.refetch()}>
            Retry
          </button>
        </div>
      );
    }
    return <p data-testid="load">Loading settings…</p>;
  }

  return <SettingsForm saved={query.data} />;
}

export default function App() {
  const [client] = useState(() => new QueryClient());
  return (
    <QueryClientProvider client={client}>
      <SettingsPage />
    </QueryClientProvider>
  );
}

import { QueryClient, QueryClientProvider, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { loadSettings, saveSettings } from "./api.js";
import type { Density, Settings, Theme } from "./api.js";

const SETTINGS_KEY = ["settings"] as const;
const MAX_NAME = 20;

const queryClient = new QueryClient();

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <SettingsPage />
    </QueryClientProvider>
  );
}

function SettingsPage() {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: SETTINGS_KEY,
    queryFn: () => loadSettings(),
    retry: false,
  });
  const save = useMutation({
    mutationFn: (s: Settings) => saveSettings(s),
    // Only a successful save changes what counts as "saved".
    onSuccess: (s) => client.setQueryData(SETTINGS_KEY, s),
  });

  const saved = query.data;
  const loading = saved === undefined && query.isFetching;
  const loadFailed = saved === undefined && !query.isFetching && query.isError;

  return (
    <main>
      <h1>Settings</h1>

      {loading && <p data-testid="load">Loading settings…</p>}
      {loadFailed && (
        <p data-testid="load">
          Could not load settings: {query.error instanceof Error ? query.error.message : String(query.error)}{" "}
          <button data-testid="retry-load" onClick={() => void query.refetch()}>
            Retry
          </button>
        </p>
      )}

      {saved !== undefined && (
        <>
          <p data-testid="saved">
            {save.isPending && save.variables
              ? `Saved: ${describe(save.variables)} (saving…)`
              : `Saved: ${describe(saved)}`}
          </p>
          {save.isError && (
            <p data-testid="save-error" role="alert">
              Save failed: {save.error instanceof Error ? save.error.message : String(save.error)}
            </p>
          )}
          <Draft
            initial={saved}
            onSave={(draft) => {
              if (draft.name.length === 0 || draft.name.length > MAX_NAME) return;
              save.mutate(draft);
            }}
          />
        </>
      )}
    </main>
  );
}

function describe(s: Settings): string {
  return `${s.name} · ${s.theme} · ${s.density}`;
}

function Draft({ initial, onSave }: { initial: Settings; onSave: (s: Settings) => void }) {
  const [name, setName] = useState(initial.name);
  const [theme, setTheme] = useState<Theme>(initial.theme);
  const [density, setDensity] = useState<Density>(initial.density);

  const length = name.length;
  const nameError =
    length === 0
      ? "Display name is required"
      : length > MAX_NAME
        ? `Display name must be at most ${MAX_NAME} characters, not ${length}`
        : null;

  return (
    <form
      onSubmit={(e) => e.preventDefault()}
      style={{ display: "grid", gap: "0.75rem", maxWidth: "24rem" }}
    >
      <label style={{ display: "grid", gap: "0.25rem" }}>
        Display name
        <input
          data-testid="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-invalid={nameError !== null}
          aria-describedby={nameError ? "name-error" : undefined}
        />
      </label>
      <span data-testid="name-count">{`${length}/${MAX_NAME}`}</span>
      {nameError && (
        <span data-testid="name-error" id="name-error" role="alert">
          {nameError}
        </span>
      )}

      <div role="group" aria-label="Theme" style={{ display: "flex", gap: "0.5rem" }}>
        <button
          type="button"
          data-testid="theme-light"
          aria-pressed={theme === "light"}
          onClick={() => setTheme("light")}
        >
          Light
        </button>
        <button
          type="button"
          data-testid="theme-dark"
          aria-pressed={theme === "dark"}
          onClick={() => setTheme("dark")}
        >
          Dark
        </button>
      </div>

      <button
        type="button"
        data-testid="density-toggle"
        onClick={() => setDensity((d) => (d === "comfortable" ? "compact" : "comfortable"))}
      >
        Density: {density}
      </button>

      <p data-testid="preview">{`Preview: ${theme} / ${density}`}</p>

      <button
        type="button"
        data-testid="save"
        onClick={() => onSave({ name, theme, density })}
      >
        Save
      </button>
    </form>
  );
}

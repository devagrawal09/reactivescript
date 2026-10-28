import { useState } from "react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { loadSettings, saveSettings } from "./api.js";
import type { Settings, Theme, Density } from "./api.js";

const MAX_NAME = 20;

function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: Infinity,
        gcTime: Infinity,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        refetchOnMount: false,
      },
    },
  });
}

function nameError(name: string): string | null {
  if (name.length === 0) return "Display name is required";
  if (name.length > MAX_NAME) return `Display name must be at most ${MAX_NAME} characters, not ${name.length}`;
  return null;
}

function line(s: Settings): string {
  return `Saved: ${s.name} · ${s.theme} · ${s.density}`;
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

type SaveState = {
  confirmed: Settings;
  confirmedSeq: number;
  issued: number;
  pending: { seq: number; values: Settings }[];
  error: string | null;
};

function Editor({ initial }: { initial: Settings }) {
  const [draft, setDraft] = useState<Settings>(() => ({ ...initial }));
  const [save, setSave] = useState<SaveState>(() => ({
    confirmed: initial,
    confirmedSeq: 0,
    issued: 0,
    pending: [],
    error: null,
  }));

  const error = nameError(draft.name);

  function onSave() {
    if (error) return;
    const values: Settings = { name: draft.name, theme: draft.theme, density: draft.density };
    const seq = save.issued + 1;
    setSave(s => ({ ...s, issued: seq, pending: [...s.pending, { seq, values }], error: null }));
    saveSettings(values).then(
      saved => {
        setSave(s => {
          const pending = s.pending.filter(p => p.seq !== seq);
          if (seq > s.confirmedSeq) return { ...s, pending, confirmed: saved, confirmedSeq: seq };
          return { ...s, pending };
        });
      },
      (e: unknown) => {
        setSave(s => {
          const pending = s.pending.filter(p => p.seq !== seq);
          const latest = seq === s.issued;
          return { ...s, pending, error: latest ? `Save failed: ${errorMessage(e)}` : s.error };
        });
      },
    );
  }

  const newestPending = save.pending.reduce<{ seq: number; values: Settings } | null>(
    (a, p) => (a === null || p.seq > a.seq ? p : a),
    null,
  );
  const savedText =
    newestPending && newestPending.seq > save.confirmedSeq
      ? `${line(newestPending.values)} (saving…)`
      : line(save.confirmed);

  const setTheme = (theme: Theme) => setDraft(d => ({ ...d, theme }));
  const toggleDensity = () =>
    setDraft(d => ({ ...d, density: (d.density === "comfortable" ? "compact" : "comfortable") as Density }));

  return (
    <div>
      <p data-testid="saved">{savedText}</p>
      <form
        onSubmit={e => {
          e.preventDefault();
          onSave();
        }}
      >
        <label>
          Display name{" "}
          <input
            data-testid="name"
            value={draft.name}
            onChange={e => {
              const name = e.target.value;
              setDraft(d => ({ ...d, name }));
            }}
            aria-invalid={error ? true : undefined}
          />
        </label>
        <span data-testid="name-count">
          {draft.name.length}/{MAX_NAME}
        </span>
        {error && (
          <p data-testid="name-error" role="alert">
            {error}
          </p>
        )}
        <div>
          <button type="button" data-testid="theme-light" aria-pressed={draft.theme === "light"} onClick={() => setTheme("light")}>
            Light
          </button>
          <button type="button" data-testid="theme-dark" aria-pressed={draft.theme === "dark"} onClick={() => setTheme("dark")}>
            Dark
          </button>
          <button type="button" data-testid="density-toggle" onClick={toggleDensity}>
            Density: {draft.density}
          </button>
        </div>
        <p data-testid="preview">
          Preview: {draft.theme} / {draft.density}
        </p>
        <button type="submit" data-testid="save">
          Save
        </button>
        {save.error && (
          <p data-testid="save-error" role="alert">
            {save.error}
          </p>
        )}
      </form>
    </div>
  );
}

function SettingsPage() {
  const query = useQuery({ queryKey: ["settings"], queryFn: () => loadSettings() });

  if (query.data) return <Editor initial={query.data} />;

  if (query.isError && !query.isFetching) {
    return (
      <div>
        <p data-testid="load">Could not load settings: {errorMessage(query.error)}</p>
        <button type="button" data-testid="retry-load" onClick={() => void query.refetch()}>
          Retry
        </button>
      </div>
    );
  }

  return <p data-testid="load">Loading settings…</p>;
}

export default function App() {
  const [client] = useState(makeClient);
  return (
    <QueryClientProvider client={client}>
      <h1>Settings</h1>
      <SettingsPage />
    </QueryClientProvider>
  );
}

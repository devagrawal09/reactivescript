import { useRef, useState } from "react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { loadSettings, saveSettings } from "./api.js";
import type { Settings } from "./api.js";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      refetchOnMount: false,
      staleTime: Infinity,
      gcTime: Infinity,
    },
  },
});

const MAX = 20;

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function line(s: Settings): string {
  return `Saved: ${s.name} · ${s.theme} · ${s.density}`;
}

function nameError(name: string): string | null {
  if (name.length === 0) return "Display name is required";
  if (name.length > MAX) return `Display name must be at most ${MAX} characters, not ${name.length}`;
  return null;
}

function Editor({ initial }: { initial: Settings }) {
  const [draft, setDraft] = useState<Settings>(initial);
  const [saved, setSaved] = useState<Settings>(initial);
  const [pending, setPending] = useState<Settings | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const seq = useRef(0);
  const savedSeq = useRef(0);

  const error = nameError(draft.name);

  function save() {
    if (nameError(draft.name)) return;
    const values: Settings = { ...draft };
    const id = ++seq.current;
    setPending(values);
    setSaveError(null);
    saveSettings(values).then(
      result => {
        if (id > savedSeq.current) {
          savedSeq.current = id;
          setSaved(result);
        }
        if (id === seq.current) setPending(null);
      },
      (e: unknown) => {
        if (id === seq.current) {
          setPending(null);
          setSaveError(`Save failed: ${message(e)}`);
        }
      },
    );
  }

  return (
    <div>
      <p data-testid="saved">{pending ? `${line(pending)} (saving…)` : line(saved)}</p>
      <form
        onSubmit={e => {
          e.preventDefault();
          save();
        }}
      >
        <label>
          Display name{" "}
          <input
            data-testid="name"
            value={draft.name}
            onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
          />
        </label>{" "}
        <span data-testid="name-count">
          {draft.name.length}/{MAX}
        </span>
        {error && (
          <p data-testid="name-error" role="alert">
            {error}
          </p>
        )}
        <div>
          <button
            type="button"
            data-testid="theme-light"
            aria-pressed={draft.theme === "light"}
            onClick={() => setDraft(d => ({ ...d, theme: "light" }))}
          >
            Light
          </button>
          <button
            type="button"
            data-testid="theme-dark"
            aria-pressed={draft.theme === "dark"}
            onClick={() => setDraft(d => ({ ...d, theme: "dark" }))}
          >
            Dark
          </button>
          <button
            type="button"
            data-testid="density-toggle"
            onClick={() =>
              setDraft(d => ({ ...d, density: d.density === "comfortable" ? "compact" : "comfortable" }))
            }
          >
            Toggle density
          </button>
        </div>
        <p data-testid="preview">
          Preview: {draft.theme} / {draft.density}
        </p>
        <button type="submit" data-testid="save">
          Save
        </button>
        {saveError && (
          <p data-testid="save-error" role="alert">
            {saveError}
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
        <p data-testid="load">Could not load settings: {message(query.error)}</p>
        <button type="button" data-testid="retry-load" onClick={() => void query.refetch()}>
          Retry
        </button>
      </div>
    );
  }

  return <p data-testid="load">Loading settings…</p>;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <SettingsPage />
    </QueryClientProvider>
  );
}

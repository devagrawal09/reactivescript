import { useRef, useState } from "react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { loadSettings, saveSettings } from "./api.js";
import type { Settings } from "./api.js";

const queryClient = new QueryClient({
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

const MAX_NAME = 20;

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function nameError(name: string): string | null {
  if (name.length === 0) return "Display name is required";
  if (name.length > MAX_NAME) return `Display name must be at most ${MAX_NAME} characters, not ${name.length}`;
  return null;
}

function SettingsPage() {
  const query = useQuery({ queryKey: ["settings"], queryFn: loadSettings });

  if (query.data) return <SettingsForm initial={query.data} />;

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

type Pending = { seq: number; settings: Settings };

function SettingsForm({ initial }: { initial: Settings }) {
  const [draft, setDraft] = useState<Settings>(initial);
  const [confirmed, setConfirmed] = useState<{ seq: number; settings: Settings }>({ seq: 0, settings: initial });
  const [pending, setPending] = useState<Pending | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const seqRef = useRef(0);

  const error = nameError(draft.name);
  const shown = pending ? pending.settings : confirmed.settings;

  function save() {
    if (nameError(draft.name)) return;
    const seq = ++seqRef.current;
    const settings = { ...draft };
    setPending({ seq, settings });
    setSaveError(null);
    saveSettings(settings).then(
      result => {
        setConfirmed(c => (seq > c.seq ? { seq, settings: result } : c));
        setPending(p => (p && p.seq === seq ? null : p));
      },
      (e: unknown) => {
        if (seq !== seqRef.current) return;
        setPending(p => (p && p.seq === seq ? null : p));
        setSaveError(`Save failed: ${errorMessage(e)}`);
      },
    );
  }

  return (
    <div>
      <p data-testid="saved">
        Saved: {shown.name} · {shown.theme} · {shown.density}
        {pending ? " (saving…)" : ""}
      </p>
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
            onChange={e => {
              const name = e.target.value;
              setDraft(d => ({ ...d, name }));
            }}
          />
        </label>
        <span data-testid="name-count">
          {draft.name.length}/{MAX_NAME}
        </span>
        {error && <p data-testid="name-error">{error}</p>}
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
            Density: {draft.density}
          </button>
        </div>
        <p data-testid="preview">
          Preview: {draft.theme} / {draft.density}
        </p>
        <button type="submit" data-testid="save">
          Save
        </button>
        {saveError && <p data-testid="save-error">{saveError}</p>}
      </form>
    </div>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <SettingsPage />
    </QueryClientProvider>
  );
}

import { useRef, useState } from "react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { loadSettings, saveSettings, type Settings } from "./api";

const MAX = 20;

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false, staleTime: Infinity, gcTime: Infinity, refetchOnWindowFocus: false, refetchOnReconnect: false },
  },
});

const fmt = (s: Settings) => `${s.name} · ${s.theme} · ${s.density}`;
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

function nameError(name: string): string | null {
  if (name.length === 0) return "Display name is required";
  if (name.length > MAX) return `Display name must be at most ${MAX} characters, not ${name.length}`;
  return null;
}

function SettingsPage() {
  const query = useQuery({ queryKey: ["settings"], queryFn: () => loadSettings() });

  if (query.data) return <Editor loaded={query.data} />;

  if (query.isError && !query.isFetching) {
    return (
      <div>
        <p data-testid="load">Could not load settings: {errMsg(query.error)}</p>
        <button data-testid="retry-load" onClick={() => void query.refetch()}>Retry</button>
      </div>
    );
  }
  return <p data-testid="load">Loading settings…</p>;
}

type Confirmed = { seq: number; value: Settings };
type Pending = { seq: number; value: Settings };

function Editor({ loaded }: { loaded: Settings }) {
  const [draft, setDraft] = useState<Settings>(loaded);
  const [confirmed, setConfirmed] = useState<Confirmed>({ seq: -1, value: loaded });
  const [pending, setPending] = useState<Pending | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const seqRef = useRef(0);

  const error = nameError(draft.name);

  const save = () => {
    if (error) return;
    const seq = seqRef.current++;
    const value = { ...draft };
    setPending({ seq, value });
    setSaveError(null);
    saveSettings(value).then(
      saved => {
        setConfirmed(c => (seq > c.seq ? { seq, value: saved } : c));
        setPending(p => (p && p.seq === seq ? null : p));
      },
      (e: unknown) => {
        // Only the latest save's failure is reported.
        if (seq === seqRef.current - 1) setSaveError(`Save failed: ${errMsg(e)}`);
        setPending(p => (p && p.seq === seq ? null : p));
      },
    );
  };

  const shown = pending ? `${fmt(pending.value)} (saving…)` : fmt(confirmed.value);

  return (
    <div>
      <p data-testid="saved">Saved: {shown}</p>
      <form onSubmit={e => { e.preventDefault(); save(); }}>
        <label>
          Display name{" "}
          <input
            data-testid="name"
            value={draft.name}
            onChange={e => { const name = e.target.value; setDraft(d => ({ ...d, name })); }}
          />
        </label>
        <span data-testid="name-count">{draft.name.length}/{MAX}</span>
        {error && <p data-testid="name-error">{error}</p>}
        <div>
          <button type="button" data-testid="theme-light" aria-pressed={draft.theme === "light"}
            onClick={() => setDraft(d => ({ ...d, theme: "light" }))}>Light</button>
          <button type="button" data-testid="theme-dark" aria-pressed={draft.theme === "dark"}
            onClick={() => setDraft(d => ({ ...d, theme: "dark" }))}>Dark</button>
          <button type="button" data-testid="density-toggle"
            onClick={() => setDraft(d => ({ ...d, density: d.density === "compact" ? "comfortable" : "compact" }))}>
            Density: {draft.density}
          </button>
        </div>
        <p data-testid="preview">Preview: {draft.theme} / {draft.density}</p>
        <button type="submit" data-testid="save">Save</button>
      </form>
      {saveError && <p data-testid="save-error">{saveError}</p>}
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

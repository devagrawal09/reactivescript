import { useState } from "react";
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

const MAX = 20;

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function nameError(name: string): string | null {
  if (name.length === 0) return "Display name is required";
  if (name.length > MAX) return `Display name must be at most ${MAX} characters, not ${name.length}`;
  return null;
}

type SaveState = {
  confirmed: Settings;
  confirmedSeq: number;
  latestSeq: number;
  pending: Settings | null; // values of the latest save while in flight
  error: string | null;
};

function SettingsPage({ initial }: { initial: Settings }) {
  const [draft, setDraft] = useState<Settings>(initial);
  const [save, setSave] = useState<SaveState>({
    confirmed: initial,
    confirmedSeq: 0,
    latestSeq: 0,
    pending: null,
    error: null,
  });

  const error = nameError(draft.name);

  const onSave = () => {
    if (error) return;
    const values: Settings = { ...draft };
    const seq = save.latestSeq + 1;
    setSave(s => ({ ...s, latestSeq: seq, pending: values, error: null }));
    saveSettings(values).then(
      result => {
        setSave(s => {
          const next = { ...s };
          if (seq > s.confirmedSeq) {
            next.confirmed = result;
            next.confirmedSeq = seq;
          }
          if (seq === s.latestSeq) next.pending = null;
          return next;
        });
      },
      (e: unknown) => {
        setSave(s => {
          if (seq !== s.latestSeq) return s;
          return { ...s, pending: null, error: `Save failed: ${errorMessage(e)}` };
        });
      },
    );
  };

  const shown = save.pending ?? save.confirmed;

  return (
    <div>
      <p data-testid="saved">
        {`Saved: ${shown.name} · ${shown.theme} · ${shown.density}${save.pending ? " (saving…)" : ""}`}
      </p>
      {save.error && <p data-testid="save-error" role="alert">{save.error}</p>}
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
          />
        </label>{" "}
        <span data-testid="name-count">{`${draft.name.length}/${MAX}`}</span>
        {error && <p data-testid="name-error" role="alert">{error}</p>}
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
              setDraft(d => ({ ...d, density: d.density === "compact" ? "comfortable" : "compact" }))
            }
          >
            Toggle density
          </button>
        </div>
        <p data-testid="preview">{`Preview: ${draft.theme} / ${draft.density}`}</p>
        <button type="submit" data-testid="save">
          Save
        </button>
      </form>
    </div>
  );
}

function Loader() {
  const query = useQuery({ queryKey: ["settings"], queryFn: () => loadSettings() });

  if (query.data) return <SettingsPage initial={query.data} />;

  if (query.isError && !query.isFetching) {
    return (
      <div>
        <p data-testid="load" role="alert">{`Could not load settings: ${errorMessage(query.error)}`}</p>
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
      <Loader />
    </QueryClientProvider>
  );
}

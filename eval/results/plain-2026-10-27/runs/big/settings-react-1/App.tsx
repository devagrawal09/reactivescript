import { useEffect, useRef, useState } from "react";
import { loadSettings, saveSettings } from "./api.js";
import type { Settings, Density } from "./api.js";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loaded" };

const MAX = 20;

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function line(s: Settings): string {
  return `Saved: ${s.name} · ${s.theme} · ${s.density}`;
}

export default function App() {
  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const [confirmed, setConfirmed] = useState<{ seq: number; settings: Settings } | null>(null);
  const [pending, setPending] = useState<{ seq: number; settings: Settings } | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Settings | null>(null);
  const started = useRef(false);
  const loadSeq = useRef(0);
  const saveSeq = useRef(0);

  function retryLoad() {
    setLoad({ status: "loading" });
    fetchSettings();
  }

  function fetchSettings() {
    const my = ++loadSeq.current;
    loadSettings().then(
      s => {
        if (my !== loadSeq.current) return;
        setLoad({ status: "loaded" });
        setConfirmed({ seq: 0, settings: s });
        setDraft({ name: s.name, theme: s.theme, density: s.density });
      },
      (e: unknown) => {
        if (my !== loadSeq.current) return;
        setLoad({ status: "error", message: errMessage(e) });
      },
    );
  }

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    fetchSettings();
  }, []);

  function nameError(name: string): string | null {
    if (name.length === 0) return "Display name is required";
    if (name.length > MAX) return `Display name must be at most ${MAX} characters, not ${name.length}`;
    return null;
  }

  function save() {
    if (!draft || nameError(draft.name)) return;
    const settings: Settings = { ...draft };
    const seq = ++saveSeq.current;
    setPending({ seq, settings });
    setSaveError(null);
    saveSettings(settings).then(
      saved => {
        setConfirmed(c => (c && c.seq > seq ? c : { seq, settings: saved }));
        setPending(p => (p && p.seq === seq ? null : p));
      },
      (e: unknown) => {
        setPending(p => (p && p.seq === seq ? null : p));
        if (seq === saveSeq.current) setSaveError(`Save failed: ${errMessage(e)}`);
      },
    );
  }

  if (load.status !== "loaded" || !draft) {
    return (
      <main>
        <h1>Settings</h1>
        {load.status === "error" ? (
          <>
            <p data-testid="load">Could not load settings: {load.message}</p>
            <button data-testid="retry-load" onClick={retryLoad}>Retry</button>
          </>
        ) : (
          <p data-testid="load">Loading settings…</p>
        )}
      </main>
    );
  }

  const error = nameError(draft.name);
  const savedText = pending
    ? `${line(pending.settings)} (saving…)`
    : confirmed
      ? line(confirmed.settings)
      : "";
  const nextDensity: Density = draft.density === "comfortable" ? "compact" : "comfortable";

  return (
    <main>
      <h1>Settings</h1>
      <p data-testid="saved">{savedText}</p>
      <form onSubmit={e => { e.preventDefault(); save(); }}>
        <label>
          Display name{" "}
          <input
            data-testid="name"
            value={draft.name}
            onChange={e => { const name = e.target.value; setDraft(d => (d ? { ...d, name } : d)); }}
          />
        </label>{" "}
        <span data-testid="name-count">{draft.name.length}/{MAX}</span>
        {error && <p data-testid="name-error" role="alert">{error}</p>}
        <div>
          Theme:{" "}
          <button type="button" data-testid="theme-light" aria-pressed={draft.theme === "light"}
            onClick={() => setDraft(d => (d ? { ...d, theme: "light" } : d))}>Light</button>{" "}
          <button type="button" data-testid="theme-dark" aria-pressed={draft.theme === "dark"}
            onClick={() => setDraft(d => (d ? { ...d, theme: "dark" } : d))}>Dark</button>
        </div>
        <div>
          Density:{" "}
          <button type="button" data-testid="density-toggle"
            onClick={() => setDraft(d => (d ? { ...d, density: d.density === "comfortable" ? "compact" : "comfortable" } : d))}>
            {draft.density} (switch to {nextDensity})
          </button>
        </div>
        <p data-testid="preview">Preview: {draft.theme} / {draft.density}</p>
        <button type="submit" data-testid="save">Save</button>
        {saveError && <p data-testid="save-error" role="alert">{saveError}</p>}
      </form>
    </main>
  );
}

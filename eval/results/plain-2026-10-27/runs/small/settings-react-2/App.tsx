import { useCallback, useEffect, useRef, useState } from "react";
import { loadSettings, saveSettings } from "./api.js";
import type { Density, Settings, Theme } from "./api.js";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready" };

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function nameError(name: string): string | null {
  if (name.length === 0) return "Display name is required";
  if (name.length > 20) {
    return `Display name must be at most 20 characters, not ${name.length}`;
  }
  return null;
}

function describe(s: Settings): string {
  return `${s.name} · ${s.theme} · ${s.density}`;
}

export default function App() {
  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const [saved, setSaved] = useState<Settings | null>(null);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [saving, setSaving] = useState<Settings | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const started = useRef(false);
  const loadSeq = useRef(0);
  const saveSeq = useRef(0);

  const fetchSettings = useCallback(() => {
    const id = ++loadSeq.current;
    loadSettings().then(
      (s) => {
        if (id !== loadSeq.current) return;
        setSaved(s);
        setDraft({ name: s.name, theme: s.theme, density: s.density });
        setLoad({ status: "ready" });
      },
      (e: unknown) => {
        if (id !== loadSeq.current) return;
        setLoad({ status: "error", message: errorMessage(e) });
      },
    );
  }, []);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    fetchSettings();
  }, [fetchSettings]);

  function retryLoad() {
    setLoad({ status: "loading" });
    fetchSettings();
  }

  function save(d: Settings) {
    if (nameError(d.name) !== null) return;
    const toSave: Settings = { name: d.name, theme: d.theme, density: d.density };
    const id = ++saveSeq.current;
    setSaving(toSave);
    setSaveError(null);
    saveSettings(toSave).then(
      (result) => {
        if (id !== saveSeq.current) return;
        setSaved(result);
        setSaving(null);
      },
      (e: unknown) => {
        if (id !== saveSeq.current) return;
        setSaving(null);
        setSaveError(`Save failed: ${errorMessage(e)}`);
      },
    );
  }

  function setName(name: string) {
    setDraft((d) => (d ? { ...d, name } : d));
  }

  function setTheme(theme: Theme) {
    setDraft((d) => (d ? { ...d, theme } : d));
  }

  function toggleDensity() {
    setDraft((d) => {
      if (!d) return d;
      const density: Density = d.density === "compact" ? "comfortable" : "compact";
      return { ...d, density };
    });
  }

  const error = draft ? nameError(draft.name) : null;
  const savedLine = saved
    ? `Saved: ${describe(saving ?? saved)}${saving ? " (saving…)" : ""}`
    : null;

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", maxWidth: 480, margin: "2rem auto", padding: "0 16px" }}>
      <h1>Settings</h1>

      {load.status === "loading" && <p data-testid="load">Loading settings…</p>}

      {load.status === "error" && (
        <div>
          <p data-testid="load">{`Could not load settings: ${load.message}`}</p>
          <button type="button" data-testid="retry-load" onClick={retryLoad}>
            Retry
          </button>
        </div>
      )}

      {savedLine !== null && <p data-testid="saved">{savedLine}</p>}

      {draft && (
        <div>
          <label>
            Display name{" "}
            <input
              data-testid="name"
              value={draft.name}
              aria-invalid={error !== null}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <p data-testid="name-count">{`${draft.name.length}/20`}</p>
          {error !== null && <p data-testid="name-error">{error}</p>}

          <div>
            <span>Theme </span>
            <button
              type="button"
              data-testid="theme-light"
              aria-pressed={draft.theme === "light"}
              onClick={() => setTheme("light")}
            >
              Light
            </button>
            <button
              type="button"
              data-testid="theme-dark"
              aria-pressed={draft.theme === "dark"}
              onClick={() => setTheme("dark")}
            >
              Dark
            </button>
          </div>

          <div>
            <button type="button" data-testid="density-toggle" onClick={toggleDensity}>
              {`Density: ${draft.density}`}
            </button>
          </div>

          <p data-testid="preview">{`Preview: ${draft.theme} / ${draft.density}`}</p>

          <button type="button" data-testid="save" onClick={() => save(draft)}>
            Save
          </button>
          {saveError !== null && <p data-testid="save-error">{saveError}</p>}
        </div>
      )}
    </main>
  );
}

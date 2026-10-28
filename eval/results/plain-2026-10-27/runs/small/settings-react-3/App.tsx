import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { loadSettings, saveSettings } from "./api.js";
import type { Density, Settings, Theme } from "./api.js";

type Status = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready" };

const MAX_NAME = 20;

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function nameError(name: string): string | null {
  if (name.length === 0) return "Display name is required";
  if (name.length > MAX_NAME) return `Display name must be at most ${MAX_NAME} characters, not ${name.length}`;
  return null;
}

function describe(s: Settings): string {
  return `${s.name} · ${s.theme} · ${s.density}`;
}

export default function App() {
  const [status, setStatus] = useState<Status>({ kind: "loading" });
  const [saved, setSaved] = useState<Settings | null>(null);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [pending, setPending] = useState<Settings | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const loadSeq = useRef(0);
  const saveSeq = useRef(0);
  const requested = useRef(false);

  const fetchSettings = useCallback(() => {
    const id = ++loadSeq.current;
    loadSettings().then(
      (s) => {
        if (id !== loadSeq.current) return;
        setSaved(s);
        setDraft(s);
        setStatus({ kind: "ready" });
      },
      (e: unknown) => {
        if (id !== loadSeq.current) return;
        setStatus({ kind: "error", message: errorMessage(e) });
      },
    );
  }, []);

  useEffect(() => {
    if (requested.current) return;
    requested.current = true;
    fetchSettings();
  }, [fetchSettings]);

  function retryLoad() {
    setStatus({ kind: "loading" });
    fetchSettings();
  }

  function update(patch: Partial<Settings>) {
    setDraft((d) => (d ? { ...d, ...patch } : d));
  }

  function onSave(e: FormEvent) {
    e.preventDefault();
    if (!draft || nameError(draft.name) !== null) return;
    const values: Settings = { name: draft.name, theme: draft.theme, density: draft.density };
    const id = ++saveSeq.current;
    setSaveError(null);
    setPending(values);
    saveSettings({ ...values }).then(
      (s) => {
        if (id !== saveSeq.current) return;
        setSaved(s);
        setPending(null);
      },
      (err: unknown) => {
        if (id !== saveSeq.current) return;
        setPending(null);
        setSaveError(`Save failed: ${errorMessage(err)}`);
      },
    );
  }

  const invalid = draft ? nameError(draft.name) : null;

  return (
    <main>
      <h1>Settings</h1>

      {status.kind === "loading" && <p data-testid="load">Loading settings…</p>}
      {status.kind === "error" && (
        <>
          <p data-testid="load">{`Could not load settings: ${status.message}`}</p>
          <button type="button" data-testid="retry-load" onClick={retryLoad}>
            Retry
          </button>
        </>
      )}

      {saved && (
        <p data-testid="saved">
          {pending ? `Saved: ${describe(pending)} (saving…)` : `Saved: ${describe(saved)}`}
        </p>
      )}

      {draft && (
        <form onSubmit={onSave} noValidate>
          <label>
            Display name{" "}
            <input
              data-testid="name"
              value={draft.name}
              onChange={(e) => update({ name: e.target.value })}
            />
          </label>
          <span data-testid="name-count">{`${draft.name.length}/${MAX_NAME}`}</span>
          {invalid && <p data-testid="name-error">{invalid}</p>}

          <div>
            <span>Theme </span>
            {(["light", "dark"] as Theme[]).map((t) => (
              <button
                key={t}
                type="button"
                data-testid={`theme-${t}`}
                aria-pressed={draft.theme === t}
                onClick={() => update({ theme: t })}
              >
                {t}
              </button>
            ))}
          </div>

          <div>
            <button
              type="button"
              data-testid="density-toggle"
              onClick={() =>
                update({ density: (draft.density === "compact" ? "comfortable" : "compact") as Density })
              }
            >
              Toggle density
            </button>
          </div>

          <p data-testid="preview">{`Preview: ${draft.theme} / ${draft.density}`}</p>

          <button type="submit" data-testid="save">
            Save
          </button>
          {saveError && <p data-testid="save-error">{saveError}</p>}
        </form>
      )}
    </main>
  );
}

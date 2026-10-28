import { useEffect, useRef, useState, type FormEvent } from "react";
import { loadSettings, saveSettings } from "./api.js";
import type { Density, Settings } from "./api.d.ts";

const MAX_NAME = 20;

type LoadState =
  | { status: "loading" }
  | { status: "failed"; message: string }
  | { status: "ready" };

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** The problem with a display name, or null when it is valid. */
function nameProblem(name: string): string | null {
  if (name.trim() === "") return "Display name is required";
  if (name.length > MAX_NAME) {
    return `Display name must be at most ${MAX_NAME} characters, not ${name.length}`;
  }
  return null;
}

function describe(s: Settings): string {
  return `${s.name} · ${s.theme} · ${s.density}`;
}

export default function App() {
  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  /** the last settings the backend confirmed (loaded or saved) */
  const [saved, setSaved] = useState<Settings | null>(null);
  /** the user's editable copy; filled once loaded, then owned by the user */
  const [draft, setDraft] = useState<Settings | null>(null);
  /** the values of the save in flight, if any */
  const [saving, setSaving] = useState<Settings | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const latestSave = useRef(0);

  useEffect(() => {
    let current = true;
    loadSettings().then(
      s => {
        if (!current) return;
        setSaved(s);
        setDraft(s);
        setLoad({ status: "ready" });
      },
      e => {
        if (!current) return;
        setLoad({ status: "failed", message: errorMessage(e) });
      },
    );
    return () => {
      current = false;
    };
  }, [attempt]);

  function retryLoad() {
    setLoad({ status: "loading" });
    setAttempt(n => n + 1);
  }

  function patchDraft(patch: Partial<Settings>) {
    setDraft(d => (d ? { ...d, ...patch } : d));
  }

  function onSave(e: FormEvent) {
    e.preventDefault();
    if (!draft || nameProblem(draft.name) !== null) return;
    const values: Settings = { name: draft.name, theme: draft.theme, density: draft.density };
    const seq = ++latestSave.current;
    setSaving(values);
    setSaveError(null);
    saveSettings(values).then(
      s => {
        if (seq !== latestSave.current) return;
        setSaved(s);
        setSaving(null);
      },
      e => {
        if (seq !== latestSave.current) return;
        setSaving(null);
        setSaveError(errorMessage(e));
      },
    );
  }

  const shown = saving ?? saved;
  const problem = draft ? nameProblem(draft.name) : null;

  return (
    <main style={{ maxWidth: 480, margin: "0 auto", padding: 16, fontFamily: "system-ui, sans-serif" }}>
      <h1>Settings</h1>

      {load.status === "loading" && <p data-testid="load">Loading settings…</p>}
      {load.status === "failed" && (
        <>
          <p data-testid="load">Could not load settings: {load.message}</p>
          <button type="button" data-testid="retry-load" onClick={retryLoad}>
            Retry
          </button>
        </>
      )}

      {shown && draft && (
        <>
          <p data-testid="saved">
            {`Saved: ${describe(shown)}`}
            {saving ? " (saving…)" : ""}
          </p>

          <form onSubmit={onSave} noValidate>
            <div>
              <label>
                Display name{" "}
                <input
                  name="name"
                  data-testid="name"
                  type="text"
                  value={draft.name}
                  onChange={e => patchDraft({ name: e.target.value })}
                />
              </label>{" "}
              <span data-testid="name-count">{`${draft.name.length}/${MAX_NAME}`}</span>
              {problem && (
                <p data-testid="name-error" role="alert">
                  {problem}
                </p>
              )}
            </div>

            <div>
              <span>Theme </span>
              <button
                type="button"
                data-testid="theme-light"
                aria-pressed={draft.theme === "light"}
                onClick={() => patchDraft({ theme: "light" })}
              >
                Light
              </button>{" "}
              <button
                type="button"
                data-testid="theme-dark"
                aria-pressed={draft.theme === "dark"}
                onClick={() => patchDraft({ theme: "dark" })}
              >
                Dark
              </button>
            </div>

            <div>
              <button
                type="button"
                data-testid="density-toggle"
                onClick={() =>
                  patchDraft({
                    density: (draft.density === "comfortable" ? "compact" : "comfortable") as Density,
                  })
                }
              >
                {`Density: ${draft.density}`}
              </button>
            </div>

            <p data-testid="preview">{`Preview: ${draft.theme} / ${draft.density}`}</p>

            <button type="submit" data-testid="save">
              Save
            </button>
          </form>

          {saveError !== null && <p data-testid="save-error">{`Save failed: ${saveError}`}</p>}
        </>
      )}
    </main>
  );
}

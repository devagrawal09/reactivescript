import { useCallback, useEffect, useRef, useState } from "react";
import { loadSettings, saveSettings } from "./api.js";
import type { Settings } from "./api.js";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loaded" };

type Pending = { seq: number; settings: Settings };

const MAX_NAME = 20;

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function nameError(name: string): string | null {
  if (name.length === 0) return "Display name is required";
  if (name.length > MAX_NAME) return `Display name must be at most ${MAX_NAME} characters, not ${name.length}`;
  return null;
}

function line(s: Settings): string {
  return `Saved: ${s.name} · ${s.theme} · ${s.density}`;
}

export default function App() {
  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const [saved, setSaved] = useState<Settings | null>(null);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const loadSeq = useRef(0);
  const started = useRef(false);
  const saveSeq = useRef(0);
  const confirmedSeq = useRef(0);

  const fetchSettings = useCallback(() => {
    const seq = ++loadSeq.current;
    loadSettings().then(
      (s) => {
        if (seq !== loadSeq.current) return;
        setSaved(s);
        setDraft((d) => d ?? s);
        setLoad({ status: "loaded" });
      },
      (e: unknown) => {
        if (seq !== loadSeq.current) return;
        setLoad({ status: "error", message: messageOf(e) });
      },
    );
  }, []);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    fetchSettings();
  }, [fetchSettings]);

  const retryLoad = () => {
    setLoad({ status: "loading" });
    fetchSettings();
  };

  const save = () => {
    if (!draft || nameError(draft.name) !== null) return;
    const toSave: Settings = { ...draft };
    const seq = ++saveSeq.current;
    setPending({ seq, settings: toSave });
    setSaveError(null);
    saveSettings(toSave).then(
      (result) => {
        if (seq > confirmedSeq.current) {
          confirmedSeq.current = seq;
          setSaved(result);
        }
        if (seq === saveSeq.current) setPending(null);
      },
      (e: unknown) => {
        if (seq === saveSeq.current) {
          setPending(null);
          setSaveError(`Save failed: ${messageOf(e)}`);
        }
      },
    );
  };

  if (load.status !== "loaded" || !saved || !draft) {
    return (
      <main>
        <h1>Settings</h1>
        {load.status === "error" ? (
          <>
            <p data-testid="load" role="alert">
              Could not load settings: {load.message}
            </p>
            <button type="button" data-testid="retry-load" onClick={retryLoad}>
              Retry
            </button>
          </>
        ) : (
          <p data-testid="load">Loading settings…</p>
        )}
      </main>
    );
  }

  const error = nameError(draft.name);
  const savedText = pending ? `${line(pending.settings)} (saving…)` : line(saved);

  return (
    <main>
      <h1>Settings</h1>
      <p data-testid="saved">{savedText}</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <label>
          Display name{" "}
          <input
            data-testid="name"
            value={draft.name}
            aria-invalid={error !== null}
            onChange={(e) => {
              const name = e.target.value;
              setDraft((d) => (d ? { ...d, name } : d));
            }}
          />
        </label>
        <span data-testid="name-count">
          {draft.name.length}/{MAX_NAME}
        </span>
        {error !== null && (
          <p data-testid="name-error" role="alert">
            {error}
          </p>
        )}
        <div>
          <button
            type="button"
            data-testid="theme-light"
            aria-pressed={draft.theme === "light"}
            onClick={() => setDraft((d) => (d ? { ...d, theme: "light" } : d))}
          >
            Light
          </button>
          <button
            type="button"
            data-testid="theme-dark"
            aria-pressed={draft.theme === "dark"}
            onClick={() => setDraft((d) => (d ? { ...d, theme: "dark" } : d))}
          >
            Dark
          </button>
          <button
            type="button"
            data-testid="density-toggle"
            onClick={() =>
              setDraft((d) =>
                d ? { ...d, density: d.density === "compact" ? "comfortable" : "compact" } : d,
              )
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
        {saveError !== null && (
          <p data-testid="save-error" role="alert">
            {saveError}
          </p>
        )}
      </form>
    </main>
  );
}

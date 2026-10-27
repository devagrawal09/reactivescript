import { useEffect, useRef, useState } from "react";
import { loadSettings, saveSettings } from "./api.js";
import type { Density, Settings, Theme } from "./api.js";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready" };

type SaveTrack = {
  /** latest settings the server confirmed, and the request sequence that confirmed them */
  confirmed: Settings;
  confirmedSeq: number;
  /** the most recent save request still awaiting an answer */
  pending: { seq: number; settings: Settings } | null;
  error: string | null;
};

const MAX_NAME = 20;

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function nameError(name: string): string | null {
  if (name.length === 0) return "Display name is required";
  if (name.length > MAX_NAME) return `Display name must be at most ${MAX_NAME} characters, not ${name.length}`;
  return null;
}

function fmt(s: Settings): string {
  return `${s.name} · ${s.theme} · ${s.density}`;
}

export default function App() {
  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const [track, setTrack] = useState<SaveTrack | null>(null);
  const [draft, setDraft] = useState<Settings | null>(null);
  const loadSeq = useRef(0);
  const saveSeq = useRef(0);

  function fetchSettings(active: () => boolean = () => true) {
    const id = ++loadSeq.current;
    const current = () => active() && id === loadSeq.current;
    loadSettings().then(
      (s) => {
        if (!current()) return;
        setTrack({ confirmed: s, confirmedSeq: 0, pending: null, error: null });
        setDraft(s);
        setLoad({ status: "ready" });
      },
      (e: unknown) => {
        if (!current()) return;
        setLoad({ status: "error", message: errorMessage(e) });
      },
    );
  }

  useEffect(() => {
    let active = true;
    fetchSettings(() => active);
    return () => {
      // ignore answers to this request after unmount (e.g. StrictMode remount)
      active = false;
    };
  }, []);

  function retry() {
    setLoad({ status: "loading" });
    fetchSettings();
  }

  function save() {
    if (!draft || nameError(draft.name)) return;
    const seq = ++saveSeq.current;
    const settings = { ...draft };
    setTrack((t) => (t ? { ...t, pending: { seq, settings }, error: null } : t));
    saveSettings(settings).then(
      (saved) => {
        setTrack((t) => {
          if (!t) return t;
          const next = { ...t };
          if (seq > t.confirmedSeq) {
            next.confirmed = saved;
            next.confirmedSeq = seq;
          }
          if (t.pending?.seq === seq) next.pending = null;
          return next;
        });
      },
      (e: unknown) => {
        setTrack((t) => {
          if (!t || t.pending?.seq !== seq) return t;
          return { ...t, pending: null, error: `Save failed: ${errorMessage(e)}` };
        });
      },
    );
  }

  if (load.status === "loading") {
    return (
      <main>
        <p data-testid="load">Loading settings…</p>
      </main>
    );
  }
  if (load.status === "error" || !track || !draft) {
    return (
      <main>
        <p data-testid="load">Could not load settings: {load.status === "error" ? load.message : ""}</p>
        <button data-testid="retry-load" onClick={retry}>
          Retry
        </button>
      </main>
    );
  }

  const error = nameError(draft.name);
  const savedLine = track.pending
    ? `Saved: ${fmt(track.pending.settings)} (saving…)`
    : `Saved: ${fmt(track.confirmed)}`;

  const setTheme = (theme: Theme) => setDraft((d) => (d ? { ...d, theme } : d));
  const toggleDensity = () =>
    setDraft((d) => {
      if (!d) return d;
      const density: Density = d.density === "comfortable" ? "compact" : "comfortable";
      return { ...d, density };
    });

  return (
    <main>
      <h1>Settings</h1>
      <p data-testid="saved">{savedLine}</p>
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
            onChange={(e) => {
              const name = e.target.value;
              setDraft((d) => (d ? { ...d, name } : d));
            }}
          />
        </label>{" "}
        <span data-testid="name-count">
          {draft.name.length}/{MAX_NAME}
        </span>
        {error && (
          <p data-testid="name-error" role="alert">
            {error}
          </p>
        )}
        <div>
          Theme:{" "}
          <button type="button" data-testid="theme-light" aria-pressed={draft.theme === "light"} onClick={() => setTheme("light")}>
            Light
          </button>{" "}
          <button type="button" data-testid="theme-dark" aria-pressed={draft.theme === "dark"} onClick={() => setTheme("dark")}>
            Dark
          </button>
        </div>
        <div>
          Density:{" "}
          <button type="button" data-testid="density-toggle" onClick={toggleDensity}>
            {draft.density}
          </button>
        </div>
        <p data-testid="preview">
          Preview: {draft.theme} / {draft.density}
        </p>
        <button type="submit" data-testid="save">
          Save
        </button>
        {track.error && (
          <p data-testid="save-error" role="alert">
            {track.error}
          </p>
        )}
      </form>
    </main>
  );
}

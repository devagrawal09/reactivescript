import { useCallback, useEffect, useReducer, useRef } from "react";
import { loadSettings, saveSettings } from "./api.js";
import type { Settings } from "./api.js";

type Pending = { seq: number; settings: Settings };

type State = {
  load: { status: "loading" } | { status: "error"; message: string } | { status: "ready" };
  confirmed: Settings | null;
  confirmedSeq: number;
  draft: Settings | null;
  pending: Pending[];
  lastSeq: number;
  saveError: string | null;
};

type Action =
  | { type: "loadStart" }
  | { type: "loadOk"; settings: Settings }
  | { type: "loadFail"; message: string }
  | { type: "draft"; patch: Partial<Settings> }
  | { type: "saveStart"; seq: number; settings: Settings }
  | { type: "saveOk"; seq: number; settings: Settings }
  | { type: "saveFail"; seq: number; message: string };

const initial: State = {
  load: { status: "loading" },
  confirmed: null,
  confirmedSeq: -1,
  draft: null,
  pending: [],
  lastSeq: -1,
  saveError: null,
};

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "loadStart":
      return { ...state, load: { status: "loading" } };
    case "loadOk":
      if (state.load.status === "ready") return state;
      return {
        ...state,
        load: { status: "ready" },
        confirmed: action.settings,
        draft: state.draft ?? action.settings,
      };
    case "loadFail":
      if (state.load.status === "ready") return state;
      return { ...state, load: { status: "error", message: action.message } };
    case "draft":
      if (!state.draft) return state;
      return { ...state, draft: { ...state.draft, ...action.patch } };
    case "saveStart":
      return {
        ...state,
        pending: [...state.pending, { seq: action.seq, settings: action.settings }],
        lastSeq: action.seq,
        saveError: null,
      };
    case "saveOk": {
      const pending = state.pending.filter(p => p.seq !== action.seq);
      if (action.seq > state.confirmedSeq) {
        return { ...state, pending, confirmed: action.settings, confirmedSeq: action.seq };
      }
      return { ...state, pending };
    }
    case "saveFail": {
      const pending = state.pending.filter(p => p.seq !== action.seq);
      const saveError = action.seq === state.lastSeq ? `Save failed: ${action.message}` : state.saveError;
      return { ...state, pending, saveError };
    }
  }
}

const MAX = 20;

function nameError(name: string): string | null {
  if (name.length === 0) return "Display name is required";
  if (name.length > MAX) return `Display name must be at most ${MAX} characters, not ${name.length}`;
  return null;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const line = (s: Settings) => `${s.name} · ${s.theme} · ${s.density}`;

export default function App() {
  const [state, dispatch] = useReducer(reducer, initial);
  const started = useRef(false);
  const seq = useRef(0);

  const load = useCallback(() => {
    dispatch({ type: "loadStart" });
    loadSettings().then(
      settings => dispatch({ type: "loadOk", settings }),
      (e: unknown) => dispatch({ type: "loadFail", message: message(e) }),
    );
  }, []);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    load();
  }, [load]);

  const save = () => {
    const draft = state.draft;
    if (!draft || nameError(draft.name)) return;
    const n = seq.current++;
    const settings = { ...draft };
    dispatch({ type: "saveStart", seq: n, settings });
    saveSettings(settings).then(
      saved => dispatch({ type: "saveOk", seq: n, settings: saved }),
      (e: unknown) => dispatch({ type: "saveFail", seq: n, message: message(e) }),
    );
  };

  if (state.load.status !== "ready" || !state.confirmed || !state.draft) {
    return (
      <main>
        {state.load.status === "error" ? (
          <>
            <p data-testid="load">Could not load settings: {state.load.message}</p>
            <button data-testid="retry-load" onClick={load}>
              Retry
            </button>
          </>
        ) : (
          <p data-testid="load">Loading settings…</p>
        )}
      </main>
    );
  }

  const { draft, confirmed } = state;
  const showing = state.pending
    .filter(p => p.seq > state.confirmedSeq)
    .reduce<Pending | null>((a, p) => (!a || p.seq > a.seq ? p : a), null);
  const error = nameError(draft.name);

  return (
    <main>
      <p data-testid="saved">
        {showing ? `Saved: ${line(showing.settings)} (saving…)` : `Saved: ${line(confirmed)}`}
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
            onChange={e => dispatch({ type: "draft", patch: { name: e.target.value } })}
          />
        </label>{" "}
        <span data-testid="name-count">
          {draft.name.length}/{MAX}
        </span>
        {error && <p data-testid="name-error">{error}</p>}
        <div>
          <button
            type="button"
            data-testid="theme-light"
            aria-pressed={draft.theme === "light"}
            onClick={() => dispatch({ type: "draft", patch: { theme: "light" } })}
          >
            Light
          </button>
          <button
            type="button"
            data-testid="theme-dark"
            aria-pressed={draft.theme === "dark"}
            onClick={() => dispatch({ type: "draft", patch: { theme: "dark" } })}
          >
            Dark
          </button>
          <button
            type="button"
            data-testid="density-toggle"
            onClick={() =>
              dispatch({
                type: "draft",
                patch: { density: draft.density === "compact" ? "comfortable" : "compact" },
              })
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
        {state.saveError && <p data-testid="save-error">{state.saveError}</p>}
      </form>
    </main>
  );
}

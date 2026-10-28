import { action, affects, createOptimistic, createSignal, Errored, isPending, Loading, onFlush, refresh, Show, untrack } from "solid-js";
import { loadSettings, saveSettings, type Density, type Settings, type Theme } from "./api";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

function nameError(name: string) {
  if (name.length === 0) return "Display name is required";
  if (name.length > 20) return `Display name must be at most 20 characters, not ${name.length}`;
  return "";
}

export default function SettingsPage() {
  // what the server has; a save shows its settings over it as a guess until it settles
  const [saved, setSaved] = createSignal<Settings>(() => loadSettings());
  const [settings, setSettings] = createOptimistic<Settings>(() => saved());
  const [saveError, setSaveError] = createSignal("");

  const save = action(function* (next: Settings) {
    setSettings(next);
    affects(settings);
    try {
      setSaved(yield saveSettings(next));
    } catch (e) {
      setSaveError(message(e));
    }
  });

  return (
    <Errored
      fallback={e => (
        <>
          <p data-testid="load">Could not load settings: {message(e())}</p>
          <button data-testid="retry-load" onClick={() => refresh(saved)}>retry</button>
        </>
      )}
    >
      <Loading fallback={<p data-testid="load">Loading settings…</p>}>
        <p data-testid="saved">
          Saved: {settings().name} · {settings().theme} · {settings().density}
          {isPending(() => settings()) ? " (saving…)" : ""}
        </p>
        <Show when={saveError()}>
          <p data-testid="save-error">Save failed: {saveError()}</p>
        </Show>
        <SettingsForm
          initial={settings()}
          onSave={s => {
            onFlush(() => setSaveError(""));
            save(s);
          }}
        />
      </Loading>
    </Errored>
  );
}

// Seeded once from the loaded settings; after that the draft is the user's.
function SettingsForm(props: { initial: Settings; onSave: (s: Settings) => void }) {
  const [name, setName] = createSignal(untrack(() => props.initial.name));
  const [theme, setTheme] = createSignal<Theme>(untrack(() => props.initial.theme));
  const [density, setDensity] = createSignal<Density>(untrack(() => props.initial.density));
  const error = () => nameError(name());
  return (
    <div>
      <label>
        Display name <input data-testid="name" value={name()} onInput={e => setName(e.currentTarget.value)} />
      </label>{" "}
      <small data-testid="name-count">{name().length}/20</small>
      <Show when={error()}>
        <p data-testid="name-error">{error()}</p>
      </Show>
      <div>
        <button data-testid="theme-light" onClick={() => setTheme("light")}>light</button>{" "}
        <button data-testid="theme-dark" onClick={() => setTheme("dark")}>dark</button>{" "}
        <button data-testid="density-toggle" onClick={() => setDensity(d => (d === "compact" ? "comfortable" : "compact"))}>
          toggle density
        </button>
      </div>
      <p data-testid="preview">
        Preview: {theme()} / {density()}
      </p>
      <button
        data-testid="save"
        onClick={() => {
          if (!error()) props.onSave({ name: name(), theme: theme(), density: density() });
        }}
      >
        save
      </button>
    </div>
  );
}

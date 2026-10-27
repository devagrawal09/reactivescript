// A plausible first draft: the form re-seeds from the saved settings whenever they change, and a failed save rolls
// back to the settings first loaded.
import { useEffect, useState } from "react";
import { loadSettings, saveSettings, type Settings } from "./api";

export default function App() {
  const [loaded, setLoaded] = useState<Settings | null>(null);
  const [saved, setSaved] = useState<Settings | null>(null);
  const [loadError, setLoadError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [draft, setDraft] = useState<Settings | null>(null);

  useEffect(() => { loadSettings().then(s => { setLoaded(s); setSaved(s); setLoadError(""); }, e => setLoadError(e.message)); }, [attempt]);
  useEffect(() => { if (saved) setDraft(saved); }, [saved]);

  if (loadError && !saved) return <div><p data-testid="load">Could not load settings: {loadError}</p><button data-testid="retry-load" onClick={() => setAttempt(a => a + 1)}>Retry</button></div>;
  if (!saved || !draft) return <p data-testid="load">Loading settings…</p>;
  const err = draft.name.length === 0 ? "Display name is required" : draft.name.length > 20 ? `Display name must be at most 20 characters, not ${draft.name.length}` : "";
  const save = async () => {
    if (err) return;
    setSaveError(""); setSaving(true); setSaved(draft);
    try { setSaved(await saveSettings(draft)); } catch (e) { setSaved(loaded); setSaveError((e as Error).message); }
    setSaving(false);
  };
  return (
    <main>
      <p data-testid="saved">Saved: {saved.name} · {saved.theme} · {saved.density}{saving ? " (saving…)" : ""}</p>
      {saveError && <p data-testid="save-error">Save failed: {saveError}</p>}
      <input data-testid="name" value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} />
      <small data-testid="name-count">{draft.name.length}/20</small>
      {err && <p data-testid="name-error">{err}</p>}
      <button data-testid="theme-light" onClick={() => setDraft({ ...draft, theme: "light" })}>light</button>
      <button data-testid="theme-dark" onClick={() => setDraft({ ...draft, theme: "dark" })}>dark</button>
      <button data-testid="density-toggle" onClick={() => setDraft({ ...draft, density: draft.density === "compact" ? "comfortable" : "compact" })}>Toggle density</button>
      <p data-testid="preview">Preview: {draft.theme} / {draft.density}</p>
      <button data-testid="save" onClick={save}>Save</button>
    </main>
  );
}

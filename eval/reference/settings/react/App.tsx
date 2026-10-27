import { useState } from "react";
import { QueryClient, QueryClientProvider, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { loadSettings, saveSettings, type Density, type Settings, type Theme } from "./api";

const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });

export default function App() {
  return (
    <QueryClientProvider client={client}>
      <SettingsPage />
    </QueryClientProvider>
  );
}

function SettingsPage() {
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: ["settings"], queryFn: loadSettings });
  const [saveError, setSaveError] = useState("");
  const save = useMutation({
    mutationFn: saveSettings,
    onMutate: async next => {
      setSaveError("");
      await queryClient.cancelQueries({ queryKey: ["settings"] });
      const previous = queryClient.getQueryData<Settings>(["settings"]);
      queryClient.setQueryData(["settings"], next);
      return { previous };
    },
    onError: (e, _next, ctx) => { queryClient.setQueryData(["settings"], ctx?.previous); setSaveError(e.message); },
    onSuccess: saved => { queryClient.setQueryData(["settings"], saved); },
  });

  if (settings.isPending) return <p data-testid="load">Loading settings…</p>;
  if (settings.error) return (
    <section>
      <p data-testid="load">Could not load settings: {settings.error.message}</p>{" "}
      <button data-testid="retry-load" onClick={() => settings.refetch()}>Retry</button>
    </section>
  );
  const s = settings.data;
  return (
    <main>
      <p data-testid="saved">Saved: {s.name} · {s.theme} · {s.density}{save.isPending ? " (saving…)" : ""}</p>{" "}
      {saveError && <p data-testid="save-error">Save failed: {saveError}</p>}
      <SettingsForm initial={s} onSave={draft => save.mutate(draft)} />
    </main>
  );
}

function nameError(name: string) {
  if (name.length === 0) return "Display name is required";
  if (name.length > 20) return `Display name must be at most 20 characters, not ${name.length}`;
  return "";
}

// Seeded once from the loaded settings; after that the draft is the user's.
function SettingsForm({ initial, onSave }: { initial: Settings; onSave: (draft: Settings) => void }) {
  const [name, setName] = useState(initial.name);
  const [theme, setTheme] = useState<Theme>(initial.theme);
  const [density, setDensity] = useState<Density>(initial.density);
  const error = nameError(name);
  return (
    <div>
      <label>Display name <input data-testid="name" value={name} onChange={e => setName(e.target.value)} /></label>{" "}
      <small data-testid="name-count">{name.length}/20</small>{" "}
      {error && <p data-testid="name-error">{error}</p>}
      <div>
        <span>Theme: {theme}</span>{" "}
        <button data-testid="theme-light" onClick={() => setTheme("light")}>light</button>{" "}
        <button data-testid="theme-dark" onClick={() => setTheme("dark")}>dark</button>{" "}
        <button data-testid="density-toggle" onClick={() => setDensity(d => (d === "compact" ? "comfortable" : "compact"))}>Toggle density</button>{" "}
        <p data-testid="preview">Preview: {theme} / {density}</p>
      </div>
      <button data-testid="save" onClick={() => { if (!error) onSave({ name, theme, density }); }}>Save</button>
    </div>
  );
}

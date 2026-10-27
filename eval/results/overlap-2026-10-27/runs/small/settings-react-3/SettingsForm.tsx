import { useState } from "react";
import type { Density, Settings, Theme } from "./api.js";

const NAME_MAX = 20;

export function nameError(name: string): string | null {
  if (name.length === 0) return "Display name is required";
  if (name.length > NAME_MAX) {
    return `Display name must be at most ${NAME_MAX} characters, not ${name.length}`;
  }
  return null;
}

type Props = {
  initial: Settings;
  onSave: (s: Settings) => void;
};

export default function SettingsForm({ initial, onSave }: Props) {
  // The draft is seeded once from the loaded settings and then belongs to the user.
  const [name, setName] = useState<string>(initial.name);
  const [theme, setTheme] = useState<Theme>(initial.theme);
  const [density, setDensity] = useState<Density>(initial.density);
  const error = nameError(name);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (nameError(name) !== null) return;
        onSave({ name, theme, density });
      }}
    >
      <label>
        Display name
        <input
          data-testid="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <span data-testid="name-count">{`${name.length}/${NAME_MAX}`}</span>
      {error !== null && <p data-testid="name-error">{error}</p>}

      <div>
        <button
          type="button"
          data-testid="theme-light"
          aria-pressed={theme === "light"}
          onClick={() => setTheme("light")}
        >
          Light
        </button>
        <button
          type="button"
          data-testid="theme-dark"
          aria-pressed={theme === "dark"}
          onClick={() => setTheme("dark")}
        >
          Dark
        </button>
      </div>

      <button
        type="button"
        data-testid="density-toggle"
        onClick={() => setDensity((d) => (d === "comfortable" ? "compact" : "comfortable"))}
      >
        Density: {density}
      </button>

      <p data-testid="preview">{`Preview: ${theme} / ${density}`}</p>

      <button type="submit" data-testid="save">
        Save
      </button>
    </form>
  );
}

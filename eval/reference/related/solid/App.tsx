import { createSignal, Match, Switch } from "solid-js";
import IssuesPage from "./IssuesPage";
import HelpPage from "./HelpPage";
import SettingsPage from "./SettingsPage";

type Page = "issues" | "help" | "settings";

// Only the open page is mounted, so leaving one discards its state.
export default function App() {
  const [page, setPage] = createSignal<Page>("issues");
  // where the help page opens: empty from its tab, on an issue's title from a related hit
  const [help, setHelp] = createSignal<{ query: string; selected: number | null }>({ query: "", selected: null });
  const openHelp = (query: string, selected: number | null) => {
    setHelp({ query, selected });
    setPage("help");
  };
  return (
    <div>
      <nav>
        <button data-testid="tab-issues" onClick={() => setPage("issues")}>Issues</button>{" "}
        <button data-testid="tab-help" onClick={() => openHelp("", null)}>Help</button>{" "}
        <button data-testid="tab-settings" onClick={() => setPage("settings")}>Settings</button>
      </nav>
      <Switch>
        <Match when={page() === "issues"}><IssuesPage onOpenHelp={openHelp} /></Match>
        <Match when={page() === "help"}><HelpPage query={help().query} selected={help().selected} /></Match>
        <Match when={page() === "settings"}><SettingsPage /></Match>
      </Switch>
    </div>
  );
}

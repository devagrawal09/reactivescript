import { createSignal, Match, Switch } from "solid-js";
import IssuesPage from "./IssuesPage";
import HelpPage from "./HelpPage";
import SettingsPage from "./SettingsPage";

type Page = "issues" | "help" | "settings";

// Only the open page is mounted, so leaving one discards its state.
export default function App() {
  const [page, setPage] = createSignal<Page>("issues");
  const [openCount, setOpenCount] = createSignal<number | null>(null);
  return (
    <div>
      <nav>
        <button data-testid="tab-issues" onClick={() => setPage("issues")}>Issues{openCount() === null ? "" : ` (${openCount()})`}</button>{" "}
        <button data-testid="tab-help" onClick={() => setPage("help")}>Help</button>{" "}
        <button data-testid="tab-settings" onClick={() => setPage("settings")}>Settings</button>
      </nav>
      <Switch>
        <Match when={page() === "issues"}><IssuesPage onOpenCount={setOpenCount} /></Match>
        <Match when={page() === "help"}><HelpPage /></Match>
        <Match when={page() === "settings"}><SettingsPage /></Match>
      </Switch>
    </div>
  );
}

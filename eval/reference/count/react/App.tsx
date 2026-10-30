import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import IssuesPage from "./IssuesPage";
import HelpPage from "./HelpPage";
import SettingsPage from "./SettingsPage";

type Page = "issues" | "help" | "settings";

// Each page gets its own query cache, made when the page opens, so leaving a page discards what it loaded.
function PageClient({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: false, gcTime: 0, refetchOnWindowFocus: false, refetchOnReconnect: false },
        },
      }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

export default function App() {
  const [page, setPage] = useState<Page>("issues");
  const [openCount, setOpenCount] = useState<number | null>(null);
  return (
    <div>
      <nav>
        <button type="button" data-testid="tab-issues" onClick={() => setPage("issues")}>
          Issues{openCount === null ? "" : ` (${openCount})`}
        </button>{" "}
        <button type="button" data-testid="tab-help" onClick={() => setPage("help")}>
          Help
        </button>{" "}
        <button type="button" data-testid="tab-settings" onClick={() => setPage("settings")}>
          Settings
        </button>
      </nav>
      <PageClient key={page}>
        {page === "issues" ? <IssuesPage onOpenCount={setOpenCount} /> : page === "help" ? <HelpPage /> : <SettingsPage />}
      </PageClient>
    </div>
  );
}

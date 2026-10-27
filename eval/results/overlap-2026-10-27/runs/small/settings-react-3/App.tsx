import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import SettingsPage from "./SettingsPage";

export default function App() {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: false, refetchOnWindowFocus: false, staleTime: Infinity },
          mutations: { retry: false },
        },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <SettingsPage />
    </QueryClientProvider>
  );
}

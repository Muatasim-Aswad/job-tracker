import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MutationCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "./index.css";
import "./platforms"; // seed the platform registry (incl. any private-board overlay)
import App from "./App.tsx";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Toaster } from "./components/Toaster";
import { describeError, toast } from "./lib/toast";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 5_000, refetchOnWindowFocus: true },
  },
  // Global mutation errors use one toast path; hook-specific rollback handlers still run.
  mutationCache: new MutationCache({
    onError: (err) => toast.error(describeError(err)),
  }),
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
      <Toaster />
    </QueryClientProvider>
  </StrictMode>,
);

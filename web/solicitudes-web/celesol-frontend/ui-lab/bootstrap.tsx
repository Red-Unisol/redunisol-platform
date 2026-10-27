import { installUiLabNetworkGuard } from "./network-guard";
import "./theme.css";

// Dynamic imports are intentional: production API modules may capture fetch.
installUiLabNetworkGuard();
async function start() {
  const [
    { createRoot },
    { QueryClient, QueryClientProvider },
    { App },
    { BrowserRouter },
  ] = await Promise.all([
    import("react-dom/client"),
    import("@tanstack/react-query"),
    import("./app"),
    import("react-router-dom"),
  ]);
  const element = document.getElementById("root");
  if (!element) throw new Error("UI Lab root is missing");
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  createRoot(element).render(
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>,
  );
}
void start().catch((error) => {
  const element = document.getElementById("root");
  if (element)
    element.textContent = `No se pudo cargar el UI Lab: ${error instanceof Error ? error.message : "Error desconocido"}`;
  console.error(error);
});

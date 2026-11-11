import { installUiLabNetworkGuard } from "./network-guard";
import { parseCbuScenario } from "./cbu-fixtures";
import { parseReliquidationScenario } from "./reliquidacion-fixtures";
import "./theme.css";

// Dynamic imports are intentional: production API modules may capture fetch.
const search = new URLSearchParams(window.location.search);
const productionRole =
  search.get("role") === "vendedor"
    ? "vendedor"
    : search.get("role") === "admin"
      ? "admin"
      : "riesgo";
installUiLabNetworkGuard(
  globalThis,
  window.location.pathname.startsWith("/production")
    ? {
        production: {
          role: productionRole,
          externalPayment: search.get("payment") === "external",
          allowEdit: search.get("edit") === "1",
          cbuScenario: parseCbuScenario(search.get("cbu")),
          workflowState: search.get("state") === "evaluacion-externa"
            ? "EvaluacionExterna"
            : search.get("state") === "revision-riesgo" ? "RevisionRiesgo" : undefined,
        },
      }
    : window.location.pathname.startsWith("/reliquidacion") ? { reliquidation: parseReliquidationScenario(search.get("scenario")) }
    : window.location.pathname.startsWith("/external-legajo") ? {
        externalLegajo: search.get("scenario") === "approved" ? "approved" : search.get("scenario") === "error" ? "error" : "waiting",
      } : {},
);
async function start() {
  const pathname = window.location.pathname;
  const ownsRouter =
    pathname.startsWith("/headers") || pathname.startsWith("/production") || pathname.startsWith("/cutoffs");
  const [
    { createRoot },
    { QueryClient, QueryClientProvider },
    { App },
    { BrowserRouter },
  ] = await Promise.all([
    import("react-dom/client"),
    import("@tanstack/react-query"),
    pathname.startsWith("/socio-create")
      ? import("./socio-create-entry")
      : pathname.startsWith("/reliquidacion")
      ? import("./reliquidacion-entry")
      : pathname.startsWith("/cutoffs")
      ? import("./cutoffs-entry")
      : pathname.startsWith("/production")
      ? import("./production-entry")
      : pathname.startsWith("/headers")
        ? import("./header-gallery")
        : pathname.startsWith("/external-legajo") ? import("./external-legajo-entry") : import("./app"),
    import("react-router-dom"),
  ]);
  const element = document.getElementById("root");
  if (!element) throw new Error("UI Lab root is missing");
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  createRoot(element).render(
    <QueryClientProvider client={queryClient}>
      {ownsRouter ? (
        <App />
      ) : (
        <BrowserRouter>
          <App />
        </BrowserRouter>
      )}
    </QueryClientProvider>,
  );
}
void start().catch((error) => {
  const element = document.getElementById("root");
  if (element)
    element.textContent = `No se pudo cargar el UI Lab: ${error instanceof Error ? error.message : "Error desconocido"}`;
  console.error(error);
});

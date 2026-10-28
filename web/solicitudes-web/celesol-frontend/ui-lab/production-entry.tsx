import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AppLayout } from "@/app/layouts/app-layout";
import { SolicitudesActualDetallePage } from "@/modules/solicitudes-core/pages/solicitudes-actual-detalle-page";
import { SolicitudesActualPrecargaPage } from "@/modules/solicitudes-core/pages/solicitudes-actual-precarga-page";
import { SolicitudesCoreRecientesPage } from "@/modules/solicitudes-core/pages/solicitudes-core-recientes-page";
import { SolicitudesCoreHistoricasPage } from "@/modules/solicitudes-core/pages/solicitudes-core-historicas-page";
import { HEADER_SAMPLE } from "./header-fixtures";

// This entry renders the operational components unchanged. Only the transport
// and route are local fixtures installed by bootstrap before this module loads.
export function App() {
  const list = new URLSearchParams(window.location.search).get("list");
  const listPaths: Record<string, string> = {
    precarga: "/solicitudes/core/precarga",
    recientes: "/solicitudes/core/recientes",
    historicas: "/solicitudes/core/historicas",
  };
  return (
    <MemoryRouter
      initialEntries={[
        (list && listPaths[list]) || `/solicitudes/core/detalle/${HEADER_SAMPLE.id}?origen=historicas`,
      ]}
    >
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/solicitudes/core/precarga" element={<SolicitudesActualPrecargaPage />} />
          <Route path="/solicitudes/core/recientes" element={<SolicitudesCoreRecientesPage />} />
          <Route path="/solicitudes/core/historicas" element={<SolicitudesCoreHistoricasPage />} />
          <Route
            path="/solicitudes/core/detalle/:id"
            element={<SolicitudesActualDetallePage />}
          />
        </Route>
        <Route
          path="*"
          element={
            <p className="p-4">
              Navegación local de ejemplo. Recargá /production para volver a la
              solicitud.
            </p>
          }
        />
      </Routes>
    </MemoryRouter>
  );
}

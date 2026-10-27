import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AppLayout } from "@/app/layouts/app-layout";
import { SolicitudesActualDetallePage } from "@/modules/solicitudes-core/pages/solicitudes-actual-detalle-page";
import { HEADER_SAMPLE } from "./header-fixtures";

// This entry renders the operational components unchanged. Only the transport
// and route are local fixtures installed by bootstrap before this module loads.
export function App() {
  return (
    <MemoryRouter
      initialEntries={[
        `/solicitudes/core/detalle/${HEADER_SAMPLE.id}?origen=historicas`,
      ]}
    >
      <Routes>
        <Route element={<AppLayout />}>
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

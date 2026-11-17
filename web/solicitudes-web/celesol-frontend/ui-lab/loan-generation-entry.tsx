import { useState } from "react";
import { LinkedLoanStatusBanner } from "@/modules/solicitudes-core/components/linked-loan-status-banner";
import { generationStatus } from "./loan-generation-fixtures";
import { UI_LAB_SOLICITUD_ID } from "./network-guard";

export function App() {
  const [done, setDone] = useState(false);
  const admin = new URLSearchParams(location.search).get("role") !== "riesgo";
  return (
    <main className="mx-auto max-w-3xl p-4 text-foreground">
      <p className="mb-4 text-sm text-foreground-secondary">
        Entorno local · Datos ficticios · {admin ? "Administrador" : "Riesgo"}
      </p>
      <h1 className="mb-4 text-xl font-semibold">
        Solicitud de ejemplo · Generación de préstamo
      </h1>
      {done ? (
        <p role="status">Comprobación aplicada. Solicitud actualizada.</p>
      ) : (
        <LinkedLoanStatusBanner
          data={generationStatus()}
          loading={false}
          failed={false}
          retry={() => undefined}
          solicitudId={UI_LAB_SOLICITUD_ID}
          canRecover={admin}
          onRecovered={() => setDone(true)}
        />
      )}
    </main>
  );
}

import { LoanReliquidationControl } from "@/modules/solicitudes-core/components/loan-reliquidation-control";
import { UI_LAB_SOLICITUD_ID } from "./network-guard";

export function App() {
  return (
    <main className="mx-auto max-w-4xl p-4 text-foreground">
      <p className="mb-4 text-sm text-foreground-secondary">
        Entorno local · Datos ficticios
      </p>
      <h1 className="mb-4 text-xl font-semibold">
        Solicitud de ejemplo · Legajos
      </h1>
      <LoanReliquidationControl
        solicitudId={UI_LAB_SOLICITUD_ID}
        updatedAt="2026-11-11T12:00:00.000Z"
        isEditing={false}
      />
    </main>
  );
}

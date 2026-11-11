import { useState } from "react";
import {
  LoanReliquidationPanel,
  type ReliquidationView,
} from "@/modules/solicitudes-core/components/loan-reliquidation-control";

export function App() {
  const scenario = new URLSearchParams(location.search).get("scenario");
  const [data, setData] = useState<ReliquidationView>({
    visible: true,
    pending: scenario === "pending",
    prepared: scenario === "prepared",
    canReopen: scenario !== "blocked",
    blockedReason:
      scenario === "blocked"
        ? "Reliquidación bloqueada: existe una reserva de transferencia o un pago. Esta versión no cancela reservas."
        : null,
    updatedAt: "2026-11-11T12:00:00.000Z",
    previousLoanId: "900001",
    ...(scenario === "prepared"
      ? {
          requestId: crypto.randomUUID(),
          reason: "Corrección solicitada por el analista",
        }
      : {}),
  });
  return (
    <main className="mx-auto max-w-4xl p-4 text-foreground">
      <p className="mb-4 text-sm text-foreground-secondary">
        Entorno local · Datos ficticios
      </p>
      <h1 className="mb-4 text-xl font-semibold">
        Solicitud de ejemplo · Legajos
      </h1>
      <LoanReliquidationPanel
        data={data}
        onSubmit={async (action, input) => {
          if (scenario === "error")
            throw new Error(
              "Vimarx no respondió. La solicitud conserva su pausa; volvé a verificar.",
            );
          setData({
            ...data,
            updatedAt: new Date().toISOString(),
            prepared: action === "prepare",
            pending: action === "reopen",
            requestId: input.requestId,
            reason: input.reason,
          });
        }}
      />
    </main>
  );
}

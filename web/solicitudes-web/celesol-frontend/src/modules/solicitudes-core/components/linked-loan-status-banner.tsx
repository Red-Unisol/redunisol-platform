import { Button } from "@/shared/components/ui/button";
import type { LinkedLoanStatus } from "../services/linked-loan-status-api";
import { LoanGenerationRecoveryControl } from "./loan-generation-recovery-control";
import { useMutation } from "@tanstack/react-query";
import { apiClient } from "@/shared/services/http/api-client";
import type { LoanGenerationCheck } from "../services/linked-loan-status-api";

const money = (value: string | number | null) =>
  value === null
    ? "No disponible"
    : new Intl.NumberFormat("es-AR", {
        style: "currency",
        currency: "ARS",
      }).format(Number(value));
export function LinkedLoanStatusBanner({
  data,
  loading,
  failed,
  retry,
  solicitudId,
  onRecovered,
  canRecover = false,
  cuenta,
  editing = false,
}: {
  data?: LinkedLoanStatus;
  loading: boolean;
  failed: boolean;
  retry: () => void;
  solicitudId?: string;
  onRecovered?: () => void | Promise<unknown>;
  canRecover?: boolean;
  // NroCuenta del prestamo generado: es el numero que se usa en la mutual
  // (currentLoanId es el ID interno de Vimarx).
  cuenta?: { loanId: string; nroCuenta: string } | null;
  // El monto bloqueado solo importa al editar: ahi se avisa como error.
  editing?: boolean;
}) {
  const check = useMutation({
    mutationFn: (recovery: NonNullable<LinkedLoanStatus["recovery"]>) =>
      apiClient.post<LoanGenerationCheck>(
        `/solicitudes/${solicitudId}/loan-generation/check`,
        {
          requestId: recovery.requestId,
          expectedUpdatedAt: recovery.expectedUpdatedAt,
        },
        120000,
      ),
    retry: false,
    onError: () => retry(),
  });
  const checked =
    check.data?.requestId === data?.recovery?.requestId &&
    check.data?.expectedUpdatedAt === data?.recovery?.expectedUpdatedAt
      ? check.data
      : undefined;
  const prestamo = (loanId: string | null) =>
    loanId && cuenta?.loanId === loanId
      ? `Nº ${cuenta.nroCuenta}`
      : `ID ${loanId ?? "desconocido"}`;
  if (loading)
    return (
      <p className="border-b border-border px-4 py-2 text-xs" role="status">
        Comprobando el préstamo vinculado en Vimarx…
      </p>
    );
  if (failed || data?.status === "unavailable")
    return (
      <div
        role="alert"
        className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm"
      >
        <p>
          {data?.reason ??
            "No pudimos comprobar el préstamo en Vimarx. La edición del monto y el avance quedan bloqueados hasta verificarlo."}
        </p>
        <Button
          variant="outline"
          size="sm"
          disabled={check.isPending}
          onClick={() => {
            if (!failed && data?.recovery && solicitudId)
              check.mutate(data.recovery);
            else retry();
          }}
          className="mt-2 min-h-11"
        >
          {check.isPending ? "Consultando Vimarx…" : "Volver a comprobar"}
        </Button>
        {check.isPending && (
          <p role="status" className="mt-2">
            Buscando préstamos del socio en Vimarx…
          </p>
        )}
        {!check.isPending && check.error && (
          <p role="alert" className="mt-2">
            {check.error.message}
          </p>
        )}
        {!check.isPending && checked && (
          <p role="status" className="mt-2">
            {checked.reason}
          </p>
        )}
        {!failed &&
          !check.isPending &&
          canRecover &&
          data?.recovery &&
          checked &&
          solicitudId && (
            <LoanGenerationRecoveryControl
              key={`${checked.requestId}-${checked.checkedAt}`}
              solicitudId={solicitudId}
              check={checked}
              onRecovered={onRecovered}
            />
          )}
      </div>
    );
  if (!data || data.status === "none") return null;
  if (data.status === "cancelled")
    return (
      <div className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm">
        <strong>
          Préstamo {prestamo(data.currentLoanId)} anulado en Vimarx.
        </strong>{" "}
        Podés editar el monto según tus permisos. Regenerá el préstamo y
        reemplazá el anterior antes de terminar el análisis.
      </div>
    );
  if (!data.matchesAmount)
    return (
      <div
        role="alert"
        className="border-b border-destructive/30 bg-destructive/5 px-4 py-3 text-sm"
      >
        <strong>Préstamo con monto distinto.</strong> Solicitud:{" "}
        {money(data.requestedAmount)} · Préstamo: {money(data.amount)}. Por
        favor, anulá el préstamo preexistente {prestamo(data.currentLoanId)} en
        Vimarx antes de modificar el monto o continuar.
      </div>
    );
  if (!editing) return null;
  return (
    <p
      role="alert"
      className="border-b border-destructive/30 bg-destructive/5 px-4 py-3 text-sm"
    >
      No se puede modificar el monto: el préstamo {prestamo(data.currentLoanId)}{" "}
      ya está generado en Vimarx por {money(data.amount)}. Para cambiarlo,
      primero hay que anularlo en Vimarx.
    </p>
  );
}

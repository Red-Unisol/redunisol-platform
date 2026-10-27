import { Button } from "@/shared/components/ui/button";
import type { LinkedLoanStatus } from "../services/linked-loan-status-api";
import { LoanGenerationRecoveryControl } from "./loan-generation-recovery-control";

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
}: {
  data?: LinkedLoanStatus;
  loading: boolean;
  failed: boolean;
  retry: () => void;
  solicitudId?: string;
  onRecovered?: () => void | Promise<unknown>;
  canRecover?: boolean;
}) {
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
        <Button variant="outline" size="sm" onClick={retry} className="mt-2">
          Volver a comprobar
        </Button>
        {!failed && canRecover && data?.recovery && solicitudId && (
          <LoanGenerationRecoveryControl
            key={data.recovery.requestId}
            solicitudId={solicitudId}
            recovery={data.recovery}
            onRecovered={onRecovered}
          />
        )}
      </div>
    );
  if (!data || data.status === "none") return null;
  if (data.status === "cancelled")
    return (
      <div className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm">
        <strong>Préstamo {data.currentLoanId} anulado en Vimarx.</strong> Podés
        editar el monto según tus permisos. Regenerá el préstamo y reemplazá el
        anterior antes de terminar el análisis.
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
        favor, anulá el préstamo preexistente {data.currentLoanId} en Vimarx
        antes de modificar el monto o continuar.
      </div>
    );
  return (
    <p className="border-b border-border bg-background px-4 py-2 text-xs text-foreground-secondary">
      Préstamo {data.currentLoanId} vigente por {money(data.amount)}. El monto
      está bloqueado; para modificarlo, primero debe anularse en Vimarx.
    </p>
  );
}

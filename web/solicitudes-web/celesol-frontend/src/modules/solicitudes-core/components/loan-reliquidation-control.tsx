import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/shared/services/http/api-client";
import { Button } from "@/shared/components/ui/button";
import {
  DialogRoot,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/shared/components/ui/dialog";
import { solicitudesCoreQueryKeys } from "../services/solicitudes-core-query-keys";

export type ReliquidationView = {
  visible: boolean;
  pending: boolean;
  prepared: boolean;
  requestId?: string;
  reason?: string;
  canReopen: boolean;
  blockedReason: string | null;
  updatedAt: string;
  previousLoanId: string | null;
};
type Input = {
  requestId: string;
  expectedUpdatedAt: string;
  previousLoanId: string;
  reason: string;
};
type Action = "prepare" | "reopen";

export function LoanReliquidationControl({
  solicitudId,
  updatedAt,
  isEditing,
}: {
  solicitudId: string;
  updatedAt: string;
  isEditing: boolean;
}) {
  const client = useQueryClient();
  const [operationError, setOperationError] = useState<string | null>(null);
  const endpoint = `/solicitudes/${solicitudId}/reliquidacion`;
  const queryKey = [
    ...solicitudesCoreQueryKeys.all,
    "reliquidacion",
    solicitudId,
    updatedAt,
  ];
  const view = useQuery({
    queryKey,
    queryFn: () => apiClient.get<ReliquidationView>(endpoint),
    placeholderData: (previous) => previous,
  });
  if (view.error && !view.data)
    return (
      <p role="alert" className="border-b border-border px-4 py-3 text-sm">
        {operationError ?? "No se pudo consultar la reliquidación."}{" "}
        <button className="underline" onClick={() => void view.refetch()}>
          Reintentar
        </button>
      </p>
    );
  if (!view.data) return null;
  return (
    <LoanReliquidationPanel
      data={view.data}
      isEditing={isEditing}
      operationError={operationError}
      onClearError={() => setOperationError(null)}
      onSubmit={async (action, input) => {
        setOperationError(null);
        try {
          const saved = await apiClient.post<ReliquidationView>(
            action === "prepare" ? `${endpoint}/preparar` : endpoint,
            input,
          );
          // Show the authoritative POST result immediately, including when the
          // parent detail changes its version or background reads are slow.
          client.setQueryData(queryKey, saved);
          client.setQueryData(
            [
              ...solicitudesCoreQueryKeys.all,
              "reliquidacion",
              solicitudId,
              saved.updatedAt,
            ],
            saved,
          );
        } catch (error) {
          setOperationError(
            error instanceof Error
              ? error.message
              : "No se pudo completar la operación.",
          );
          throw error;
        } finally {
          // Unrelated refetches must not delay success or hide a rejected pause.
          void client.invalidateQueries({
            queryKey: solicitudesCoreQueryKeys.all,
          });
        }
      }}
    />
  );
}

export function LoanReliquidationPanel({
  data,
  isEditing = false,
  onSubmit,
  operationError = null,
  onClearError,
}: {
  data: ReliquidationView;
  isEditing?: boolean;
  onSubmit: (action: Action, input: Input) => Promise<void>;
  operationError?: string | null;
  onClearError?: () => void;
}) {
  const [form, setForm] = useState<{
    action: Action;
    version: string;
    requestId: string;
    loanId: string;
  } | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const message = error ?? operationError;
  useEffect(() => {
    if (message) errorRef.current?.scrollIntoView({ block: "nearest" });
  }, [message]);
  if (!data.visible) return null;
  const title = data.pending
    ? "Reliquidación en Riesgo"
    : data.prepared
      ? "Solicitud pausada para reliquidación"
      : "Devolver a Riesgo por anulación";
  const ready =
    form &&
    !isEditing &&
    !busy &&
    data.canReopen &&
    form.version === data.updatedAt &&
    reason.trim().length >= 10;
  return (
    <section
      aria-label="Reliquidación"
      className="border-b border-border bg-muted/20 px-4 py-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1 basis-72 text-sm">
          <strong>{title}</strong>
          <p className="mt-1 text-foreground-secondary">
            {data.pending
              ? `El préstamo anterior ${data.previousLoanId} quedó desvinculado. Continuá el análisis habitual y generá un préstamo nuevo desde Confirmada. Se requerirá su propia firma.`
              : data.prepared
                ? `Firma y transferencias pausadas. Anulá el préstamo ${data.previousLoanId} en Vimarx y luego verificá aquí la anulación para volver a Riesgo. La pausa permanece si la verificación falla.`
                : "Primero pausá la solicitud en Beex; después anulá el préstamo en Vimarx. Sólo se admiten casos sin reservas, pagos ni refinanciación registrada."}
          </p>
          {!data.pending && data.blockedReason && (
            <p className="mt-2">{data.blockedReason}</p>
          )}
          {!data.pending && isEditing && (
            <p className="mt-2">
              Guardá o cancelá la edición antes de continuar.
            </p>
          )}
        </div>
        {!data.pending && (
          <Button
            type="button"
            variant="outline"
            className="h-auto max-w-full whitespace-normal text-left"
            disabled={!data.canReopen || isEditing || busy}
            onClick={() => {
              setForm({
                action: data.prepared ? "reopen" : "prepare",
                version: data.updatedAt,
                requestId: data.requestId ?? crypto.randomUUID(),
                loanId: data.previousLoanId!,
              });
              setReason(data.prepared ? (data.reason ?? "") : "");
              setError(null);
              onClearError?.();
            }}
          >
            {data.prepared
              ? "Verificar anulación y volver a Riesgo"
              : "Preparar reliquidación"}
          </Button>
        )}
      </div>
      {!form && operationError && (
        <p
          role="alert"
          className="mt-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-foreground"
        >
          {operationError}
        </p>
      )}
      <DialogRoot
        open={Boolean(form)}
        onOpenChange={(open) => {
          if (!open && !busy) setForm(null);
        }}
      >
        <DialogContent
          className="max-h-[90vh] max-w-xl space-y-4 overflow-y-auto p-6"
          onInteractOutside={(e) => {
            if (busy) e.preventDefault();
          }}
          onEscapeKeyDown={(e) => {
            if (busy) e.preventDefault();
          }}
        >
          <DialogTitle className="text-xl font-semibold">
            {form?.action === "prepare"
              ? "Preparar reliquidación"
              : "Confirmar anulación y volver a Riesgo"}
          </DialogTitle>
          <DialogDescription className="text-sm leading-relaxed text-foreground-secondary">
            {form?.action === "prepare"
              ? "Se pausarán la firma y las transferencias hasta verificar la anulación. Después deberás anular el préstamo en Vimarx. Esta pausa no se levanta automáticamente."
              : "Beex consultará Vimarx. Sólo una anulación confirmada, sin vigencia y con saldo cero, permite desvincular el préstamo y volver a Revisión Riesgo. El historial y el analista se conservan."}
          </DialogDescription>
          <p className="text-sm">
            Préstamo anterior: <strong>{form?.loanId}</strong>.
          </p>
          <form
            className="grid gap-4"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!form || !ready) return;
              setBusy(true);
              setError(null);
              try {
                await onSubmit(form.action, {
                  requestId: form.requestId,
                  expectedUpdatedAt: form.version,
                  previousLoanId: form.loanId,
                  reason: reason.trim(),
                });
                setForm(null);
              } catch (e) {
                setError(
                  e instanceof Error
                    ? e.message
                    : "No se pudo completar la operación. Actualizá el detalle antes de continuar.",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            <label className="grid gap-2 text-sm">
              Motivo obligatorio
              <textarea
                required
                minLength={10}
                maxLength={2000}
                rows={3}
                value={reason}
                readOnly={form?.action === "reopen"}
                disabled={busy}
                onChange={(e) => setReason(e.target.value)}
                className="w-full rounded-md border border-input-border bg-input-background px-3 py-2"
              />
            </label>
            {form && !busy && form.version !== data.updatedAt && (
              <p role="alert" className="text-sm">
                La solicitud cambió. Cerrá y volvé a abrir para revisar su
                versión actual.
              </p>
            )}
            {message && (
              <p
                ref={errorRef}
                role="alert"
                className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-foreground"
              >
                {message}
              </p>
            )}
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => setForm(null)}
              >
                Cerrar
              </Button>
              <Button
                type="submit"
                className="h-auto whitespace-normal"
                disabled={!ready}
              >
                {busy
                  ? "Verificando…"
                  : form?.action === "prepare"
                    ? "Pausar solicitud"
                    : "Verificar y devolver a Riesgo"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </DialogRoot>
    </section>
  );
}

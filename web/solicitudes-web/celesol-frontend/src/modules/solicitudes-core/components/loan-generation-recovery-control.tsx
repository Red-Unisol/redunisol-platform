import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/shared/components/ui/button";
import { apiClient } from "@/shared/services/http/api-client";
import type { LinkedLoanStatus } from "../services/linked-loan-status-api";

export function LoanGenerationRecoveryControl({
  solicitudId,
  recovery,
  onRecovered,
}: {
  solicitudId: string;
  recovery: NonNullable<LinkedLoanStatus["recovery"]>;
  onRecovered?: () => void | Promise<unknown>;
}) {
  const client = useQueryClient();
  const [newLoanId, setNewLoanId] = useState(recovery.knownLoanId ?? "");
  const [reason, setReason] = useState("");
  const [version] = useState(recovery.expectedUpdatedAt);
  const mutation = useMutation({
    mutationFn: () =>
      apiClient.post(
        `/solicitudes/${solicitudId}/loan-generation/recover`,
        {
          requestId: recovery.requestId,
          expectedUpdatedAt: version,
          newLoanId: newLoanId.trim(),
          reason: reason.trim(),
        },
        120000,
      ),
    onSuccess: async () => {
      toast.success(
        "Préstamo recuperado y vinculado. Se conservó la trazabilidad de la generación.",
      );
      await client.invalidateQueries({ queryKey: ["solicitudes-core"] });
      await client.invalidateQueries({ queryKey: ["notifications"] });
      await onRecovered?.();
    },
    retry: false,
  });
  const ready =
    /^[1-9]\d*$/.test(newLoanId.trim()) &&
    reason.trim().length >= 10 &&
    version === recovery.expectedUpdatedAt;
  return (
    <details className="mt-3 rounded-md border border-border bg-surface p-3">
      <summary className="cursor-pointer text-sm font-semibold">
        Recuperar préstamo generado
      </summary>
      <p className="mt-2 text-sm text-foreground-secondary">
        Usá esta recuperación si la generación ya creó un préstamo en Vimarx y
        su vinculación quedó pendiente. Se comprobarán el titular y las
        condiciones antes de vincularlo. Esta acción no genera otro préstamo.
      </p>
      <form
        className="mt-3 grid gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (ready && !mutation.isPending) mutation.mutate();
        }}
      >
        <label
          className="grid gap-1 text-sm font-medium"
          htmlFor={`recover-loan-${solicitudId}`}
        >
          Número del préstamo generado en Vimarx
          <input
            id={`recover-loan-${solicitudId}`}
            className="w-full rounded-md border border-border bg-surface px-3 py-2 font-normal"
            inputMode="numeric"
            value={newLoanId}
            onChange={(event) => setNewLoanId(event.target.value)}
            required
            pattern="[1-9][0-9]*"
            disabled={mutation.isPending}
          />
        </label>
        <label
          className="grid gap-1 text-sm font-medium"
          htmlFor={`recover-loan-reason-${solicitudId}`}
        >
          Motivo de la recuperación
          <textarea
            id={`recover-loan-reason-${solicitudId}`}
            className="min-h-20 w-full rounded-md border border-border bg-surface px-3 py-2 font-normal"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            required
            minLength={10}
            maxLength={2000}
            placeholder="Indicá cómo comprobaste el resultado de la generación (mínimo 10 caracteres)."
            disabled={mutation.isPending}
          />
        </label>
        {version !== recovery.expectedUpdatedAt && (
          <p role="alert" className="text-sm text-destructive">
            La solicitud se actualizó. Volvé a comprobar el préstamo antes de
            recuperar.
          </p>
        )}
        {mutation.error && (
          <p role="alert" className="text-sm text-destructive">
            {mutation.error.message}
          </p>
        )}
        <Button
          type="submit"
          variant="outline"
          className="justify-self-start"
          disabled={!ready || mutation.isPending}
        >
          {mutation.isPending
            ? "Verificando y vinculando…"
            : "Recuperar préstamo generado"}
        </Button>
      </form>
    </details>
  );
}

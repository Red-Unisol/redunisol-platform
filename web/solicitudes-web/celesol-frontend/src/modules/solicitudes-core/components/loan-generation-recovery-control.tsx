import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/shared/components/ui/button";
import { apiClient } from "@/shared/services/http/api-client";
import type { LoanGenerationCheck } from "../services/linked-loan-status-api";

export function LoanGenerationRecoveryControl({
  solicitudId,
  check,
  onRecovered,
}: {
  solicitudId: string;
  check: LoanGenerationCheck;
  onRecovered?: () => void | Promise<unknown>;
}) {
  const client = useQueryClient();
  const [reason, setReason] = useState("");
  const release = check.canRelease && !check.canRecover;
  const mutation = useMutation({
    mutationFn: () =>
      apiClient.post(
        `/solicitudes/${solicitudId}/loan-generation/${release ? "release" : "recover-checked"}`,
        {
          requestId: check.requestId,
          expectedUpdatedAt: check.expectedUpdatedAt,
          reason: reason.trim(),
          ...(!release ? { newLoanId: check.candidate?.id } : {}),
        },
        120000,
      ),
    onSuccess: async () => {
      toast.success(
        release
          ? "Reserva liberada. Actualizá las condiciones y generá el préstamo una sola vez."
          : "Préstamo recuperado y vinculado.",
      );
      await client.invalidateQueries({ queryKey: ["solicitudes-core"] });
      await client.invalidateQueries({ queryKey: ["notifications"] });
      await onRecovered?.();
    },
    retry: false,
  });
  if (!check.canRecover && !check.canRelease) return null;
  const loan = check.candidate;
  const money = (amount: number) =>
    new Intl.NumberFormat("es-AR", {
      style: "currency",
      currency: "ARS",
    }).format(amount);
  return (
    <form
      className="mt-3 grid gap-3 rounded-md border border-border bg-surface p-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (reason.trim().length >= 10 && !mutation.isPending)
          mutation.mutate();
      }}
    >
      <strong>
        {release
          ? "Liberar reserva de generación"
          : "Recuperar préstamo encontrado"}
      </strong>
      {loan && (
        <p>
          Préstamo {loan.account ? `Nº ${loan.account}` : `ID ${loan.id}`} ·{" "}
          {loan.amount === null ? "Monto no disponible" : money(loan.amount)} ·{" "}
          {loan.cuotas} cuotas.
          {loan.createdAt && <> Alta: {loan.createdAt.slice(0, 10)}.</>}
          {loan.primerVencimiento && (
            <> Primer vencimiento: {loan.primerVencimiento.slice(0, 10)}.</>
          )}
        </p>
      )}
      <p>
        {release
          ? "Se quitará el bloqueo y la solicitud seguirá Confirmada. Después podrás generar un préstamo."
          : "Verificá los datos del préstamo encontrado. Se recuperará su vinculación con esta solicitud."}
      </p>
      <label
        className="grid gap-1 text-sm font-medium"
        htmlFor={`recover-loan-reason-${solicitudId}`}
      >
        Motivo de la {release ? "liberación" : "recuperación"}
        <textarea
          id={`recover-loan-reason-${solicitudId}`}
          className="min-h-20 w-full rounded-md border border-border bg-surface px-3 py-2 font-normal"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          required
          minLength={10}
          maxLength={2000}
          placeholder="Dejá constancia de la comprobación realizada (mínimo 10 caracteres)."
          disabled={mutation.isPending}
        />
      </label>
      {mutation.error && (
        <p role="alert" className="text-sm text-destructive">
          {mutation.error.message}
        </p>
      )}
      <Button
        type="submit"
        variant="outline"
        className="min-h-11 justify-self-start"
        disabled={
          reason.trim().length < 10 || mutation.isPending || mutation.isSuccess
        }
      >
        {mutation.isPending
          ? "Verificando…"
          : release
            ? "Liberar reserva"
            : "Recuperar préstamo"}
      </Button>
    </form>
  );
}

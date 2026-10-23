import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/shared/services/http/api-client";
import { Button } from "@/shared/components/ui/button";
import {
  DialogRoot,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/shared/components/ui/dialog";
import { solicitudesCoreQueryKeys } from "../services/solicitudes-core-query-keys";

import { ControlledLoanReplacementControl } from "./controlled-loan-replacement-control";

type View = {
  replacementPending: boolean;
  canAdmin: boolean;
  state: string;
  updatedAt: string;
  loanId: string | null;
  reconciliationRequired: boolean;
  blockedReason: string | null;
};

export function AdministrativeStateControl({
  solicitudId,
  updatedAt,
  isEditing,
}: {
  solicitudId: string;
  updatedAt: string;
  isEditing: boolean;
}) {
  const client = useQueryClient();
  const endpoint = `/solicitudes/${solicitudId}/admin-state-correction`;
  const view = useQuery({
    queryKey: [
      ...solicitudesCoreQueryKeys.all,
      "admin-state-correction",
      solicitudId,
      updatedAt,
    ],
    queryFn: () => apiClient.get<View>(endpoint),
  });
  const [mode, setMode] = useState<"correct" | "reconcile" | null>(null);
  const [reason, setReason] = useState("");
  const [version, setVersion] = useState("");
  const [requestId, setRequestId] = useState("");
  const mutation = useMutation({
    mutationFn: () =>
      mode === "correct"
        ? apiClient.post<View>(endpoint, {
            targetStateCode: "Revisar",
            expectedUpdatedAt: version,
            reason: reason.trim(),
            requestId,
          })
        : apiClient.post<View>(
            `/solicitudes/${solicitudId}/admin-core-reconciliation`,
            { expectedUpdatedAt: version, reason: reason.trim() },
          ),
    onSuccess: async () => {
      setMode(null);
      await client.invalidateQueries({
        queryKey: solicitudesCoreQueryKeys.all,
      });
    },
    onError: () => {
      void client.invalidateQueries({ queryKey: solicitudesCoreQueryKeys.all });
    },
  });
  function start(next: "correct" | "reconcile") {
    if (!view.data) return;
    setVersion(view.data.updatedAt);
    setRequestId(crypto.randomUUID());
    setReason("");
    mutation.reset();
    setMode(next);
  }
  if (view.error)
    return (
      <p role="alert" className="border-b border-border px-4 py-2 text-sm">
        No se pudieron consultar los controles administrativos.{" "}
        <button className="underline" onClick={() => void view.refetch()}>
          Reintentar
        </button>
      </p>
    );
  const data = view.data;
  if (
    !data ||
    (!data.reconciliationRequired &&
      (!data.canAdmin || data.state !== "Confirmada"))
  )
    return null;
  return (
    <div className="border-b border-border bg-muted/20 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm">
          <strong>
            {data.reconciliationRequired
              ? "Conciliación del préstamo Core pendiente"
              : "Administración"}
          </strong>
          <p className="mt-1 text-foreground-secondary">
            {data.reconciliationRequired
              ? `Se conserva el préstamo ${data.loanId}. La liquidación está bloqueada hasta verificar sus condiciones con el Core.`
              : "Corrección excepcional con motivo e historial. Destino habilitado: Revisar (Vendedores)."}
          </p>
          {isEditing && (
            <p className="mt-1">
              Terminá de guardar o cancelá la edición antes de continuar.
            </p>
          )}
        </div>
        {data.canAdmin && (
          <div className="flex flex-wrap gap-2">
            {data.state === "Confirmada" && (
              <Button
                variant="outline"
                type="button"
                title={data.blockedReason ?? undefined}
                disabled={
                  Boolean(data.blockedReason) || isEditing || mutation.isPending
                }
                onClick={() => start("correct")}
              >
                Corregir estado
              </Button>
            )}
            {data.reconciliationRequired && (
              <Button
                variant="outline"
                type="button"
                disabled={isEditing || mutation.isPending || data.replacementPending}
                onClick={() => start("reconcile")}
              >
                Conciliar préstamo Core
              </Button>
            )}
          </div>
        )}
      </div>
      {data.canAdmin && data.state === "Confirmada" && data.blockedReason && (
        <p className="mt-2 text-sm">{data.blockedReason}</p>
      )}
      {data.canAdmin && data.loanId && data.reconciliationRequired && (
        <ControlledLoanReplacementControl solicitudId={solicitudId} updatedAt={updatedAt} isEditing={isEditing} />
      )}
      <DialogRoot
        open={mode !== null}
        onOpenChange={(open) => {
          if (!open && !mutation.isPending) setMode(null);
        }}
      >
        <DialogContent className="max-w-xl space-y-4 p-6">
          <DialogTitle className="text-xl font-semibold leading-tight">
            {mode === "correct"
              ? "Corrección administrativa de estado"
              : "Conciliar préstamo Core"}
          </DialogTitle>
          <DialogDescription className="text-sm leading-relaxed text-foreground-secondary">
            {mode === "correct"
              ? "Confirmada → Revisar (Vendedores). Se conserva el historial, el ejecutivo asignado y el vínculo con el préstamo."
              : "Se consultará el préstamo existente en el Core y se compararán titular, monto, cuotas, línea, vencimiento y cancelaciones con Beex."}
          </DialogDescription>
          {data.loanId && (
            <p className="text-sm">
              Préstamo Core: <strong>{data.loanId}</strong>.{" "}
              {mode === "correct"
                ? "Deberá conciliarse antes de liquidar. No se genera otro préstamo ni se modifican operaciones del Core."
                : "Si hay diferencias, corregilas en el sistema correspondiente y volvé a verificar. Cualquier edición posterior de las condiciones exige una nueva conciliación."}
            </p>
          )}
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (reason.trim().length >= 10) mutation.mutate();
            }}
          >
            <label className="grid gap-2 text-sm">
              Motivo obligatorio
              <textarea
                required
                minLength={10}
                maxLength={2000}
                rows={4}
                value={reason}
                disabled={mutation.isPending}
                onChange={(e) => setReason(e.target.value)}
                className="w-full rounded-md border border-input-border bg-input-background px-3 py-2"
              />
            </label>
            {version !== data.updatedAt && (
              <p role="alert" className="text-sm">
                La solicitud cambió. Cerrá y volvé a abrir el formulario para
                revisar su versión actual.
              </p>
            )}
            {mutation.error && (
              <p role="alert" className="text-sm text-danger-foreground">
                {mutation.error.message}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                type="button"
                disabled={mutation.isPending}
                onClick={() => setMode(null)}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={
                  mutation.isPending ||
                  reason.trim().length < 10 ||
                  version !== data.updatedAt
                }
              >
                {mutation.isPending
                  ? "Verificando…"
                  : mode === "correct"
                    ? "Confirmar corrección a Revisar"
                    : "Verificar y registrar conciliación"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </DialogRoot>
    </div>
  );
}

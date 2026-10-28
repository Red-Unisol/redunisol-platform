import { useEffect, useState } from "react";
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
import { useRevisionPrestamoQuery } from "../hooks/use-revision-prestamo-query";
import { useSolicitudCoreCancelacionesQuery } from "../hooks/use-solicitud-core-cancelaciones-query";

type Operation = {
  id: string;
  previousLoanId: string;
  newLoanId: string | null;
  status: string;
};
type View = {
  canAdmin: boolean;
  canReplace: boolean;
  canRecover: boolean;
  blockedReason: string | null;
  updatedAt: string;
  currentLoanId: string | null;
  amount: number | null;
  cuotas: number | null;
  line: string | null;
  operations: Operation[];
};
const money = (value: number | null | undefined) =>
  value == null
    ? "Sin cálculo"
    : new Intl.NumberFormat("es-AR", {
        style: "currency",
        currency: "ARS",
      }).format(value);

export function ControlledLoanReplacementControl({
  solicitudId,
  updatedAt,
  isEditing,
}: {
  solicitudId: string;
  updatedAt: string;
  isEditing: boolean;
}) {
  const endpoint = `/solicitudes/${solicitudId}/admin-loan-replacements`;
  const view = useQuery({
    queryKey: [
      ...solicitudesCoreQueryKeys.all,
      "admin-loan-replacements",
      solicitudId,
      updatedAt,
    ],
    queryFn: () => apiClient.get<View>(endpoint),
    refetchInterval: (query) =>
      query.state.data?.operations[0]?.status === "CREATING" ? 3000 : false,
  });
  const [mode, setMode] = useState<"replace" | "recover" | null>(null);
  if (view.error)
    return (
      <p role="alert" className="mt-3 text-sm">
        No se pudo consultar la regeneración del préstamo.{" "}
        <button className="underline" onClick={() => void view.refetch()}>
          Reintentar
        </button>
      </p>
    );
  const data = view.data;
  if (
    !data ||
    (!data.canReplace && !data.canRecover && data.operations.length === 0)
  )
    return null;
  const last = data.operations[0];
  const pending = last && last.status !== "LINKED";
  return (
    <details
      className="mt-4 rounded-md border border-border p-3"
      open={pending || undefined}
    >
      <summary className="cursor-pointer text-sm font-medium">
        Regenerar préstamo y reemplazar el anterior
      </summary>
      <p className="mt-2 text-sm text-foreground-secondary">
        Primero guardá el monto, las cuotas y las cancelaciones correctas.
        Vimarx debe tener anulado el préstamo anterior. Se conservarán su ID y
        su enlace de firma en la auditoría.
      </p>
      {last?.status === "LINKED" && (
        <p className="mt-2 text-sm">
          Reemplazo registrado: {last.previousLoanId} →{" "}
          <strong>{last.newLoanId}</strong>. Se verificarán sus condiciones
          antes de terminar el análisis.
        </p>
      )}
      {pending && (
        <p role="status" className="mt-2 text-sm">
          Hay un intento registrado para el préstamo {last.previousLoanId}
          {last.newLoanId ? `; Vimarx devolvió el ID ${last.newLoanId}` : ""}.
          No vuelvas a generarlo.{" "}
          {last.status === "CREATING"
            ? "Esperando el resultado de Vimarx…"
            : "Verificá el resultado en Vimarx y vinculá el préstamo generado."}
        </p>
      )}
      {data.blockedReason && (
        <p className="mt-2 text-sm">{data.blockedReason}</p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={isEditing || !data.canReplace}
          onClick={() => setMode("replace")}
        >
          Regenerar préstamo y reemplazar el anterior
        </Button>
        {data.canRecover && (
          <Button
            type="button"
            variant="outline"
            disabled={isEditing}
            onClick={() => setMode("recover")}
          >
            Vincular préstamo generado
          </Button>
        )}
      </div>
      <DialogRoot
        open={mode !== null}
        onOpenChange={(open) => {
          if (!open) setMode(null);
        }}
      >
        {mode && (
          <ReplacementForm
            key={mode}
            solicitudId={solicitudId}
            endpoint={endpoint}
            data={data}
            mode={mode}
            isEditing={isEditing}
            close={() => setMode(null)}
          />
        )}
      </DialogRoot>
    </details>
  );
}

function ReplacementForm({
  solicitudId,
  endpoint,
  data,
  mode,
  isEditing,
  close,
}: {
  solicitudId: string;
  endpoint: string;
  data: View;
  mode: "replace" | "recover";
  isEditing: boolean;
  close: () => void;
}) {
  const client = useQueryClient();
  const [version] = useState(data.updatedAt);
  const [requestId] = useState(() =>
    mode === "recover" ? data.operations[0].id : crypto.randomUUID(),
  );
  const [reason, setReason] = useState("");
  const [newLoanId, setNewLoanId] = useState(
    data.operations[0]?.newLoanId ?? "",
  );
  const mutation = useMutation({
    mutationFn: () =>
      apiClient.post<View>(
        mode === "recover" ? `${endpoint}/recover` : endpoint,
        {
          requestId,
          expectedUpdatedAt: version,
          reason: reason.trim(),
          ...(mode === "recover"
            ? { newLoanId }
            : { previousLoanId: data.currentLoanId }),
        },
      ),
    onSuccess: async () => {
      close();
      await client.invalidateQueries({
        queryKey: solicitudesCoreQueryKeys.all,
      });
    },
    onError: () => {
      void client.invalidateQueries({ queryKey: solicitudesCoreQueryKeys.all });
    },
    retry: false,
  });
  const [previewReady, setPreviewReady] = useState(false);
  const ready =
    !isEditing &&
    version === data.updatedAt &&
    reason.trim().length >= 10 &&
    (mode === "recover" ? /^[1-9]\d*$/.test(newLoanId) : previewReady);
  return (
    <DialogContent
      className="max-h-[90vh] max-w-xl space-y-4 overflow-y-auto p-6"
      onInteractOutside={(e) => {
        if (mutation.isPending) e.preventDefault();
      }}
      onEscapeKeyDown={(e) => {
        if (mutation.isPending) e.preventDefault();
      }}
    >
      <DialogTitle className="text-xl font-semibold">
        {mode === "replace"
          ? "Regenerar préstamo y reemplazar el anterior"
          : "Vincular préstamo generado"}
      </DialogTitle>
      <DialogDescription className="text-sm leading-relaxed text-foreground-secondary">
        {mode === "replace"
          ? "Se generará un préstamo nuevo con las condiciones guardadas y un enlace de firma vigente. Se conserva el préstamo anterior en el historial. La solicitud permanece en su estado actual."
          : "Usá esta recuperación si el intento ya generó un préstamo en Vimarx. Se verificará el titular y las condiciones antes de vincularlo."}
      </DialogDescription>
      <p className="text-sm">
        Préstamo anterior:{" "}
        <strong>
          {mode === "recover"
            ? data.operations[0].previousLoanId
            : data.currentLoanId}
        </strong>
        . Condiciones guardadas:{" "}
        <strong>
          {money(data.amount)} / {data.cuotas} cuotas
        </strong>
        . {data.line}
      </p>
      {mode === "replace" && (
        <ReplacementPreview
          solicitudId={solicitudId}
          version={version}
          data={data}
          onReady={setPreviewReady}
        />
      )}
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready && !mutation.isPending) mutation.mutate();
        }}
      >
        {mode === "recover" && (
          <label className="grid gap-2 text-sm">
            ID del préstamo nuevo en Vimarx
            <input
              required
              inputMode="numeric"
              pattern="[1-9][0-9]*"
              value={newLoanId}
              disabled={mutation.isPending}
              onChange={(e) => setNewLoanId(e.target.value.trim())}
              className="rounded-md border border-input-border bg-input-background px-3 py-2"
            />
          </label>
        )}
        <label className="grid gap-2 text-sm">
          Motivo obligatorio
          <textarea
            required
            minLength={10}
            maxLength={2000}
            rows={3}
            value={reason}
            disabled={mutation.isPending}
            onChange={(e) => setReason(e.target.value)}
            className="rounded-md border border-input-border bg-input-background px-3 py-2"
          />
        </label>
        {version !== data.updatedAt && (
          <p role="alert" className="text-sm">
            La solicitud cambió. Cerrá y volvé a abrir para revisar la versión
            actual.
          </p>
        )}
        {mutation.error && (
          <p role="alert" className="text-sm text-danger-foreground">
            {mutation.error.message}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={mutation.isPending}
            onClick={close}
          >
            Cancelar
          </Button>
          <Button type="submit" disabled={!ready || mutation.isPending}>
            {mutation.isPending
              ? "Verificando…"
              : mode === "replace"
                ? "Confirmar reemplazo y generar"
                : "Verificar y vincular"}
          </Button>
        </div>
      </form>
    </DialogContent>
  );
}

function ReplacementPreview({
  solicitudId,
  version,
  data,
  onReady,
}: {
  solicitudId: string;
  version: string;
  data: View;
  onReady: (ready: boolean) => void;
}) {
  const revision = useRevisionPrestamoQuery(solicitudId, version);
  const cancelaciones = useSolicitudCoreCancelacionesQuery(solicitudId);
  const totalCancelaciones = (cancelaciones.data ?? []).reduce(
    (total, c) => total + c.monto,
    0,
  );
  const result = revision.data;
  const ready =
    !revision.isFetching &&
    !revision.error &&
    !cancelaciones.isFetching &&
    !cancelaciones.error &&
    Boolean(result?.calculo) &&
    result?.condiciones.montoAFinanciar === data.amount &&
    result?.condiciones.cuotas === data.cuotas &&
    totalCancelaciones <= (data.amount ?? 0);
  // Report readiness after rendering, including failed or changed previews.
  useEffect(() => {
    onReady(ready);
  }, [ready, onReady]);
  return (
    <div className="rounded-md bg-muted/30 p-3 text-sm" aria-live="polite">
      {result && (
        <p>
          {result.titular.nombreCompleto} · Socio {result.titular.nroSocio}
        </p>
      )}
      {ready ? (
        <div className="mt-2 grid gap-1">
          <p>
            Cuota calculada:{" "}
            <strong>{money(result?.calculo?.cuotaResultante)}</strong>
          </p>
          <p>
            Cancelaciones: {money(totalCancelaciones)} · Neto:{" "}
            {money((data.amount ?? 0) - totalCancelaciones)}
          </p>
          <p>
            Primer vencimiento:{" "}
            {result?.calculo?.fechaPrimerVencimiento?.slice(0, 10) ??
              "Según línea en Vimarx"}
          </p>
        </div>
      ) : (
        <p>
          {revision.isFetching || cancelaciones.isFetching
            ? "Consultando condiciones y cálculo…"
            : "No se pudo validar el cálculo con estas condiciones. Revisá y guardá la solicitud antes de generar."}
        </p>
      )}
    </div>
  );
}

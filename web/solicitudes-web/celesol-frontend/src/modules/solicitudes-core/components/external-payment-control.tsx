import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/shared/components/ui/button";
import {
  DialogRoot,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/shared/components/ui/dialog";
import {
  getExternalPayment,
  registerExternalPayment,
} from "../services/external-payment-api";
import { solicitudesCoreQueryKeys } from "../services/solicitudes-core-query-keys";
import { externalPaymentToday } from "../utils/external-payment-form";

const fieldClass =
  "w-full rounded-md border border-input-border bg-input-background px-3 py-2 text-sm text-foreground";

export function ExternalPaymentControl({
  solicitudId,
  isPaid,
}: {
  solicitudId: string;
  isPaid: boolean;
}) {
  const queryClient = useQueryClient();
  const view = useQuery({
    queryKey: [...solicitudesCoreQueryKeys.all, "pago-externo", solicitudId],
    queryFn: () => getExternalPayment(solicitudId),
  });
  const [open, setOpen] = useState(false);
  const [requestId, setRequestId] = useState("");
  const [paidOn, setPaidOn] = useState("");
  const [reference, setReference] = useState("");
  const [comment, setComment] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const mutation = useMutation({
    mutationFn: () =>
      registerExternalPayment(solicitudId, {
        requestId,
        paidOn,
        reference,
        comment,
        file: file!,
      }),
    onSuccess: async () => {
      setOpen(false);
      await queryClient.invalidateQueries({
        queryKey: solicitudesCoreQueryKeys.all,
      });
    },
    onError: async () => {
      await view.refetch();
    },
  });
  function start() {
    setRequestId(crypto.randomUUID());
    setPaidOn(externalPaymentToday());
    setReference("");
    setComment("");
    setFile(null);
    mutation.reset();
    setOpen(true);
  }
  const payment = view.data?.payment;
  if (isPaid && !payment && !view.error) return null;
  if (payment)
    return (
      <div className="border-b border-border bg-muted/20 px-4 py-3 text-sm">
        <strong>Transferencia realizada por fuera</strong>
        <p className="mt-1 text-foreground-secondary">
          Fecha: {payment.paidOn.split("-").reverse().join("/")} · Referencia:{" "}
          {payment.reference} · Registró: {payment.recordedBy}
        </p>
        {payment.comment ? (
          <p className="mt-1 whitespace-pre-wrap">{payment.comment}</p>
        ) : null}
        <p className="mt-1 text-xs text-foreground-secondary">
          Comprobante disponible en Adjuntos. La reserva quedó cerrada por pago
          externo.
        </p>
      </div>
    );
  return (
    <div className="border-b border-border bg-muted/20 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-foreground-secondary">
          {view.error
            ? "No se pudo consultar el registro de pago externo."
            : (view.data?.blockedReason ??
              "Si la transferencia ya se realizó por otro circuito, registrá el comprobante para cerrar la solicitud.")}
        </p>
        <Button
          type="button"
          variant="outline"
          disabled={!view.data?.canRegister || mutation.isPending}
          onClick={start}
        >
          Registrar pago externo
        </Button>
        {view.error ? (
          <Button
            type="button"
            variant="ghost"
            onClick={() => void view.refetch()}
          >
            Reintentar
          </Button>
        ) : null}
      </div>
      <DialogRoot
        open={open}
        onOpenChange={(next) => {
          if (!mutation.isPending) setOpen(next);
        }}
      >
        <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto p-0">
          <header className="border-b border-border px-4 py-4">
            <DialogTitle className="text-xl font-semibold leading-tight">
              Registrar transferencia realizada por fuera
            </DialogTitle>
            <DialogDescription className="mt-2 text-sm text-foreground-secondary">
              La solicitud pasará a Pagada y su reserva pendiente quedará
              cerrada. Esta acción registra un pago ya realizado.
            </DialogDescription>
          </header>
          <form
            className="grid gap-4 px-4 py-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (file && paidOn && reference.trim()) mutation.mutate();
            }}
          >
            <fieldset
              disabled={mutation.isPending}
              className="grid gap-4 disabled:opacity-60"
            >
              <label className="grid gap-1.5 text-sm">
                Fecha de la transferencia *
                <input
                  className={fieldClass}
                  type="date"
                  required
                  max={externalPaymentToday()}
                  value={paidOn}
                  onChange={(event) => setPaidOn(event.target.value)}
                />
              </label>
              <label className="grid gap-1.5 text-sm">
                Referencia de la operación *
                <input
                  className={fieldClass}
                  required
                  maxLength={200}
                  value={reference}
                  onChange={(event) => setReference(event.target.value)}
                />
              </label>
              <label className="grid gap-1.5 text-sm">
                Comprobante *
                <input
                  className={fieldClass}
                  type="file"
                  required
                  accept="application/pdf,image/jpeg,image/png"
                  onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                />
                <span className="text-xs text-foreground-secondary">
                  PDF, JPG o PNG.
                </span>
              </label>
              <label className="grid gap-1.5 text-sm">
                Comentario (opcional)
                <textarea
                  className={fieldClass}
                  rows={3}
                  maxLength={4000}
                  value={comment}
                  onChange={(event) => setComment(event.target.value)}
                />
              </label>
            </fieldset>
            {mutation.error ? (
              <p
                role="alert"
                className="rounded-md bg-danger px-3 py-2 text-sm text-danger-foreground"
              >
                {mutation.error.message}
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={mutation.isPending}
                onClick={() => setOpen(false)}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={
                  mutation.isPending || !file || !paidOn || !reference.trim()
                }
              >
                {mutation.isPending
                  ? "Registrando…"
                  : "Registrar y marcar Pagada"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </DialogRoot>
    </div>
  );
}

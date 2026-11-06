import { useState } from "react";
import { Upload } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/shared/components/ui/button";
import {
  approveExternalLegajo,
  documentReviewKey,
  signatureInboxKey,
} from "../services/document-review-api";

export function ExternalLegajoForm({
  solicitudId,
  sourceFingerprint,
  analysisReady,
  disabled,
}: {
  solicitudId: string;
  sourceFingerprint: string;
  analysisReady: boolean;
  disabled: boolean;
}) {
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [message, setMessage] = useState<string | null>(null);
  const invalidFiles =
    files.length > 10 ||
    files.some(
      (file) =>
        !["application/pdf", "image/jpeg", "image/png"].includes(file.type) ||
        !file.size ||
        file.size > 10 * 1024 * 1024,
    ) ||
    files.reduce((size, file) => size + file.size, 0) > 32 * 1024 * 1024;
  const save = useMutation({
    mutationFn: () =>
      approveExternalLegajo(solicitudId, {
        requestId,
        sourceFingerprint,
        reason,
        files,
      }),
    onSuccess: async (data) => {
      client.setQueryData(documentReviewKey(solicitudId), data);
      setMessage(
        data.analysisReady
          ? "Legajo externo aprobado. La solicitud quedó Para transferir."
          : "Legajo externo aprobado. Se podrá mandar a transferir al finalizar el análisis.",
      );
      setFiles([]);
      setReason("");
      setConfirmed(false);
      setRequestId(crypto.randomUUID());
      setOpen(false);
      await client.invalidateQueries({ queryKey: ["solicitudes-core"] });
      await client.invalidateQueries({ queryKey: signatureInboxKey });
    },
    onError: (error) => setMessage(error.message),
    retry: false,
  });
  const busy = disabled || save.isPending;
  function changePayload() {
    setConfirmed(false);
    setRequestId(crypto.randomUUID());
    setMessage(null);
  }
  return (
    <div className="space-y-3 border-t border-border pt-4">
      <Button
        type="button"
        variant="outline"
        disabled={busy}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Upload className="size-4" />
        Usar legajo externo
      </Button>
      {message && (
        <p
          role="status"
          className="rounded-md border border-border p-3 text-sm"
        >
          {message}
        </p>
      )}
      {open && (
        <div className="space-y-3 rounded-md border border-border p-4">
          <p className="text-sm text-foreground-secondary">
            Adjuntá fotos de un legajo físico o un PDF exportado de otro
            sistema, como MetaMap. La aprobación se basa en tu revisión de los
            archivos.
          </p>
          <label className="block space-y-1 text-sm font-medium">
            <span>Archivos del legajo externo</span>
            <input
              type="file"
              multiple
              accept="application/pdf,image/jpeg,image/png"
              disabled={busy}
              className="block w-full min-w-0 rounded-md border border-border p-2 text-sm"
              onChange={(event) => {
                setFiles(Array.from(event.target.files ?? []));
                changePayload();
              }}
            />
          </label>
          <p className="text-xs text-foreground-secondary">
            Hasta 10 archivos PDF, JPG o PNG; 10 MiB por archivo y 32 MiB en
            total.
          </p>
          {invalidFiles && (
            <p role="alert" className="text-sm text-red-600">
              Revisá el formato, la cantidad y el tamaño de los archivos.
            </p>
          )}
          {files.length > 0 && (
            <ul className="space-y-1 text-sm">
              {files.map((file, index) => (
                <li key={`${index}-${file.name}`} className="break-all">
                  <button
                    type="button"
                    className="text-left text-primary underline"
                    onClick={() => {
                      const url = URL.createObjectURL(file);
                      window.open(url, "_blank", "noopener,noreferrer");
                      setTimeout(() => URL.revokeObjectURL(url), 300000);
                    }}
                  >
                    Ver archivo {index + 1}: {file.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <label className="block space-y-1 text-sm font-medium">
            <span>Motivo para usar un legajo externo</span>
            <textarea
              value={reason}
              maxLength={4000}
              disabled={busy}
              className="min-h-20 w-full rounded-md border border-border bg-surface p-3"
              placeholder="Por ejemplo: legajo firmado en papel o PDF de MetaMap ante un problema de conexión."
              onChange={(event) => {
                setReason(event.target.value);
                changePayload();
              }}
            />
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={confirmed}
              disabled={busy}
              className="mt-1"
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            <span>
              Revisé los archivos y confirmo que las firmas, el titular, el
              préstamo y sus condiciones corresponden a esta solicitud.
            </span>
          </label>
          <p className="text-sm text-foreground-secondary">
            {analysisReady
              ? "Al aprobar, la solicitud pasará a Para transferir."
              : "La aprobación quedará registrada mientras continúa el análisis."}
          </p>
          <Button
            type="button"
            className="h-auto min-h-9 whitespace-normal"
            disabled={
              busy ||
              !confirmed ||
              !reason.trim() ||
              !files.length ||
              invalidFiles
            }
            onClick={() => save.mutate()}
          >
            {save.isPending
              ? "Guardando legajo…"
              : "Adjuntar y aprobar legajo externo"}
          </Button>
        </div>
      )}
    </div>
  );
}

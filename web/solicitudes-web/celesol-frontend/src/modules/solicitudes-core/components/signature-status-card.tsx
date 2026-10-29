import { useState } from "react";
import { Check, Copy, ExternalLink } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import type { SignatureSummary } from "../services/document-review-api";
import { signatureStatusLabels } from "../utils/signature-status-labels";

export function SignatureStatusCard({
  signature,
  analysisReady,
}: {
  signature: SignatureSummary;
  analysisReady: boolean;
}) {
  const [copyMessage, setCopyMessage] = useState("");
  const completed = signature.completedAttempts > 0;
  const lastCompleted =
    signature.lastCompletedAt &&
    Number.isFinite(Date.parse(signature.lastCompletedAt))
      ? new Intl.DateTimeFormat("es-AR", {
          dateStyle: "short",
          timeStyle: "short",
          timeZone: "America/Argentina/Buenos_Aires",
        }).format(new Date(signature.lastCompletedAt))
      : null;
  return (
    <section
      className="space-y-3 rounded-lg border border-border bg-surface p-4"
      aria-label="Seguimiento de firma"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">Firma del legajo digital</h2>
          <p className="mt-1 text-sm text-foreground-secondary">
            {signatureStatusLabels[signature.status]}
          </p>
        </div>
        <span className="rounded-full border border-border px-3 py-1 text-xs">
          {analysisReady ? "Análisis terminado" : "Análisis en curso"}
        </span>
      </div>
      <div
        className="flex flex-wrap gap-x-6 gap-y-2 text-sm"
        aria-label="Avance de la firma"
      >
        <span className="inline-flex items-center gap-2">
          <span
            className={`inline-flex size-6 items-center justify-center rounded-full border ${completed ? "border-primary bg-primary text-white" : "border-border text-foreground-muted"}`}
            aria-hidden="true"
          >
            {completed ? <Check className="size-4" /> : "1"}
          </span>
          {completed ? "Firma enviada" : "Sin firmas enviadas"}
        </span>
        <span className="inline-flex items-center gap-2">
          <span
            className={`inline-flex size-6 items-center justify-center rounded-full border ${signature.approved ? "border-green-700 bg-green-700 text-white" : "border-border text-foreground-muted"}`}
            aria-hidden="true"
          >
            {signature.approved ? <Check className="size-4" /> : "2"}
          </span>
          {signature.approved
            ? "Validada por Legajos"
            : "Pendiente de validación"}
        </span>
      </div>
      <p className="text-xs text-foreground-secondary">
        {signature.completedAttempts} intento(s) completo(s) en esta gestión
        {lastCompleted ? ` · Último: ${lastCompleted}` : ""}.
      </p>
      {signature.reason && signature.status === "requested_again" && (
        <div
          role="status"
          className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm"
        >
          <strong>Pedile al socio que firme nuevamente.</strong>
          <p className="mt-1 whitespace-pre-wrap">{signature.reason}</p>
        </div>
      )}
      {signature.link ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              void (async () => {
                try {
                  await navigator.clipboard.writeText(signature.link!);
                  setCopyMessage("Enlace copiado. Podés enviárselo al socio.");
                } catch {
                  setCopyMessage(
                    "No se pudo copiar. Abrí el enlace y copialo desde el navegador.",
                  );
                }
              })();
            }}
          >
            <Copy className="size-4" />
            Copiar enlace para el socio
          </Button>
          <a
            className="inline-flex items-center gap-1 text-sm text-primary underline"
            href={signature.link}
            target="_blank"
            rel="noreferrer"
          >
            <ExternalLink className="size-4" />
            Abrir enlace
          </a>
        </div>
      ) : (
        <p className="text-sm text-foreground-secondary">
          El enlace estará disponible al generar el préstamo.
        </p>
      )}
      {copyMessage && (
        <p role="status" className="text-sm">
          {copyMessage}
        </p>
      )}
    </section>
  );
}

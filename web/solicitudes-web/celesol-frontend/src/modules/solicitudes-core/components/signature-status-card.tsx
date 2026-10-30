import { Check, Copy, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/shared/components/ui/button";
import type { SignatureSummary } from "../services/document-review-api";
import { signatureStatusLabels } from "../utils/signature-status-labels";

// Color de la etiqueta segun en que punto esta la firma.
const ESTILO_ESTADO: Record<SignatureSummary["status"], string> = {
  approved: "border-verde/30 bg-[#e9f1ed] text-[#2f5f4b]",
  requested_again: "border-amber-500/40 bg-amber-50 text-amber-800",
  to_review: "border-sky-300 bg-sky-50 text-sky-800",
  waiting: "border-border bg-[#f6f8f7] text-foreground-secondary",
};

function Paso({ hecho, texto }: { hecho: boolean; texto: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 ${hecho ? "text-foreground" : "text-foreground-secondary"}`}
    >
      {hecho ? <Check aria-hidden className="size-3.5 text-verde" /> : null}
      {texto}
    </span>
  );
}

// Seguimiento de la firma para quien no decide (vendedor, Riesgo, Tesoreria):
// una franja con el estado, el avance y el enlace para el socio.
export function SignatureStatusCard({
  signature,
}: {
  signature: SignatureSummary;
  analysisReady?: boolean;
}) {
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

  async function copiarEnlace() {
    try {
      await navigator.clipboard.writeText(signature.link!);
      toast.success("Enlace copiado. Podés enviárselo al socio.");
    } catch {
      toast.error(
        "No se pudo copiar. Abrí el enlace y copialo desde el navegador.",
      );
    }
  }

  return (
    <section
      aria-label="Seguimiento de firma"
      className="rounded-lg border border-border bg-surface px-4 py-3"
    >
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <div className="flex items-center gap-2.5">
          <h2 className="font-marca text-[0.9375rem] font-bold tracking-[-0.01em] text-marino">
            Firma del legajo
          </h2>
          <span
            className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${ESTILO_ESTADO[signature.status]}`}
          >
            {signatureStatusLabels[signature.status]}
          </span>
        </div>
        <div
          aria-label="Avance de la firma"
          className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm"
        >
          <Paso hecho={completed} texto={completed ? "Firmó" : "Sin firma"} />
          <span aria-hidden className="text-border">
            ·
          </span>
          <Paso
            hecho={signature.approved}
            texto={signature.approved ? "Validada por Legajos" : "Sin validar"}
          />
          <span aria-hidden className="text-border">
            ·
          </span>
          <span className="text-foreground-secondary">
            {signature.completedAttempts}{" "}
            {signature.completedAttempts === 1 ? "intento" : "intentos"}
            {lastCompleted ? ` · último ${lastCompleted}` : ""}
          </span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {signature.link ? (
            <>
              <Button
                onClick={() => void copiarEnlace()}
                size="sm"
                type="button"
                variant="outline"
              >
                <Copy className="size-4" />
                Copiar enlace
              </Button>
              <Button asChild size="sm" variant="ghost">
                <a href={signature.link} rel="noreferrer" target="_blank">
                  <ExternalLink className="size-4" />
                  Abrir
                </a>
              </Button>
            </>
          ) : (
            <span className="text-sm text-foreground-secondary">
              El enlace se habilita al generar el préstamo
            </span>
          )}
        </div>
      </div>
      {signature.reason && signature.status === "requested_again" ? (
        <p
          className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900"
          role="status"
        >
          <strong>Pedile al socio que firme nuevamente:</strong>{" "}
          {signature.reason}
        </p>
      ) : null}
    </section>
  );
}

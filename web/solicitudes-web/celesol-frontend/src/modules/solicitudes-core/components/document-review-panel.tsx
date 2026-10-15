import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Download, RefreshCw, XCircle } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import {
  decideDocumentReview,
  documentReviewKey,
  downloadDocumentLegajo,
  evaluateDocumentReview,
  useDocumentReview,
  type DocumentDecision,
  type DocumentReview,
  type ReviewAttempt,
} from "../services/document-review-api";

const decisionLabel = (value: DocumentDecision) =>
  value === "approve" ? "Aprobar" : "No aprobar";
const statusLabel = (value: string | null) =>
  ({
    verified: "Verificada (verde)",
    reviewNeeded: "Requiere revisión",
    rejected: "Rechazada",
    postponed: "Postergada",
  })[value ?? ""] ??
  value ??
  "No disponible";
const date = (value: string | null) =>
  value && Number.isFinite(Date.parse(value))
    ? new Intl.DateTimeFormat("es-AR", {
        timeZone: "America/Argentina/Buenos_Aires",
        dateStyle: "short",
        timeStyle: "short",
      }).format(new Date(value))
    : "Sin fecha";

function AttemptDetails({ attempt }: { attempt: ReviewAttempt }) {
  return (
    <div className="space-y-3">
      <p className="text-sm">
        MetaMap: <strong>{statusLabel(attempt.providerStatus)}</strong>.{" "}
        {attempt.documents.length} documento(s) firmado(s).
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border text-foreground-secondary">
              <th className="p-2">Control</th>
              <th className="p-2">Solicitud</th>
              <th className="p-2">MetaMap / firma</th>
              <th className="p-2">Resultado</th>
            </tr>
          </thead>
          <tbody>
            {attempt.checks.map((c) => (
              <tr className="border-b border-border" key={c.code}>
                <td className="p-2">{c.label}</td>
                <td className="p-2">{c.expected ?? "No disponible"}</td>
                <td className="p-2">{c.actual ?? "No disponible"}</td>
                <td className="p-2">{c.passed ? "Conforme" : "No conforme"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="list-disc space-y-1 pl-5 text-sm">
        {attempt.reasons.map((r, i) => (
          <li key={i}>{r}</li>
        ))}
      </ul>
      {attempt.dashboardUrl && (
        <a
          className="text-sm text-primary underline"
          href={attempt.dashboardUrl}
          rel="noreferrer"
          target="_blank"
        >
          Abrir este intento en MetaMap
        </a>
      )}
    </div>
  );
}

export function DocumentReviewPanel({
  solicitudId,
  editing = false,
}: {
  solicitudId: string;
  editing?: boolean;
}) {
  const query = useDocumentReview(solicitudId),
    client = useQueryClient();
  const [selection, setSelection] = useState<{
    reviewId: string;
    id: string | null;
  } | null>(null);
  const [comment, setComment] = useState<{
    reviewId: string;
    value: string;
  } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const current = query.data?.currentReview ?? null;
  const selectedId =
    selection?.reviewId === current?.id
      ? selection?.id
      : current?.selectedVerificationId;
  const attempt =
    current?.attempts.find((a) => a.verificationId === selectedId) ?? null;
  const reason =
    comment?.reviewId === current?.id ? (comment?.value ?? "") : "";
  const refresh = useMutation({
    mutationFn: () => evaluateDocumentReview(solicitudId),
    onSuccess: (data) => {
      client.setQueryData(documentReviewKey(solicitudId), data);
      setMessage(null);
    },
    onError: (e) => setMessage(e.message),
  });
  const decide = useMutation({
    mutationFn: (decision: DocumentDecision) => {
      if (!current) throw new Error("Esperá a que se complete la revisión.");
      return decideDocumentReview(solicitudId, {
        reviewId: current.id,
        requestId: crypto.randomUUID(),
        decision,
        verificationId: selectedId ?? null,
        reason,
      });
    },
    onSuccess: async (data) => {
      client.setQueryData(documentReviewKey(solicitudId), data);
      setMessage(
        "Decisión humana registrada. Se actualizó el estado de la solicitud.",
      );
      await client.invalidateQueries({ queryKey: ["solicitudes-core"] });
    },
    onError: async (e) => {
      setMessage(e.message);
      await client.invalidateQueries({
        queryKey: documentReviewKey(solicitudId),
      });
    },
  });
  const busy = decide.isPending || refresh.isPending;
  async function download(review: DocumentReview, decisionId?: string) {
    setDownloading(true);
    try {
      await downloadDocumentLegajo(solicitudId, review.id, decisionId);
    } catch (e) {
      setMessage(
        e instanceof Error ? e.message : "No se pudo descargar el legajo.",
      );
    } finally {
      setDownloading(false);
    }
  }
  if (query.isLoading || query.data?.enabled === false) return null;
  if (query.error)
    return (
      <section className="rounded-lg border border-border bg-surface p-4">
        <p role="alert">
          No se pudo consultar la revisión de firma. {query.error.message}
        </p>
        <Button variant="outline" onClick={() => void query.refetch()}>
          Reintentar
        </Button>
      </section>
    );
  if (!query.data) return null;
  if (
    query.data.state !== "VerificarFirmaYDocumentacion" &&
    query.data.history.length === 0
  )
    return null;
  const canDecide = query.data.canDecide && !editing;
  const override =
    current?.systemDecision !== "approve" || attempt?.decision !== "approve";
  return (
    <section
      className="space-y-4 rounded-lg border border-border bg-surface p-4"
      aria-label="Revisión de firma y legajo digital"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">Revisión de firma y legajo digital</h2>
          <p className="text-sm text-foreground-secondary">
            El sistema propone una decisión. Una persona debe aprobar o
            desaprobar para cambiar el estado.
          </p>
        </div>
        {query.data.canDecide && (
          <Button
            variant="outline"
            disabled={busy || editing}
            onClick={() => refresh.mutate()}
          >
            <RefreshCw
              className={`size-4 ${refresh.isPending ? "animate-spin" : ""}`}
            />
            {refresh.isPending ? "Revisando firmas…" : "Actualizar revisión"}
          </Button>
        )}
      </div>
      {editing && (
        <p className="text-sm">
          Guardá los cambios de la solicitud antes de decidir esta revisión.
        </p>
      )}
      {message && (
        <p
          role="status"
          className="rounded-md border border-border p-3 text-sm"
        >
          {message}
        </p>
      )}
      {!current ? (
        <p className="text-sm">
          La evaluación de los datos vigentes está pendiente. Se completa
          automáticamente mientras la solicitud está en verificación.
        </p>
      ) : (
        <>
          <div
            className={`rounded-md border p-3 ${current.systemDecision === "approve" ? "border-green-600/30 bg-green-600/5" : "border-amber-600/30 bg-amber-600/5"}`}
          >
            <p className="font-medium">
              El sistema hubiera decidido:{" "}
              {decisionLabel(current.systemDecision)}
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
              {current.reasons.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-foreground-secondary">
              Evaluación: {date(current.evaluatedAt)}
            </p>
          </div>
          {current.artifactError && (
            <p role="alert" className="text-sm text-red-600">
              {current.artifactError}
            </p>
          )}
          <fieldset className="space-y-2">
            <legend className="mb-2 text-sm font-medium">
              Intentos de firma ({current.attempts.length}). Basta uno conforme.
            </legend>
            {current.attempts.map((a) => (
              <label
                className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 ${a.verificationId === selectedId ? "border-primary" : "border-border"}`}
                key={a.verificationId}
              >
                <input
                  type="radio"
                  className="mt-1"
                  name={`signature-${solicitudId}`}
                  checked={a.verificationId === selectedId}
                  disabled={busy}
                  onChange={() =>
                    setSelection({ reviewId: current.id, id: a.verificationId })
                  }
                />
                <span className="min-w-0 text-sm">
                  <span className="block break-all font-medium">
                    {a.verificationId}
                  </span>
                  <span>
                    {date(a.completedAt)} · {statusLabel(a.providerStatus)} ·
                    Propuesta: {decisionLabel(a.decision)}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
          {attempt && <AttemptDetails attempt={attempt} />}
          {current.legajoAdjuntoId && (
            <Button
              variant="outline"
              disabled={downloading}
              onClick={() => void download(current)}
            >
              <Download className="size-4" />
              Descargar legajo de la propuesta
            </Button>
          )}
          {canDecide && (
            <div className="space-y-3 border-t border-border pt-4">
              <label
                className="block text-sm font-medium"
                htmlFor={`review-reason-${solicitudId}`}
              >
                Motivo de la decisión humana
              </label>
              <textarea
                className="min-h-20 w-full rounded-md border border-border bg-surface p-3 text-sm"
                id={`review-reason-${solicitudId}`}
                maxLength={4000}
                value={reason}
                disabled={busy}
                placeholder="Obligatorio para desaprobar o para diferir del sistema."
                onChange={(e) =>
                  setComment({ reviewId: current.id, value: e.target.value })
                }
              />
              {override && (
                <p className="text-sm text-amber-700">
                  Aprobar este intento difiere de la evaluación automática.
                  Indicá por qué; ambas decisiones quedarán conservadas.
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={
                    busy ||
                    !attempt?.evidenceAvailable ||
                    Boolean(current.artifactError) ||
                    !current.legajoAdjuntoId ||
                    (override && !reason.trim())
                  }
                  onClick={() => decide.mutate("approve")}
                >
                  <CheckCircle2 className="size-4" />
                  {decide.isPending
                    ? "Guardando decisión…"
                    : "Aprobar y enviar a Transferir"}
                </Button>
                <Button
                  variant="outline"
                  disabled={busy || !reason.trim()}
                  onClick={() => decide.mutate("not_approve")}
                >
                  <XCircle className="size-4" />
                  Desaprobar y devolver a Liquidada
                </Button>
              </div>
            </div>
          )}
        </>
      )}
      {query.data.history.length > 0 && (
        <details className="border-t border-border pt-3">
          <summary className="cursor-pointer text-sm font-medium">
            Historial de propuestas y decisiones humanas
          </summary>
          <div className="mt-3 space-y-4">
            {query.data.history.map((r) => (
              <div
                className="space-y-2 rounded-md border border-border p-3 text-sm"
                key={r.id}
              >
                <p>
                  <strong>Sistema: {decisionLabel(r.systemDecision)}</strong> ·{" "}
                  {date(r.evaluatedAt)}
                </p>
                {r.decisions.length === 0 ? (
                  <p className="text-foreground-secondary">
                    Sin decisión humana registrada para esta evaluación.
                  </p>
                ) : (
                  r.decisions.map((d) => (
                    <div className="space-y-1" key={d.id}>
                      <p>
                        <strong>
                          Humano: {decisionLabel(d.humanDecision)}
                        </strong>{" "}
                        · {d.actorName} · {date(d.decidedAt)}
                      </p>
                      <p>
                        {d.reason || "Conforme con la propuesta del sistema."}
                      </p>
                      <p>
                        Disparidad con el sistema:{" "}
                        {d.disagreesWithSystem ? "Sí" : "No"}
                        {d.overridesAttempt
                          ? ". Se aprobó un intento que el sistema no aprobaría."
                          : ""}
                      </p>
                      <p>
                        Firma elegida: {d.verificationId ?? "Ninguna"}
                        {d.providerCheckedAt
                          ? ` · Comprobada: ${date(d.providerCheckedAt)}`
                          : ""}
                      </p>
                      {d.attemptsAtDecision.length > 0 && (
                        <details>
                          <summary className="cursor-pointer">
                            Intentos conservados al decidir (
                            {d.attemptsAtDecision.length})
                          </summary>
                          <ul className="mt-2 space-y-1">
                            {d.attemptsAtDecision.map((a) => (
                              <li className="break-all" key={a.verificationId}>
                                {a.verificationId} ·{" "}
                                {statusLabel(a.providerStatus)} ·{" "}
                                {decisionLabel(a.decision)}
                              </li>
                            ))}
                          </ul>
                        </details>
                      )}
                      {d.legajoAdjuntoId && (
                        <button
                          className="text-primary underline"
                          disabled={downloading}
                          onClick={() => void download(r, d.id)}
                        >
                          Descargar legajo con decisión humana
                        </button>
                      )}
                    </div>
                  ))
                )}
                {r.legajoAdjuntoId && (
                  <button
                    className="text-primary underline"
                    disabled={downloading}
                    onClick={() => void download(r)}
                  >
                    Ver legajo de esta propuesta
                  </button>
                )}
              </div>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}

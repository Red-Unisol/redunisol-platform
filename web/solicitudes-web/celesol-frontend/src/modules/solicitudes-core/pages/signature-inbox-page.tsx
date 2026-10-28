import { useState } from "react";
import { Link } from "react-router-dom";
import { RefreshCw, X } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { DocumentReviewPanel } from "../components/document-review-panel";
import { signatureStatusLabels } from "../utils/signature-status-labels";
import {
  useSignatureInbox,
  type SignatureSummary,
  type SignatureInboxItem,
} from "../services/document-review-api";

const filters: { value: SignatureSummary["status"] | "all"; label: string }[] =
  [
    { value: "all", label: "Todos" },
    { value: "waiting", label: "Esperando firma" },
    { value: "to_review", label: "Para revisar" },
    { value: "requested_again", label: "Nueva firma solicitada" },
    { value: "approved", label: "Aprobados" },
  ];
const date = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat("es-AR", {
        dateStyle: "short",
        timeStyle: "short",
        timeZone: "America/Argentina/Buenos_Aires",
      }).format(new Date(value))
    : "Sin firmas enviadas";

export function SignatureInboxPage() {
  const [status, setStatus] = useState<SignatureSummary["status"] | "all">(
    "all",
  );
  const [selected, setSelected] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const query = useSignatureInbox(status, offset);
  return (
    <main className="w-full space-y-4 overflow-y-auto p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">
            Bandeja de Legajos Digitales
          </h2>
          <p className="mt-1 text-sm text-foreground-secondary">
            Préstamos vigentes pendientes de transferencia. La revisión de firma
            puede avanzar mientras continúa el análisis.
          </p>
        </div>
        <Button
          variant="outline"
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          <RefreshCw
            className={`size-4 ${query.isFetching ? "animate-spin" : ""}`}
          />
          Actualizar
        </Button>
      </div>
      <div className="flex flex-wrap gap-2" aria-label="Filtrar firmas">
        {filters.map((filter) => (
          <Button
            key={filter.value}
            size="sm"
            variant={filter.value === status ? "default" : "outline"}
            aria-pressed={filter.value === status}
            onClick={() => {
              setStatus(filter.value);
              setOffset(0);
              setSelected(null);
            }}
          >
            {filter.label}
          </Button>
        ))}
      </div>
      {query.error && (
        <p
          role="alert"
          className="rounded-md border border-destructive/30 p-4 text-sm"
        >
          No se pudo consultar la bandeja. {query.error.message}
        </p>
      )}
      <SignatureInboxTable
        items={query.data?.items ?? []}
        selected={selected}
        onReview={setSelected}
        loading={query.isPending}
        failed={query.isError}
      />
      {query.data && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-foreground-secondary">
            {query.data.total} préstamo(s) en esta vista.{" "}
            {query.data.total > 0
              ? `Mostrando ${offset + 1}–${Math.min(offset + query.data.items.length, query.data.total)}.`
              : ""}
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={offset === 0 || query.isFetching}
              onClick={() => {
                setOffset(Math.max(0, offset - 50));
                setSelected(null);
              }}
            >
              Anterior
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={offset + 50 >= query.data.total || query.isFetching}
              onClick={() => {
                setOffset(offset + 50);
                setSelected(null);
              }}
            >
              Siguiente
            </Button>
          </div>
        </div>
      )}
      {selected && (
        <section className="space-y-2">
          <div className="flex justify-end">
            <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>
              <X className="size-4" />
              Cerrar revisión
            </Button>
          </div>
          <DocumentReviewPanel key={selected} solicitudId={selected} />
        </section>
      )}
    </main>
  );
}

export function SignatureInboxTable({
  items,
  selected,
  onReview,
  loading = false,
  failed = false,
}: {
  items: SignatureInboxItem[];
  selected: string | null;
  onReview: (id: string) => void;
  loading?: boolean;
  failed?: boolean;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-surface">
      <table className="w-full min-w-[900px] text-left text-sm">
        <thead className="bg-background text-foreground-secondary">
          <tr>
            <th className="p-3">Solicitud / préstamo</th>
            <th className="p-3">Socio / vendedor</th>
            <th className="p-3">Firma</th>
            <th className="p-3">Último envío</th>
            <th className="p-3">Análisis</th>
            <th className="p-3">Acción</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr
              key={item.solicitudId}
              className={`border-t border-border ${selected === item.solicitudId ? "bg-primary/5" : ""}`}
            >
              <td className="p-3">
                <Link
                  className="font-medium text-primary underline"
                  to={`/solicitudes/core/detalle/${item.solicitudId}`}
                >
                  Solicitud {item.nroSolicitud ?? "s/n"}
                </Link>
                <span className="mt-1 block text-xs text-foreground-secondary">
                  Préstamo {item.prestamoId}
                </span>
              </td>
              <td className="p-3">
                <span className="block font-medium">{item.socio}</span>
                <span className="text-xs text-foreground-secondary">
                  {item.vendedor ?? "Sin vendedor asignado"}
                </span>
              </td>
              <td className="p-3">
                <span
                  className={
                    item.status === "approved"
                      ? "font-medium text-green-700"
                      : item.status === "requested_again"
                        ? "font-medium text-amber-700"
                        : ""
                  }
                >
                  {signatureStatusLabels[item.status]}
                </span>
                <span className="mt-1 block text-xs text-foreground-secondary">
                  {item.completedAttempts} intento(s) completo(s)
                </span>
                {item.reason && item.status === "requested_again" && (
                  <p className="mt-1 max-w-64 whitespace-pre-wrap text-xs">
                    {item.reason}
                  </p>
                )}
              </td>
              <td className="p-3 text-xs">{date(item.lastCompletedAt)}</td>
              <td className="p-3">
                {item.analysisReady ? "Terminado" : "En curso"}
              </td>
              <td className="p-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onReview(item.solicitudId)}
                >
                  Revisar firma
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {loading && (
        <p className="p-6 text-sm" role="status">
          Cargando préstamos…
        </p>
      )}
      {!loading && !failed && items.length === 0 && (
        <p className="p-6 text-sm text-foreground-secondary">
          No hay préstamos en esta situación.
        </p>
      )}
    </div>
  );
}

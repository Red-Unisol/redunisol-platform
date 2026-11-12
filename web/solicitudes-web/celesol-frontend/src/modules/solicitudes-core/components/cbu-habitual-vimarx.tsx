import { useQuery } from "@tanstack/react-query";
import { Button } from "@/shared/components/ui/button";
import { cn } from "@/shared/utils/cn";
import { esCbuValido } from "@/shared/utils/cbu";
import { datosRapidosApi } from "../services/datos-rapidos-api";
import { compareCbu, normalizeCbu } from "../utils/cbu-comparison";

const comparisonLabels = {
  empty: "Sin cargar en la solicitud",
  invalid: "El CBU de la solicitud requiere revisión",
  unverified: "Comparación pendiente de revisión",
  match: "Coincide con el habitual de Vimarx",
  different: "Difiere del habitual de Vimarx",
};

function SolicitudCbu({
  label,
  value,
  habitual,
}: {
  label: string;
  value: string | null;
  habitual: string | null;
}) {
  const comparison = habitual ? compareCbu(value, habitual) : null;
  return (
    <div className="min-w-0">
      <dt className="text-xs text-foreground-secondary">{label}</dt>
      <dd className="mt-1 break-all font-mono text-sm">
        {value?.trim() || "Sin cargar"}
      </dd>
      {comparison ? (
        <dd
          className={cn(
            "mt-1 text-xs",
            comparison === "match"
              ? "text-verde"
              : comparison === "different" || comparison === "invalid"
                ? "text-amber-800"
                : "text-foreground-muted",
          )}
        >
          {comparisonLabels[comparison]}
        </dd>
      ) : null}
    </div>
  );
}

export function CbuHabitualVimarx({
  solicitudId,
  documento,
  tipoDocumento,
  cuit,
  cbuSolicitud,
  cbuNoHabitual,
  identityChanged = false,
}: {
  solicitudId: string;
  documento: string | null;
  tipoDocumento: string | null;
  cuit?: string | null;
  cbuSolicitud: string | null;
  cbuNoHabitual: string | null;
  identityChanged?: boolean;
}) {
  const query = useQuery({
    queryKey: [
      "solicitudes-core",
      "cbu-habitual",
      solicitudId,
      documento,
      tipoDocumento,
      cuit,
    ],
    queryFn: () => datosRapidosApi.cbu(solicitudId),
    enabled: !identityChanged,
    staleTime: 30_000,
    retry: false,
  });
  // Nunca usar un resultado anterior si cambió la persona, se está consultando
  // de nuevo o falló la actualización del origen.
  const data =
    !identityChanged && !query.isFetching && !query.isError
      ? query.data
      : undefined;
  const habitual = data?.status === "available" ? data.cbu : null;
  const message = identityChanged
    ? "Guardá el documento y el CUIT para consultar el CBU habitual del titular actualizado."
    : query.isFetching || query.isPending
      ? "Consultando el CBU habitual en Vimarx…"
      : query.isError || !data || data.status === "unavailable"
        ? "No se pudo consultar el CBU habitual en Vimarx. Volvé a intentar."
        : data.status === "ambiguous"
          ? "Hay más de un socio con ese documento en Vimarx. Revisá su identidad para comparar el CBU."
          : data.status === "not_member"
            ? "No se encontró un socio con ese documento y tipo en Vimarx."
            : data.status === "missing"
              ? "El socio no tiene un CBU habitual informado en Vimarx."
              : !esCbuValido(normalizeCbu(habitual))
                ? "El CBU registrado en Vimarx requiere revisión de formato."
                : null;
  return (
    <section
      aria-label="Comparación de CBU"
      className="mt-4 space-y-3 border-t border-border-soft pt-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Comparación de CBU</h3>
        <Button
          size="sm"
          type="button"
          variant="outline"
          disabled={identityChanged || query.isFetching}
          onClick={() => void query.refetch()}
        >
          Actualizar CBU
        </Button>
      </div>
      {message ? (
        <p role="status" className="text-sm text-foreground-secondary">
          {message}
        </p>
      ) : null}
      <dl className="grid gap-4 sm:grid-cols-2">
        <div className="min-w-0">
          <dt className="text-xs text-foreground-secondary">
            CBU habitual en Vimarx
          </dt>
          <dd className="mt-1 break-all font-mono text-sm">
            {habitual ?? "Sin dato confirmado"}
          </dd>
        </div>
        <SolicitudCbu
          label="CBU de la solicitud"
          value={cbuSolicitud}
          habitual={habitual}
        />
        {cbuNoHabitual?.trim() ? (
          <SolicitudCbu
            label="CBU no habitual de la solicitud"
            value={cbuNoHabitual}
            habitual={habitual}
          />
        ) : null}
      </dl>
      {cbuNoHabitual?.trim() ? (
        <p className="text-xs text-foreground-muted">
          La solicitud indica un CBU no habitual como destino de transferencia.
        </p>
      ) : null}
    </section>
  );
}

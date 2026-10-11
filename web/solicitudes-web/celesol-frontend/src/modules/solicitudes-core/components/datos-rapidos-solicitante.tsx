import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { datosRapidosApi } from "../services/datos-rapidos-api";
import {
  socioIndicator,
  creditosIndicator,
} from "../utils/datos-rapidos-state";

export function DatosRapidosSolicitante({
  solicitudId,
  revision,
  canViewDetalle,
  onVerDetalle,
}: {
  solicitudId: string;
  revision: string;
  canViewDetalle: boolean;
  onVerDetalle: () => void;
}) {
  // La clave cambia con la solicitud y sus datos guardados; no se reutilizan
  // resultados de otra persona ni se mezclan con reglas por convenio.
  const key = [
    "solicitudes-core",
    "datos-rapidos",
    solicitudId,
    revision,
  ] as const;
  const socio = useQuery({
    queryKey: [...key, "persona", "socio"],
    queryFn: () => datosRapidosApi.socio(solicitudId),
    retry: false,
  });
  const convenio = useQuery({
    queryKey: [...key, "convenio"],
    queryFn: () => datosRapidosApi.convenio(solicitudId),
    retry: false,
  });
  const condicion = socioIndicator(socio);
  const creditos = useQuery({
    queryKey: [...key, "persona", "creditos"],
    queryFn: () => datosRapidosApi.creditos(solicitudId),
    enabled: condicion.member,
    retry: false,
  });
  const vigencia = creditosIndicator(creditos);
  return (
    <section
      aria-label="Datos rápidos del solicitante"
      className="shrink-0 border-b border-border bg-background px-3 py-3 md:px-4"
    >
      <p className="text-xs font-medium text-foreground-secondary">
        Datos rápidos del solicitante · Convenio
      </p>
      <h2 className="mt-1 break-words text-lg font-semibold text-foreground">
        {convenio.isPending
          ? "Consultando convenio"
          : convenio.isError || !convenio.data?.descripcion
            ? "Convenio no disponible"
            : convenio.data.descripcion}
      </h2>
      <div
        aria-live="polite"
        className="mt-2 flex flex-wrap items-center gap-x-6 gap-y-2"
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-foreground-secondary">
            Condición de socio
          </span>
          <Badge variant={condicion.variant}>{condicion.text}</Badge>
        </div>
        {condicion.member && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-foreground-secondary">
              Créditos vigentes
            </span>
            <Badge variant={vigencia.variant}>{vigencia.text}</Badge>
            {canViewDetalle && (
              <Button
                onClick={onVerDetalle}
                size="sm"
                type="button"
                variant="ghost"
              >
                Ver detalle
              </Button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
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
  titular,
  canViewDetalle,
  onVerDetalle,
  estado,
  meta,
}: {
  solicitudId: string;
  revision: string;
  titular: {
    nombre: string | null;
    apellidoDenominacion: string | null;
    tipoDocumento: string | null;
    nroDocumento: string | null;
    cuit: string | null;
  };
  canViewDetalle: boolean;
  onVerDetalle: () => void;
  // Estado de la solicitud (junto al nombre) e identificadores (abajo a la derecha).
  estado?: ReactNode;
  meta?: ReactNode;
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
  const mora = useQuery({
    queryKey: [...key, "persona", "mora"],
    queryFn: () => datosRapidosApi.mora(solicitudId),
    enabled: condicion.member && canViewDetalle,
    retry: false,
  });
  const moraText = mora.isPending
    ? "Consultando mora"
    : mora.isError || typeof mora.data?.enMora !== "boolean"
      ? "No se pudo verificar"
      : mora.data.enMora
        ? "Tiene cuotas vencidas impagas"
        : "Sin cuotas vencidas impagas";
  const vigencia = creditosIndicator(creditos);
  return (
    <section
      aria-label="Datos rápidos del solicitante"
      className="sticky top-0 z-20 shrink-0 border-b border-border bg-background px-3 py-2.5 md:px-4"
    >
      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between md:gap-6">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h2 className="break-words text-xl font-semibold text-foreground">
              {[titular.nombre, titular.apellidoDenominacion]
                .map((value) => value?.trim())
                .filter(Boolean)
                .join(" ") || "Nombre no informado"}
            </h2>
            {estado}
          </div>
          <dl className="mt-0.5 flex flex-wrap gap-x-5 gap-y-1 text-sm">
            <div className="flex gap-1.5">
              <dt className="text-foreground-secondary">
                {titular.tipoDocumento?.trim() || "Documento"}
              </dt>
              <dd className="font-medium tabular-nums text-foreground">
                {titular.nroDocumento?.trim() || "No informado"}
              </dd>
            </div>
            <div className="flex gap-1.5">
              <dt className="text-foreground-secondary">CUIT</dt>
              <dd className="font-medium tabular-nums text-foreground">
                {titular.cuit?.trim() || "No informado"}
              </dd>
            </div>
          </dl>
        </div>
        <div className="min-w-0 md:max-w-[45%] md:text-right">
          <p className="text-xs font-medium text-foreground-secondary">
            Convenio
          </p>
          <h2 className="mt-1 break-words text-lg font-semibold text-foreground">
            {convenio.isPending
              ? "Consultando convenio"
              : convenio.isError || !convenio.data?.descripcion
                ? "Convenio no disponible"
                : convenio.data.descripcion}
          </h2>
        </div>
      </div>
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
        {condicion.member && canViewDetalle && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-foreground-secondary">Mora</span>
            <Badge
              variant={
                mora.isError || mora.data?.enMora !== false
                  ? "warning"
                  : "neutral"
              }
            >
              {moraText}
            </Badge>
          </div>
        )}
        {condicion.member && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-foreground-secondary">
              Créditos activos
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
        {meta ? (
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 md:ml-auto">
            {meta}
          </div>
        ) : null}
      </div>
    </section>
  );
}

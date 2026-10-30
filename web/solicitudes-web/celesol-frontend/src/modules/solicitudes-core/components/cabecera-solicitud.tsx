import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";

import { getEstadoBadgeVariant } from "@/modules/solicitudes-shared/utils/estado-badge-variant";
import { Badge } from "@/shared/components/ui/badge";

import { datosRapidosApi } from "../services/datos-rapidos-api";
import { socioIndicator } from "../utils/datos-rapidos-state";
import { nombreEstado } from "@/modules/solicitudes-shared/utils/nombre-estado";

// Cabecera del detalle: quien pide, en que estado esta y cual es el proximo
// paso van en la barra azul; debajo solo quedan las pestanas y las acciones.

function formatDesde(value?: string | null) {
  const fecha = value ? new Date(value) : null;

  if (!fecha || Number.isNaN(fecha.getTime())) return null;

  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    month: "2-digit",
  })
    .format(fecha)
    .replace(",", "");
}

// Punto de color del estado sobre fondo marino.
const PUNTO_ESTADO: Record<string, string> = {
  danger: "bg-red-300",
  neutral: "bg-white/60",
  success: "bg-verde-claro",
  warning: "bg-amber-300",
};

const PILDORA =
  "inline-flex shrink-0 items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-white";

// Lo principal en la barra azul: quien, numero, estado y la accion que sigue.
export function CabeceraSolicitudEnBarra({
  accionPrincipal,
  aviso,
  destino,
  estado,
  estadoDesde,
  nroSolicitud,
  prestamo,
  titular,
}: {
  accionPrincipal?: ReactNode;
  // Lo que frena la accion principal (p. ej. falta el recibo de sueldo).
  aviso?: ReactNode;
  destino: HTMLElement | null | undefined;
  estado: { code: string; name: string | null; owner?: { name: string } };
  estadoDesde?: string | null;
  nroSolicitud: string | null;
  // "Préstamo Nº 1015194" cuando ya se genero en Vimarx.
  prestamo?: string | null;
  titular: { apellidoDenominacion: string | null; nombre: string | null };
}) {
  if (!destino) return null;
  const nombre =
    [titular.nombre, titular.apellidoDenominacion]
      .map((value) => value?.trim())
      .filter(Boolean)
      .join(" ") || "Nombre no informado";
  const desde = formatDesde(estadoDesde);
  // "Solicitud Nº 500117 · en Riesgo desde 26/10 17:26": donde esta ahora.
  const ubicacion = [
    `Solicitud ${nroSolicitud ? `Nº ${nroSolicitud}` : "sin número"}`,
    estado.owner?.name && desde
      ? `en ${estado.owner.name} desde ${desde}`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return createPortal(
    <div className="flex min-w-0 flex-1 items-center gap-2 pl-2 sm:gap-4 sm:pl-4">
      <span aria-hidden className="hidden h-8 w-px bg-white/15 sm:block" />
      <div className="min-w-28 leading-tight">
        <p className="truncate text-base font-semibold text-white">{nombre}</p>
        <p className="hidden truncate text-xs text-marino-foreground-secondary sm:block">
          {ubicacion}
        </p>
        {/* En celular, el estado va debajo del nombre (no entra la pildora). */}
        <p className="truncate text-xs text-marino-foreground-secondary sm:hidden">
          {nombreEstado(estado.code, estado.name)}
        </p>
      </div>
      <span className={`${PILDORA} max-sm:hidden`}>
        <span
          aria-hidden
          className={`size-2 rounded-full ${PUNTO_ESTADO[getEstadoBadgeVariant(estado.code)] ?? "bg-white/60"}`}
        />
        {nombreEstado(estado.code, estado.name)}
      </span>
      {prestamo ? (
        <span className={`${PILDORA} tabular-nums max-md:hidden`}>
          {prestamo}
        </span>
      ) : null}
      <div className="ml-auto flex shrink-0 items-center gap-3">
        <div className="max-lg:hidden">{aviso}</div>
        {accionPrincipal}
      </div>
    </div>,
    destino,
  );
}

// Debajo de la barra: pestanas y acciones.
export function CabeceraSolicitud({ acciones }: { acciones: ReactNode }) {
  return (
    <header className="shrink-0 border-b border-border">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-2">
        {acciones}
      </div>
    </header>
  );
}

// Al lado del titulo Titular: socio o no, mora y creditos. Si tiene creditos,
// la etiqueta lleva a la pestana Prestamos.
export function SituacionDelSocio({
  canViewDetalle,
  nroSocio,
  onVerPrestamos,
  revision,
  solicitudId,
}: {
  canViewDetalle: boolean;
  nroSocio?: string | null;
  onVerPrestamos: () => void;
  // Misma clave que la franja del socio: comparte la cache de las consultas.
  revision: string;
  solicitudId: string;
}) {
  const key = [
    "solicitudes-core",
    "datos-rapidos",
    solicitudId,
    revision,
  ] as const;
  const socio = useQuery({
    queryFn: () => datosRapidosApi.socio(solicitudId),
    queryKey: [...key, "persona", "socio"],
    retry: false,
  });
  const condicion = socioIndicator(socio);
  const creditos = useQuery({
    enabled: condicion.member,
    queryFn: () => datosRapidosApi.creditos(solicitudId),
    queryKey: [...key, "persona", "creditos"],
    retry: false,
  });
  const mora = useQuery({
    enabled: condicion.member && canViewDetalle,
    queryFn: () => datosRapidosApi.mora(solicitudId),
    queryKey: [...key, "persona", "mora"],
    retry: false,
  });
  const textoSocio = socio.isPending
    ? "Consultando socio"
    : condicion.member
      ? nroSocio?.trim()
        ? `Socio Nº ${nroSocio.trim()}`
        : "Socio"
      : condicion.text === "No es socio"
        ? "No es socio"
        : "Socio sin verificar";
  const activos = creditos.data?.activos;

  return (
    <div aria-live="polite" className="flex flex-wrap items-center gap-1.5">
      <Badge variant={condicion.variant}>{textoSocio}</Badge>
      {condicion.member ? (
        creditos.isPending ? (
          <Badge variant="neutral">Consultando créditos</Badge>
        ) : activos === true && canViewDetalle ? (
          <button
            className="rounded-full focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
            onClick={onVerPrestamos}
            title="Ver los préstamos del socio"
            type="button"
          >
            <Badge className="cursor-pointer hover:bg-muted" variant="neutral">
              Tiene créditos
            </Badge>
          </button>
        ) : (
          <Badge variant={typeof activos === "boolean" ? "neutral" : "warning"}>
            {activos === true
              ? "Tiene créditos"
              : activos === false
                ? "No tiene créditos"
                : "Créditos sin verificar"}
          </Badge>
        )
      ) : null}
      {condicion.member && canViewDetalle && mora.data?.enMora === true ? (
        <Badge variant="warning">Tiene mora</Badge>
      ) : null}
      {condicion.member &&
      canViewDetalle &&
      (mora.isError || (!mora.isPending && mora.data?.enMora === null)) ? (
        <Badge variant="warning">Mora sin verificar</Badge>
      ) : null}
    </div>
  );
}

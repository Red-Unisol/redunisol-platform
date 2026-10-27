import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { toast } from "sonner";

import { useGuardarRefinanciacionMutation } from "@/modules/solicitudes-core/hooks/use-guardar-refinanciacion-mutation";
import { usePrestamoDelSocioQuery } from "@/modules/solicitudes-core/hooks/use-prestamo-del-socio-query";
import { usePrestamosDelSocioQuery } from "@/modules/solicitudes-core/hooks/use-prestamos-del-socio-query";
import { useSimularRefinanciacionMutation } from "@/modules/solicitudes-core/hooks/use-simular-refinanciacion-mutation";
import { useSolicitudRefinanciacionQuery } from "@/modules/solicitudes-core/hooks/use-solicitud-refinanciacion-query";
import type {
  CuotaPrestamoResponse,
  PrestamoDelSocioResponse,
  RefinanciacionPrestamoRequest,
  RefinanciacionSimuladaResponse,
} from "@/modules/solicitudes-core/services/solicitudes-core-api";
import { diaDeNegocio, diaLegacy, estadoCobro } from "@/modules/solicitudes-core/utils/cuotas-cobro";
import { formatLegacyDate } from "@/modules/solicitudes-core/utils/legacy-date-format";
import { clasificarEstadoPrestamo } from "@/modules/solicitudes-core/utils/prestamo-estado";
import { Button } from "@/shared/components/ui/button";
import { Checkbox } from "@/shared/components/ui/checkbox";
import { ApiError } from "@/shared/services/http/api-error";
import { formatMoneyAmount, formatNullableAmount } from "@/shared/utils/money-format";

const PLACEHOLDER = "-";
const GUARDAR_ERROR_TOAST_ID = "refinanciacion-guardar-error";

const CUOTAS_COLUMNS = [
  "",
  "Nº cuota",
  "Vencimiento",
  "Tipo",
  "Saldo cuota",
  "Importe estimado hoy",
] as const;

type Seleccion = Record<string, number[]>;

type TipoCuota = "vencida" | "del-mes" | "futura";

const ETIQUETAS_TIPO: Record<TipoCuota, string> = {
  "del-mes": "Del mes",
  futura: "Futura · sin interés",
  vencida: "Vencida · con punitorios",
};

const ESTILO_TIPO: Record<TipoCuota, string> = {
  "del-mes": "",
  futura: "text-foreground-secondary",
  vencida: "text-destructive",
};

type RefinanciacionSectionProps = {
  canEdit: boolean;
  isActive: boolean;
  solicitudId: string;
};

// Cuotas de los prestamos del socio que se cancelan con el prestamo nuevo.
// Se guardan en Sol Web y se cobran en Vimarx al generar el prestamo, con el
// motivo Refinanciacion: el analista solo elige cuotas, el importe lo calcula
// Vimarx (punitorios en las vencidas, sin interes las futuras, y el cargo de
// refinanciacion de la linea si lo tiene).
export function RefinanciacionSection({
  canEdit,
  isActive,
  solicitudId,
}: RefinanciacionSectionProps) {
  const prestamosQuery = usePrestamosDelSocioQuery(solicitudId, isActive);
  const guardadaQuery = useSolicitudRefinanciacionQuery(solicitudId, isActive);
  const guardarMutation = useGuardarRefinanciacionMutation(solicitudId);
  const simularMutation = useSimularRefinanciacionMutation(solicitudId);
  // null: sin cambios locales, se muestra lo guardado.
  const [borrador, setBorrador] = useState<Seleccion | null>(null);
  const [simulacion, setSimulacion] =
    useState<RefinanciacionSimuladaResponse | null>(null);

  const guardada = useMemo(
    () => aSeleccion(guardadaQuery.data?.prestamos ?? []),
    [guardadaQuery.data],
  );
  const seleccion = borrador ?? guardada;
  const hayCambios = borrador !== null && !mismaSeleccion(borrador, guardada);
  const prestamos = (prestamosQuery.data?.prestamos ?? []).filter(
    (prestamo) =>
      prestamo.legacyId &&
      clasificarEstadoPrestamo(prestamo) === "activos" &&
      // Vimarx da el Saldo del prestamo en negativo cuando hay deuda
      // (-332462,42 con SaldoPrestamo 332462,42): solo se descarta el cero.
      // Sin dato se muestra igual; las cuotas dicen si queda algo pendiente.
      prestamo.saldo !== 0,
  );
  const cantidadCuotas = Object.values(seleccion).reduce(
    (total, nros) => total + nros.length,
    0,
  );
  const ocupado = guardarMutation.isPending || simularMutation.isPending;
  // Un intento de generar el prestamo ya cobro cuotas en Vimarx: la seleccion
  // queda fija (el backend tampoco deja cambiarla).
  const yaCobrada = (guardadaQuery.data?.prestamos ?? []).some(
    (prestamo) => prestamo.cobro,
  );
  const editable = canEdit && !yaCobrada;

  function cambiarSeleccion(prestamoId: string, nros: number[]) {
    setSimulacion(null);
    setBorrador((actual) => {
      const siguiente = { ...(actual ?? guardada) };

      if (nros.length > 0) {
        siguiente[prestamoId] = nros;
      } else {
        delete siguiente[prestamoId];
      }

      return siguiente;
    });
  }

  function calcular() {
    simularMutation.mutate(aRequest(seleccion), {
      onError: (error) => {
        toast.error(mensajeDeError(error, "No se pudo calcular el total."));
      },
      onSuccess: setSimulacion,
    });
  }

  function guardar() {
    guardarMutation.mutate(aRequest(seleccion), {
      onError: (error) => {
        toast.error(
          mensajeDeError(error, "No se pudo guardar la refinanciación."),
          { id: GUARDAR_ERROR_TOAST_ID },
        );
      },
      onSuccess: (resultado) => {
        setBorrador(null);
        setSimulacion(resultado.simulacion);
        toast.success(
          resultado.prestamos.length > 0
            ? "Refinanciación guardada."
            : "Se quitó la refinanciación.",
        );
      },
    });
  }

  if (prestamosQuery.isLoading || guardadaQuery.isLoading) {
    return (
      <p className="py-4 text-sm text-foreground-secondary">
        Consultando préstamos...
      </p>
    );
  }

  if (prestamosQuery.error || guardadaQuery.error) {
    return (
      <p className="py-4 text-sm text-foreground-secondary">
        No se pudieron consultar los préstamos del socio.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-foreground-secondary">
        Seleccioná las cuotas a cancelar con la refinanciación. Se cobran en
        Vimarx al generar el préstamo, con el importe de ese día.
      </p>
      {yaCobrada ? (
        <p className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
          Ya se cobraron en Vimarx cuotas de esta refinanciación. No se puede
          cambiar: terminá de generar el préstamo.
        </p>
      ) : null}
      {prestamos.length === 0 ? (
        <p className="py-4 text-sm text-foreground-secondary">
          El socio no tiene préstamos activos con saldo para refinanciar.
        </p>
      ) : (
        prestamos.map((prestamo) => (
          <PrestamoRefinanciacion
            canEdit={editable && !ocupado}
            inicialmenteAbierto={
              prestamos.length <= 2 ||
              (seleccion[prestamo.legacyId ?? ""]?.length ?? 0) > 0
            }
            key={prestamo.legacyId}
            nrosSeleccionados={seleccion[prestamo.legacyId ?? ""] ?? []}
            onChange={(nros) => cambiarSeleccion(prestamo.legacyId ?? "", nros)}
            prestamo={prestamo}
            simulacion={simulacion?.prestamos.find(
              (item) => item.prestamoId === prestamo.legacyId,
            )}
            solicitudId={solicitudId}
          />
        ))
      )}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-muted/30 px-4 py-3">
        <div className="text-sm">
          <div>
            {cantidadCuotas === 0
              ? "No hay cuotas seleccionadas."
              : `${cantidadCuotas} cuota${cantidadCuotas === 1 ? "" : "s"} seleccionada${cantidadCuotas === 1 ? "" : "s"}.`}
            {hayCambios ? " Hay cambios sin guardar." : ""}
          </div>
          <div className="font-medium">
            Total a refinanciar:{" "}
            {simulacion?.total != null
              ? formatMoneyAmount(simulacion.total)
              : cantidadCuotas > 0
                ? "calcular"
                : formatMoneyAmount(0)}
          </div>
          {simulacion?.total != null ? (
            <div className="text-xs text-foreground-secondary">
              Calculado por Vimarx a hoy, con punitorios y el cargo de
              refinanciación de la línea.
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={cantidadCuotas === 0 || ocupado}
            onClick={calcular}
            type="button"
            variant="outline"
          >
            {simularMutation.isPending ? "Calculando..." : "Calcular total"}
          </Button>
          {editable ? (
            <Button
              disabled={!hayCambios || ocupado}
              onClick={guardar}
              type="button"
            >
              {guardarMutation.isPending ? "Guardando..." : "Guardar"}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

type PrestamoRefinanciacionProps = {
  canEdit: boolean;
  inicialmenteAbierto: boolean;
  nrosSeleccionados: number[];
  onChange: (nros: number[]) => void;
  prestamo: PrestamoDelSocioResponse;
  simulacion: RefinanciacionSimuladaResponse["prestamos"][number] | undefined;
  solicitudId: string;
};

function PrestamoRefinanciacion({
  canEdit,
  inicialmenteAbierto,
  nrosSeleccionados,
  onChange,
  prestamo,
  simulacion,
  solicitudId,
}: PrestamoRefinanciacionProps) {
  const [abierto, setAbierto] = useState(inicialmenteAbierto);
  // Las cuotas se piden siempre: hacen falta para "Cancelar todo" aunque el
  // prestamo este cerrado. Son pocos prestamos activos por socio.
  const { data, error, isLoading } = usePrestamoDelSocioQuery(
    solicitudId,
    prestamo.legacyId,
  );
  const hoy = diaDeNegocio();
  const pendientes = useMemo(
    () => cuotasPendientes(data?.cuotas ?? [], hoy),
    [data, hoy],
  );
  const seleccionadas = new Set(nrosSeleccionados);
  const todas =
    pendientes.length > 0 &&
    pendientes.every((cuota) => seleccionadas.has(cuota.nroCuota));

  // Vimarx cobra en orden: tildar una cuota tilda las anteriores impagas, y
  // destildarla destilda las siguientes.
  function alternar(nroCuota: number, marcar: boolean) {
    const nros = pendientes.map((cuota) => cuota.nroCuota);
    onChange(
      marcar
        ? nros.filter((nro) => nro <= nroCuota || seleccionadas.has(nro))
        : nros.filter((nro) => nro < nroCuota && seleccionadas.has(nro)),
    );
  }

  return (
    <div className="rounded-md border border-border">
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
        <button
          aria-expanded={abierto}
          className="flex items-center gap-2 text-left text-sm font-medium"
          onClick={() => setAbierto((valor) => !valor)}
          type="button"
        >
          {abierto ? (
            <ChevronDown className="size-4" />
          ) : (
            <ChevronRight className="size-4" />
          )}
          Préstamo {prestamo.nroCuenta || PLACEHOLDER} ·{" "}
          {prestamo.lineaPrestamoDescripcion || PLACEHOLDER}
          <span className="font-normal text-foreground-secondary">
            · Saldo{" "}
            {formatNullableAmount(
              prestamo.saldo === null ? null : Math.abs(prestamo.saldo),
            ) || PLACEHOLDER}
            {isLoading ? "" : ` · ${pendientes.length} cuotas pendientes`}
          </span>
        </button>
        <div className="flex items-center gap-3 text-sm">
          {simulacion?.ok ? (
            <span className="font-medium">
              {formatMoneyAmount(simulacion.totalPago)}
            </span>
          ) : null}
          {canEdit && pendientes.length > 0 ? (
            <Button
              onClick={() =>
                onChange(todas ? [] : pendientes.map((cuota) => cuota.nroCuota))
              }
              size="sm"
              type="button"
              variant="outline"
            >
              {todas ? "Quitar todo" : "Cancelar todo"}
            </Button>
          ) : null}
        </div>
      </div>
      {simulacion && !simulacion.ok ? (
        <p className="border-t border-border px-3 py-2 text-sm text-destructive">
          Vimarx no acepta estas cuotas: {simulacion.error}
        </p>
      ) : null}
      {abierto ? (
        <div className="overflow-x-auto border-t border-border">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead className="bg-background text-left text-xs text-foreground-secondary">
              <tr>
                {CUOTAS_COLUMNS.map((column) => (
                  <th
                    className="border-r border-border px-3 py-2 font-medium"
                    key={column}
                  >
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr className="border-t border-border">
                  <td className="px-3 py-3 text-foreground-secondary" colSpan={CUOTAS_COLUMNS.length}>
                    Consultando cuotas...
                  </td>
                </tr>
              ) : error ? (
                <tr className="border-t border-border">
                  <td className="px-3 py-3 text-foreground-secondary" colSpan={CUOTAS_COLUMNS.length}>
                    No se pudieron consultar las cuotas.
                  </td>
                </tr>
              ) : pendientes.length === 0 ? (
                <tr className="border-t border-border">
                  <td className="px-3 py-3 text-foreground-secondary" colSpan={CUOTAS_COLUMNS.length}>
                    No tiene cuotas pendientes.
                  </td>
                </tr>
              ) : (
                pendientes.map((cuota) => (
                  <tr className="border-t border-border" key={cuota.nroCuota}>
                    <td className="border-r border-border px-3 py-2">
                      <Checkbox
                        aria-label={`Cancelar la cuota ${cuota.nroCuota}`}
                        checked={seleccionadas.has(cuota.nroCuota)}
                        disabled={!canEdit}
                        onCheckedChange={(checked) =>
                          alternar(cuota.nroCuota, checked === true)
                        }
                      />
                    </td>
                    <td className="border-r border-border px-3 py-2">
                      {cuota.nroCuota}
                    </td>
                    <td className="border-r border-border px-3 py-2">
                      {formatLegacyDate(cuota.fecha)}
                    </td>
                    <td className={`border-r border-border px-3 py-2 ${ESTILO_TIPO[cuota.tipo]}`}>
                      {ETIQUETAS_TIPO[cuota.tipo]}
                    </td>
                    <td className="border-r border-border px-3 py-2">
                      {formatNullableAmount(cuota.saldoCuota) || PLACEHOLDER}
                    </td>
                    <td className="px-3 py-2">
                      {formatNullableAmount(cuota.saldoCuotaConPunitorios) ||
                        PLACEHOLDER}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

type CuotaPendiente = CuotaPrestamoResponse & {
  nroCuota: number;
  tipo: TipoCuota;
};

// Cuotas del plan sin cobrar y con saldo, de la mas vieja a la mas nueva.
function cuotasPendientes(
  cuotas: readonly CuotaPrestamoResponse[],
  hoy: string,
): CuotaPendiente[] {
  return cuotas
    .filter(
      (cuota): cuota is CuotaPrestamoResponse & { nroCuota: number } =>
        typeof cuota.nroCuota === "number" &&
        cuota.nroCuota > 0 &&
        (cuota.saldoCuota ?? 0) > 0 &&
        estadoCobro(cuota, hoy) !== "cobrada",
    )
    .sort((a, b) => a.nroCuota - b.nroCuota)
    .map((cuota) => ({ ...cuota, tipo: tipoCuota(cuota.fecha, hoy) }));
}

function tipoCuota(fecha: string | null, hoy: string): TipoCuota {
  const vencimiento = diaLegacy(fecha);

  if (!vencimiento) {
    return "del-mes";
  }

  if (vencimiento < hoy) {
    return "vencida";
  }

  return vencimiento.slice(0, 7) === hoy.slice(0, 7) ? "del-mes" : "futura";
}

function aSeleccion(prestamos: RefinanciacionPrestamoRequest[]): Seleccion {
  return Object.fromEntries(
    prestamos.map((prestamo) => [prestamo.prestamoId, prestamo.nrosCuota]),
  );
}

function aRequest(seleccion: Seleccion): RefinanciacionPrestamoRequest[] {
  return Object.entries(seleccion)
    .filter(([, nros]) => nros.length > 0)
    .map(([prestamoId, nros]) => ({
      nrosCuota: [...nros].sort((a, b) => a - b),
      prestamoId,
    }));
}

function mismaSeleccion(a: Seleccion, b: Seleccion) {
  const normalizar = (seleccion: Seleccion) =>
    JSON.stringify(
      aRequest(seleccion).sort((x, y) => x.prestamoId.localeCompare(y.prestamoId)),
    );

  return normalizar(a) === normalizar(b);
}

function mensajeDeError(error: unknown, fallback: string) {
  return error instanceof ApiError && error.message.trim().length > 0
    ? error.message
    : fallback;
}

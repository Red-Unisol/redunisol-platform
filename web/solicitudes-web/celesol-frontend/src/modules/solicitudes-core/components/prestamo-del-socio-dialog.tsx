import { useId, useState } from "react";
import { Landmark, X } from "lucide-react";

import type { CuotaPrestamoResponse } from "@/modules/solicitudes-core/services/solicitudes-core-api";
import { usePrestamoDelSocioQuery } from "@/modules/solicitudes-core/hooks/use-prestamo-del-socio-query";
import {
  diaDeNegocio,
  diaLegacy,
  ETIQUETAS_COBRO,
  vistaCuotas,
  resaltadoCuota,
} from "@/modules/solicitudes-core/utils/cuotas-cobro";
import { formatLegacyDate } from "@/modules/solicitudes-core/utils/legacy-date-format";
import { Button } from "@/shared/components/ui/button";
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogRoot,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { formatNullableAmount } from "@/shared/utils/money-format";

const PLACEHOLDER = "-";

const CUOTAS_TABLE_COLUMNS = [
  "Nro cuota",
  "Vencimiento",
  "Fecha de cobro",
  "Estado",
  "Monto total",
  "Saldo cuota con punitorios",
  "Saldo cuota",
  "Capital",
] as const;

type PrestamoDelSocioDialogProps = {
  onOpenChange: (open: boolean) => void;
  prestamoId: string | null;
  solicitudId: string;
};

// Ficha de un prestamo del socio: los datos que los analistas miraban en
// Vimarx al entrar a cada prestamo, y su plan de cuotas.
export function PrestamoDelSocioDialog({
  onOpenChange,
  prestamoId,
  solicitudId,
}: PrestamoDelSocioDialogProps) {
  const { data, error, isLoading } = usePrestamoDelSocioQuery(
    solicitudId,
    prestamoId,
  );
  const prestamo = data?.prestamo ?? null;
  const cuotas = data?.cuotas ?? [];

  return (
    <DialogRoot onOpenChange={onOpenChange} open={prestamoId !== null}>
      <DialogContent className="flex max-h-[calc(100vh-3rem)] max-w-[960px] flex-col overflow-hidden p-0">
        <header className="flex items-center justify-between border-b border-border bg-surface px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-background text-foreground-secondary">
              <Landmark className="size-4" />
            </span>
            <div className="min-w-0">
              <DialogTitle className="truncate text-xl font-semibold leading-tight text-foreground">
                Préstamo {prestamo?.nroCuenta ?? ""}
              </DialogTitle>
              <DialogDescription className="mt-1 text-sm text-foreground-secondary">
                {prestamo?.lineaPrestamoDescripcion || "Detalle del préstamo"}
              </DialogDescription>
            </div>
          </div>
          <DialogClose asChild>
            <Button
              aria-label="Cerrar detalle del préstamo"
              className="text-foreground-secondary"
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <X className="size-4" />
            </Button>
          </DialogClose>
        </header>

        <div className="space-y-4 overflow-y-auto px-4 py-4">
          {isLoading ? (
            <p className="text-sm text-foreground-secondary">
              Consultando préstamo...
            </p>
          ) : error || !prestamo ? (
            <p className="text-sm text-foreground-secondary">
              No se pudo consultar el préstamo.
            </p>
          ) : (
            <>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm md:grid-cols-3">
                <Dato
                  label="Cantidad de cuotas"
                  value={
                    prestamo.cuotas == null ? null : String(prestamo.cuotas)
                  }
                />
                <Dato label="Orden de compra" value={prestamo.ordenCompra} />
                <Dato label="Cobrador" value={prestamo.cobrador} />
                <Dato label="Destino" value={prestamo.destino} />
                <Dato label="Asiento" value={prestamo.asiento} />
                <Dato
                  label="Línea préstamo"
                  value={prestamo.lineaPrestamoDescripcion}
                />
                <Dato
                  label="Tasa inicial"
                  value={formatTasa(prestamo.tasaInicial)}
                />
              </dl>

              {prestamoId !== null && (
                <CuotasTable
                  key={`${solicitudId}/${prestamoId}`}
                  cuotas={cuotas}
                />
              )}
            </>
          )}
        </div>
      </DialogContent>
    </DialogRoot>
  );
}

const ROW_STYLES = {
  cobrada: "text-foreground-secondary",
  "mes-anterior":
    "bg-yellow-50 dark:bg-yellow-950/30 [&>td:first-child]:border-l-4 [&>td:first-child]:border-l-yellow-500",
  vencida:
    "bg-red-50 dark:bg-red-950/30 [&>td:first-child]:border-l-4 [&>td:first-child]:border-l-red-500",
  pendiente: "",
  "sin-vencimiento": "",
  desconocido: "",
};

function CuotasTable({ cuotas }: { cuotas: CuotaPrestamoResponse[] }) {
  const [expandida, setExpandida] = useState(false);
  const tableId = useId();
  const hoy = diaDeNegocio();
  const { filas, cantidadOcultas } = vistaCuotas(cuotas, expandida, hoy);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1000px] border-collapse text-sm">
        <caption className="sr-only">Plan de cuotas y estado de cobro</caption>
        <thead className="bg-background text-left text-xs text-foreground-secondary">
          <tr>
            {CUOTAS_TABLE_COLUMNS.map((column) => (
              <th
                scope="col"
                className="border-r border-border px-3 py-2 font-medium"
                key={column}
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {cantidadOcultas > 0 && (
            <tr className="border-t border-border bg-background">
              <td colSpan={CUOTAS_TABLE_COLUMNS.length} className="px-3 py-1">
                <Button
                  aria-expanded={expandida}
                  aria-controls={tableId}
                  onClick={() => setExpandida(!expandida)}
                  type="button"
                  variant="ghost"
                  size="sm"
                >
                  {expandida
                    ? "Ocultar cuotas cobradas anteriores"
                    : `Mostrar ${cantidadOcultas} cuotas cobradas anteriores`}
                </Button>
              </td>
            </tr>
          )}
        </tbody>
        <tbody id={tableId}>
          {filas.length ? (
            filas.map(({ cuota, estado, ultimaCobrada }, index) => (
              <tr
                className={`border-t border-border ${ROW_STYLES[estado]} ${resaltadoCuota(cuota, hoy).noVencida ? "font-bold" : ""}`}
                key={`${cuota.nroCuota}-${index}`}
              >
                <td className="border-r border-border px-3 py-2">
                  {cuota.nroCuota ?? PLACEHOLDER}
                </td>
                <td className="border-r border-border px-3 py-2 whitespace-nowrap">
                  {diaLegacy(cuota.fecha)
                    ? formatLegacyDate(diaLegacy(cuota.fecha))
                    : "No disponible"}
                </td>
                <td
                  className={`border-r border-border px-3 py-2 whitespace-nowrap ${resaltadoCuota(cuota, hoy).cobroEnOtroDia ? "bg-warning text-warning-foreground font-bold" : ""}`}
                  title={
                    resaltadoCuota(cuota, hoy).cobroEnOtroDia
                      ? "Fecha de cobro distinta del vencimiento"
                      : undefined
                  }
                >
                  {estado === "cobrada"
                    ? formatLegacyDate(cuota.fechaCobro!.trim())
                    : estado === "desconocido"
                      ? "No disponible"
                      : "Sin cobro"}
                </td>
                <td className="border-r border-border px-3 py-2">
                  {ultimaCobrada ? "Última cobrada" : ETIQUETAS_COBRO[estado]}
                </td>
                <td className="border-r border-border px-3 py-2">
                  {formatNullableAmount(cuota.montoTotal) || PLACEHOLDER}
                </td>
                <td className="border-r border-border px-3 py-2">
                  {formatNullableAmount(cuota.saldoCuotaConPunitorios) ||
                    PLACEHOLDER}
                </td>
                <td className="border-r border-border px-3 py-2">
                  {formatNullableAmount(cuota.saldoCuota) || PLACEHOLDER}
                </td>
                <td className="px-3 py-2">
                  {formatNullableAmount(cuota.capital) || PLACEHOLDER}
                </td>
              </tr>
            ))
          ) : (
            <tr className="border-t border-border">
              <td
                className="px-3 py-4 text-foreground-secondary"
                colSpan={CUOTAS_TABLE_COLUMNS.length}
              >
                El préstamo no tiene cuotas registradas.
              </td>
            </tr>
          )}
        </tbody>
        {cuotas.length > 0 && (
          <tfoot className="border-t-2 border-border bg-background font-semibold">
            <tr>
              <th
                scope="row"
                colSpan={4}
                className="border-r border-border px-3 py-2 text-left"
              >
                Total
              </th>
              <td className="border-r border-border px-3 py-2">
                {formatNullableAmount(sumar(cuotas, "montoTotal")) ||
                  PLACEHOLDER}
              </td>
              <td className="border-r border-border px-3 py-2">
                {formatNullableAmount(
                  sumar(cuotas, "saldoCuotaConPunitorios"),
                ) || PLACEHOLDER}
              </td>
              <td className="border-r border-border px-3 py-2">
                {formatNullableAmount(sumar(cuotas, "saldoCuota")) ||
                  PLACEHOLDER}
              </td>
              <td className="px-3 py-2">
                {formatNullableAmount(sumar(cuotas, "capital")) || PLACEHOLDER}
              </td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

// Suma todas las cuotas del prestamo, tambien las cobradas que estan ocultas.
// Redondea a centavos para no arrastrar el error de los decimales. Si ninguna
// cuota tiene el dato, devuelve null.
function sumar(
  cuotas: CuotaPrestamoResponse[],
  campo: "capital" | "montoTotal" | "saldoCuota" | "saldoCuotaConPunitorios",
) {
  const valores = cuotas
    .map((cuota) => cuota[campo])
    .filter((valor): valor is number => typeof valor === "number");

  if (!valores.length) {
    return null;
  }

  const total = valores.reduce((acumulado, valor) => acumulado + valor, 0);

  return Math.round(total * 100) / 100;
}

function Dato({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-xs font-medium text-foreground-secondary">{label}</dt>
      <dd className="mt-0.5 text-foreground">{value || PLACEHOLDER}</dd>
    </div>
  );
}

// Vimarx guarda la tasa como fraccion (0.1135) y la muestra por 100 con tres
// decimales ("11,350 %").
function formatTasa(value: number | null) {
  if (value === null) {
    return null;
  }

  return `${(value * 100).toLocaleString("es-AR", {
    maximumFractionDigits: 3,
    minimumFractionDigits: 3,
  })} %`;
}

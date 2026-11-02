import { X } from "lucide-react";

import { useMovimientosDeCuotaQuery } from "@/modules/solicitudes-core/hooks/use-movimientos-de-cuota-query";
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

const MOVIMIENTOS_TABLE_COLUMNS = [
  "Cuota afectada",
  "Tipo",
  "Fecha",
  "Monto",
] as const;

type MovimientosCuotaDialogProps = {
  cuotaId: string | null;
  nroCuota: number | null;
  onOpenChange: (open: boolean) => void;
  prestamoId: string;
  solicitudId: string;
};

// Movimientos de una cuota: lo mismo que Vimarx muestra al abrir una cuota
// con doble clic en "Detalle cuotas". Los montos positivos son lo que la cuota
// debe y los negativos, lo que se le pago.
export function MovimientosCuotaDialog({
  cuotaId,
  nroCuota,
  onOpenChange,
  prestamoId,
  solicitudId,
}: MovimientosCuotaDialogProps) {
  const { data, error, isLoading } = useMovimientosDeCuotaQuery(
    solicitudId,
    prestamoId,
    cuotaId,
  );
  const movimientos = data?.movimientos ?? [];

  return (
    <DialogRoot onOpenChange={onOpenChange} open={cuotaId !== null}>
      <DialogContent className="flex max-h-[calc(100vh-3rem)] max-w-[640px] flex-col overflow-hidden p-0">
        <header className="flex items-center justify-between border-b border-border bg-surface px-4 py-3">
          <div className="min-w-0">
            <DialogTitle className="truncate text-lg font-semibold leading-tight text-foreground">
              {cuotaId} - Cuota préstamo
            </DialogTitle>
            <DialogDescription className="mt-1 text-sm text-foreground-secondary">
              Movimientos de la cuota {nroCuota ?? ""}
            </DialogDescription>
          </div>
          <DialogClose asChild>
            <Button
              aria-label="Cerrar movimientos de la cuota"
              className="text-foreground-secondary"
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <X className="size-4" />
            </Button>
          </DialogClose>
        </header>

        <div className="overflow-y-auto px-4 py-4">
          {isLoading ? (
            <p className="text-sm text-foreground-secondary">
              Consultando movimientos...
            </p>
          ) : error ? (
            <p className="text-sm text-foreground-secondary">
              No se pudieron consultar los movimientos de la cuota.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[480px] border-collapse text-sm">
                <caption className="sr-only">Movimientos de la cuota</caption>
                <thead className="bg-background text-left text-xs text-foreground-secondary">
                  <tr>
                    {MOVIMIENTOS_TABLE_COLUMNS.map((column) => (
                      <th
                        scope="col"
                        className="border-r border-border px-3 py-2 font-medium last:border-r-0"
                        key={column}
                      >
                        {column}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {movimientos.length ? (
                    movimientos.map((movimiento, index) => (
                      <tr
                        className="border-t border-border"
                        key={movimiento.id ?? index}
                      >
                        <td className="border-r border-border px-3 py-2">
                          {movimiento.cuotaAfectada || PLACEHOLDER}
                        </td>
                        <td className="border-r border-border px-3 py-2">
                          {movimiento.tipo || PLACEHOLDER}
                        </td>
                        <td className="border-r border-border px-3 py-2 whitespace-nowrap">
                          {formatLegacyDate(movimiento.fecha)}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          {formatMonto(movimiento.monto)}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr className="border-t border-border">
                      <td
                        className="px-3 py-4 text-foreground-secondary"
                        colSpan={MOVIMIENTOS_TABLE_COLUMNS.length}
                      >
                        La cuota no tiene movimientos registrados.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </DialogContent>
    </DialogRoot>
  );
}

// Los pagos vienen en negativo: el signo va antes del $ ("-$4.367,51").
function formatMonto(monto: number | null) {
  if (monto === null) {
    return PLACEHOLDER;
  }

  return monto < 0
    ? `-${formatNullableAmount(-monto)}`
    : formatNullableAmount(monto);
}

import { useState } from "react";
import { Landmark, X } from "lucide-react";

import { usePrestamoDelSocioQuery } from "@/modules/solicitudes-core/hooks/use-prestamo-del-socio-query";
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
  "Fecha",
  "Fecha de cobro",
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
  // La cuota 0 es un movimiento interno del sistema legado.
  const cuotas = (data?.cuotas ?? []).filter((cuota) => cuota.nroCuota !== 0);
  const [expandedPrestamoId, setExpandedPrestamoId] = useState<string | null>(null);
  const mostrarCobradas = expandedPrestamoId === prestamoId && prestamoId !== null;
  const cobradas = cuotas.filter((cuota) => Boolean(cuota.fechaCobro));
  // Ultima cuota del plan con cobro registrado, por numero de cuota.
  const ultimaCobrada = cobradas.reduce<(typeof cuotas)[number] | null>(
    (ultima, cuota) =>
      !ultima || (cuota.nroCuota ?? -1) > (ultima.nroCuota ?? -1) ? cuota : ultima,
    null,
  );
  const cuotasVisibles = cuotas.filter(
    (cuota) => !cuota.fechaCobro || mostrarCobradas || cuota === ultimaCobrada,
  );

  return (
    <DialogRoot
      onOpenChange={(open) => {
        if (!open) setExpandedPrestamoId(null);
        onOpenChange(open);
      }}
      open={prestamoId !== null}
    >
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
                <Dato label="Cobrador" value={prestamo.cobrador} />
                <Dato
                  label="Línea préstamo"
                  value={prestamo.lineaPrestamoDescripcion}
                />
                <Dato
                  label="Cantidad de cuotas"
                  value={prestamo.cuotas == null ? null : String(prestamo.cuotas)}
                />
              </dl>

              {cobradas.length > 1 && (
                <Button
                  aria-expanded={mostrarCobradas}
                  onClick={() => setExpandedPrestamoId(mostrarCobradas ? null : prestamoId)}
                  type="button"
                  variant="ghost"
                >
                  {mostrarCobradas
                    ? "Ocultar cuotas cobradas anteriores"
                    : `Ver todas las cuotas cobradas (${cobradas.length})`}
                </Button>
              )}
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] border-collapse text-sm">
                  <thead className="bg-background text-left text-xs text-foreground-secondary">
                    <tr>
                      {CUOTAS_TABLE_COLUMNS.map((column) => (
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
                    {cuotas.length > 0 ? (
                      cuotasVisibles.map((cuota) => (
                        <tr
                          className="border-t border-border"
                          key={cuota.nroCuota ?? cuota.fecha}
                        >
                          <td className="border-r border-border px-3 py-2">
                            {cuota.nroCuota ?? PLACEHOLDER}
                          </td>
                          <td className="border-r border-border px-3 py-2">
                            {formatLegacyDate(cuota.fecha)}
                          </td>
                          <td className="border-r border-border px-3 py-2">
                            {formatLegacyDate(cuota.fechaCobro)}
                          </td>
                          <td className="border-r border-border px-3 py-2">
                            {formatNullableAmount(cuota.montoTotal) ||
                              PLACEHOLDER}
                          </td>
                          <td className="border-r border-border px-3 py-2">
                            {formatNullableAmount(
                              cuota.saldoCuotaConPunitorios,
                            ) || PLACEHOLDER}
                          </td>
                          <td className="border-r border-border px-3 py-2">
                            {formatNullableAmount(cuota.saldoCuota) ||
                              PLACEHOLDER}
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
                </table>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </DialogRoot>
  );
}

function Dato({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-xs font-medium text-foreground-secondary">{label}</dt>
      <dd className="mt-0.5 text-foreground">{value || PLACEHOLDER}</dd>
    </div>
  );
}

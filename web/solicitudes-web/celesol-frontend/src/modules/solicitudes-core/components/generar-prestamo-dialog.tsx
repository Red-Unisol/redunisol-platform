import { useRevisionPrestamoQuery } from "../hooks/use-revision-prestamo-query";
import { formatLegacyDate } from "../utils/legacy-date-format";
import { Button } from "@/shared/components/ui/button";
import { useSolicitudCoreCancelacionesQuery } from "@/modules/solicitudes-core/hooks/use-solicitud-core-cancelaciones-query";
import { ConfirmDialog } from "@/shared/components/ui/confirm-dialog";
import { formatMoneyAmount } from "@/shared/utils/money-format";

const PLACEHOLDER = "-";

type GenerarPrestamoDialogProps = {
  condicionesKey: string;
  cuotas: number | null;
  isPending: boolean;
  lineaPrestamoDescripcion: string;
  montoAFinanciar: number | null;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  solicitudId: string;
};

// Confirmacion previa a crear el prestamo en Vimarx con el reparto del monto a
// desembolsar: lo que cancela deudas con terceros y lo que recibe el socio. Es
// la misma cuenta que el legado ([Monto En Mano] = Bco + MontoCancelaciones).
// REFI queda afuera: hoy el prestamo creado desde aca no refinancia deuda propia.
export function GenerarPrestamoDialog(props: GenerarPrestamoDialogProps) {
  // Desmontar al cerrar descarta la vista previa, incluso una consulta pendiente.
  return props.open ? (
    <RevisionPrestamoDialog
      key={JSON.stringify([props.solicitudId, props.condicionesKey])}
      {...props}
    />
  ) : null;
}

function RevisionPrestamoDialog({
  condicionesKey,
  cuotas,
  isPending,
  lineaPrestamoDescripcion,
  montoAFinanciar,
  onConfirm,
  onOpenChange,
  open,
  solicitudId,
}: GenerarPrestamoDialogProps) {
  const revision = useRevisionPrestamoQuery(solicitudId, condicionesKey);
  // Nunca presentar el resultado cacheado durante una nueva consulta.
  const data =
    revision.isFetching || revision.isError ? undefined : revision.data;
  const calculo = data?.calculo;
  const montoRevision = data ? data.condiciones.montoAFinanciar : montoAFinanciar;
  const {
    data: cancelaciones = [],
    error,
    isLoading,
  } = useSolicitudCoreCancelacionesQuery(open ? solicitudId : "");
  const totalCancelaciones = cancelaciones.reduce(
    (total, cancelacion) => total + cancelacion.monto,
    0,
  );
  const montoEnMano =
    montoRevision === null || isLoading || error
      ? null
      : montoRevision - totalCancelaciones;
  // Sin las cancelaciones no se puede mostrar el reparto, y un en mano negativo
  // es un prestamo que no alcanza para pagar a los terceros.
  const bloqueo = error
    ? "No se pudieron consultar las cancelaciones. Reintentá antes de generar el préstamo."
    : montoEnMano !== null && montoEnMano < 0
      ? "Las cancelaciones superan el monto a desembolsar."
      : null;
  // Con una sola cancelacion su monto es el total: repetirlo confunde.
  const detallarMontos = cancelaciones.length > 1;

  return (
    <ConfirmDialog
      className="max-w-[960px] p-4 md:p-5"
      confirmLabel="Generar préstamo"
      description="Revisá el titular, el plan de cuotas y el desembolso antes de confirmar."
      isConfirmDisabled={isLoading || bloqueo !== null}
      isConfirming={isPending}
      onConfirm={onConfirm}
      onOpenChange={onOpenChange}
      open={open}
      title="Generar préstamo"
    >
      <div className="max-h-[calc(100dvh-13rem)] overflow-y-auto pr-1 space-y-4">
        {revision.isFetching ? (
          <p role="status" className="text-sm text-foreground-secondary">
            Calculando el plan de cuotas...
          </p>
        ) : revision.isError ? (
          <div
            role="alert"
            className="rounded-md border border-destructive/30 p-3 text-sm text-destructive"
          >
            <p>
              No se pudo obtener la revisión del préstamo.{" "}
              {revision.error.message}
            </p>
            <Button
              className="mt-2"
              variant="outline"
              size="sm"
              onClick={() => void revision.refetch()}
            >
              Reintentar cálculo
            </Button>
          </div>
        ) : null}
        <section
          aria-label="Titular"
          className="rounded-md border border-border bg-background p-3"
        >
          <h3 className="mb-2 text-sm font-semibold">Titular</h3>
          <dl className="grid gap-3 sm:grid-cols-2 text-sm">
            <Campo
              label="Nombre completo"
              value={data?.titular.nombreCompleto}
            />
            <Campo label="Número de socio" value={data?.titular.nroSocio} />
          </dl>
        </section>
        <section aria-label="Condiciones">
          <h3 className="mb-2 text-sm font-semibold">Condiciones</h3>
          <dl className="grid grid-cols-2 gap-3 md:grid-cols-4 text-sm">
            <Campo
              label="Línea"
              value={
                data?.condiciones.lineaDescripcion ?? lineaPrestamoDescripcion
              }
            />
            <Campo
              label="Monto a financiar"
              value={formatMoneyAmount(
                montoRevision,
              )}
            />
            <Campo
              label="Tasa del cálculo"
              value={
                calculo?.tasa == null
                  ? null
                  : String(calculo.tasa).replace(".", ",")
              }
            />
            <Campo
              label="Cantidad de cuotas"
              value={String((data ? data.condiciones.cuotas : cuotas) ?? "")}
            />
            <Campo
              label="Cuota resultante"
              value={formatMoneyAmount(calculo?.cuotaResultante)}
            />
            <Campo
              label="Gastos administrativos de liquidación"
              value={formatMoneyAmount(calculo?.gastos)}
            />
            <Campo
              label="Capital financiado"
              value={formatMoneyAmount(calculo?.capital)}
            />
            <Campo
              label="Total del cálculo"
              value={formatMoneyAmount(calculo?.total)}
            />
          </dl>
        </section>
        <dl className="grid gap-3 rounded-md border border-primary/30 bg-primary/5 p-3 sm:grid-cols-2 text-sm">
          <Campo
            label="Fecha de primer vencimiento"
            value={
              calculo?.fechaPrimerVencimiento
                ? formatLegacyDate(calculo.fechaPrimerVencimiento)
                : null
            }
            destacado
          />
          <Campo
            label="Fecha de última cuota"
            value={
              calculo?.fechaUltimaCuota
                ? formatLegacyDate(calculo.fechaUltimaCuota)
                : null
            }
          />
        </dl>
        <section aria-label="Detalle de cuotas">
          <h3 className="mb-2 text-sm font-semibold">Detalle de cuotas</h3>
          {calculo?.cuotasDetalle?.length ? (
            <div
              role="region"
              aria-label="Plan de cuotas"
              tabIndex={0}
              className="max-h-64 overflow-auto rounded-md border border-border"
            >
              <table className="w-full min-w-[620px] border-collapse text-xs tabular-nums">
                <thead className="sticky top-0 z-10 bg-background text-foreground-secondary">
                  <tr>
                    {[
                      "Cuota",
                      "Vencimiento",
                      "Capital",
                      "Interés",
                      "Gastos",
                      "Monto",
                    ].map((label, index) => (
                      <th
                        scope="col"
                        key={label}
                        className={`px-3 py-2 font-medium ${index > 1 ? "text-right" : "text-left"}`}
                      >
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {calculo.cuotasDetalle.map((cuota, index) => (
                    <tr key={index} className="border-t border-border">
                      <td className="px-3 py-2">
                        {cuota.numeroCuota ?? "No disponible"}
                      </td>
                      <td className="px-3 py-2">
                        {cuota.fechaVencimiento
                          ? formatLegacyDate(cuota.fechaVencimiento)
                          : "No disponible"}
                      </td>
                      {[
                        cuota.capital,
                        cuota.interes,
                        cuota.gastos,
                        cuota.total,
                      ].map((value, col) => (
                        <td key={col} className="px-3 py-2 text-right">
                          {formatMoneyAmount(value) || "No disponible"}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="rounded-md border border-border p-4 text-sm text-foreground-secondary">
              {revision.isFetching
                ? "Consultando cuotas..."
                : revision.isError
                  ? "El detalle no pudo consultarse."
                  : "Detalle de cuotas no disponible."}
            </p>
          )}
        </section>
        <h3 className="text-sm font-semibold">Resumen del desembolso</h3>
        <dl className="mt-4 space-y-2 rounded-md bg-background px-3 py-3 text-sm">
          <Dato
            label="Monto a desembolsar"
            value={formatMoneyAmount(montoRevision)}
          />
          <div>
            <Dato
              label="Cancelaciones"
              value={
                isLoading
                  ? "Consultando..."
                  : error
                    ? null
                    : formatMoneyAmount(totalCancelaciones)
              }
            />
            {cancelaciones.length > 0 ? (
              <ul className="mt-1 space-y-0.5 pl-3 text-xs text-foreground-secondary">
                {cancelaciones.map((cancelacion) => (
                  <li
                    className="flex justify-between gap-3"
                    key={cancelacion.id}
                  >
                    <span className="break-words">{cancelacion.socio}</span>
                    {detallarMontos ? (
                      <span className="shrink-0">
                        {formatMoneyAmount(cancelacion.monto)}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          <div className="border-t border-border pt-2 text-lg font-semibold">
            <Dato
              label="Monto en mano"
              value={
                montoEnMano === null ? null : formatMoneyAmount(montoEnMano)
              }
            />
          </div>
        </dl>

        {bloqueo ? <p className="mt-3 text-sm text-danger">{bloqueo}</p> : null}
      </div>
    </ConfirmDialog>
  );
}

function Dato({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-foreground-secondary">{label}</dt>
      <dd className="text-right font-medium text-foreground">
        {value || PLACEHOLDER}
      </dd>
    </div>
  );
}

function Campo({
  label,
  value,
  destacado = false,
}: {
  label: string;
  value?: string | null;
  destacado?: boolean;
}) {
  return (
    <div className="min-w-0 space-y-1">
      <dt className="text-xs text-foreground-secondary">{label}</dt>
      <dd
        className={`break-words font-medium ${destacado ? "text-lg text-primary" : "text-foreground"}`}
      >
        {value || "No disponible"}
      </dd>
    </div>
  );
}

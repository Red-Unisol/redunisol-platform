import { useSolicitudCoreCancelacionesQuery } from "@/modules/solicitudes-core/hooks/use-solicitud-core-cancelaciones-query";
import { ConfirmDialog } from "@/shared/components/ui/confirm-dialog";
import { formatMoneyAmount } from "@/shared/utils/money-format";

const PLACEHOLDER = "-";

type GenerarPrestamoDialogProps = {
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
export function GenerarPrestamoDialog({
  cuotas,
  isPending,
  lineaPrestamoDescripcion,
  montoAFinanciar,
  onConfirm,
  onOpenChange,
  open,
  solicitudId,
}: GenerarPrestamoDialogProps) {
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
    montoAFinanciar === null || isLoading || error
      ? null
      : montoAFinanciar - totalCancelaciones;
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
      className="max-w-lg"
      confirmLabel="Generar préstamo"
      description="Revisá los datos antes de crear el préstamo en Vimarx."
      isConfirmDisabled={isLoading || bloqueo !== null}
      isConfirming={isPending}
      onConfirm={onConfirm}
      onOpenChange={onOpenChange}
      open={open}
      title="Generar préstamo"
    >
      <dl className="space-y-2 text-sm">
        <Dato label="Línea" value={lineaPrestamoDescripcion} />
        <Dato label="Cuotas" value={cuotas === null ? null : String(cuotas)} />
      </dl>

      <dl className="mt-4 space-y-2 rounded-md bg-background px-3 py-3 text-sm">
        <Dato
          label="Monto a desembolsar"
          value={formatMoneyAmount(montoAFinanciar)}
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
                <li className="flex justify-between gap-3" key={cancelacion.id}>
                  <span className="truncate">{cancelacion.socio}</span>
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
        <div className="border-t border-border pt-2 font-semibold">
          <Dato
            label="Monto en mano"
            value={montoEnMano === null ? null : formatMoneyAmount(montoEnMano)}
          />
        </div>
      </dl>

      {bloqueo ? <p className="mt-3 text-sm text-danger">{bloqueo}</p> : null}
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

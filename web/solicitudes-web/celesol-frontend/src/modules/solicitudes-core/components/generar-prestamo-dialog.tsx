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

// Confirmacion previa a crear el prestamo en Vimarx con los montos del panel
// CREDITO que ya se conocen antes de que el prestamo exista. REFI y En mano
// quedan afuera: Vimarx los calcula recien al refinanciar/liquidar. La suma de
// cancelaciones es la misma que Solicitud.MontoCancelaciones del legado.
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

  return (
    <ConfirmDialog
      confirmLabel="Generar préstamo"
      description="Revisá los datos antes de crear el préstamo en Vimarx."
      isConfirming={isPending}
      onConfirm={onConfirm}
      onOpenChange={onOpenChange}
      open={open}
      title="Generar préstamo"
    >
      <dl className="space-y-2 text-sm">
        <Dato label="Línea" value={lineaPrestamoDescripcion} />
        <Dato label="Cuotas" value={cuotas === null ? null : String(cuotas)} />
        <Dato
          label="Monto a desembolsar"
          value={formatMoneyAmount(montoAFinanciar)}
        />
        <Dato
          label="Cancelaciones"
          value={
            isLoading
              ? "Consultando..."
              : error
                ? "No se pudieron consultar"
                : formatMoneyAmount(totalCancelaciones)
          }
        />
      </dl>
      {cancelaciones.length > 0 ? (
        <ul className="mt-2 space-y-1 border-t border-border pt-2 text-xs text-foreground-secondary">
          {cancelaciones.map((cancelacion) => (
            <li className="flex justify-between gap-3" key={cancelacion.id}>
              <span className="truncate">{cancelacion.socio}</span>
              <span className="shrink-0">
                {formatMoneyAmount(cancelacion.monto)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
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

import {
  AlertCircle,
  CheckCircle2,
  CircleHelp,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import {
  conditionDifferences,
  money,
  SAMPLE_REQUEST,
  type Scenario,
} from "../scenarios";

export function ConditionAlert({
  scenario,
  compact = false,
  onReconsult,
}: {
  scenario: Scenario;
  compact?: boolean;
  onReconsult?: () => void;
}) {
  const differences = conditionDifferences(scenario);
  if (scenario.id === "new")
    return (
      <div className="lab-product-note">
        <CircleHelp size={17} />
        <p>
          La solicitud todavía no tiene un préstamo vinculado. Al confirmar se
          generará y pasará a Liquidada.
        </p>
      </div>
    );
  if (scenario.id === "compatible")
    return (
      <div className="lab-condition-alert is-success">
        <CheckCircle2 size={18} />
        <div>
          <strong>El préstamo #{scenario.core?.id} coincide con Beex.</strong>
          <p>Se utilizará el préstamo existente. No se generará otro.</p>
          {!compact && (
            <span className="lab-check-line">
              Monto solicitado · cuotas · línea · primer vencimiento ·
              cancelaciones
            </span>
          )}
        </div>
      </div>
    );
  if (scenario.id === "cancelled")
    return (
      <div className="lab-condition-alert is-success">
        <ShieldCheck size={18} />
        <div>
          <strong>
            Anulación confirmada del préstamo #{scenario.core?.id}
          </strong>
          <p>
            Sin vigencia y con saldo cero. Podés regenerar con las condiciones
            actuales y conservar el historial.
          </p>
        </div>
      </div>
    );
  if (scenario.id === "processing")
    return (
      <div className="lab-condition-alert is-neutral">
        <LoaderCircle size={18} className="animate-spin" />
        <div>
          <strong>
            {scenario.operationMode === "reuse"
              ? "Liquidación en curso"
              : "Generación y liquidación en curso"}
          </strong>
          <p>
            Esperá el resultado de esta operación. La edición y la liquidación
            permanecen bloqueadas.
          </p>
          {!compact && (
            <div className="lab-operation-steps">
              <span className="complete">Condiciones verificadas</span>
              <span className="current">
                {scenario.operationMode === "reuse"
                  ? "Registrando liquidación"
                  : "Generando préstamo"}
              </span>
              <span>Pasar a Liquidada</span>
            </div>
          )}
        </div>
      </div>
    );
  if (scenario.id === "uncertain")
    return (
      <div className="lab-condition-alert is-warning">
        <AlertCircle size={18} />
        <div>
          <strong>
            {scenario.operationMode === "reuse"
              ? "No se pudo confirmar la liquidación."
              : "No se pudo confirmar el resultado del intento."}
          </strong>
          <p>
            {scenario.operationMode === "reuse"
              ? "Consultá el resultado de esta operación en Beex, sin repetir la liquidación. Se mantiene el préstamo ya vinculado."
              : "No generes otro préstamo. Primero verificá el resultado del mismo intento."}
          </p>
          {!compact && (
            <span className="lab-check-line">
              Intento pendiente: DEMO-GEN-0241
              {scenario.core
                ? " · Vínculo conservado: #" +
                  scenario.core.id +
                  (scenario.core.status === "cancelled" ? " (anulado)" : "")
                : ""}
            </span>
          )}
        </div>
      </div>
    );
  if (scenario.id === "success")
    return (
      <div className="lab-condition-alert is-success">
        <CheckCircle2 size={18} />
        <div>
          <strong>
            Préstamo #{scenario.core?.id} vinculado. Solicitud liquidada.
          </strong>
          <p>
            La operación quedó registrada y el circuito continúa con firma y
            revisión del legajo.
          </p>
        </div>
      </div>
    );
  if (scenario.id === "unverifiable")
    return (
      <div className="lab-condition-alert is-warning">
        <CircleHelp size={18} />
        <div>
          <strong>
            No se pudo verificar el préstamo #{scenario.core?.id} en Vimarx.
          </strong>
          <p>
            Necesitamos confirmar su estado y condiciones antes de generar o
            liquidar.
          </p>
          {!compact && (
            <Button
              variant="outline"
              size="sm"
              type="button"
              onClick={onReconsult}
            >
              <RefreshCw size={14} />
              Reconsultar Vimarx
            </Button>
          )}
        </div>
      </div>
    );
  return (
    <div className="lab-mismatch-block">
      <div className="lab-condition-alert is-danger">
        <AlertCircle size={18} />
        <div>
          <strong>
            {scenario.id === "amount-mismatch"
              ? "Préstamo con monto distinto"
              : "El préstamo tiene condiciones diferentes"}
          </strong>
          <p>
            {scenario.id === "amount-mismatch"
              ? "Anulá el préstamo preexistente #" +
                scenario.core?.id +
                " en Vimarx para continuar."
              : "No se puede liquidar con estas diferencias. Revisá el préstamo #" +
                scenario.core?.id +
                " y las condiciones guardadas en Beex."}
          </p>
        </div>
      </div>
      {compact ? (
        <div className="lab-compact-difference">
          {scenario.id === "amount-mismatch" ? (
            <>
              <span>
                Beex <strong>{money(SAMPLE_REQUEST.amount)}</strong>
              </span>
              <span>
                Vimarx <strong>{money(scenario.core!.amount)}</strong>
              </span>
            </>
          ) : (
            <span>Cuotas, línea, vencimiento y cancelaciones distintos</span>
          )}
        </div>
      ) : (
        <>
          <div className="lab-difference-table">
            <table>
              <thead>
                <tr>
                  <th>Campo</th>
                  <th>Beex</th>
                  <th>Vimarx · #{scenario.core?.id}</th>
                </tr>
              </thead>
              <tbody>
                {differences.map((row) => (
                  <tr key={row.label}>
                    <td>{row.label}</td>
                    <td>{row.beex}</td>
                    <td>{row.core}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {scenario.id === "amount-mismatch" && (
            <p className="lab-comparison-footnote">
              El monto solicitado se compara por separado del capital que
              incluye gastos.
            </p>
          )}
          <div className="lab-alert-actions">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onReconsult}
            >
              <RefreshCw size={14} />
              Reconsultar Vimarx
            </Button>
            <span>La anulación se realiza en Vimarx.</span>
          </div>
        </>
      )}
    </div>
  );
}

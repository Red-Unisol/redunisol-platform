import { ArrowRight, CheckCircle2, History, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { ConfirmDialog } from "@/shared/components/ui/confirm-dialog";
import { FinancialBreakdown } from "./financial-breakdown";
import {
  actionLabel,
  money,
  SAMPLE_REQUEST,
  type Scenario,
} from "../scenarios";

export function OperationDialog({
  scenario,
  onClose,
  onConfirm,
}: {
  scenario: Scenario;
  onClose: () => void;
  onConfirm: (observations: string) => void;
}) {
  const [observations, setObservations] = useState("");
  const reuse = scenario.id === "compatible",
    regenerate = scenario.id === "cancelled";
  const description = reuse
    ? "Se utilizará el préstamo ya vinculado para liquidar esta solicitud. Esta acción no genera otro préstamo."
    : regenerate
      ? "Se generará un reemplazo con las condiciones guardadas. La solicitud pasará a Liquidada cuando el alta quede confirmada."
      : "Se generará el préstamo con las condiciones guardadas. La solicitud pasará a Liquidada cuando el alta quede confirmada.";
  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={actionLabel(scenario)}
      description={description}
      confirmLabel={
        reuse
          ? "Confirmar liquidación"
          : regenerate
            ? "Confirmar regeneración y liquidación"
            : "Confirmar generación y liquidación"
      }
      onConfirm={() => onConfirm(observations.trim())}
      className="lab-operation-modal max-w-2xl p-5"
    >
      <div className="lab-modal-body">
        <div className="lab-modal-transition">
          <span className="lab-state-pill">
            <span />
            Confirmada
          </span>
          <ArrowRight size={18} />
          <span className="lab-state-pill is-liquidated">
            <span />
            Liquidada
          </span>
        </div>
        <section className="lab-modal-summary">
          <h3>{SAMPLE_REQUEST.name}</h3>
          <p>
            {SAMPLE_REQUEST.number} · {SAMPLE_REQUEST.line}
          </p>
          <dl>
            <div>
              <dt>Monto solicitado</dt>
              <dd>{money(SAMPLE_REQUEST.amount)}</dd>
            </div>
            <div>
              <dt>Plan de cuotas</dt>
              <dd>
                {SAMPLE_REQUEST.cuotas} × {money(SAMPLE_REQUEST.installment)}
              </dd>
            </div>
            <div>
              <dt>Cancelaciones</dt>
              <dd>{money(SAMPLE_REQUEST.cancellations)}</dd>
            </div>
            <div>
              <dt>Monto en mano</dt>
              <dd>
                {money(SAMPLE_REQUEST.amount - SAMPLE_REQUEST.cancellations)}
              </dd>
            </div>
            <div>
              <dt>Primer vencimiento</dt>
              <dd>{SAMPLE_REQUEST.firstDue}</dd>
            </div>
            <div>
              <dt>
                {reuse
                  ? "Préstamo existente"
                  : regenerate
                    ? "Préstamo que se reemplaza"
                    : "Préstamo por generar"}
              </dt>
              <dd>
                {scenario.core
                  ? "#" + scenario.core.id
                  : "Se vincula al confirmar el alta"}
              </dd>
            </div>
          </dl>
        </section>
        {reuse && (
          <p className="lab-modal-assurance">
            <CheckCircle2 size={17} />
            Se utilizará el préstamo #{scenario.core?.id}, sin crear otro.
          </p>
        )}
        {regenerate && (
          <div className="lab-modal-history">
            <History size={18} />
            <p>
              Se reemplazará el vínculo del préstamo anulado{" "}
              <strong>#{scenario.core?.id}</strong> por el nuevo. El préstamo
              anterior y su documentación quedarán en el historial. El nuevo
              continuará con firma y revisión del legajo.
            </p>
          </div>
        )}
        <FinancialBreakdown />
        <label className="lab-observations">
          <span>Observaciones (opcional)</span>
          <textarea
            rows={2}
            value={observations}
            onChange={(event) => setObservations(event.target.value)}
            placeholder="Podés agregar una observación para esta liquidación"
          />
        </label>
        <div className="lab-modal-audit">
          <ShieldCheck size={16} />
          <p>
            El usuario que confirma, la fecha, las condiciones y el préstamo
            asociado quedarán registrados automáticamente.
          </p>
        </div>
        <p className="lab-after-confirmation">
          Después continúa el circuito habitual de firma y revisión del legajo.
        </p>
      </div>
    </ConfirmDialog>
  );
}

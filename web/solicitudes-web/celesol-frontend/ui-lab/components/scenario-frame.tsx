import {
  ArrowRight,
  CheckCircle2,
  FileCheck2,
  Landmark,
  LoaderCircle,
  Search,
} from "lucide-react";
import { SolicitudDetailToolbar } from "@/modules/solicitudes-editor/components/SolicitudToolbar";
import { StyledSelect } from "@/modules/solicitudes-editor/components/fields/base";
import { Button } from "@/shared/components/ui/button";
import {
  actionLabel,
  canConfirm,
  money,
  SAMPLE_REQUEST,
  type Scenario,
} from "../scenarios";
import { ConditionAlert } from "./condition-alert";

export function ScenarioAction({
  scenario,
  onClick,
  compact = false,
}: {
  scenario: Scenario;
  onClick?: () => void;
  compact?: boolean;
}) {
  const Icon =
    scenario.id === "processing"
      ? LoaderCircle
      : scenario.id === "uncertain"
        ? Search
        : scenario.id === "success"
          ? CheckCircle2
          : Landmark;
  const disabled = !canConfirm(scenario) && scenario.id !== "uncertain";
  return (
    <Button
      type="button"
      size="sm"
      disabled={disabled}
      onClick={onClick}
      className={
        (compact ? "lab-compact-primary " : "") +
        (scenario.id === "success" ? "lab-completed-action" : "")
      }
    >
      <Icon
        size={15}
        className={scenario.id === "processing" ? "animate-spin" : undefined}
      />
      {actionLabel(scenario)}
    </Button>
  );
}

export function ScenarioFrame({
  scenario,
  onPrimary,
  onReconsult,
  onOtherAction,
  compact = false,
}: {
  scenario: Scenario;
  onPrimary?: () => void;
  onReconsult?: () => void;
  onOtherAction?: (action: string) => void;
  compact?: boolean;
}) {
  const locked = ["processing", "uncertain", "success"].includes(scenario.id);
  const state = scenario.id === "success" ? "Liquidada" : "Confirmada";
  return (
    <article
      className={"lab-product-frame " + (compact ? "is-compact" : "")}
      aria-label={"Interfaz: " + scenario.title}
    >
      <header className="lab-product-heading">
        <div>
          <span className="lab-beex-wordmark">beex</span>
          <span className="lab-product-context">
            Solicitud {SAMPLE_REQUEST.number}
          </span>
        </div>
        <span
          className={
            "lab-state-pill " + (state === "Liquidada" ? "is-liquidated" : "")
          }
        >
          <span />
          {state}
        </span>
      </header>
      {compact ? (
        <div className="lab-compact-actions">
          <ScenarioAction scenario={scenario} compact onClick={onPrimary} />
        </div>
      ) : (
        <div className="lab-product-toolbar">
          <SolicitudDetailToolbar
            canEdit={!locked}
            onOpenSimulador={() => onOtherAction?.("simulador")}
            onPreloadSimulador={() => undefined}
            onRefresh={locked ? undefined : onReconsult}
            onStartEdit={() => onOtherAction?.("editar")}
            attachmentsAction={{
              count: 4,
              onClick: () => onOtherAction?.("adjuntos"),
            }}
            transitionControl={
              <div className="lab-unified-actions">
                <ScenarioAction scenario={scenario} onClick={onPrimary} />
                <StyledSelect
                  ariaLabel="Otras acciones de la solicitud"
                  className="lab-other-actions !h-7 !min-h-7 !px-2.5 !py-0 text-[0.8rem]"
                  disabled={locked}
                  options={[
                    { value: "revisar", label: "Revisar" },
                    { value: "desestimar", label: "Desestimar" },
                  ]}
                  placeholder="Otras acciones"
                  value=""
                  onChange={(value) => onOtherAction?.(value)}
                />
              </div>
            }
          />
        </div>
      )}
      <div className="lab-product-body">
        <section className="lab-request-summary">
          <div className="lab-sample-person">
            <span>ME</span>
            <div>
              <h3>{SAMPLE_REQUEST.name}</h3>
              <p>{SAMPLE_REQUEST.line}</p>
            </div>
          </div>
          <div className="lab-request-amount">
            <strong>{money(SAMPLE_REQUEST.amount)}</strong>
            <span>
              {SAMPLE_REQUEST.cuotas} cuotas de{" "}
              {money(SAMPLE_REQUEST.installment)}
            </span>
          </div>
        </section>
        {!compact && (
          <div className="lab-core-reference">
            <span>Préstamo vinculado</span>
            <strong>
              {scenario.core
                ? "#" +
                  scenario.core.id +
                  (scenario.core.status === "cancelled"
                    ? " · Anulado"
                    : scenario.core.status === "unknown"
                      ? " · Sin verificar"
                      : " · Activo")
                : scenario.id === "uncertain"
                  ? "Resultado por verificar"
                  : scenario.id === "processing"
                    ? "Alta en curso"
                    : "Todavía no generado"}
            </strong>
          </div>
        )}
        <ConditionAlert
          scenario={scenario}
          compact={compact}
          onReconsult={onReconsult}
        />
        {scenario.id === "success" && !compact && (
          <div className="lab-audit-summary">
            <h4>Operación registrada</h4>
            <dl>
              <div>
                <dt>Usuario</dt>
                <dd>Operador de Riesgo</dd>
              </div>
              <div>
                <dt>Fecha</dt>
                <dd>26/10/2026 · 14:32</dd>
              </div>
              <div>
                <dt>Préstamo</dt>
                <dd>#{scenario.core?.id}</dd>
              </div>
              <div>
                <dt>Cambio de estado</dt>
                <dd>Confirmada → Liquidada</dd>
              </div>
              {scenario.operationMode === "replacement" && (
                <div>
                  <dt>Préstamo anterior</dt>
                  <dd>#999001 · Anulado</dd>
                </div>
              )}
            </dl>
          </div>
        )}
        {!compact && (
          <div className="lab-following-step">
            <FileCheck2 size={17} />
            <span>Después de Liquidada</span>
            <ArrowRight size={14} />
            <strong>Verificar firma y documentación</strong>
            <ArrowRight size={14} />
            <span>Transferir</span>
          </div>
        )}
      </div>
    </article>
  );
}

import { useEffect, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  FlaskConical,
  Grid2X2,
  LayoutPanelTop,
  RotateCcw,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { StyledSelect } from "@/modules/solicitudes-editor/components/fields/base";
import { OperationDialog } from "./components/operation-dialog";
import { ScenarioFrame } from "./components/scenario-frame";
import {
  canConfirm,
  getScenario,
  SCENARIOS,
  type Scenario,
  type ScenarioId,
} from "./scenarios";
import "./styles.css";

function initialParams() {
  return new URLSearchParams(window.location.search);
}

export function App() {
  const [selectedId, setSelectedId] = useState<ScenarioId>(
    () => getScenario(initialParams().get("scenario")).id,
  );
  const [view, setView] = useState<"detail" | "compare">(() =>
    initialParams().get("view") === "compare" ? "compare" : "detail",
  );
  const [modal, setModal] = useState<Scenario | null>(() => {
    const scenario = getScenario(initialParams().get("scenario"));
    return initialParams().get("modal") === "1" && canConfirm(scenario)
      ? scenario
      : null;
  });
  const [operationOrigin, setOperationOrigin] = useState<Scenario | null>(null);
  const [keepsCancelledAmount, setKeepsCancelledAmount] = useState(false);
  const [notice, setNotice] = useState("");
  const baseScenario = getScenario(selectedId);
  let scenario = baseScenario;
  if (selectedId === "cancelled" && keepsCancelledAmount && baseScenario.core) {
    scenario = {
      ...baseScenario,
      core: {
        ...baseScenario.core,
        amount: 600000,
        cuotas: 12,
        capital: 660000,
      },
    };
  }
  if (
    (selectedId === "processing" || selectedId === "uncertain") &&
    operationOrigin
  ) {
    scenario = {
      ...baseScenario,
      core: operationOrigin.core,
      ...(selectedId === "uncertain" && operationOrigin.id === "compatible"
        ? { title: "Resultado de liquidación incierto" }
        : {}),
      operationMode:
        operationOrigin.id === "compatible"
          ? "reuse"
          : operationOrigin.id === "cancelled"
            ? "replacement"
            : "new",
    };
  }
  if (selectedId === "success" && operationOrigin) {
    scenario = {
      ...baseScenario,
      core:
        operationOrigin.id === "compatible"
          ? operationOrigin.core
          : baseScenario.core,
      operationMode:
        operationOrigin.id === "compatible"
          ? "reuse"
          : operationOrigin.id === "cancelled"
            ? "replacement"
            : "new",
    };
  }

  useEffect(() => {
    const params = new URLSearchParams();
    params.set("scenario", selectedId);
    if (view === "compare") params.set("view", "compare");
    window.history.replaceState(
      {},
      "",
      window.location.pathname + "?" + params.toString(),
    );
  }, [selectedId, view]);

  function selectCase(id: ScenarioId) {
    setSelectedId(id);
    setOperationOrigin(null);
    setKeepsCancelledAmount(false);
    setModal(null);
    setNotice("");
  }
  function openCase(id: ScenarioId) {
    selectCase(id);
    setView("detail");
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  function verifyResult() {
    const loanId =
      operationOrigin?.id === "compatible"
        ? (operationOrigin.core?.id ?? "999001")
        : "999002";
    setSelectedId("success");
    setNotice(
      "Simulación local: se verificó el resultado completo del mismo intento. El préstamo #" +
        loanId +
        " quedó vinculado y la solicitud está Liquidada. No se generó otro préstamo al consultar.",
    );
  }
  function primary(target: Scenario) {
    if (canConfirm(target)) setModal(target);
    else if (target.id === "uncertain") verifyResult();
  }
  function confirmOperation(observations: string) {
    if (!modal || !canConfirm(modal)) return;
    setOperationOrigin(modal);
    setModal(null);
    setSelectedId("processing");
    setView("detail");
    setNotice(
      "Simulación local iniciada. Elegí un resultado en Controles del laboratorio." +
        (observations
          ? " La observación se conserva sólo en esta demostración."
          : ""),
    );
  }
  function simulateResult(id: "success" | "uncertain") {
    setSelectedId(id);
    setNotice(
      id === "success"
        ? "Simulación local: operación completada. No se generó ningún préstamo real."
        : "Simulación local: respuesta perdida. La interfaz mantiene bloqueada otra generación.",
    );
  }
  function reconsult() {
    setNotice(
      "Reconsulta simulada: se mantiene el resultado del escenario seleccionado. Podés cambiarlo desde los controles del laboratorio.",
    );
  }

  return (
    <div
      className={"beex-ui-lab " + (view === "compare" ? "is-comparison" : "")}
    >
      <header className="lab-header">
        <div className="lab-header-brand">
          <span className="lab-flask">
            <FlaskConical size={20} />
          </span>
          <div>
            <strong>Beex · UI Lab</strong>
            <span>Generación y liquidación</span>
          </div>
        </div>
        <div className="lab-safe-badge">
          <ShieldCheck size={14} />
          <span>Prototipo local · datos ficticios</span>
        </div>
      </header>
      <div className="lab-workspace">
        <aside className="lab-sidebar">
          <div className="lab-sidebar-title">
            <span>ESCENARIOS</span>
            <span>09</span>
          </div>
          <nav aria-label="Escenarios de la interfaz">
            {SCENARIOS.map((item, index) => (
              <button
                key={item.id}
                type="button"
                onClick={() => openCase(item.id)}
                className={
                  "lab-scenario-nav " +
                  (selectedId === item.id && view === "detail"
                    ? "is-selected"
                    : "")
                }
                aria-current={
                  selectedId === item.id && view === "detail"
                    ? "page"
                    : undefined
                }
              >
                <span className={"lab-scenario-number tone-" + item.tone}>
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span>{item.shortTitle}</span>
                <ChevronRight size={13} />
              </button>
            ))}
          </nav>
          <div className="lab-sidebar-foot">
            <strong>Alcance de la maqueta</strong>
            <p>
              Un solo botón operativo. La firma continúa después de Liquidada.
            </p>
            <p>Las simulaciones no modifican Beex ni Vimarx.</p>
          </div>
        </aside>
        <main className="lab-main">
          <section className="lab-page-title">
            <div>
              <p>MAQUETA PARA REVISIÓN · SIN IMPLEMENTAR</p>
              <h1>
                {view === "compare"
                  ? "Todos los casos de la misma operación"
                  : "Generar préstamo y liquidar"}
              </h1>
              <span>
                {view === "compare"
                  ? "Comparación de estados, bloqueos y acciones visibles."
                  : "Revisá cómo responde la interfaz según el préstamo que ya exista."}
              </span>
            </div>
            <div className="lab-view-switch" aria-label="Vista del laboratorio">
              <button
                type="button"
                aria-pressed={view === "detail"}
                onClick={() => setView("detail")}
              >
                <LayoutPanelTop size={15} />
                Un caso
              </button>
              <button
                type="button"
                aria-pressed={view === "compare"}
                onClick={() => setView("compare")}
              >
                <Grid2X2 size={15} />
                Comparar casos
              </button>
            </div>
          </section>
          <div className="lab-mobile-selector">
            <StyledSelect
              ariaLabel="Elegir escenario de laboratorio"
              value={selectedId}
              onChange={(value) => openCase(value as ScenarioId)}
              options={SCENARIOS.map((item, index) => ({
                value: item.id,
                label:
                  String(index + 1).padStart(2, "0") + " · " + item.shortTitle,
              }))}
            />
          </div>
          {view === "compare" ? (
            <section
              className="lab-comparison-grid"
              aria-label="Comparativa de los nueve casos"
            >
              {SCENARIOS.map((item, index) => (
                <div key={item.id} className="lab-comparison-card">
                  <header className="lab-comparison-title">
                    <span>
                      {String(index + 1).padStart(2, "0")} · {item.shortTitle}
                    </span>
                    <span className={"lab-tag tone-" + item.tone}>
                      {item.tag}
                    </span>
                  </header>
                  <ScenarioFrame
                    scenario={item}
                    compact
                    onPrimary={() => primary(item)}
                  />
                  <button
                    className="lab-open-case"
                    type="button"
                    onClick={() => openCase(item.id)}
                  >
                    Ver interfaz completa <ArrowRight size={13} />
                  </button>
                </div>
              ))}
            </section>
          ) : (
            <>
              <section className="lab-case-heading">
                <div>
                  <span className={"lab-tag tone-" + scenario.tone}>
                    {scenario.tag}
                  </span>
                  <h2>{scenario.title}</h2>
                  <p>{scenario.description}</p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => selectCase(selectedId)}
                >
                  <RotateCcw size={14} />
                  Restablecer caso
                </Button>
              </section>
              <ScenarioFrame
                scenario={scenario}
                onPrimary={() => primary(scenario)}
                onReconsult={reconsult}
                onOtherAction={(action) =>
                  setNotice(
                    "Control ilustrativo: " +
                      action +
                      ". En esta maqueta sólo se simula la operación de generación y liquidación.",
                  )
                }
              />
              <section
                className="lab-simulator-controls"
                aria-label="Controles del laboratorio"
              >
                <div>
                  <FlaskConical size={15} />
                  <strong>Controles del laboratorio</strong>
                  <span>Fuera de la interfaz de producto</span>
                </div>
                <div className="lab-simulator-buttons">
                  {scenario.id === "processing" && (
                    <>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => simulateResult("success")}
                      >
                        Simular resultado confirmado
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => simulateResult("uncertain")}
                      >
                        Simular respuesta perdida
                      </Button>
                    </>
                  )}
                  {[
                    "amount-mismatch",
                    "conditions-mismatch",
                    "unverifiable",
                  ].includes(scenario.id) && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        selectCase("cancelled");
                        setNotice(
                          "Simulación local: Vimarx confirma la anulación, sin vigencia y con saldo cero.",
                        );
                      }}
                    >
                      Simular anulación confirmada
                    </Button>
                  )}
                  {scenario.id === "cancelled" && (
                    <label className="lab-fixture-checkbox">
                      <input
                        type="checkbox"
                        checked={keepsCancelledAmount}
                        onChange={(event) =>
                          setKeepsCancelledAmount(event.target.checked)
                        }
                      />
                      Simular que Core conserva $600.000 después de anular
                    </label>
                  )}
                  {scenario.id === "uncertain" && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={verifyResult}
                    >
                      Simular resultado verificado
                    </Button>
                  )}
                  {["new", "compatible", "success"].includes(scenario.id) && (
                    <p>
                      Elegí un escenario o usá el botón operativo para revisar
                      su confirmación.
                    </p>
                  )}
                </div>
                {scenario.id === "compatible" && (
                  <p className="lab-fixture-note">
                    Caso de control: monto solicitado de $600.000 y capital
                    financiado de $660.000. Los gastos incluidos en el capital
                    no provocan un falso bloqueo.
                  </p>
                )}
                {scenario.id === "cancelled" && (
                  <p className="lab-fixture-note">
                    La regeneración está disponible para quien ya puede
                    liquidar; no agrega un permiso de administrador. El estado
                    anulado prevalece aunque Core conserve o deje en cero sus
                    importes.
                  </p>
                )}
              </section>
            </>
          )}
          {notice && (
            <p className="lab-notice" role="status">
              <CheckCircle2 size={16} />
              <span>{notice}</span>
            </p>
          )}
          <footer className="lab-footer">
            <ShieldCheck size={13} />
            <span>
              Componentes actuales de Beex con datos de ejemplo. Las acciones
              sólo cambian el estado de esta maqueta.
            </span>
          </footer>
        </main>
      </div>
      {modal && (
        <OperationDialog
          key={modal.id}
          scenario={modal}
          onClose={() => setModal(null)}
          onConfirm={confirmOperation}
        />
      )}
    </div>
  );
}

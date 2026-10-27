import { useState } from "react";
import { Bell, FlaskConical, RefreshCw } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { SignatureStatusCard } from "@/modules/solicitudes-core/components/signature-status-card";
import { LinkedLoanStatusBanner } from "@/modules/solicitudes-core/components/linked-loan-status-banner";
import { SolicitudDetailToolbar } from "@/modules/solicitudes-editor/components/SolicitudToolbar";
import {
  NotificationBellButton,
  NotificationItems,
} from "@/modules/notifications/notification-center";
import {
  PopoverRoot,
  PopoverTrigger,
  PopoverContent,
} from "@/shared/components/ui/popover";
import { SignatureInboxTable } from "@/modules/solicitudes-core/pages/signature-inbox-page";
import { SCENARIOS, getScenario, type Scenario } from "./scenarios";
import "./styles.css";

type Notice = {
  id: number;
  title: string;
  body: string;
  target: string;
  read: boolean;
};
export function App() {
  const initial = new URLSearchParams(window.location.search);
  const [scenario, setScenario] = useState<Scenario>(() =>
    getScenario(initial.get("scenario")),
  );
  const [compare, setCompare] = useState(initial.get("view") === "compare");
  const [role, setRole] = useState("vendedor");
  const [reason, setReason] = useState("");
  const [notices, setNotices] = useState<Notice[]>([]);
  const [history, setHistory] = useState<string[]>([]);
  const [notice, setNotice] = useState("");
  const notificationItems = notices.map((item) => ({
    id: String(item.id),
    title: item.title,
    body: item.body,
    solicitudId: "demo",
    createdAt: new Date(item.id).toISOString(),
    readAt: item.read ? new Date(item.id).toISOString() : null,
    kind: "demo",
  }));
  const markRead = (id: string) =>
    setNotices((items) =>
      items.map((item) =>
        String(item.id) === id ? { ...item, read: true } : item,
      ),
    );
  const canFinish =
    scenario.loan.status === "active" && scenario.loan.matchesAmount;
  function record(title: string, body: string, target: string) {
    setNotices((items) => [
      { id: Date.now(), title, body, target, read: false },
      ...items,
    ]);
    setHistory((items) => [title + ": " + body, ...items]);
  }
  function select(id: string) {
    setScenario(getScenario(id));
    setNotices([]);
    setHistory([]);
    setReason("");
    setNotice("");
    const params = new URLSearchParams({ scenario: id });
    if (compare) params.set("view", "compare");
    window.history.replaceState({}, "", "?" + params.toString());
  }
  function generate() {
    if (Number(scenario.loan.requestedAmount) <= 0) {
      setNotice(
        "Ingresá un monto mayor que cero antes de generar el préstamo.",
      );
      return;
    }
    const replaced = scenario.loan.status === "cancelled";
    const id = replaced ? "999002" : "999001";
    setScenario((item) => ({
      ...item,
      loan: {
        ...item.loan,
        status: "active",
        currentLoanId: id,
        amount: item.loan.requestedAmount,
        matchesAmount: true,
        amountEditable: false,
      },
      signature: {
        ...item.signature,
        status: "waiting",
        approved: false,
        completedAttempts: 0,
        lastCompletedAt: null,
        reason: null,
        cycle: id,
        link: `https://firma.invalid/demo-${id}`,
      },
    }));
    record(
      "Enlace disponible",
      `El préstamo ${id} ya tiene un enlace para que firme el socio.`,
      "Vendedor",
    );
    setNotice(
      "El préstamo quedó generado. La solicitud permanece en Confirmada.",
    );
  }
  function finishAnalysis() {
    if (!canFinish) return;
    setScenario((item) => ({
      ...item,
      analysisReady: true,
      state: item.signature.approved
        ? "Transferir"
        : "VerificarFirmaYDocumentacion",
    }));
    setHistory((items) => [
      "Análisis terminado: " +
        (scenario.signature.approved
          ? "pasa a Para transferir."
          : "queda esperando revisión de firma."),
      ...items,
    ]);
  }
  function submit() {
    setScenario((item) => ({
      ...item,
      signature: {
        ...item.signature,
        completedAttempts: item.signature.completedAttempts + 1,
        lastCompletedAt: new Date().toISOString(),
        status: item.signature.approved ? "approved" : "to_review",
      },
    }));
    record(
      "Nueva firma enviada",
      "El socio completó un nuevo envío de firma. Revisá el intento vigente.",
      "Legajos Digitales",
    );
  }
  function approve() {
    if (!scenario.signature.completedAttempts) return;
    setScenario((item) => ({
      ...item,
      state: item.analysisReady ? "Transferir" : item.state,
      signature: {
        ...item.signature,
        status: "approved",
        approved: true,
        decisionId: "demo-approved",
        reason: null,
      },
    }));
    setHistory((items) => [
      "Legajos aprobó la firma" +
        (scenario.analysisReady
          ? ": pase automático a Para transferir."
          : ": el análisis sigue en curso."),
      ...items,
    ]);
  }
  function request() {
    if (!reason.trim()) return;
    setScenario((item) => ({
      ...item,
      signature: {
        ...item.signature,
        status: "requested_again",
        approved: false,
        completedAttempts: 0,
        lastCompletedAt: null,
        decisionId: null,
        cycle: String(Date.now()),
        reason: reason.trim(),
      },
    }));
    record("Se necesita una nueva firma", reason.trim(), "Vendedor");
    setReason("");
  }
  return (
    <div className="lab-shell">
      <header className="lab-heading">
        <PopoverRoot>
          <PopoverTrigger asChild>
            <NotificationBellButton
              count={notices.filter((item) => !item.read).length}
            />
          </PopoverTrigger>
          <PopoverContent align="end" className="w-96 p-0">
            <div className="border-b border-border p-3 font-semibold">
              Notificaciones en Beex
            </div>
            {notificationItems.length ? (
              <NotificationItems
                items={notificationItems}
                onOpen={(item) => markRead(item.id)}
                compact
              />
            ) : (
              <p className="p-4 text-sm">No hay notificaciones todavía.</p>
            )}
          </PopoverContent>
        </PopoverRoot>
        <div>
          <span className="lab-eyebrow">
            <FlaskConical className="size-4" />
            Laboratorio local · datos ficticios
          </span>
          <h1>Préstamos, análisis y firma digital</h1>
          <p>
            Generar el préstamo y terminar el análisis son acciones separadas.
            Este laboratorio no realiza operaciones reales.
          </p>
        </div>
        <Button variant="outline" onClick={() => setCompare(!compare)}>
          {compare ? "Ver caso" : "Comparar escenarios"}
        </Button>
      </header>
      <div className="lab-controls">
        <label>
          Escenario
          <select
            value={scenario.id}
            onChange={(event) => select(event.target.value)}
          >
            {SCENARIOS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          Vista de trabajo
          <select
            value={role}
            onChange={(event) => setRole(event.target.value)}
          >
            <option value="vendedor">Vendedor</option>
            <option value="analista">Analista</option>
            <option value="legajos">Legajos Digitales</option>
          </select>
        </label>
        <Button variant="outline" onClick={() => select(scenario.id)}>
          <RefreshCw className="size-4" />
          Restablecer
        </Button>
      </div>
      {!compare && role === "legajos" && (
        <section className="mb-6 space-y-3">
          <h2 className="text-lg font-semibold">Inbox de Legajos Digitales</h2>
          <p className="text-sm text-foreground-secondary">
            Esperando firma, para revisar, nueva firma solicitada y aprobados;
            con el análisis en paralelo.
          </p>
          <SignatureInboxTable
            items={SCENARIOS.filter(
              (item) =>
                item.loan.status === "active" && item.loan.matchesAmount,
            ).map((item, index) => ({
              solicitudId: item.id,
              nroSolicitud: `DEMO-${index + 1001}`,
              prestamoId: String(999001 + index),
              socio: `Socio de ejemplo ${index + 1}`,
              vendedor: "Vendedor de ejemplo",
              monto: 600000,
              status: item.signature.status,
              completedAttempts: item.signature.completedAttempts,
              lastCompletedAt: item.signature.lastCompletedAt,
              analysisReady: item.analysisReady,
              reason: item.signature.reason,
            }))}
            selected={scenario.id}
            onReview={select}
          />
        </section>
      )}
      {compare ? (
        <div className="lab-comparison">
          {SCENARIOS.map((item) => (
            <article key={item.id} className="lab-case">
              <h2>{item.title}</h2>
              <LinkedLoanStatusBanner
                data={item.loan}
                loading={false}
                failed={false}
                retry={() => select(item.id)}
              />
              <SignatureStatusCard
                signature={item.signature}
                analysisReady={item.analysisReady}
              />
              <Button
                variant="outline"
                onClick={() => {
                  select(item.id);
                  setCompare(false);
                }}
              >
                Explorar este caso
              </Button>
            </article>
          ))}
        </div>
      ) : (
        <div className="lab-columns">
          <article className="lab-detail">
            <div className="lab-detail-heading">
              <div>
                <h2>Solicitud DEMO-1001</h2>
                <p>
                  Ana Ejemplo · Préstamo{" "}
                  {scenario.loan.currentLoanId ?? "sin generar"}
                </p>
              </div>
              <span>
                {scenario.state === "VerificarFirmaYDocumentacion"
                  ? "Revisión de firma"
                  : scenario.state === "Transferir"
                    ? "Para transferir"
                    : scenario.state}
              </span>
            </div>
            {role === "analista" && (
              <SolicitudDetailToolbar
                isPrestamoLegacyGenerado={scenario.loan.status === "active"}
                onCreatePrestamoLegacy={
                  scenario.loan.status === "cancelled" ? undefined : generate
                }
                onOpenSimulador={() =>
                  setNotice(
                    "El simulador continúa separado de la generación del préstamo.",
                  )
                }
                onPreloadSimulador={() => undefined}
                analysisAction={
                  !scenario.analysisReady
                    ? {
                        label: scenario.signature.approved
                          ? "Mandar a transferir"
                          : "Mandar a revisar firma",
                        disabled: !canFinish,
                        disabledReason: !canFinish
                          ? "Se requiere préstamo vigente y mismo monto."
                          : undefined,
                        onClick: finishAnalysis,
                      }
                    : undefined
                }
              />
            )}
            <LinkedLoanStatusBanner
              data={scenario.loan}
              loading={false}
              failed={false}
              retry={() =>
                setNotice(
                  "Simulación: Vimarx sigue sin responder. El monto y el avance permanecen bloqueados.",
                )
              }
            />
            {scenario.loan.status === "cancelled" && role === "analista" && (
              <div className="lab-padding">
                <Button onClick={generate}>
                  Regenerar préstamo y reemplazar el anterior
                </Button>
              </div>
            )}
            <div className="lab-padding">
              <label className="lab-amount">
                Monto a financiar
                <input
                  aria-label="Monto a financiar"
                  type="number"
                  min="1"
                  value={scenario.loan.requestedAmount ?? ""}
                  onChange={(event) =>
                    setScenario((item) => ({
                      ...item,
                      loan: {
                        ...item.loan,
                        requestedAmount: Number(event.target.value),
                        matchesAmount:
                          Number(item.loan.amount) ===
                          Number(event.target.value),
                      },
                    }))
                  }
                  disabled={
                    !scenario.loan.amountEditable || role !== "analista"
                  }
                />
              </label>
              <SignatureStatusCard
                key={scenario.signature.cycle}
                signature={scenario.signature}
                analysisReady={scenario.analysisReady}
              />
              {role === "legajos" && (
                <div className="lab-review">
                  <h3>Revisión de Legajos Digitales</h3>
                  <p>
                    En la aplicación se muestra aquí la evidencia del intento
                    seleccionado.
                  </p>
                  <Button
                    disabled={
                      !scenario.signature.completedAttempts ||
                      scenario.signature.approved
                    }
                    onClick={approve}
                  >
                    {scenario.analysisReady
                      ? "Aprobar y mandar a transferir"
                      : "Aprobar firma"}
                  </Button>
                  <label>
                    Motivo para solicitar una nueva firma
                    <textarea
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                      placeholder="Por ejemplo: el DNI quedó borroso."
                    />
                  </label>
                  <Button
                    variant="outline"
                    disabled={!reason.trim()}
                    onClick={request}
                  >
                    Solicitar nueva firma
                  </Button>
                </div>
              )}
              {notice && (
                <p className="lab-notice" role="status">
                  {notice}
                </p>
              )}
              <details>
                <summary>Historial de esta demostración</summary>
                <ul>
                  {history.map((item, index) => (
                    <li key={index}>{item}</li>
                  ))}
                </ul>
              </details>
            </div>
          </article>
          <aside className="space-y-4">
            <section className="lab-box">
              <h2>Controles de la simulación</h2>
              <p>
                Simulá una firma completa para comprobar las tildes, los avisos
                y ambos órdenes de trabajo.
              </p>
              <Button
                disabled={
                  scenario.loan.status !== "active" ||
                  !scenario.loan.matchesAmount
                }
                onClick={submit}
              >
                {scenario.signature.approved
                  ? "Simular firma adicional"
                  : "Simular firma enviada"}
              </Button>
            </section>
            <section className="lab-box">
              <h2>
                <Bell className="size-4" />
                Notificaciones en Beex
              </h2>
              {notices.length === 0 && (
                <p>Los avisos de este escenario aparecerán aquí.</p>
              )}
              <NotificationItems
                items={notificationItems}
                onOpen={(item) => markRead(item.id)}
              />
              <p className="text-xs">
                Leer un aviso no resuelve la tarea de firma.
              </p>
            </section>
          </aside>
        </div>
      )}
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import { BrowserRouter } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  FileText,
  Menu,
  Settings,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { AppTopbar } from "@/app/layouts/app-topbar";
import { AppSidebar } from "@/app/layouts/app-sidebar";
import { DatosRapidosSolicitante } from "@/modules/solicitudes-core/components/datos-rapidos-solicitante";
import { DocumentReviewPanel } from "@/modules/solicitudes-core/components/document-review-panel";
import { SolicitudDetailToolbar } from "@/modules/solicitudes-editor/components/SolicitudToolbar";
import { StyledSelect } from "@/modules/solicitudes-editor/components/fields/base";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import {
  PopoverRoot,
  PopoverTrigger,
  PopoverContent,
} from "@/shared/components/ui/popover";
import { HEADER_SAMPLE } from "./header-fixtures";
import "./header-gallery.css";

const DESIGNS = [
  {
    id: "current",
    label: "Actual",
    description: "Barra global de 64 px y encabezado completo fijo.",
  },
  {
    id: "slim",
    label: "A · Barra compacta",
    description: "Barra global de 40 px. Datos de la solicitud plegables.",
  },
  {
    id: "merged",
    label: "B · Encabezado integrado",
    description: "Menú, navegación, persona y usuario en una sola cabecera.",
  },
  {
    id: "focus",
    label: "C · Vista de lectura",
    description:
      "Identificación y pestañas visibles. Datos y acciones a demanda.",
  },
] as const;
type Design = (typeof DESIGNS)[number]["id"];
type Tab = "solicitud" | "evaluacion" | "credixsa";
const params = () => new URLSearchParams(window.location.search);
function initialDesign(): Design {
  const value = params().get("layout");
  return DESIGNS.find((design) => design.id === value)?.id ?? "merged";
}

function DemoAccount() {
  return (
    <PopoverRoot>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="icon" aria-label="Usuario">
          <span className="header-demo-avatar">SD</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64">
        <strong>SOFÍA DEMO</strong>
        <p className="text-sm text-foreground-secondary">
          Operadora · cuenta de ejemplo
        </p>
        <p className="mt-2 text-xs text-foreground-muted">
          Vista local de diseño
        </p>
      </PopoverContent>
    </PopoverRoot>
  );
}

function RequestDetails({ tab }: { tab: Tab }) {
  if (tab === "evaluacion")
    return (
      <section className="rounded-lg border border-border bg-surface p-4">
        <h2 className="font-semibold">Evaluación de la solicitud</h2>
        <p className="mt-1 text-sm text-foreground-secondary">
          Vista de ejemplo para comparar el espacio disponible.
        </p>
        <table className="header-demo-table">
          <thead>
            <tr>
              <th>Concepto</th>
              <th>Valor</th>
            </tr>
          </thead>
          <tbody>
            {[
              ["Ingreso declarado", "$ 1.250.000"],
              ["Descuentos", "$ 280.000"],
              ["Ingreso disponible", "$ 970.000"],
              ["Monto solicitado", "$ 500.000"],
              ["Cantidad de cuotas", "12"],
              ["Cuota estimada", "$ 65.000"],
            ].map(([label, value]) => (
              <tr key={label}>
                <td>{label}</td>
                <td>{value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    );
  if (tab === "credixsa")
    return (
      <section className="rounded-lg border border-border bg-surface p-4">
        <h2 className="font-semibold">Informe CredixSA</h2>
        <p className="mt-1 text-sm text-foreground-secondary">
          Informe de ejemplo · sin consulta externa
        </p>
        <table className="header-demo-table">
          <thead>
            <tr>
              <th>Control</th>
              <th>Resultado</th>
            </tr>
          </thead>
          <tbody>
            {[
              "Identificación",
              "Situación crediticia",
              "Antecedentes de pago",
              "Consultas recientes",
              "Endeudamiento informado",
              "Información laboral",
            ].map((label) => (
              <tr key={label}>
                <td>{label}</td>
                <td>Sin observaciones en este ejemplo</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    );
  return (
    <>
      <DocumentReviewPanel solicitudId={HEADER_SAMPLE.id} />
      <section className="rounded-lg border border-border bg-surface p-4">
        <h2 className="font-semibold">Solicitud</h2>
        <dl className="header-demo-fields">
          {[
            ["Número", HEADER_SAMPLE.number],
            ["Convenio", HEADER_SAMPLE.convenio],
            ["Monto solicitado", "$ 500.000"],
            ["Cuotas", "12"],
            ["Cuota", "$ 65.000"],
            ["Vendedor", "Equipo de ejemplo"],
            ["Fecha de alta", "23/10/2026"],
            ["Estado", HEADER_SAMPLE.state],
          ].map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section
        className="rounded-lg border border-border bg-surface p-4"
        id="header-demo-attachments"
      >
        <h2 className="font-semibold">Adjuntos (6)</h2>
        <table className="header-demo-table">
          <thead>
            <tr>
              <th>Documento</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {[
              "DNI · frente",
              "DNI · dorso",
              "Recibo de sueldo",
              "Solicitud firmada",
              "Anexo firmado",
              "Comprobante",
            ].map((label) => (
              <tr key={label}>
                <td>{label}</td>
                <td>Disponible en el ejemplo</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}

function HeaderGallery() {
  const client = useQueryClient();
  const [design, setDesign] = useState<Design>(initialDesign);
  const [expanded, setExpanded] = useState(
    () => params().get("expanded") === "1",
  );
  const [actionsOpen, setActionsOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("solicitud");
  const [notice, setNotice] = useState("");
  const [clean, setClean] = useState(() => params().get("clean") === "1");
  const [viewport, setViewport] = useState(() =>
    params().get("size") === "mobile" ? "mobile" : "desktop",
  );
  const [readingHeight, setReadingHeight] = useState(0);
  const [smallScreen, setSmallScreen] = useState(() => window.innerWidth < 768);
  const embedded = params().get("embed") === "1";
  const content = useRef<HTMLDivElement>(null);
  const baseline = design === "current";
  const showDetails = baseline || expanded;
  const designInfo = DESIGNS.find((candidate) => candidate.id === design)!;

  useEffect(() => {
    const search = new URLSearchParams({ layout: design });
    if (expanded) search.set("expanded", "1");
    if (clean) search.set("clean", "1");
    if (viewport === "mobile") search.set("size", "mobile");
    if (embedded) search.set("embed", "1");
    window.history.replaceState({}, "", "/headers?" + search.toString());
    document.title = `${designInfo.label} · Beex UI Lab`;
  }, [design, expanded, clean, viewport, designInfo.label, embedded]);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");
    const change = () => setSmallScreen(media.matches);
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  useEffect(() => {
    if (!content.current) return;
    const observer = new ResizeObserver(([entry]) =>
      setReadingHeight(Math.round(entry.contentRect.height)),
    );
    observer.observe(content.current);
    return () => observer.disconnect();
  }, [tab, viewport]);

  function selectDesign(next: Design) {
    setDesign(next);
    setExpanded(false);
    setActionsOpen(false);
    setNotice("");
    setSidebarOpen(false);
  }
  function simulate(action: string) {
    setNotice(`${action}: demostración local; no se modifican datos.`);
  }
  const disclosure = (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-expanded={showDetails}
      aria-controls="header-demo-details"
      onClick={() => setExpanded((value) => !value)}
    >
      {showDetails ? <ChevronUp /> : <ChevronDown />}
      {showDetails ? "Ocultar encabezado" : "Mostrar encabezado"}
    </Button>
  );
  const identity = (
    <div className="header-identity">
      <h1>{HEADER_SAMPLE.name}</h1>
      <span>
        DNI {HEADER_SAMPLE.document}
        <span className="header-loan-reference">
          {" "}
          · Préstamo {HEADER_SAMPLE.loanId}
        </span>
      </span>
    </div>
  );
  const toolbar = (
    <SolicitudDetailToolbar
      canEdit
      onOpenSimulador={() => simulate("Simulador")}
      onPreloadSimulador={() => undefined}
      onRefresh={() => {
        void client.invalidateQueries();
        simulate("Datos actualizados");
      }}
      onStartEdit={() => simulate("Editar solicitud")}
      onCreateSocio={showDetails ? () => simulate("Crear socio") : undefined}
      onCreatePrestamoLegacy={() => undefined}
      isPrestamoLegacyGenerado
      attachmentsAction={{
        count: 6,
        onClick: () => {
          setTab("solicitud");
          requestAnimationFrame(() =>
            document
              .getElementById("header-demo-attachments")
              ?.scrollIntoView({ block: "start", behavior: "smooth" }),
          );
        },
      }}
      transitionControl={
        showDetails ? (
          <StyledSelect
            disabled
            options={[]}
            placeholder="Sin acciones disponibles"
            value=""
            onChange={() => undefined}
          />
        ) : undefined
      }
    />
  );

  return (
    <main className={`header-lab ${clean ? "is-clean" : ""}`}>
      {!clean && (
        <section
          className="header-lab-controls"
          aria-label="Controles del laboratorio"
        >
          <div className="header-lab-title">
            <strong>Beex · Diseños de cabecera</strong>
            <span>UI local · datos ficticios</span>
            <a href="/">Otros escenarios</a>
          </div>
          <div className="header-lab-options">
            <div role="group" aria-label="Diseño">
              {DESIGNS.map((item) => (
                <Button
                  key={item.id}
                  type="button"
                  size="sm"
                  variant={design === item.id ? "default" : "outline"}
                  aria-pressed={design === item.id}
                  onClick={() => selectDesign(item.id)}
                >
                  {item.label}
                </Button>
              ))}
            </div>
            <div role="group" aria-label="Tamaño de prueba">
              <Button
                type="button"
                size="sm"
                variant="outline"
                aria-pressed={viewport === "desktop"}
                onClick={() => setViewport("desktop")}
              >
                Escritorio
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                aria-pressed={viewport === "mobile"}
                onClick={() => setViewport("mobile")}
              >
                390 px
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setClean(true)}
              >
                Vista limpia
              </Button>
            </div>
          </div>
          <div className="header-lab-caption">
            <span>{designInfo.description}</span>
            <output aria-live="polite">
              {viewport === "mobile"
                ? "Viewport real de 390 px"
                : `Área de lectura: ${readingHeight} px de alto`}
            </output>
          </div>
        </section>
      )}
      <div
        className={`header-device ${viewport === "mobile" ? "is-mobile" : ""}`}
      >
        {viewport === "mobile" && !embedded ? (
          <iframe
            title="Vista móvil de la solicitud, 390 píxeles"
            className="header-mobile-frame"
            src={`/headers?layout=${design}&clean=1&embed=1`}
          />
        ) : (
          <>
            <div
              className={`header-product design-${design}`}
              data-testid="header-product"
            >
              {(baseline || design === "slim") && (
                <div
                  className="header-global-bar"
                  data-testid="global-bar"
                  onClickCapture={(event) => {
                    const target = (event.target as Element).closest("button");
                    if (
                      target &&
                      /Mis datos|Desconectarse/.test(target.textContent ?? "")
                    ) {
                      event.preventDefault();
                      event.stopPropagation();
                      simulate("Cuenta de ejemplo");
                    }
                  }}
                >
                  <AppTopbar
                    onToggleSidebar={() => setSidebarOpen((value) => !value)}
                    titleIcon={FileText}
                    titleBadge="Solicitudes Históricas"
                  />
                </div>
              )}
              <div className="header-workspace">
                {sidebarOpen && (
                  <div
                    className={`header-sidebar ${smallScreen ? "is-overlay" : ""}`}
                    onClickCapture={(event) => {
                      const link = (event.target as Element).closest("a");
                      if (link) {
                        event.preventDefault();
                        event.stopPropagation();
                        simulate(`Navegación a ${link.textContent?.trim()}`);
                        setSidebarOpen(false);
                      }
                    }}
                  >
                    <AppSidebar
                      isDesktop={!smallScreen}
                      isOpen
                      onClose={() => setSidebarOpen(false)}
                    />
                  </div>
                )}
                <article className="header-request">
                  {baseline || design === "slim" ? (
                    <header className="header-detail-title">
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        aria-label="Volver al listado"
                        onClick={() => simulate("Volver al listado")}
                      >
                        <ArrowLeft />
                      </Button>
                      <FileText className="header-file-icon" />
                      <h1>Detalle de Solicitud</h1>
                      <span className="header-title-reference">
                        Solicitud ID <code>demo…0241</code>
                      </span>
                      <span className="header-title-reference">
                        Préstamo <code>{HEADER_SAMPLE.loanId}</code>
                      </span>
                      <Badge className="ml-auto" dot variant="neutral">
                        Pagada
                      </Badge>
                    </header>
                  ) : (
                    <header
                      className="header-unified"
                      data-testid="unified-header"
                    >
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label="Mostrar u ocultar menú lateral"
                        onClick={() => setSidebarOpen((value) => !value)}
                      >
                        <Menu />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="header-back"
                        onClick={() => simulate("Volver a históricas")}
                      >
                        <ArrowLeft />
                        <span>Históricas</span>
                      </Button>
                      {identity}
                      <Badge dot variant="neutral">
                        Pagada
                      </Badge>
                      <DemoAccount />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label="Configuración"
                        onClick={() => simulate("Configuración")}
                      >
                        <Settings />
                      </Button>
                    </header>
                  )}
                  <div id="header-demo-details" hidden={!showDetails}>
                    <DatosRapidosSolicitante
                      solicitudId={HEADER_SAMPLE.id}
                      titular={HEADER_SAMPLE.titular}
                      revision="header-gallery"
                      canViewDetalle
                      onVerDetalle={() => simulate("Préstamos del socio")}
                    />
                    {!baseline && (
                      <div className="header-expanded-reference">
                        Solicitud {HEADER_SAMPLE.number} · Préstamo{" "}
                        {HEADER_SAMPLE.loanId}
                      </div>
                    )}
                  </div>
                  {!showDetails && design !== "focus" && (
                    <div className="header-compact-summary">
                      {design === "slim" ? (
                        identity
                      ) : (
                        <span className="header-convenio">
                          {HEADER_SAMPLE.convenio}
                        </span>
                      )}
                      <div className="header-status-items">
                        <span className="header-member">Es socio</span>
                        <span>Sin mora</span>
                        <span>Créditos activos</span>
                      </div>
                    </div>
                  )}
                  {design === "focus" && !showDetails && (
                    <div className="header-focus-status">
                      <span className="header-member">Es socio</span>
                      <span>Sin mora · Créditos activos</span>
                      <span className="header-convenio">
                        {HEADER_SAMPLE.convenio}
                      </span>
                    </div>
                  )}
                  <div
                    id="header-demo-actions"
                    className="header-toolbar"
                    data-testid="request-toolbar"
                    hidden={design === "focus" && !actionsOpen && !showDetails}
                  >
                    {toolbar}
                  </div>
                  <div className="header-tabs-row">
                    <div role="tablist" aria-label="Secciones de la solicitud">
                      {(
                        [
                          ["solicitud", "Solicitud"],
                          ["evaluacion", "Evaluación"],
                          ["credixsa", "CredixSA"],
                        ] as const
                      ).map(([value, label], index, items) => (
                        <button
                          key={value}
                          id={`header-tab-${value}`}
                          role="tab"
                          type="button"
                          tabIndex={tab === value ? 0 : -1}
                          aria-selected={tab === value}
                          aria-controls="header-demo-content"
                          onKeyDown={(event) => {
                            const step =
                              event.key === "ArrowRight"
                                ? 1
                                : event.key === "ArrowLeft"
                                  ? -1
                                  : 0;
                            if (
                              !step &&
                              event.key !== "Home" &&
                              event.key !== "End"
                            )
                              return;
                            event.preventDefault();
                            const next =
                              event.key === "Home"
                                ? 0
                                : event.key === "End"
                                  ? items.length - 1
                                  : (index + step + items.length) %
                                    items.length;
                            setTab(items[next][0]);
                            document
                              .getElementById(`header-tab-${items[next][0]}`)
                              ?.focus();
                          }}
                          onClick={() => {
                            setTab(value);
                            content.current?.scrollTo({ top: 0 });
                          }}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <div className="header-view-controls">
                      {design === "focus" && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          aria-expanded={actionsOpen || showDetails}
                          aria-controls="header-demo-actions"
                          onClick={() => setActionsOpen((value) => !value)}
                          disabled={showDetails}
                        >
                          <SlidersHorizontal />
                          Acciones
                        </Button>
                      )}
                      {!baseline && disclosure}
                    </div>
                  </div>
                  <div
                    id="header-demo-content"
                    ref={content}
                    role="tabpanel"
                    tabIndex={0}
                    aria-labelledby={`header-tab-${tab}`}
                    className="header-reading-area"
                    data-testid="reading-area"
                  >
                    {notice && (
                      <div className="header-local-notice" role="status">
                        <span>{notice}</span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label="Cerrar aviso"
                          onClick={() => setNotice("")}
                        >
                          <X />
                        </Button>
                      </div>
                    )}
                    <RequestDetails tab={tab} />
                  </div>
                </article>
              </div>
            </div>
          </>
        )}
      </div>
      {clean && !embedded && (
        <Button
          className="header-return-to-lab"
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setClean(false)}
        >
          <SlidersHorizontal />
          Comparar diseños
        </Button>
      )}
    </main>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <HeaderGallery />
    </BrowserRouter>
  );
}

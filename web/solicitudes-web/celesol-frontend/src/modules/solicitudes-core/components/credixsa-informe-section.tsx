import { useMemo, type ReactNode } from "react";

import { useCredixsaSolicitudQuery } from "@/modules/solicitudes-core/hooks/use-credixsa-solicitud-query";
import {
  bcraSituation,
  formatBcraSituation,
  prepareCredixBcra,
  type CredixsaBcra,
} from "@/modules/solicitudes-core/utils/credixsa-bcra";

// El informe muestra los datos igual que la herramienta Consulta CredixSA
// (web/herramientas/resources/js/app.jsx, CredixDedicatedReport), que es la
// vista que conocen los analistas: mismas secciones, en el mismo orden y con
// las mismas tablas. Los estilos son los de Solicitudes Web. Si cambia el
// informe en herramientas, hay que traer el cambio aca.
//
// El informe llega como JSON sin tipar desde CredixSA, via Kestra. Cada panel
// valida las listas antes de recorrerlas, igual que herramientas: si CredixSA
// cambia su HTML, es preferible un panel vacio a romper la pantalla.

type Alerta = {
  codigo?: string;
  fuente?: string;
  mensaje?: string;
  nivel?: string;
};

type Persona = {
  cuit?: string;
  documento?: string;
  domicilio?: string;
  edad?: string;
  fecha_nacimiento?: string;
  genero?: string;
  localidad?: string;
  nombre_completo?: string;
  provincia?: string;
};

type Empleador = {
  actividad?: string;
  cuit?: string;
  domicilio?: string;
  indice?: string | number;
  nombre?: string;
};

type Registracion = {
  mensaje?: string;
  periodo?: string;
};

type ObraSocial = {
  empleador?: string;
  mensaje?: string;
  obra_social?: string;
  situacion_laboral?: string;
};

type Previsional = {
  empleadores?: Empleador[];
  mensaje?: string;
  registraciones?: Registracion[];
  situaciones_por_empleador?: Array<{
    empleador?: Empleador;
    fuente?: string;
    indice?: string | number;
    periodos?: Array<{
      aportes_obra_social?: string;
      aportes_seguridad_social?: string;
      contribucion_patronal_obra_social?: string;
      incluido_declaracion_jurada?: string;
      periodo?: string;
    }>;
  }>;
};

type Aportes = {
  empleadores?: Empleador[];
  mensaje?: string;
  obra_sociales?: ObraSocial[];
  registraciones?: Registracion[];
};

type Quiebras = {
  edictos?: Array<{ fecha?: string; fuente?: string; resumen?: string }>;
  mensaje?: string;
};

type InformeNormalizado = {
  alertas?: Alerta[];
  aportes?: Aportes;
  bcra?: CredixsaBcra;
  persona?: Persona;
  previsional?: Previsional;
  quiebras?: Quiebras;
};

// Colores de la situacion BCRA: los mismos tonos que herramientas (1 verde,
// 2 amarillo, 3 naranja, 4 rojo, 5 y 6 rojo oscuro), con variante oscura.
const SITUACION_CLASES: Record<string, string> = {
  "1": "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  "2": "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  "3": "bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300",
  "4": "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  "5": "bg-red-200 text-red-900 dark:bg-red-900 dark:text-red-200",
  "6": "bg-red-200 text-red-900 dark:bg-red-900 dark:text-red-200",
  na: "text-foreground-muted",
};

type CredixsaInformeSectionProps = {
  isActive: boolean;
  solicitudId: string;
};

export function CredixsaInformeSection({
  isActive,
  solicitudId,
}: CredixsaInformeSectionProps) {
  const { data, error, isLoading } = useCredixsaSolicitudQuery(
    solicitudId,
    isActive,
  );
  const credixsa = data?.credixsa ?? null;
  const normalized = useMemo(() => {
    const informe = credixsa?.informe;

    if (!informe || typeof informe !== "object" || Array.isArray(informe)) {
      return null;
    }

    const report = informe as InformeNormalizado;

    return { ...report, bcra: prepareCredixBcra(report.bcra) };
  }, [credixsa]);

  if (isLoading) {
    return (
      <Aviso texto="Consultando CredixSA... la primera consulta puede tardar hasta un minuto." />
    );
  }

  if (error || !credixsa) {
    return <Aviso texto="No se pudo consultar CredixSA." />;
  }

  if (!credixsa.ok || !normalized) {
    return (
      <Aviso
        texto={
          credixsa.error ||
          (credixsa.status === "none"
            ? "CredixSA no encontro a esta persona."
            : credixsa.status === "multiple"
              ? "CredixSA devolvio mas de un resultado. Hay que consultarlo a mano."
              : "CredixSA no devolvio un informe.")
        }
      />
    );
  }

  return (
    <div className="space-y-3 p-3 md:p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-xs text-foreground-secondary">
          {credixsa.cacheHit
            ? `Informe consultado el ${formatDateTime(credixsa.cachedAt)}.`
            : "Informe consultado recién."}
        </p>
        <div className="text-right text-sm">
          <p className="font-medium">{credixsa.nombre || "Sin nombre"}</p>
          <p className="text-xs text-foreground-secondary">
            {formatCuit(credixsa.cuit) || "Sin CUIL"}
          </p>
        </div>
      </div>

      <CredixAlertsPanel alerts={normalized.alertas || []} />
      <CredixPersonPanel persona={normalized.persona || {}} />
      <CredixBcraHistoryPanel bcra={normalized.bcra} />
      <CredixBcraPanel bcra={normalized.bcra} />
      <CredixBcraEntityEvolutionPanel bcra={normalized.bcra} />
      <CredixPrevisionalHistoryPanel
        previsional={normalized.previsional || {}}
      />
      <CredixQuiebrasPanel quiebras={normalized.quiebras || {}} />
      <CredixSecondarySections normalized={normalized} />
    </div>
  );
}

function Aviso({ texto }: { texto: string }) {
  return <p className="p-4 text-sm text-foreground-secondary">{texto}</p>;
}

function Panel({
  children,
  etiqueta,
  titulo,
}: {
  children: ReactNode;
  etiqueta?: string;
  titulo: string;
}) {
  return (
    <section className="rounded-md border border-border bg-surface">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
        <h3 className="text-xs font-medium uppercase text-foreground-secondary">
          {titulo}
        </h3>
        {etiqueta && (
          <span className="rounded-full border border-border px-2 py-0.5 text-xs text-foreground-secondary">
            {etiqueta}
          </span>
        )}
      </header>
      <div className="space-y-3 p-3 text-sm">{children}</div>
    </section>
  );
}

function Metrica({ etiqueta, valor }: { etiqueta: string; valor: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-foreground-secondary">{etiqueta}</p>
      <p className="font-medium break-words">{valor}</p>
    </div>
  );
}

function Nota({ children }: { children: ReactNode }) {
  return <p className="text-xs text-foreground-secondary">{children}</p>;
}

function Vacio({ children }: { children: ReactNode }) {
  return <p className="text-foreground-secondary">{children}</p>;
}

function Item({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-md border border-border-soft px-3 py-2 [&>span]:text-foreground-secondary">
      {children}
    </div>
  );
}

function SubTitulo({ children }: { children: ReactNode }) {
  return (
    <h4 className="text-xs font-medium uppercase text-foreground-secondary">
      {children}
    </h4>
  );
}

const TH = "border-b border-border px-2 py-1.5 text-left font-medium";
const TD = "border-b border-border-soft px-2 py-1.5";

function CredixAlertsPanel({ alerts }: { alerts: Alerta[] }) {
  const visibleAlerts = Array.isArray(alerts)
    ? alerts.filter(
        (alert) => alert && typeof alert === "object" && alert.mensaje,
      )
    : [];

  if (visibleAlerts.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2" aria-label="Alertas del informe">
      {visibleAlerts.map((alert, index) => (
        <div
          className={
            alert.nivel === "error"
              ? "rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-destructive"
              : "rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200"
          }
          key={`${alert.codigo || "alerta"}-${index}`}
          role="alert"
        >
          <p className="text-xs uppercase opacity-80">
            {alert.fuente || "CredixSA"}
          </p>
          <p className="text-sm font-medium">{alert.mensaje}</p>
        </div>
      ))}
    </div>
  );
}

function CredixSecondarySections({
  normalized,
}: {
  normalized: InformeNormalizado;
}) {
  return (
    <details className="group rounded-md border border-border bg-surface">
      <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
        Ver secciones adicionales
      </summary>
      <div className="grid gap-3 border-t border-border p-3 lg:grid-cols-2">
        <CredixPrevisionalPanel previsional={normalized.previsional || {}} />
        <CredixAportesPanel aportes={normalized.aportes || {}} />
      </div>
    </details>
  );
}

function CredixPersonPanel({ persona }: { persona: Persona }) {
  const birthDate = persona.fecha_nacimiento || extractBirthDate(persona.edad);
  const metrics = [
    ["Nombre completo", persona.nombre_completo],
    ["Edad", stripBirthDateFromAge(persona.edad)],
    ["Fecha de nacimiento", birthDate],
    ["Genero", persona.genero],
    [
      "Localidad",
      [persona.localidad, persona.provincia].filter(Boolean).join(" - "),
    ],
    ["Documento", persona.documento],
    ["CUIL", persona.cuit],
  ].filter(([, value]) => value);

  return (
    <Panel titulo="Datos filiatorios">
      <div className="grid grid-cols-2 gap-x-6 gap-y-2 md:grid-cols-4">
        {metrics.map(([label, value]) => (
          <Metrica etiqueta={label ?? ""} key={label} valor={value} />
        ))}
      </div>
      {persona.domicilio && <Nota>{persona.domicilio}</Nota>}
    </Panel>
  );
}

function CredixBcraPanel({ bcra }: { bcra: CredixsaBcra }) {
  const history = Array.isArray(bcra.historial_por_entidad)
    ? bcra.historial_por_entidad
    : [];
  const detailedHistoryRows = Array.isArray(
    bcra.evolucion_deuda_por_entidad?.filas,
  )
    ? bcra.evolucion_deuda_por_entidad.filas
    : [];
  const activeDebts = Array.isArray(bcra.deudas_vigentes)
    ? bcra.deudas_vigentes
    : [];

  return (
    <Panel
      etiqueta={`Fuente: ${bcra.fuente || "CredixSA"}`}
      titulo="Deudas vigentes sistema financiero"
    >
      {bcra.consulta_directa_estado === "unavailable" && (
        <Nota>
          No se pudo completar la consulta a BCRA al preparar el informe. Se
          muestran datos de CredixSA.
        </Nota>
      )}
      {["invalid_response", "processing_error"].includes(
        bcra.consulta_directa_estado ?? "",
      ) && (
        <Nota>
          No se pudo procesar la respuesta de BCRA al preparar el informe. Se
          muestran datos de CredixSA.
        </Nota>
      )}
      {bcra.consultado_en && (
        <Nota>Consultado: {formatDateTime(bcra.consultado_en)}</Nota>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Metrica
          etiqueta="Deuda vigente total"
          valor={bcra.deuda_vigente_total || "Sin datos"}
        />
        <Metrica
          etiqueta="Total en situación ≥ 2"
          valor={bcra.deuda_situacion_negativa_total ?? "Sin datos"}
        />
        <Metrica
          etiqueta="Entidades informadas"
          valor={bcra.deuda_vigente_total ? activeDebts.length : "Sin datos"}
        />
      </div>
      {bcra.mensaje && <Nota>{bcra.mensaje}</Nota>}

      {activeDebts.length > 0 && (
        <CredixSimpleTable
          columns={["Entidad", "Periodo", "Monto", "Situacion"]}
          rows={activeDebts.map((row) => [
            row.entidad || "Sin dato",
            row.periodo || "Sin dato",
            row.monto || "Sin dato",
            formatBcraSituation(row.situacion),
          ])}
          cellClassName={(value, index) =>
            index === 3 ? `font-semibold ${situacionClases(value)}` : undefined
          }
        />
      )}

      {history.length > 0 && detailedHistoryRows.length === 0 && (
        <div className="space-y-2">
          <SubTitulo>Historial por entidad</SubTitulo>
          {history.slice(0, 6).map((period, index) => (
            <Item key={`${period.periodo || "periodo"}-${index}`}>
              <strong>{period.periodo || "Periodo sin dato"}</strong>
              {Object.entries(period.entidades || {}).map(
                ([entity, amount]) => (
                  <span key={entity}>
                    {entity}: {amount}
                  </span>
                ),
              )}
            </Item>
          ))}
        </div>
      )}
    </Panel>
  );
}

function CredixBcraHistoryPanel({ bcra }: { bcra: CredixsaBcra }) {
  const matrix = bcra?.deudas_24_meses || {};
  const years = Array.isArray(matrix.anios) ? matrix.anios : [];
  const months = Array.isArray(matrix.meses) ? matrix.meses : [];
  const rows = Array.isArray(matrix.filas) ? matrix.filas : [];

  if (years.length === 0 || months.length === 0 || rows.length === 0) {
    return null;
  }

  return (
    <Panel
      etiqueta={`Fuente: ${bcra.fuente || "CredixSA"}`}
      titulo="Deudas en el sistema financiero"
    >
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead className="bg-muted">
            <tr>
              <th className={`${TH} min-w-48`} rowSpan={2}>
                Entidad
              </th>
              {years.map((year, index) => (
                <th
                  className={`${TH} text-center`}
                  colSpan={year.span || 1}
                  key={`${year.anio || "anio"}-${index}`}
                >
                  {year.anio || "Sin dato"}
                </th>
              ))}
              <th className={TH} rowSpan={2}>
                Ultimo monto informado
              </th>
              <th className={TH} rowSpan={2}>
                Obs.
              </th>
            </tr>
            <tr>
              {months.map((month, index) => (
                <th className={`${TH} text-center`} key={`${month}-${index}`}>
                  {month}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr
                className={row.activa ? "font-semibold" : undefined}
                key={`${row.entidad || "entidad"}-${rowIndex}`}
              >
                <th className={`${TD} text-left font-medium`} scope="row">
                  {row.entidad || "Sin dato"}
                </th>
                {(Array.isArray(row.situaciones) ? row.situaciones : []).map(
                  (value, valueIndex) => (
                    <td
                      className={`${TD} text-center font-semibold ${situacionClases(value)}`}
                      key={`${rowIndex}-${valueIndex}`}
                    >
                      {formatBcraSituation(value)}
                    </td>
                  ),
                )}
                <td className={`${TD} whitespace-nowrap text-right`}>
                  {row.ultimo_monto_informado || "-"}
                </td>
                <td className={TD}>{row.observacion || ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Nota>
        Referencias: <strong>1</strong> normal, <strong>2</strong> riesgo
        potencial, <strong>3</strong> con problemas, <strong>4</strong> alto
        riesgo, <strong>5</strong> irrecuperable, <strong>6</strong>{" "}
        irrecuperable por disposicion tecnica, <strong>N/D</strong> no
        disponible.
      </Nota>
    </Panel>
  );
}

function CredixBcraEntityEvolutionPanel({ bcra }: { bcra: CredixsaBcra }) {
  const matrix = bcra?.evolucion_deuda_por_entidad || {};
  const entities = Array.isArray(matrix.entidades) ? matrix.entidades : [];
  const rows = Array.isArray(matrix.filas) ? matrix.filas : [];

  if (entities.length === 0 || rows.length === 0) {
    return null;
  }

  return (
    <Panel
      etiqueta={`Fuente: ${bcra.fuente || "CredixSA"}`}
      titulo="Evolucion deuda sistema financiero por entidad"
    >
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead className="bg-muted">
            <tr>
              <th className={TH}>Periodo</th>
              {entities.map((entity, index) => (
                <th className={TH} key={`${entity}-${index}`}>
                  {entity}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={`${row.periodo || "periodo"}-${rowIndex}`}>
                <th
                  className={`${TD} whitespace-nowrap text-left font-medium`}
                  scope="row"
                >
                  {row.periodo || "-"}
                </th>
                {(Array.isArray(row.celdas) ? row.celdas : []).map(
                  (cell, cellIndex) => (
                    <td
                      className={`${TD} whitespace-nowrap text-right ${situacionClases(cell.situacion)}`}
                      key={`${rowIndex}-${cellIndex}`}
                    >
                      {cell.monto || ""}
                    </td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function CredixPrevisionalHistoryPanel({
  previsional,
}: {
  previsional: Previsional;
}) {
  const situations = Array.isArray(previsional?.situaciones_por_empleador)
    ? previsional.situaciones_por_empleador
    : [];

  if (situations.length === 0) {
    return null;
  }

  return (
    <Panel titulo="Situacion previsional detallada">
      {situations.map((situation, index) => {
        const employer = situation.empleador || {};
        const periods = Array.isArray(situation.periodos)
          ? situation.periodos
          : [];
        const employerLabel = [formatCuit(employer.cuit), employer.nombre]
          .filter(Boolean)
          .join(" - ");

        return (
          <div
            className="space-y-2 rounded-md border border-border-soft p-3"
            key={`${employer.cuit || "empleador"}-${index}`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <strong>
                Situacion previsional - Empleador{" "}
                {situation.indice || employer.indice || index + 1}
              </strong>
              <span className="text-xs text-foreground-secondary">
                {situation.fuente
                  ? `Fuente: ${situation.fuente}`
                  : "Fuente no informada"}
              </span>
            </div>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
              <Metrica
                etiqueta="Empleador"
                valor={employerLabel || "Sin dato"}
              />
              <Metrica
                etiqueta="Actividad"
                valor={employer.actividad || "Sin dato"}
              />
              <Metrica
                etiqueta="Domicilio"
                valor={employer.domicilio || "Sin dato"}
              />
            </div>
            {periods.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-xs">
                  <thead className="bg-muted">
                    <tr>
                      <th className={TH}>Periodo</th>
                      <th className={TH}>Incluido en declaracion jurada</th>
                      <th className={TH}>Aportes de seguridad social</th>
                      <th className={TH}>Aportes de obra social</th>
                      <th className={TH}>
                        Contribucion patronal de obra social
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {periods.map((period, periodIndex) => (
                      <tr key={`${period.periodo || "periodo"}-${periodIndex}`}>
                        <td className={TD}>{period.periodo || "-"}</td>
                        <td
                          className={
                            period.incluido_declaracion_jurada === "SI"
                              ? `${TD} font-semibold text-emerald-700 dark:text-emerald-300`
                              : TD
                          }
                        >
                          {period.incluido_declaracion_jurada || "-"}
                        </td>
                        <td className={TD}>
                          {period.aportes_seguridad_social || "-"}
                        </td>
                        <td className={TD}>
                          {period.aportes_obra_social || "-"}
                        </td>
                        <td className={TD}>
                          {period.contribucion_patronal_obra_social || "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
    </Panel>
  );
}

function CredixPrevisionalPanel({ previsional }: { previsional: Previsional }) {
  const employers = Array.isArray(previsional.empleadores)
    ? previsional.empleadores
    : [];
  const registrations = Array.isArray(previsional.registraciones)
    ? previsional.registraciones
    : [];

  return (
    <Panel titulo="Situacion previsional">
      {previsional.mensaje && <Nota>{previsional.mensaje}</Nota>}
      {employers.length > 0 ? (
        <div className="space-y-2">
          {employers.map((employer, index) => (
            <Item key={`${employer.cuit || "empleador"}-${index}`}>
              <strong>{employer.nombre || "Empleador sin nombre"}</strong>
              <span>{employer.cuit || "Sin CUIT"}</span>
              <span>{employer.actividad || "Sin actividad"}</span>
              <span>{employer.domicilio || "Sin domicilio"}</span>
            </Item>
          ))}
        </div>
      ) : (
        <Vacio>Sin empleadores informados.</Vacio>
      )}
      {registrations.length > 0 && (
        <div className="space-y-2">
          <SubTitulo>Registraciones</SubTitulo>
          {registrations.map((registration, index) => (
            <Item key={`${registration.periodo || "registro"}-${index}`}>
              <strong>{registration.periodo || "Registro"}</strong>
              <span>{registration.mensaje || "Sin detalle"}</span>
            </Item>
          ))}
        </div>
      )}
    </Panel>
  );
}

function CredixQuiebrasPanel({ quiebras }: { quiebras: Quiebras }) {
  const edicts = Array.isArray(quiebras.edictos) ? quiebras.edictos : [];

  return (
    <Panel
      etiqueta={edicts.length ? `${edicts.length} edictos` : "Sin edictos"}
      titulo="Quiebras"
    >
      {edicts.length > 0 ? (
        <CredixSimpleTable
          columns={["Fecha", "Fuente", "Resumen"]}
          rows={edicts.map((edict) => [
            edict.fecha || "Sin dato",
            edict.fuente || "Sin dato",
            edict.resumen || "Sin dato",
          ])}
        />
      ) : (
        <Vacio>
          {quiebras.mensaje || "Sin edictos judiciales informados."}
        </Vacio>
      )}
    </Panel>
  );
}

function CredixAportesPanel({ aportes }: { aportes: Aportes }) {
  const registrations = Array.isArray(aportes.registraciones)
    ? aportes.registraciones
    : [];
  const healthProviders = Array.isArray(aportes.obra_sociales)
    ? aportes.obra_sociales
    : [];
  const employers = Array.isArray(aportes.empleadores)
    ? aportes.empleadores
    : [];

  return (
    <Panel titulo="Aportes">
      {aportes.mensaje && <Nota>{aportes.mensaje}</Nota>}
      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-2">
          <SubTitulo>Registraciones</SubTitulo>
          {registrations.length > 0 ? (
            registrations.map((registration, index) => (
              <Item key={`${registration.periodo || "registro"}-${index}`}>
                <strong>{registration.periodo || "Registro"}</strong>
                <span>{registration.mensaje || "Sin detalle"}</span>
              </Item>
            ))
          ) : (
            <Vacio>Sin registraciones informadas.</Vacio>
          )}
        </div>
        <div className="space-y-2">
          <SubTitulo>Obra social</SubTitulo>
          {healthProviders.length > 0 ? (
            healthProviders.map((item, index) => (
              <Item
                key={`${item.obra_social || item.mensaje || "obra-social"}-${index}`}
              >
                <strong>
                  {item.obra_social || item.mensaje || "Sin datos"}
                </strong>
                {item.situacion_laboral && (
                  <span>{item.situacion_laboral}</span>
                )}
                {item.empleador && <span>{item.empleador}</span>}
              </Item>
            ))
          ) : (
            <Vacio>Sin obra social informada.</Vacio>
          )}
        </div>
      </div>
      {employers.length > 0 && (
        <div className="space-y-2">
          <SubTitulo>Empleadores vinculados</SubTitulo>
          {employers.map((employer, index) => (
            <Item key={`${employer.cuit || "aporte-empleador"}-${index}`}>
              <strong>{employer.nombre || "Empleador sin nombre"}</strong>
              <span>{employer.cuit || "Sin CUIT"}</span>
            </Item>
          ))}
        </div>
      )}
    </Panel>
  );
}

function CredixSimpleTable({
  cellClassName,
  columns,
  rows,
}: {
  cellClassName?: (value: string, index: number) => string | undefined;
  columns: string[];
  rows: string[][];
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-xs">
        <thead className="bg-muted">
          <tr>
            {columns.map((column) => (
              <th className={TH} key={column}>
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => (
                <td
                  className={`${TD} ${cellClassName?.(cell, cellIndex) ?? ""}`}
                  key={cellIndex}
                >
                  {cell || "Sin dato"}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function situacionClases(value: unknown): string {
  return SITUACION_CLASES[bcraSituation(value) ?? "na"];
}

function formatCuit(value: string | undefined): string {
  const digits = String(value || "").replace(/\D+/g, "");
  if (digits.length !== 11) {
    return value || "";
  }
  return `${digits.slice(0, 2)}-${digits.slice(2, 10)}-${digits.slice(10)}`;
}

function extractBirthDate(ageValue: string | undefined): string {
  const match = String(ageValue || "").match(/\(([^)]+)\)/);
  return match?.[1] || "";
}

function stripBirthDateFromAge(ageValue: string | undefined): string {
  return String(ageValue || "")
    .replace(/\s*\([^)]+\)\s*/, "")
    .trim();
}

function formatDateTime(value: string | undefined): string {
  if (!value) {
    return "Sin dato";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return new Intl.DateTimeFormat("es-AR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

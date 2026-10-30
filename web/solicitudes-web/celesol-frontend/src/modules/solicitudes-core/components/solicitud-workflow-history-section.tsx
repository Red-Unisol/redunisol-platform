import type {
  SolicitudCoreWorkflowHistoryItem,
  SolicitudWorkflowHistoryStateSnapshot,
} from "@/modules/solicitudes/types/solicitudes-core";
import { nombreEstado } from "@/modules/solicitudes-shared/utils/nombre-estado";

const PLACEHOLDER = "-";

type SolicitudWorkflowHistorySectionProps = {
  errorMessage?: string | null;
  history: SolicitudCoreWorkflowHistoryItem[];
  isLoading?: boolean;
};

function formatText(value: string | null | undefined) {
  return value?.trim() || PLACEHOLDER;
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "America/Argentina/Buenos_Aires",
  }).format(date);
}

function formatState(state: SolicitudWorkflowHistoryStateSnapshot) {
  return formatText(nombreEstado(state.code, state.name));
}

function formatOwner(state: SolicitudWorkflowHistoryStateSnapshot) {
  const name = state.ownerName?.trim();
  const code = state.ownerCode?.trim();
  return name && code ? `${name} (${code})` : name || code || PLACEHOLDER;
}

function formatChangedBy(item: SolicitudCoreWorkflowHistoryItem) {
  const fullName = item.changedByFullName?.trim();
  if (fullName) return fullName;
  const raw = item.changedBy?.trim();
  if (!raw) return PLACEHOLDER;
  if (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      raw,
    )
  ) {
    return `${raw.slice(0, 8)}...${raw.slice(-4)}`;
  }
  return raw;
}

function getStateVariantClassName(stateLabel: string) {
  const state = stateLabel.toLowerCase().trim();
  if (
    state.includes("rechazada") ||
    state.includes("rechazo") ||
    state.includes("revisar")
  ) {
    return "border-red-200 bg-red-50 text-red-700";
  }
  if (state.includes("revision riesgo") || state.includes("riesgo")) {
    return "border-blue-200 bg-blue-50 text-blue-700";
  }
  if (state.includes("preaprob")) {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  if (state.includes("carga vendedor")) {
    return "border-slate-200 bg-slate-50 text-slate-700";
  }
  return "border-primary/35 bg-primary/10 text-foreground";
}

function mapOperationalCode(value: string | null | undefined) {
  switch (value?.trim()) {
    case "ASSIGNMENT_AUTO":
      return "Asignación automática";
    case "ASSIGNMENT_SET":
      return "Solicitud asignada";
    case "ASSIGNMENT_CLEARED_ON_OWNER_CHANGE":
      return "Asignación removida";
    case "ADMINISTRATIVE_CORRECTION":
      return "Corrección administrativa";
    default:
      return null;
  }
}

export function SolicitudWorkflowHistorySection({
  errorMessage,
  history,
  isLoading = false,
}: SolicitudWorkflowHistorySectionProps) {
  const cellClassName =
    "block min-w-0 px-2 py-2 align-top [overflow-wrap:anywhere] md:table-cell";
  const labelClassName =
    "mb-1 block text-xs font-semibold text-foreground-secondary md:hidden";

  return (
    // Al pie del detalle, sin caja: es consulta, no tarea.
    <section aria-label="Novedades" className="px-1 pt-3">
      <h2 className="mb-1 px-2 text-xs font-semibold text-foreground-secondary">
        Novedades
      </h2>
      {isLoading ? (
        <p className="px-2 py-1 text-xs text-foreground-muted">
          Cargando novedades...
        </p>
      ) : null}

      {!isLoading && errorMessage ? (
        <p
          role="alert"
          className="rounded-md border border-danger bg-danger px-3 py-2 text-sm text-danger-foreground"
        >
          {errorMessage}
        </p>
      ) : null}

      {!isLoading && !errorMessage && history.length === 0 ? (
        <p className="px-2 py-1 text-xs text-foreground-muted">
          Sin novedades todavía.
        </p>
      ) : null}

      {!isLoading && !errorMessage && history.length > 0 ? (
        <div>
          <table
            role="table"
            aria-label="Historial de estados de la solicitud"
            className="block w-full text-left text-xs text-foreground-secondary md:table md:table-fixed"
          >
            <caption className="sr-only">
              Movimientos más recientes primero. Fecha y hora de Argentina.
            </caption>
            <thead
              role="rowgroup"
              className="sr-only border-b border-border-soft text-foreground-muted md:not-sr-only md:table-header-group"
            >
              <tr role="row">
                <th
                  role="columnheader"
                  scope="col"
                  className="w-[16%] px-2 py-1.5 font-medium"
                >
                  Fecha
                </th>
                <th
                  role="columnheader"
                  scope="col"
                  className="w-[28%] px-2 py-1.5 font-medium"
                >
                  Cambio de estado
                </th>
                <th
                  role="columnheader"
                  scope="col"
                  className="w-[36%] px-2 py-1.5 font-medium"
                >
                  Observación
                </th>
                <th
                  role="columnheader"
                  scope="col"
                  className="w-[20%] px-2 py-1.5 font-medium"
                >
                  Usuario
                </th>
              </tr>
            </thead>
            <tbody role="rowgroup" className="block md:table-row-group">
              {history.map((item) => {
                const action =
                  mapOperationalCode(item.actionCode) ||
                  formatText(item.actionLabel?.trim() || item.actionCode);
                const reason =
                  mapOperationalCode(item.motivo) || item.motivo?.trim();
                const previousOwner = formatOwner(item.estadoAnterior);
                const nextOwner = formatOwner(item.estadoNuevo);
                const comment = item.comentario?.trim();

                return (
                  <tr
                    role="row"
                    key={item.id}
                    className="block border-t border-border-soft first:border-t-0 md:table-row"
                  >
                    <td
                      role="cell"
                      className={`${cellClassName} tabular-nums text-foreground-secondary`}
                    >
                      <span aria-hidden="true" className={labelClassName}>
                        Fecha
                      </span>
                      <time dateTime={item.changedAt}>
                        {formatDateTime(item.changedAt)}
                      </time>
                    </td>
                    <td role="cell" className={cellClassName}>
                      <span aria-hidden="true" className={labelClassName}>
                        Cambio de estado
                      </span>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span>{formatState(item.estadoAnterior)}</span>
                        <span aria-label="a" className="text-foreground-muted">
                          →
                        </span>
                        <span
                          className={`inline-flex rounded-sm border px-1 py-px text-[0.6875rem] font-medium ${getStateVariantClassName(formatText(item.estadoNuevo.name?.trim() || item.estadoNuevo.code))}`}
                        >
                          {formatState(item.estadoNuevo)}
                        </span>
                      </div>
                      {action !== PLACEHOLDER ? (
                        <p className="mt-0.5 text-foreground-muted">{action}</p>
                      ) : null}
                      {previousOwner !== nextOwner ? (
                        <p className="mt-0.5 text-foreground-muted">
                          Área: {previousOwner} → {nextOwner}
                        </p>
                      ) : null}
                    </td>
                    <td role="cell" className={cellClassName}>
                      <span aria-hidden="true" className={labelClassName}>
                        Observación
                      </span>
                      <p className="whitespace-pre-wrap">
                        {comment || PLACEHOLDER}
                      </p>
                      {reason && reason !== comment && reason !== action ? (
                        <p className="mt-0.5 whitespace-pre-wrap text-foreground-muted">
                          Motivo: {reason}
                        </p>
                      ) : null}
                    </td>
                    <td role="cell" className={cellClassName}>
                      <span aria-hidden="true" className={labelClassName}>
                        Usuario
                      </span>
                      <span
                        title={formatText(
                          item.changedBy || item.changedByFullName,
                        )}
                      >
                        {formatChangedBy(item)}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

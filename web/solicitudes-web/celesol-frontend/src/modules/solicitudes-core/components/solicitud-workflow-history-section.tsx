import { CalendarDays, UserRound } from "lucide-react";
import { Section } from "@/modules/solicitudes-editor/components/fields/base";
import type {
  SolicitudCoreWorkflowHistoryItem,
  SolicitudWorkflowHistoryStateSnapshot,
} from "@/modules/solicitudes/types/solicitudes-core";
import { TableEmptyState } from "@/shared/components/ui/table-empty-state";

const PLACEHOLDER = "-";

type SolicitudWorkflowHistorySectionProps = {
  errorMessage?: string | null;
  history: SolicitudCoreWorkflowHistoryItem[];
  isLoading?: boolean;
};

function formatText(value: string | null | undefined) {
  const normalizedValue = value?.trim();

  return normalizedValue ? normalizedValue : PLACEHOLDER;
}

function formatDateTime(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

function formatState(state: SolicitudWorkflowHistoryStateSnapshot) {
  return formatText(state.name ?? state.code);
}

function formatOwner(state: SolicitudWorkflowHistoryStateSnapshot) {
  const ownerName = state.ownerName?.trim();
  const ownerCode = state.ownerCode?.trim();

  if (ownerName && ownerCode) {
    return `${ownerName} (${ownerCode})`;
  }

  return ownerName ?? ownerCode ?? PLACEHOLDER;
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function formatChangedBy(value: string | null | undefined) {
  const normalizedValue = value?.trim();

  if (!normalizedValue) {
    return PLACEHOLDER;
  }

  if (!isUuid(normalizedValue)) {
    return normalizedValue;
  }

  return `${normalizedValue.slice(0, 8)}...${normalizedValue.slice(-4)}`;
}

function formatChangedByDisplay(
  fullName: string | null | undefined,
  rawValue: string | null | undefined,
) {
  const normalizedFullName = fullName?.trim();

  if (normalizedFullName) {
    return normalizedFullName;
  }

  return formatChangedBy(rawValue);
}

function stateChipClassName(variantClassName?: string) {
  const chipVariant =
    variantClassName ?? "border-border bg-background text-foreground-secondary";

  return `inline-flex items-center rounded-sm border px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider ${chipVariant}`;
}

function getStateVariantClassName(stateLabel: string) {
  const normalizedState = stateLabel.toLowerCase().trim();

  if (
    normalizedState.includes("rechazada") ||
    normalizedState.includes("rechazo") ||
    normalizedState.includes("revisar")
  ) {
    return "border-red-200 bg-red-50 text-red-700";
  }

  if (
    normalizedState.includes("revision riesgo") ||
    normalizedState.includes("riesgo")
  ) {
    return "border-blue-200 bg-blue-50 text-blue-700";
  }

  if (normalizedState.includes("preaprob")) {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }

  if (normalizedState.includes("carga vendedor")) {
    return "border-slate-200 bg-slate-50 text-slate-700";
  }

  return "border-primary/35 bg-primary/10 text-foreground";
}

function getStateDotClassName(stateLabel: string) {
  const normalizedState = stateLabel.toLowerCase().trim();

  if (
    normalizedState.includes("rechazada") ||
    normalizedState.includes("rechazo") ||
    normalizedState.includes("revisar")
  ) {
    return "bg-red-600";
  }

  if (
    normalizedState.includes("revision riesgo") ||
    normalizedState.includes("riesgo")
  ) {
    return "bg-blue-600";
  }

  return "bg-foreground-muted";
}

function getCommentAccentClassName(stateLabel: string) {
  const normalizedState = stateLabel.toLowerCase().trim();

  if (
    normalizedState.includes("rechazada") ||
    normalizedState.includes("rechazo") ||
    normalizedState.includes("revisar")
  ) {
    return "border-l-red-300";
  }

  if (
    normalizedState.includes("revision riesgo") ||
    normalizedState.includes("riesgo")
  ) {
    return "border-l-blue-300";
  }

  return "border-l-border";
}

function mapWorkflowOperationalCode(value: string | null | undefined) {
  const normalized = value?.trim();

  if (!normalized) {
    return null;
  }

  if (normalized === "ASSIGNMENT_SET") {
    return "Solicitud asignada";
  }

  if (normalized === "ASSIGNMENT_CLEARED_ON_OWNER_CHANGE") {
    return "Asignacion removida";
  }

  return null;
}

function resolveHistoryActionLabel(item: SolicitudCoreWorkflowHistoryItem) {
  const mappedCode = mapWorkflowOperationalCode(item.actionCode);

  if (mappedCode) {
    return mappedCode;
  }

  return formatText(item.actionLabel ?? item.actionCode);
}

export function SolicitudWorkflowHistorySection({
  errorMessage,
  history,
  isLoading = false,
}: SolicitudWorkflowHistorySectionProps) {
  return (
    <Section title="Historial de estados">
      {isLoading ? (
        <p className="text-sm text-foreground-secondary">
          Cargando historial...
        </p>
      ) : null}

      {!isLoading && errorMessage ? (
        <p className="rounded-md border border-danger bg-danger px-3 py-2 text-sm text-danger-foreground">
          {errorMessage}
        </p>
      ) : null}

      {!isLoading && !errorMessage && history.length === 0 ? (
        <TableEmptyState message="Sin historial de estados para mostrar." />
      ) : null}

      {!isLoading && !errorMessage && history.length > 0 ? (
        <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
          <ul className="space-y-8 p-6">
            {history.map((item) => (
              <li
                className="grid grid-cols-[1rem_minmax(0,1fr)] gap-4"
                key={item.id}
              >
                <div className="relative">
                  <div className="absolute top-2 bottom-0 left-1/2 w-px -translate-x-1/2 bg-blue-100" />
                  <span
                    className={`absolute top-1 left-1/2 inline-flex size-3 -translate-x-1/2 rounded-full ring-4 ring-surface ${getStateDotClassName(
                      formatState(item.estadoNuevo),
                    )}`}
                  />
                </div>

                <div className="relative min-w-0">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-3">
                        <span className={stateChipClassName()}>
                          {formatState(item.estadoAnterior)}
                        </span>
                        <span className="text-base text-foreground-muted">
                          -&gt;
                        </span>
                        <span
                          className={stateChipClassName(
                            getStateVariantClassName(
                              formatState(item.estadoNuevo),
                            ),
                          )}
                        >
                          {formatState(item.estadoNuevo)}
                        </span>
                      </div>

                      <div className="mt-2 text-sm text-foreground">
                        <span className="font-bold text-foreground">
                          Accion:
                        </span>{" "}
                        <span>{resolveHistoryActionLabel(item)}</span>
                      </div>
                    </div>

                    <div className="inline-flex items-center gap-1.5 text-xs text-foreground-secondary">
                      <CalendarDays className="size-3.5" />
                      <div>{formatDateTime(item.changedAt)}</div>
                    </div>
                  </div>

                  <div className="mt-2 inline-flex flex-wrap items-center gap-1.5 text-xs text-foreground-secondary">
                    <UserRound className="size-3.5 text-foreground-muted" />
                    <span>Cambio Ejecutivo:</span>{" "}
                    <span className="text-foreground">
                      {formatOwner(item.estadoAnterior)}
                    </span>{" "}
                    <span>-&gt;</span>{" "}
                    <span className="text-foreground">
                      {formatOwner(item.estadoNuevo)}
                    </span>
                    <span className="mx-1 text-foreground-muted">·</span>
                    <span>Usuario:</span>{" "}
                    <span
                      className="inline-block rounded-sm bg-background px-1.5 py-0.5 text-[12px] text-foreground-muted"
                      title={formatText(
                        item.changedBy ?? item.changedByFullName,
                      )}
                    >
                      {formatChangedByDisplay(
                        item.changedByFullName,
                        item.changedBy,
                      )}
                    </span>
                  </div>

                  {item.motivo || item.comentario ? (
                    <div className="mt-4 grid gap-2 text-sm md:grid-cols-2">
                      {item.motivo ? (
                        <div className="rounded-md border border-border/50 bg-background/70 px-3 py-3">
                          <div className="text-xs font-semibold uppercase tracking-wide text-foreground-secondary">
                            Motivo
                          </div>
                          <p className="mt-1 italic text-foreground">
                            {mapWorkflowOperationalCode(item.motivo) ??
                              formatText(item.motivo)}
                          </p>
                        </div>
                      ) : null}
                      {item.comentario ? (
                        <div
                          className={`rounded-md border border-border/50 border-l-4 bg-background/80 px-3 py-3 ${getCommentAccentClassName(
                            formatState(item.estadoNuevo),
                          )}`}
                        >
                          <div className="text-xs font-semibold uppercase tracking-wide text-foreground-secondary">
                            Comentario
                          </div>
                          <p className="mt-1 italic text-foreground">
                            {item.comentario}
                          </p>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Section>
  );
}

import { useQuery } from "@tanstack/react-query";
import { CircleCheck } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuthSessionQuery } from "@/modules/auth/hooks/use-auth-session";
import { canAccessRiesgoTools } from "@/modules/auth/utils/auth-user";
import {
  currentPeriod,
  cutoffQueryKey,
  displayDate,
  getMonthlyCutoff,
  isAmejucaLine,
} from "./api";
export function MonthlyCutoffNotice({
  lineId,
  hasLoan = false,
}: {
  lineId?: string | null;
  hasLoan?: boolean;
}) {
  const period = currentPeriod();
  const applies = isAmejucaLine(lineId) && !hasLoan;
  const session = useAuthSessionQuery();
  const query = useQuery({
    queryKey: cutoffQueryKey(period),
    queryFn: () => getMonthlyCutoff(period),
    enabled: applies,
    staleTime: 30_000,
    refetchInterval: applies ? 60_000 : false,
  });
  if (!applies) return null;

  const canManage = canAccessRiesgoTools(session.data);
  const record = query.data?.record;
  if (!query.isError && record) {
    return (
      <div
        role="status"
        className="mb-3 flex flex-wrap items-center justify-between gap-x-2 border-b border-border-soft text-xs sm:gap-x-3 sm:text-sm"
      >
        <span className="flex min-h-9 flex-wrap items-center gap-x-1.5 text-foreground-secondary">
          <CircleCheck aria-hidden="true" className="size-4 shrink-0" />
          <span>Corte AMEJUCA</span>
          <span aria-hidden="true">·</span>
          <time
            dateTime={record.cutoffDate}
            className="font-medium text-foreground tabular-nums"
          >
            {displayDate(record.cutoffDate)}
          </time>
        </span>
        {canManage ? (
          <Link
            className="inline-flex min-h-11 items-center rounded-sm text-foreground-secondary underline underline-offset-4 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 sm:min-h-8"
            to="/solicitudes/fechas-de-corte"
          >
            Modificar corte
          </Link>
        ) : null}
      </div>
    );
  }

  return (
    <div
      role="status"
      className="my-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-950"
    >
      <p className="font-semibold">
        {query.isError
          ? "No pudimos comprobar el corte de AMEJUCA"
          : query.isPending
            ? "Consultando el corte de AMEJUCA..."
            : "Corte del mes pendiente de confirmar"}
      </p>
      <p>
        {record
          ? "El cálculo usa la fecha confirmada del mes. Guardá las condiciones antes de generar el préstamo."
          : "El primer vencimiento es estimado hasta confirmar el corte mensual."}
      </p>
      {canManage ? (
        <Link
          className="font-semibold underline"
          to="/solicitudes/fechas-de-corte"
        >
          Configurar fecha de corte
        </Link>
      ) : null}
    </div>
  );
}

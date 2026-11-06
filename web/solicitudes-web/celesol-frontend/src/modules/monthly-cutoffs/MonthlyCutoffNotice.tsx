import { useQuery } from "@tanstack/react-query";
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
            : query.data?.record
              ? `Corte confirmado de AMEJUCA: ${displayDate(query.data.record.cutoffDate)}`
              : "Corte del mes pendiente de confirmar"}
      </p>
      <p>
        {query.data?.record
          ? "El cálculo usa la fecha confirmada del mes. Guardá las condiciones antes de generar el préstamo."
          : "El primer vencimiento es estimado hasta confirmar el corte mensual."}
      </p>
      {canAccessRiesgoTools(session.data) ? (
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

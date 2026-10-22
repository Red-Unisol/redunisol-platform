import { useEffect, useState } from "react";
import { recientesRefreshLabel } from "../utils/recientes-refresh-options";

type Props = {
  dataUpdatedAt: number;
  isError: boolean;
  isFetching: boolean;
  isPaused: boolean;
};

export function RecientesRefreshIndicator(props: Props) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  // El reloj vive separado: no vuelve a renderizar tabla, filtros ni diálogos.
  return (
    <span className="ml-auto text-xs text-foreground-secondary" aria-live="off">
      {recientesRefreshLabel({ ...props, now })}
    </span>
  );
}

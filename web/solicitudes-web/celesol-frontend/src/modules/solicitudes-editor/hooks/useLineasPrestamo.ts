import { useCallback, useEffect, useRef, useState } from "react";

import { getLineasPrestamoParaAlta } from "@/modules/solicitudes-core/services/solicitudes-core-api";
import type { LineaPrestamoPresolicitud } from "@/modules/solicitudes/types/solicitudes";

export function useLineasPrestamo(isDetailRoute: boolean) {
  const [isLoadingLineas, setIsLoadingLineas] = useState(false);
  const [lineas, setLineas] = useState<LineaPrestamoPresolicitud[]>([]);
  const requests = useRef({ version: 0 });

  const refreshLineas = useCallback(async () => {
    if (isDetailRoute) return;

    const version = ++requests.current.version;
    setIsLoadingLineas(true);
    try {
      const rows = await getLineasPrestamoParaAlta();
      if (version === requests.current.version) setLineas(rows);
    } catch {
      // Conserva el último catálogo disponible. El alta valida la variante al guardar.
    } finally {
      if (version === requests.current.version) setIsLoadingLineas(false);
    }
  }, [isDetailRoute]);

  useEffect(() => {
    if (isDetailRoute) return;

    const refresh = () => {
      void refreshLineas();
    };
    const mountedRequests = requests.current;
    refresh();
    window.addEventListener("focus", refresh);
    return () => {
      mountedRequests.version++;
      window.removeEventListener("focus", refresh);
    };
  }, [isDetailRoute, refreshLineas]);

  return {
    isLoadingLineas: !isDetailRoute && isLoadingLineas,
    lineas,
    setLineas,
    refreshLineas,
  };
}

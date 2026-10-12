import { useCallback, useEffect, useState } from "react";

import { getLineasPrestamoByAgente } from "@/modules/solicitudes/services/solicitudes-api";
import type { LineaPrestamoPresolicitud } from "@/modules/solicitudes/types/solicitudes";

export function useLineasPrestamo(isDetailRoute: boolean) {
  const [isLoadingLineas, setIsLoadingLineas] = useState(false);
  const [lineas, setLineas] = useState<LineaPrestamoPresolicitud[]>([]);

  const refreshLineas = useCallback(async () => {
    if (isDetailRoute) return;
    setIsLoadingLineas(true);
    try {
      const rows = await getLineasPrestamoByAgente();
      setLineas(rows.filter(linea => linea.vigente !== false));
    } catch {
      // Los controles de cálculo/guardado consultan el legacy y muestran el fallo.
    } finally { setIsLoadingLineas(false); }
  }, [isDetailRoute]);
  useEffect(() => {
    const refresh = () => { void refreshLineas(); };
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [refreshLineas]);

  useEffect(() => {
    if (isDetailRoute) {
      return;
    }

    let isMounted = true;

    async function loadLineasPrestamo() {
      setIsLoadingLineas(true);

      try {
        const rows = await getLineasPrestamoByAgente();

        if (!isMounted) {
          return;
        }

        setLineas(rows.filter((linea) => linea.vigente !== false));
      } finally {
        if (isMounted) {
          setIsLoadingLineas(false);
        }
      }
    }

    void loadLineasPrestamo();

    return () => {
      isMounted = false;
    };
  }, [isDetailRoute]);

  return { isLoadingLineas, lineas, setLineas, refreshLineas };
}

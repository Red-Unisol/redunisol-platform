import { useEffect, useState } from "react";

import { getLineasPrestamoByAgente } from "@/modules/solicitudes/services/solicitudes-api";
import type { LineaPrestamoPresolicitud } from "@/modules/solicitudes/types/solicitudes";

export function useLineasPrestamo(isDetailRoute: boolean) {
  const [isLoadingLineas, setIsLoadingLineas] = useState(false);
  const [lineas, setLineas] = useState<LineaPrestamoPresolicitud[]>([]);

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

  return { isLoadingLineas, lineas, setLineas };
}

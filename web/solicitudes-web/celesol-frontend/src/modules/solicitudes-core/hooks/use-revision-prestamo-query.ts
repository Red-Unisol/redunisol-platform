import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getRevisionPrestamo } from "../services/solicitudes-core-api";
import { solicitudesCoreQueryKeys } from "../services/solicitudes-core-query-keys";

export function useRevisionPrestamoQuery(id: string, condiciones: string) {
  const [apertura] = useState(() => crypto.randomUUID());
  return useQuery({
    queryKey: [
      ...solicitudesCoreQueryKeys.revisionPrestamo(id, condiciones),
      apertura,
    ],
    queryFn: () => getRevisionPrestamo(id),
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    retry: false,
  });
}

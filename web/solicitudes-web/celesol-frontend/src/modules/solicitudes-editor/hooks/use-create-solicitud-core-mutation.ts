import { useMutation } from "@tanstack/react-query";

import { createSolicitudCore } from "@/modules/solicitudes-core/services/solicitudes-core-api";
import type { CreateSolicitudCoreRequest } from "@/modules/solicitudes/types/solicitudes-core";

export function useCreateSolicitudCoreMutation() {
  return useMutation({
    mutationFn: (payload: CreateSolicitudCoreRequest) =>
      createSolicitudCore(payload),
  });
}

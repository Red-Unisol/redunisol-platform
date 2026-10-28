import type { ConvenioSocioEdicion } from "../../domain/services/ConvenioSocioGateway";

export type CreatePrestamoLegacyInput = {
  /**
   * Solo campos editados, con su valor original para detectar conflictos.
   * Sin el campo, no se toca el socio.
   */
  convenio?: ConvenioSocioEdicion;
  currentUser: {
    id: string;
    isSystemAdmin?: boolean;
    workflowOwnerId: string;
  };
  solicitudId: string;
};

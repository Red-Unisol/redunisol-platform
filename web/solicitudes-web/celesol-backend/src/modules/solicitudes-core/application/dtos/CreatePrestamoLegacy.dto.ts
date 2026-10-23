import type { ConvenioSocio } from "../../domain/services/ConvenioSocioGateway";

export type CreatePrestamoLegacyInput = {
  /**
   * Datos del convenio como deben quedar en Vimarx, editados en el modal de
   * Generar prestamo. Sin el campo, no se toca el socio.
   */
  convenio?: ConvenioSocio;
  currentUser: {
    id: string;
    isSystemAdmin?: boolean;
    workflowOwnerId: string;
  };
  solicitudId: string;
};

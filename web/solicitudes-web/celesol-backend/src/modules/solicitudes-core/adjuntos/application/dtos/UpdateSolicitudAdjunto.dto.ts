import type { AuthWorkflowOwner } from "../../../../auth/domain/entities/User.entity";
export type UpdateSolicitudAdjuntoInput = {
  solicitudId: string;
  adjuntoId: string;
  updatedBy: string;
  currentUser: {
    id: string;
    isSystemAdmin?: boolean;
    workflowOwners?: AuthWorkflowOwner[];
    workflowOwnerId: string | null;
  };
  workflowOwnerId: string;
  tipoAdjunto?: string;
  descripcion?: string;
  adicional?: string;
  comentario?: string;
  nroDocumento?: string;
  restringido?: boolean;
};

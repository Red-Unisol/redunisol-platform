import type { AuthWorkflowOwner } from "../../../../auth/domain/entities/User.entity";
export type UploadSolicitudAdjuntoInput = {
  solicitudId: string;
  createdBy: string;
  currentUser: {
    id: string;
    isSystemAdmin?: boolean;
    workflowOwners?: AuthWorkflowOwner[];
    workflowOwnerId: string | null;
  };
  workflowOwnerId: string;
  file: {
    buffer: Buffer;
    fileName: string;
    mimeType: string;
    size: number;
  };
  tipoAdjunto?: string;
  descripcion?: string;
  adicional?: string;
  comentario?: string;
  nroDocumento?: string;
  restringido?: boolean;
};

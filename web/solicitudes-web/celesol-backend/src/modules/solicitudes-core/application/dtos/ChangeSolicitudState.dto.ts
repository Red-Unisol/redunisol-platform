import type { AuthWorkflowOwner } from "../../../auth/domain/entities/User.entity";
import type { UpdateSolicitudInput } from "./UpdateSolicitud.dto";

export type ChangeSolicitudStateInput = {
  expectedUpdatedAt?: string;
  changes?: Pick<UpdateSolicitudInput, "titular" | "solicitud" | "datosLaborales" | "conyuge" | "garantias">;
  administrativeCorrection?: { expectedUpdatedAt: string; requestId: string };
  actionCode: string;
  comment?: string;
  currentUser: {
    id: string;
    isSystemAdmin?: boolean;
    workflowOwners?: AuthWorkflowOwner[];
    workflowOwnerId: string;
  };
  motivo?: string;
  solicitudId: string;
};

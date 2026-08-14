import type { SolicitudCoreState } from "../entities/SolicitudCore.entity";

export type WorkflowStateCatalog = {
  getInitialState(): Promise<SolicitudCoreState | null>;
};

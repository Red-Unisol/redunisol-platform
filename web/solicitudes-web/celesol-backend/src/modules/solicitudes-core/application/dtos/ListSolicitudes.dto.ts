export type ListSolicitudesInput = {
  createdFrom?: string;
  createdTo?: string;
  excludeEstado?: string;
  estado?: string;
  limit: number;
  nroDocumento?: string;
  offset: number;
  scope: "historicas" | "recientes" | "tracking" | "work";
  currentUser: {
    id: string;
    isSystemAdmin?: boolean;
    workflowOwnerId: string | null;
  };
  workflowOwnerId?: string;
};

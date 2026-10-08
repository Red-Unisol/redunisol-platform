export type ListSolicitudesInput = {
  /**
   * Solo para Vendedores: ids de quienes crearon las solicitudes que puede
   * ver (las suyas y, si es dueño de un agente, las de sus vendedores).
   * Sin definir, no se filtra por creador.
   */
  creadoresVisibles?: string[];
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

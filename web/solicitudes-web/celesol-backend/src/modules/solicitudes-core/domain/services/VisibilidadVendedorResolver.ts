/**
 * Que solicitudes ve un usuario de Vendedores, por quien las creo.
 *
 * - Un vendedor ve las que creo el.
 * - El dueño de un agente (el Usuario del AgenteSolicitud en Vimarx) ve
 *   ademas las que crearon los vendedores de ese agente.
 *
 * Las demas areas (Riesgo, Tesoreria) y los admin no pasan por aca: ven todo.
 */
export type VisibilidadVendedorResolver = {
  /** Ids de usuarios de Sol Web cuyas solicitudes puede ver. Incluye el propio. */
  creadoresVisibles(usuario: { id: string; legacyUser: string }): Promise<string[]>;
};

export function esUsuarioVendedor(usuario: {
  isSystemAdmin: boolean;
  workflowOwner?: { code: string } | null;
}) {
  return !usuario.isSystemAdmin && usuario.workflowOwner?.code === "VENDEDORES";
}

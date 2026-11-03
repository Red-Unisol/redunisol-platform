// Una sola regla para los cambios de estado en toda la web: en cada estado hay
// una accion principal (y a veces una secundaria) a la vista; el resto va en
// "Mas acciones", con las que terminan la solicitud al final y en rojo.
// Todo por actionCode: los nombres de la base ("PreAprobada", "Rechazada",
// "Revisar/Reenviar") no se tocan porque son los de la configuracion.

// Nombre en pantalla de cada accion: un verbo y, si hace falta, a donde va.
const ETIQUETA_DE_ACCION: Record<string, string> = {
  confirmar: "Confirmar",
  desestimar: "Desestimar",
  devolver_a_liquidada: "Devolver a Liquidada",
  enviar: "Enviar a Riesgo",
  liquidar: "Mandar a revisar firma",
  liquidar_con_firma: "Mandar a transferir",
  motor: "Pasar a Riesgo",
  pagar: "Marcar como pagada",
  preaprobar: "Pre aprobar",
  rechazar: "Rechazar",
  revisar: "Devolver al vendedor",
  revisar_monto_cuota: "Pedir otro monto o cuota",
  revisar_reenviar: "Reenviar a Riesgo",
  transferir: "Mandar a transferir",
  vencer: "Marcar vencida",
  verificar_firma: "Mandar a verificar firma",
};

// Lo que se hace habitualmente en cada estado. Confirmada y Verificar firma
// tienen ademas pasos propios (generar el prestamo, revisar la firma) que el
// detalle pone como principal cuando corresponden.
export const ACCIONES_DE_ESTADO: Record<
  string,
  { primaria?: string; secundaria?: string }
> = {
  CargaVendedor: { primaria: "enviar" },
  Confirmada: { primaria: "liquidar", secundaria: "revisar" },
  Liquidada: { primaria: "transferir" },
  PreAprobada: { primaria: "confirmar" },
  Revisar: { primaria: "revisar_reenviar" },
  RevisionRiesgo: { primaria: "preaprobar", secundaria: "revisar" },
  Transferir: { primaria: "pagar" },
  VerificarFirmaYDocumentacion: { primaria: "transferir" },
};

// Terminan la solicitud: van al final del menu, separadas y en rojo.
const ACCIONES_QUE_TERMINAN = new Set(["desestimar", "rechazar", "vencer"]);

export function etiquetaDeAccion(
  actionCode: string,
  actionLabel?: string | null,
) {
  return ETIQUETA_DE_ACCION[actionCode] ?? actionLabel?.trim() ?? actionCode;
}

export function terminaLaSolicitud(actionCode: string) {
  return ACCIONES_QUE_TERMINAN.has(actionCode);
}

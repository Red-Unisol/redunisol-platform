// Nombre de cada estado como se muestra en pantalla. En la base quedan los
// nombres de la migracion inicial ("Revision Riesgo", "Pre Aprobada"...): no se
// tocan porque hay codigo que compara por ese texto. Por codigo de estado.
const NOMBRE_POR_CODIGO: Record<string, string> = {
  CargaVendedor: "Carga vendedor",
  PreAprobada: "Preaprobada",
  RevisionRiesgo: "Revisión de Riesgo",
  VerificarFirmaYDocumentacion: "Verificar firma y documentación",
};

export function nombreEstado(
  code: string | null | undefined,
  name: string | null | undefined,
) {
  return (code && NOMBRE_POR_CODIGO[code]) || name?.trim() || code || "";
}

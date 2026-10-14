import { apiClient, fetchConSesion } from "@/shared/services/http/api-client";
export type ConfiguracionReconocimiento = {
  habilitado: boolean;
  version: number;
};
export type ResultadoReconocimiento = {
  resultado:
    | "recibo"
    | "no_recibo"
    | "indeterminado"
    | "error"
    | "deshabilitado";
  version: number;
  motivo?: "credencial" | "proveedor" | "formato" | "procesamiento";
};
const base = "/solicitudes/reconocimiento-recibos";
export const getConfiguracionReconocimiento = () =>
  apiClient.get<ConfiguracionReconocimiento>(`${base}/configuracion`);
export const updateConfiguracionReconocimiento = (habilitado: boolean) =>
  apiClient.patch<ConfiguracionReconocimiento>(`${base}/configuracion`, {
    habilitado,
  });
export async function analizarRecibo(
  file: File,
  solicitudId: string | undefined,
  signal: AbortSignal,
): Promise<ResultadoReconocimiento> {
  const body = new FormData();
  body.append("file", file);
  const response = await fetchConSesion(
    solicitudId
      ? `${base}/${encodeURIComponent(solicitudId)}/analizar`
      : `${base}/alta`,
    { method: "POST", body, signal },
  );
  if (!response.ok) throw new Error("No se pudo analizar el documento");
  const result = (await response.json()) as ResultadoReconocimiento;
  if (
    ![
      "recibo",
      "no_recibo",
      "indeterminado",
      "error",
      "deshabilitado",
    ].includes(result.resultado) ||
    !Number.isSafeInteger(result.version)
  )
    throw new Error("Respuesta inválida");
  return result;
}

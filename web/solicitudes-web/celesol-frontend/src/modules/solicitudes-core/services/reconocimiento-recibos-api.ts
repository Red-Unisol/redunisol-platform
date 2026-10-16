import { ApiError } from "@/shared/services/http/api-error";
import { ReconocimientoRequestError } from "../utils/reconocimiento-recibos-draft";
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
  codigoError?: string;
  motivo?: "credencial" | "proveedor" | "formato" | "procesamiento";
};
const base = "/solicitudes/reconocimiento-recibos";
export const getConfiguracionReconocimiento = () =>
  apiClient
    .get<ConfiguracionReconocimiento>(`${base}/configuracion`)
    .catch((error) => {
      if (error instanceof ApiError)
        throw new ReconocimientoRequestError(error.status ?? 0);
      throw error;
    });
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
  ).catch((error) => {
    if (error instanceof TypeError) throw new ReconocimientoRequestError(0);
    throw error;
  });
  if (!response.ok) throw new ReconocimientoRequestError(response.status);
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

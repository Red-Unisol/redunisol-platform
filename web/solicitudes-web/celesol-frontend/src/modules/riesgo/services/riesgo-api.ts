import { ApiError } from "@/shared/services/http/api-error";
import { DEFAULT_HTTP_TIMEOUT_MS } from "@/shared/services/http/http.constants";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

function resolveErrorMessage(responseText: string) {
  if (!responseText) {
    return "No se pudo completar la solicitud.";
  }

  try {
    const parsed = JSON.parse(responseText) as {
      error?: { message?: string };
      message?: string;
    };
    return parsed.error?.message ?? parsed.message ?? responseText;
  } catch {
    return responseText;
  }
}

export type CalculadoraMutualDatos = {
  antiguedadLaboral: number | null;
  compromisoMensualVigente: number | null;
  convenio: string | null;
  cuitTitular: string | null;
  cuotaResultante: number | null;
  cuotas: number | null;
  cupoDisponibleVendedor: number | null;
  dniTitular: string | null;
  fechaPrimerVencimiento: string | null;
  fechaSolicitud: string | null;
  ingresos: number | null;
  lineaDescripcion: string | null;
  lineaId: number | null;
  montoAFinanciar: number | null;
  nombreCompletoTitular: string | null;
  nroSolicitud: string | null;
  rechazosDelMes: number | null;
  saldoPrestamosVigentes: number | null;
  situacionSocio: string | null;
  titularNuevo: boolean | null;
  vendedor: string | null;
};

async function fetchCalculadoraMutualDatos(
  path: string,
): Promise<CalculadoraMutualDatos> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(
    () => controller.abort(),
    DEFAULT_HTTP_TIMEOUT_MS,
  );

  try {
    const response = await fetch(new URL(path, API_BASE_URL), {
      credentials: "include",
      method: "GET",
      signal: controller.signal,
    });

    if (!response.ok) {
      const responseText = await response.text();
      throw new ApiError(resolveErrorMessage(responseText), response.status);
    }

    return (await response.json()) as CalculadoraMutualDatos;
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }

    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ApiError(
        "La solicitud excedió el tiempo límite.",
        undefined,
        error,
      );
    }

    throw new ApiError("No se pudo conectar con el backend.", undefined, error);
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export function getCalculadoraMutualDatos(
  solicitudOid: string,
): Promise<CalculadoraMutualDatos> {
  return fetchCalculadoraMutualDatos(
    `/api/riesgo/calculadora/${encodeURIComponent(solicitudOid)}/datos`,
  );
}

export function getCalculadoraMutualDatosByCoreId(
  solicitudId: string,
): Promise<CalculadoraMutualDatos> {
  return fetchCalculadoraMutualDatos(
    `/api/riesgo/calculadora/core/${encodeURIComponent(solicitudId)}/datos`,
  );
}

export async function getCalculadoraRiesgoFile(): Promise<Blob> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(
    () => controller.abort(),
    DEFAULT_HTTP_TIMEOUT_MS,
  );

  try {
    const response = await fetch(
      new URL("/api/riesgo/calculadora", API_BASE_URL),
      {
        credentials: "include",
        method: "GET",
        signal: controller.signal,
      },
    );

    if (!response.ok) {
      const responseText = await response.text();
      throw new ApiError(resolveErrorMessage(responseText), response.status);
    }

    return await response.blob();
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }

    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ApiError(
        "La solicitud excedió el tiempo límite.",
        undefined,
        error,
      );
    }

    throw new ApiError("No se pudo conectar con el backend.", undefined, error);
  } finally {
    window.clearTimeout(timeoutId);
  }
}

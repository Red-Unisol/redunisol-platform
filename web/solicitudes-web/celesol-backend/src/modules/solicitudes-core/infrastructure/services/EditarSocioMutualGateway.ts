import {
  ConvenioSocioLegacyRechazadoError,
  PrestamoLegacyUnavailableError,
} from "../../domain/solicitudes-core-errors";

type Fetcher = (
  input: string | URL,
  init?: RequestInit,
) => Promise<{
  json(): Promise<unknown>;
  ok: boolean;
}>;

type EditarSocioMutualGatewayConfig = {
  baseUrl: string;
  timeoutMs: number;
};

const EDITAR_OBJETO_PATH = "/api/Empresa/EditarObjeto";

// Edita campos de un F.Module.SocioMutual existente con EditarObjeto.
//
// - socioLegacyId es el ID del socio (nroSocioLegacy en Sol Web), no el NroSocio.
// - Los valores van como texto: el legado los convierte (numeros en formato
//   invariante, "" en un numero lo deja en 0).
// - SocAux se manda con la ruta en la clave ("SocAux.Caja40"): edita el SocAux
//   del socio en el lugar. Anidado ({"SocAux": {...}}) crea un SocAux nuevo con
//   solo esos campos y deja el anterior huerfano. Verificado en FapiTest el
//   23/10/2026.
// - Requiere el permiso de tarea EditarObjetos en Vimarx. Sin el permiso la API
//   responde 500 sin cuerpo.
export class EditarSocioMutualGateway {
  private readonly baseUrl: string;
  private readonly fetcher: Fetcher;
  private readonly timeoutMs: number;

  constructor(config: EditarSocioMutualGatewayConfig, fetcher: Fetcher = fetch) {
    this.baseUrl = config.baseUrl;
    this.fetcher = fetcher;
    this.timeoutMs = config.timeoutMs;
  }

  async editar(
    socioLegacyId: string,
    campos: Record<string, string>,
  ): Promise<void> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Awaited<ReturnType<Fetcher>>;

    try {
      response = await this.fetcher(
        new URL(EDITAR_OBJETO_PATH, this.baseUrl),
        {
          body: JSON.stringify({
            tipo: "SocioMutual",
            id: socioLegacyId,
            campos,
          }),
          headers: {
            "Content-Type": "application/json",
          },
          method: "POST",
          signal: controller.signal,
        },
      );
    } catch {
      clearTimeout(timeoutId);
      throw new PrestamoLegacyUnavailableError();
    }

    clearTimeout(timeoutId);

    let body: unknown;

    try {
      body = await response.json();
    } catch {
      throw new PrestamoLegacyUnavailableError();
    }

    const row = (body ?? {}) as Record<string, unknown>;

    if (row.Ok !== true) {
      throw new ConvenioSocioLegacyRechazadoError(
        typeof row.Error === "string" && row.Error.trim().length > 0
          ? row.Error
          : "el legado no confirmó el cambio.",
      );
    }
  }
}

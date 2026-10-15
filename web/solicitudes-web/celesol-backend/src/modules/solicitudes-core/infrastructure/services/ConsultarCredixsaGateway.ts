type Fetcher = (
  input: string | URL,
  init?: RequestInit,
) => Promise<{ json(): Promise<unknown>; ok: boolean }>;

type Config = {
  /**
   * URL completa del webhook, con la clave incluida. Se guarda entera en la
   * configuracion en vez de armarla en el codigo para que la clave no ande
   * dando vueltas por el repositorio, igual que hace redunisol-web con los
   * webhooks de Kestra.
   *
   * Vacia deshabilita la consulta sin romper nada.
   */
  webhookUrl: string;
};

/**
 * Lo que devuelve el flow de Kestra. Los nombres son los de sus salidas.
 *
 * "normalized_json" es el informe ya estructurado (persona, bcra, previsional,
 * aportes, quiebras, alertas). Los otros dos json son la respuesta cruda de
 * CredixSA, que por ahora no usamos.
 */
export type InformeCredixsa = {
  cachedAt: string;
  cacheHit: boolean;
  cuit: string;
  error: string;
  informe: unknown;
  nombre: string;
  ok: boolean;
  status: string;
};

export type ConsultarCredixsaInput = {
  /** CUIL de 11 digitos, documento, o vacio si no hay ninguno. */
  cuit: string;
  nombre: string;
  solicitudId: string;
};

/**
 * Le pide a Kestra el informe de CredixSA de una persona.
 *
 * Nunca propaga errores: si Kestra o CredixSA estan caidos devuelve null y
 * decide quien llama. Para la pestaña "no se pudo consultar" es un estado
 * valido, no un error del servidor; y en el alta de una solicitud, una
 * consulta caida no puede impedir que se guarde.
 */
export class ConsultarCredixsaGateway {
  private readonly fetcher: Fetcher;
  private readonly webhookUrl: string;

  constructor(config: Config, fetcher: Fetcher = fetch) {
    this.fetcher = fetcher;
    this.webhookUrl = config.webhookUrl;
  }

  /**
   * La peticion queda abierta hasta que Kestra termina: la cola del flow, si
   * tiene, mas el scraping de CredixSA si la cache esta fria. Por eso el
   * timeout lo elige quien llama.
   */
  async obtenerInforme(
    input: ConsultarCredixsaInput,
    timeoutMs: number,
  ): Promise<InformeCredixsa | null> {
    if (!this.webhookUrl.trim()) {
      return null;
    }

    // Sin ningun identificador no hay a quien consultar. CredixSA necesita al
    // menos uno de los dos.
    if (!input.cuit.trim() && !input.nombre.trim()) {
      return null;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await this.fetcher(this.webhookUrl, {
        body: JSON.stringify({
          cuit: input.cuit,
          nombre: input.nombre,
          solicitud_id: input.solicitudId,
        }),
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
        signal: controller.signal,
      });

      if (!response.ok) {
        return null;
      }

      return mapInforme(await response.json());
    } catch {
      return null;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

function mapInforme(body: unknown): InformeCredixsa | null {
  if (!body || typeof body !== "object") {
    return null;
  }

  const salidas = body as Record<string, unknown>;

  return {
    cachedAt: texto(salidas.cached_at),
    cacheHit: salidas.cache_hit === true,
    cuit: texto(salidas.cuit),
    error: texto(salidas.error),
    // El flow lo devuelve como string JSON, no como objeto.
    informe: parsearJson(texto(salidas.normalized_json)),
    nombre: texto(salidas.nombre),
    ok: salidas.ok === true,
    status: texto(salidas.status),
  };
}

function parsearJson(value: string): unknown {
  if (!value.trim()) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function texto(value: unknown): string {
  return typeof value === "string" ? value : "";
}

type Fetcher = (
  input: string | URL,
  init?: RequestInit,
) => Promise<{ json(): Promise<unknown>; ok: boolean }>;

type Config = {
  timeoutMs: number;
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
 * Le pide a Kestra que consulte CredixSA y deje el informe cacheado, para que
 * el analista lo encuentre listo cuando abra la solicitud.
 *
 * NO ESPERA LA RESPUESTA A PROPOSITO. La consulta puede tardar medio minuto
 * scrapeando CredixSA, y el vendedor esta del otro lado esperando que la
 * solicitud se guarde. Se dispara y se sigue.
 *
 * Por lo mismo nunca propaga errores: si Kestra o CredixSA estan caidos, el
 * analista consulta en el momento como hasta ahora. Bloquear el alta de una
 * solicitud por esta consulta seria peor que no hacerla.
 */
export class ConsultarCredixsaGateway {
  private readonly fetcher: Fetcher;
  private readonly timeoutMs: number;
  private readonly webhookUrl: string;

  constructor(config: Config, fetcher: Fetcher = fetch) {
    this.fetcher = fetcher;
    this.timeoutMs = config.timeoutMs;
    this.webhookUrl = config.webhookUrl;
  }

  /**
   * Igual que consultar(), pero espera la respuesta y devuelve el informe.
   *
   * Es lo que necesita la pestaña. El costo es que la peticion queda abierta
   * lo que tarde CredixSA -- por eso el timeout de esta via es mucho mas
   * generoso que el del disparo al crear la solicitud.
   *
   * Devuelve null en vez de fallar cuando no hay a quien consultar o cuando
   * Kestra no responde: para la pestaña "no se pudo consultar" es un estado
   * valido, no un error del servidor.
   */
  async obtenerInforme(
    input: ConsultarCredixsaInput,
    timeoutMs: number,
  ): Promise<InformeCredixsa | null> {
    if (!this.webhookUrl.trim()) {
      return null;
    }

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

  async consultar(input: ConsultarCredixsaInput): Promise<void> {
    if (!this.webhookUrl.trim()) {
      return;
    }

    // Sin ningun identificador no hay a quien consultar. CredixSA necesita al
    // menos uno de los dos.
    if (!input.cuit.trim() && !input.nombre.trim()) {
      return;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      await this.fetcher(this.webhookUrl, {
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
    } catch {
      // Silencio deliberado: ver el comentario de la clase.
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

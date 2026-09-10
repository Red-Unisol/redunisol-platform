type Fetcher = (
  input: string | URL,
  init?: RequestInit,
) => Promise<{ ok: boolean }>;

type Config = {
  timeoutMs: number;
  /**
   * URL completa del webhook, con la clave incluida. Se guarda entera en la
   * configuracion en vez de armarla en el codigo para que la clave no ande
   * dando vueltas por el repositorio, igual que hace redunisol-web con los
   * webhooks de Kestra.
   *
   * Vacia deshabilita el precalentamiento sin romper nada.
   */
  webhookUrl: string;
};

export type PrecalentarCredixsaInput = {
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
 * solicitud por un precalentamiento seria peor que no tenerlo.
 */
export class PrecalentarCredixsaGateway {
  private readonly fetcher: Fetcher;
  private readonly timeoutMs: number;
  private readonly webhookUrl: string;

  constructor(config: Config, fetcher: Fetcher = fetch) {
    this.fetcher = fetcher;
    this.timeoutMs = config.timeoutMs;
    this.webhookUrl = config.webhookUrl;
  }

  async precalentar(input: PrecalentarCredixsaInput): Promise<void> {
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

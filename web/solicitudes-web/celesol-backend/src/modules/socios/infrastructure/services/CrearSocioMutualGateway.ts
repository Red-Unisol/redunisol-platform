import {
  SocioMutualLegacyRechazadoError,
  SocioMutualLegacyUnavailableError,
} from "../../domain/socios-errors";

type Fetcher = (
  input: string | URL,
  init?: RequestInit,
) => Promise<{
  json(): Promise<unknown>;
  ok: boolean;
}>;

type CrearSocioMutualGatewayConfig = {
  baseUrl: string;
  timeoutMs: number;
};

export type CrearSocioMutualDomicilio = {
  calle: string;
  codigoPostal: string;
  localidad: string;
  nroPuerta: string;
};

export type CrearSocioMutualInput =
  | {
      tipoPersona: "FISICA";
      apellido: string;
      celular?: string | null;
      cuit: string;
      domicilio: CrearSocioMutualDomicilio;
      email?: string | null;
      fechaDeNacimiento: string;
      nombre: string;
      nroDocumento: string;
      sexo: string;
    }
  | {
      tipoPersona: "JURIDICA";
      celular?: string | null;
      cuit: string;
      domicilio: CrearSocioMutualDomicilio;
      email?: string | null;
      razonSocial: string;
    };

export type CrearSocioMutualResult = {
  id: string;
};

const CREAR_SOCIO_MUTUAL_PATH = "/api/Simulador/CrearSocioMutual";
const HISTORIA_CATEGORIAS_FIJA = [{ Categoria: 2, Fecha: "2020-01-01" }];
// El legado espera un codigo numerico de tipo de documento (ej. "96" para
// DNI), no nuestros valores locales ("DNI", "LC", etc.). Por decision de
// negocio siempre se manda DNI, sea cual sea el tipo de documento cargado
// en Celesol.
const TIPO_DOCUMENTO_FIJO = "96";

export class CrearSocioMutualGateway {
  private readonly baseUrl: string;
  private readonly fetcher: Fetcher;
  private readonly timeoutMs: number;

  constructor(config: CrearSocioMutualGatewayConfig, fetcher: Fetcher = fetch) {
    this.baseUrl = config.baseUrl;
    this.fetcher = fetcher;
    this.timeoutMs = config.timeoutMs;
  }

  async crear(input: CrearSocioMutualInput): Promise<CrearSocioMutualResult> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Awaited<ReturnType<Fetcher>>;

    try {
      response = await this.fetcher(
        new URL(CREAR_SOCIO_MUTUAL_PATH, this.baseUrl),
        {
          body: JSON.stringify({
            campos: {
              ...this.buildPersonaFields(input),
              Celular: input.celular ?? undefined,
              CUIT: input.cuit,
              Domicilio: this.buildDomicilio(input.domicilio),
              Email: input.email ?? undefined,
              HistoriaCategorias: HISTORIA_CATEGORIAS_FIJA,
            },
            validar: false,
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
      throw new SocioMutualLegacyUnavailableError();
    }

    clearTimeout(timeoutId);

    let body: unknown;

    try {
      body = await response.json();
    } catch {
      throw new SocioMutualLegacyUnavailableError();
    }

    return this.parseResponse(body);
  }

  private buildPersonaFields(
    input: CrearSocioMutualInput,
  ): Record<string, unknown> {
    if (input.tipoPersona === "FISICA") {
      return {
        Apellido: input.apellido,
        FechaDeNacimiento: input.fechaDeNacimiento,
        Nombre: input.nombre,
        NroDoc: input.nroDocumento,
        Sexo: input.sexo,
        TipoDoc: TIPO_DOCUMENTO_FIJO,
      };
    }

    return {
      Apellido: input.razonSocial,
      Nombre: "",
      Sexo: "PersonaJuridica",
    };
  }

  private buildDomicilio(
    domicilio: CrearSocioMutualDomicilio,
  ): Record<string, unknown> {
    return {
      Calle: domicilio.calle,
      CodigoPostal: domicilio.codigoPostal,
      Localidad: Number(domicilio.localidad),
      NroPuerta: domicilio.nroPuerta,
    };
  }

  private parseResponse(body: unknown): CrearSocioMutualResult {
    const row = body as Record<string, unknown>;

    if (row.Ok !== true) {
      const message =
        typeof row.Error === "string" && row.Error.trim().length > 0
          ? row.Error
          : "No se pudo dar de alta el socio en el legado.";

      throw new SocioMutualLegacyRechazadoError(message);
    }

    return { id: String(row.ID) };
  }
}

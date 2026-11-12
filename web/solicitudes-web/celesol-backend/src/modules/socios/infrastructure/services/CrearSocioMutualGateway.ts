import {
  SocioMutualLegacyRechazadoError,
  SocioMutualLegacyUnavailableError,
} from "../../domain/socios-errors";
import {
  SOCIO_CATEGORIA_ID_VIMARX,
  type SocioCategoria,
} from "../../domain/SocioCategoria";
import { hoyEnArgentina } from "../../../solicitudes-core/application/services/PlanCobroRefinanciacion";

type Fetcher = (
  input: string | URL,
  init?: RequestInit,
) => Promise<{
  json(): Promise<unknown>;
  ok: boolean;
}>;

type CrearSocioMutualGatewayConfig = {
  baseUrl: string;
  // Reloj para la fecha de la categoria (inyectable en tests).
  now?: () => Date;
  timeoutMs: number;
};

// Como en InsCreditB, solo calle y localidad son obligatorios: el numero de
// puerta y el codigo postal viajan solo si se cargaron.
export type CrearSocioMutualDomicilio = {
  calle: string;
  codigoPostal: string | null;
  localidad: string;
  nroPuerta: string | null;
};

// Datos del convenio que Vimarx guarda en SocAux del socio (Caja 40, Mudon =
// Beneficio, AMEJUCA = ConvAux). Solo viajan los que se cargaron.
export type CrearSocioMutualSocAux = {
  beneficio?: string;
  caja40?: number;
  convAux?: number;
};

export type CrearSocioMutualInput =
  | {
      tipoPersona: "FISICA";
      apellido: string;
      categoria: SocioCategoria;
      celular?: string | null;
      cuit: string;
      domicilio: CrearSocioMutualDomicilio;
      email?: string | null;
      fechaDeNacimiento: string;
      nombre: string;
      nroDocumento: string;
      observaciones?: string | null;
      sexo: string;
      socAux?: CrearSocioMutualSocAux | null;
    }
  | {
      tipoPersona: "JURIDICA";
      categoria: SocioCategoria;
      celular?: string | null;
      cuit: string;
      domicilio: CrearSocioMutualDomicilio;
      email?: string | null;
      observaciones?: string | null;
      razonSocial: string;
      socAux?: CrearSocioMutualSocAux | null;
    };

export type CrearSocioMutualResult = {
  id: string;
};

const CREAR_SOCIO_MUTUAL_PATH = "/api/Simulador/CrearSocioMutual";
// El legado espera un codigo numerico de tipo de documento (ej. "96" para
// DNI), no nuestros valores locales ("DNI", "LC", etc.). Por decision de
// negocio siempre se manda DNI, sea cual sea el tipo de documento cargado
// en Celesol.
const TIPO_DOCUMENTO_FIJO = "96";

// Vimarx recibe el nombre del sexo (como "PersonaJuridica"). Si en Sol Web
// quedo el codigo que devuelve EvaluateList (0 Masculino, 1 Femenino, 3 Otro;
// verificado en prod el 29/10), se traduce.
const SEXO_POR_CODIGO: Record<string, string> = {
  "0": "Masculino",
  "1": "Femenino",
  "3": "Otro",
};

function nombreSexoVimarx(sexo: string) {
  return SEXO_POR_CODIGO[sexo.trim()] ?? sexo;
}

export class CrearSocioMutualGateway {
  private readonly baseUrl: string;
  private readonly fetcher: Fetcher;
  private readonly now: () => Date;
  private readonly timeoutMs: number;

  constructor(config: CrearSocioMutualGatewayConfig, fetcher: Fetcher = fetch) {
    this.baseUrl = config.baseUrl;
    this.fetcher = fetcher;
    this.now = config.now ?? (() => new Date());
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
              HistoriaCategorias: this.buildHistoriaCategorias(input.categoria),
              Observaciones: input.observaciones ?? undefined,
              SocAux: this.buildSocAux(input.socAux),
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
        Sexo: nombreSexoVimarx(input.sexo),
        TipoDoc: TIPO_DOCUMENTO_FIJO,
      };
    }

    return {
      Apellido: input.razonSocial,
      Nombre: "",
      Sexo: "PersonaJuridica",
    };
  }

  // Antes iba fija CLUB MUTUAL (2) con fecha 2020-01-01, y Vimarx dejaba
  // tambien el alta del socio en esa fecha. Ahora va la categoria segun la
  // linea (o la elegida en Socios) con la fecha del dia, como en InsCreditB.
  private buildHistoriaCategorias(categoria: SocioCategoria) {
    return [
      {
        Categoria: SOCIO_CATEGORIA_ID_VIMARX[categoria],
        Fecha: hoyEnArgentina(this.now()),
      },
    ];
  }

  private buildDomicilio(
    domicilio: CrearSocioMutualDomicilio,
  ): Record<string, unknown> {
    return {
      Calle: domicilio.calle,
      CodigoPostal: domicilio.codigoPostal ?? undefined,
      Localidad: Number(domicilio.localidad),
      NroPuerta: domicilio.nroPuerta ?? undefined,
    };
  }

  private buildSocAux(
    socAux: CrearSocioMutualSocAux | null | undefined,
  ): Record<string, unknown> | undefined {
    const campos = {
      Beneficio: socAux?.beneficio,
      Caja40: socAux?.caja40,
      ConvAux: socAux?.convAux,
    };

    return Object.values(campos).some((value) => value !== undefined)
      ? campos
      : undefined;
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

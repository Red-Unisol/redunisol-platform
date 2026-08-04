import type { SolicitudesLegacyGateway } from "../../../solicitudes/domain/services/SolicitudesLegacyGateway";
import {
  SolicitudCoreNotFoundError,
  SolicitudPrestamoNoGeneradoError,
} from "../../domain/solicitudes-core-errors";
import type { SolicitudesCoreRepository } from "../../domain/repositories/SolicitudesCoreRepository";
import {
  formatArsCurrency,
  formatCftDecimalComma,
  formatDecimalCommaNoGrouping,
  formatMidnightIsoDate,
  parseArgentineDecimalString,
} from "../services/formatFinSolicitudFields";

export type GetFinSolicitudDatosInput = {
  sol: string;
};

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Replica el contrato de POST /api/redunisol/finSolicitud/:ntrans/:sol (ver
// finalizar-api-caja-celesol-contrato.txt) -- nombres de campo y
// capitalizacion heterogenea son intencionales, es lo que espera el
// consumidor externo.
export type FinSolicitudDatosResponse = {
  nombreSocio: string;
  cuotas: string;
  prestamoCFT: string | null;
  prestamoTEM: string | null;
  prestamoTNA: string | null;
  prestamoTEA: string | null;
  cuotaResultante: string | null;
  montoAfinanciar: string | null;
  NumeroPrestamo: number | null;
  CapitalOriginal: string | null;
  MontoPrestamo: string | null;
  PrimerVencimiento: string | null;
  Vencimiento: string | null;
  DNI: number | null;
  FechaNacimiento: string | null;
  Nacionalidad: string | null;
  TelefonoMovil: string | null;
  TelefonoFijo: string | null;
  Localidad: string | null;
  CodigoPostal: null;
  Calle: string | null;
  NroPuerta: string;
  PisoDpto: string;
  FechaEmision: string | null;
};

type Dependencies = {
  legacyGateway: SolicitudesLegacyGateway;
  repository: SolicitudesCoreRepository;
};

function toNullableInteger(value: string | null): number | null {
  if (value === null || value.trim() === "") {
    return null;
  }

  const parsed = Number(value);

  return Number.isNaN(parsed) ? null : parsed;
}

export class GetFinSolicitudDatosUseCase {
  private readonly legacyGateway: SolicitudesLegacyGateway;
  private readonly repository: SolicitudesCoreRepository;

  constructor(dependencies: Dependencies) {
    this.legacyGateway = dependencies.legacyGateway;
    this.repository = dependencies.repository;
  }

  async execute(
    input: GetFinSolicitudDatosInput,
  ): Promise<FinSolicitudDatosResponse> {
    // "sol" puede venir como nuestro uuid interno o como el legacyOid que
    // genera Vimax al otorgar el prestamo -- se distingue por formato.
    const solicitud = UUID_REGEX.test(input.sol)
      ? await this.repository.findById(input.sol)
      : ((await this.repository.findByLegacyOid?.(input.sol)) ?? null);

    if (!solicitud) {
      throw new SolicitudCoreNotFoundError();
    }

    if (!solicitud.legacyOid) {
      throw new SolicitudPrestamoNoGeneradoError();
    }

    const prestamo = await this.legacyGateway.getPrestamoOtorgadoByLegacyOid(
      solicitud.legacyOid,
    );

    if (!prestamo) {
      throw new SolicitudPrestamoNoGeneradoError();
    }

    const nombreSocio = [
      solicitud.titular.apellidoDenominacion,
      solicitud.titular.nombre,
    ]
      .filter((value) => value && value.trim().length > 0)
      .join(" ");

    return {
      Calle: solicitud.titular.domicilioCalle,
      CapitalOriginal: formatArsCurrency(prestamo.capital),
      CodigoPostal: null,
      cuotaResultante: formatDecimalCommaNoGrouping(
        parseArgentineDecimalString(solicitud.cuotaResultante),
        4,
      ),
      cuotas: solicitud.cuotas === null ? "" : String(solicitud.cuotas),
      DNI: toNullableInteger(solicitud.titular.nroDocumento),
      FechaEmision: formatMidnightIsoDate(prestamo.fechaEmision),
      FechaNacimiento: formatMidnightIsoDate(
        solicitud.titular.fechaNacimiento ?? null,
      ),
      Localidad: solicitud.titular.localidad,
      montoAfinanciar: formatArsCurrency(solicitud.montoAFinanciar),
      MontoPrestamo: formatArsCurrency(prestamo.montoPrestamo),
      Nacionalidad: solicitud.titular.nacionalidad ?? null,
      nombreSocio,
      NroPuerta: solicitud.titular.nroPuerta ?? "",
      NumeroPrestamo: toNullableInteger(prestamo.nroCuenta),
      PisoDpto: "",
      prestamoCFT: formatCftDecimalComma(prestamo.cft),
      prestamoTEA: formatDecimalCommaNoGrouping(prestamo.tea, 4),
      prestamoTEM: formatDecimalCommaNoGrouping(prestamo.tem, 4),
      prestamoTNA: formatDecimalCommaNoGrouping(prestamo.tna, 4),
      PrimerVencimiento: formatMidnightIsoDate(prestamo.primerVencimiento),
      TelefonoFijo: solicitud.titular.telefonoFijo ?? null,
      TelefonoMovil: solicitud.titular.celular,
      Vencimiento: formatMidnightIsoDate(prestamo.vencimiento),
    };
  }
}

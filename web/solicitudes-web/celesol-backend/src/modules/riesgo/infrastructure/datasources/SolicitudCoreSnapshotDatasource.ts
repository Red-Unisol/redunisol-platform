import type { Prisma } from "@prisma/client";

import type { DbClient } from "../../../../db/prisma";
import { parseArgentineDecimalString } from "../../../solicitudes-core/application/services/formatFinSolicitudFields";
import type { CalculadoraMutualSolicitudSnapshot } from "../services/CalculadoraMutualLegacyGateway";

const solicitudSnapshotInclude = {
  datosLaborales: true,
  titular: true,
} satisfies Prisma.SolicitudInclude;

type SolicitudSnapshotRecord = Prisma.SolicitudGetPayload<{
  include: typeof solicitudSnapshotInclude;
}>;

/**
 * Busca el snapshot de una solicitud directamente en el core (Postgres), sin
 * pasar por el legado.
 *
 * `findByLegacyOid` sirve para la calculadora standalone (`/riesgo/calculadora`,
 * que solo tiene un Oid de legado como input) -- solo devuelve algo cuando la
 * solicitud fue creada/handoff-eada al sistema nuevo y ese link ya quedó
 * seteado. Hoy (2026-07) todavía ningún flujo completa `Solicitud.legacyOid`,
 * pero el método queda listo para cuando exista el handoff a Vimax que
 * devuelva ese Oid.
 *
 * `findById` sirve para la pestaña "Calculadora" embebida en el detalle de
 * una solicitud del core: ahí ya sabemos qué solicitud es (su id propio),
 * así que no hace falta pasar por legacyOid en absoluto.
 *
 * `Convenio` no tiene equivalente en el core (no se persiste el texto de
 * "Términos y condiciones" de la línea), así que siempre viene null acá.
 */
export class SolicitudCoreSnapshotDatasource {
  private readonly prisma: DbClient;

  constructor(prisma: DbClient) {
    this.prisma = prisma;
  }

  async findById(
    id: string,
  ): Promise<CalculadoraMutualSolicitudSnapshot | null> {
    const record = await this.prisma.solicitud.findUnique({
      include: solicitudSnapshotInclude,
      where: { id },
    });

    return record ? mapSolicitudSnapshotRecord(record) : null;
  }

  async findByLegacyOid(
    legacyOid: string,
  ): Promise<CalculadoraMutualSolicitudSnapshot | null> {
    const record = await this.prisma.solicitud.findUnique({
      include: solicitudSnapshotInclude,
      where: { legacyOid },
    });

    return record ? mapSolicitudSnapshotRecord(record) : null;
  }
}

function mapSolicitudSnapshotRecord(
  record: SolicitudSnapshotRecord,
): CalculadoraMutualSolicitudSnapshot {
  return {
    antiguedadLaboral: record.datosLaborales?.antiguedadLaboralMeses ?? null,
    convenio: null,
    cuitTitular: record.titular?.cuit ?? null,
    // La cuota se guarda en formato argentino ("677.916,20"), asi que Number()
    // devolveria NaN. Se usa el mismo parser que el endpoint de firma.
    cuotaResultante: parseArgentineDecimalString(record.cuotaResultante),
    cuotas: record.cuotas,
    cupoDisponibleVendedor: record.cupoTitular
      ? Number(record.cupoTitular)
      : null,
    dniTitular: record.titular?.nroDocumento ?? null,
    fechaPrimerVencimiento: toDateOnly(record.fechaPrimerVencimiento),
    fechaSolicitud: toDateOnly(record.createdAt),
    ingresos: record.datosLaborales?.montoRecibo
      ? Number(record.datosLaborales.montoRecibo)
      : null,
    lineaDescripcion: record.lineaPrestamoDescripcion,
    lineaId: Number(record.lineaPrestamoLegacyOid),
    montoAFinanciar: record.montoAFinanciar
      ? Number(record.montoAFinanciar)
      : null,
    nombreCompletoTitular: buildNombreCompleto(
      record.titular?.nombre ?? null,
      record.titular?.apellidoDenominacion ?? null,
    ),
    nroSolicitud: record.nroSolicitud,
    vendedor: record.vendedorSolicitud,
  };
}

function toDateOnly(value: Date | null) {
  if (!value) {
    return null;
  }

  return value.toISOString().slice(0, 10);
}

function buildNombreCompleto(
  nombre: string | null,
  apellido: string | null,
) {
  const parts = [apellido, nombre].filter(
    (part): part is string => !!part && part.trim() !== "",
  );

  return parts.length > 0 ? parts.join(" ") : null;
}

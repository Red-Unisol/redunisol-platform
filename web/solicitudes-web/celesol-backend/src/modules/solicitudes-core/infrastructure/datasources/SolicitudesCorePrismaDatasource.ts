import type { DbClient } from "../../../../db/prisma";
import type { Prisma } from "@prisma/client";

import type {
  AnalistaDashboardStatsResult,
  AnalistaDashboardStatsV2Result,
  CreateSolicitudCoreRecord,
  GetAnalistaStatsInput,
  GetSolicitudesStatsInput,
  ListSolicitudesRecientesInput,
  ListSolicitudesByOwnerInput,
  ListSolicitudesTrackingInput,
  SolicitudesStatsResult,
  UpdateSolicitudCorePatch,
  VendedorDashboardStatsResult,
} from "../../domain/repositories/SolicitudesCoreRepository";
import { SolicitudCoreMapper } from "../mappers/SolicitudCore.mapper";

const solicitudInclude = {
  assignedToUser: {
    select: {
      email: true,
      firstName: true,
      id: true,
      lastName: true,
    },
  },
  conyuge: true,
  datosLaborales: true,
  estadoActual: {
    include: {
      owner: true,
    },
  },
  garantias: true,
  titular: true,
} satisfies Prisma.SolicitudInclude;

const solicitudDetailInclude = {
  ...solicitudInclude,
  participants: {
    select: {
      role: true,
      source: true,
      userId: true,
    },
  },
} satisfies Prisma.SolicitudInclude;

const ARGENTINA_UTC_OFFSET_HOURS = 3;
const DAY_IN_MS = 24 * 60 * 60 * 1000;
const RECIENTES_WINDOW_DAYS = 21;
// Solicitudes en Carga Vendedor son borradores del vendedor -- no se
// muestran en el dashboard de administracion (Operacion), a diferencia del
// dashboard de vendedor, que si necesita ver sus propios borradores.
const ADMIN_DASHBOARD_EXCLUDED_ESTADO_CODE = "CargaVendedor";
export const HISTORICAS_NEGATIVE_STATE_CODES = [
  "Rechazada",
  "Vencida",
  "Desestimada",
  "Cancelada",
  "Abandonada",
  "Transferir",
  "Pagada",
  "ParaTransferir",
] as const;
const ANALISTA_BACKLOG_ESTADO_CODES = ["RevisionRiesgo", "Confirmada", "Motor"];
const ANALISTA_TRANSICION_ESPERADA: Record<string, string> = {
  Confirmada: "Liquidada",
  Motor: "RevisionRiesgo",
  Revisar: "RevisionRiesgo",
  RevisionRiesgo: "Confirmada",
  VerificarFirmaYDocumentacion: "Transferir",
};

type SolicitudCreateExecutor = Pick<
  DbClient,
  "solicitud" | "solicitudEstadoHistorial" | "solicitudParticipant"
>;

export class SolicitudesCorePrismaDatasource {
  private readonly prisma: DbClient;

  constructor(prisma: DbClient) {
    this.prisma = prisma;
  }

  private static toDateOrNull(value: string | null | undefined) {
    if (value === undefined) {
      return undefined;
    }

    return value ? new Date(`${value}T00:00:00.000Z`) : null;
  }

  private static toDatePatchValue(value: string | null | undefined) {
    if (value === undefined) {
      return undefined;
    }

    return value ? new Date(`${value}T00:00:00.000Z`) : null;
  }

  private toGarantiaCreateInput(
    garantia: CreateSolicitudCoreRecord["garantias"][number],
  ) {
    return {
      antiguedadLaboralMeses: garantia.antiguedadLaboralMeses,
      casadoConTitular: garantia.casadoConTitular,
      celular: garantia.celular,
      cuit: garantia.cuit,
      denominacion: garantia.denominacion,
      domicilio: garantia.domicilio,
      edad: garantia.edad,
      email: garantia.email,
      estadoCivil: garantia.estadoCivil,
      fechaIngresoLaboral: garantia.fechaIngresoLaboral
        ? new Date(`${garantia.fechaIngresoLaboral}T00:00:00.000Z`)
        : null,
      fechaNacimiento: garantia.fechaNacimiento
        ? new Date(`${garantia.fechaNacimiento}T00:00:00.000Z`)
        : null,
      ingresoMensual: garantia.ingresoMensual,
      nacionalidad: garantia.nacionalidad,
      nombre: garantia.nombre,
      nombreCompleto: garantia.nombreCompleto,
      nroDocumento: garantia.nroDocumento,
      nroSocio: garantia.nroSocio,
      observaciones: garantia.observaciones,
      ocupacion: garantia.ocupacion,
      persona: garantia.persona,
      sexo: garantia.sexo,
      sumaIngresos: garantia.sumaIngresos,
      telefono: garantia.telefono,
      tipoDocumento: garantia.tipoDocumento,
      tipoGarantia: garantia.tipoGarantia,
      tipoRelacion: garantia.tipoRelacion,
    };
  }

  async create(input: CreateSolicitudCoreRecord) {
    const data = {
      creator: {
        connect: {
          id: input.createdBy,
        },
      },
      cuotaResultante: input.cuotaResultante,
      cuotas: input.cuotas,
      cupoTitular: input.cupoTitular,
      fechaPrimerVencimiento:
        SolicitudesCorePrismaDatasource.toDateOrNull(
          input.fechaPrimerVencimiento,
        ),
      ejecutivoSolicitud: input.ejecutivoSolicitud,
      linkFirmaDigital: input.linkFirmaDigital,
      estadoActual: {
        connect: {
          id: input.estadoActual.id,
        },
      },
      firmaDigitalmente: input.firmaDigitalmente,
      lineaPrestamoDescripcion: input.lineaPrestamoDescripcion,
      lineaPrestamoLegacyOid: input.lineaPrestamoLegacyOid,
      montoAFinanciar: input.montoAFinanciar,
      motivo: input.motivo,
      nroOperacion: input.nroOperacion,
      observaciones: input.observaciones,
      garantias:
        input.garantias.length > 0
          ? {
              create: input.garantias.map((garantia) =>
                this.toGarantiaCreateInput(garantia),
              ),
            }
          : undefined,
      conyuge: input.conyuge
        ? {
              create: {
                actividad: input.conyuge.actividad,
                apellido: input.conyuge.apellido,
                fechaNacimiento: input.conyuge.fechaNacimiento
                  ? new Date(`${input.conyuge.fechaNacimiento}T00:00:00.000Z`)
                  : null,
                ingresosMensuales: input.conyuge.ingresosMensuales,
                nacionalidad: input.conyuge.nacionalidad,
                nombre: input.conyuge.nombre,
                nroDocumento: input.conyuge.nroDocumento,
                sexo: input.conyuge.sexo,
                tipoDocumento: input.conyuge.tipoDocumento,
              },
          }
        : undefined,
      datosLaborales: {
        create: {
          actividadLaboral: input.datosLaborales.actividadLaboral,
          antiguedadLaboralMeses: input.datosLaborales.antiguedadLaboralMeses,
          descuentosSueldo: input.datosLaborales.descuentosSueldo,
          domicilioLaboralCalle: input.datosLaborales.domicilioLaboralCalle,
          domicilioLaboralLocalidad:
            input.datosLaborales.domicilioLaboralLocalidad,
          domicilioLaboralNroPuerta:
            input.datosLaborales.domicilioLaboralNroPuerta,
          domicilioLaboralPisoDepto:
            input.datosLaborales.domicilioLaboralPisoDepto,
          empleador: input.datosLaborales.empleador,
          fechaIngresoLaboral: input.datosLaborales.fechaIngresoLaboral
            ? new Date(`${input.datosLaborales.fechaIngresoLaboral}T00:00:00.000Z`)
            : null,
          montoRecibo: input.datosLaborales.montoRecibo,
          relacionLaboral: input.datosLaborales.relacionLaboral,
          tarjetas: input.datosLaborales.tarjetas,
          vehiculo: input.datosLaborales.vehiculo,
          vivienda: input.datosLaborales.vivienda,
        },
      },
      titular: {
        create: {
          apellidoDenominacion: input.titular.apellidoDenominacion,
          cbu: input.titular.cbu,
          celular: input.titular.celular,
          cuit: input.titular.cuit,
          domicilioCalle: input.titular.domicilioCalle,
          email: input.titular.email,
          fechaNacimiento: input.titular.fechaNacimiento
            ? new Date(`${input.titular.fechaNacimiento}T00:00:00.000Z`)
            : null,
          localidad: input.titular.localidad,
          nombre: input.titular.nombre,
          personaExpuestaPoliticamente:
            input.titular.personaExpuestaPoliticamente,
          nroDocumento: input.titular.nroDocumento,
          nroPuerta: input.titular.nroPuerta,
          nroSocio: input.titular.nroSocio,
          estadoCivil: input.titular.estadoCivil,
          nacionalidad: input.titular.nacionalidad,
          sexo: input.titular.sexo,
          telefonoFijo: input.titular.telefonoFijo,
          tipoDocumento: input.titular.tipoDocumento,
        },
      },
      vendedorSolicitud: input.vendedorSolicitud,
      vendedor: {
        connect: { id: input.createdBy },
      },
    };

    const solicitud = await this.prisma.$transaction(async (tx) => {
      const executor = tx as SolicitudCreateExecutor;
      const createdSolicitud = await executor.solicitud.create({
        data,
        include: solicitudInclude,
      });

      await executor.solicitudParticipant.upsert({
        where: {
          solicitudId_userId: {
            solicitudId: createdSolicitud.id,
            userId: input.createdBy,
          },
        },
        create: {
          createdBy: input.createdBy,
          role: "CREATOR",
          solicitudId: createdSolicitud.id,
          source: "CREATE",
          userId: input.createdBy,
        },
        update: {},
      });

      return createdSolicitud;
    });

    return SolicitudCoreMapper.toDomain(solicitud);
  }

  private static toUtcBoundaryFromArgentinaDate(
    dateOnly: string | undefined,
    boundary: "start" | "end",
  ) {
    if (!dateOnly) {
      return undefined;
    }

    const [year, month, day] = dateOnly
      .split("-")
      .map((segment) => Number(segment));
    const utcStart = Date.UTC(
      year,
      month - 1,
      day,
      ARGENTINA_UTC_OFFSET_HOURS,
      0,
      0,
      0,
    );

    if (boundary === "start") {
      return new Date(utcStart);
    }

    return new Date(utcStart + DAY_IN_MS - 1);
  }

  private static buildExecutiveName(
    user:
      | {
          firstName: string | null;
          lastName: string | null;
          legacyUser: string;
        }
      | null,
  ) {
    if (!user) {
      return null;
    }

    const fullName = [user.firstName?.trim(), user.lastName?.trim()]
      .filter(Boolean)
      .join(" ")
      .trim();

    if (fullName) {
      return fullName;
    }

    return user.legacyUser.trim() || null;
  }

  private static buildWorkflowStateFilter(input: {
    estado?: string;
    excludeEstado?: string;
    ownerId?: string;
  }) {
    const codeFilter =
      input.estado && input.excludeEstado
        ? {
            equals: input.estado,
            not: input.excludeEstado,
          }
        : input.estado
          ? input.estado
          : input.excludeEstado
            ? {
                not: input.excludeEstado,
              }
            : undefined;

    return {
      ...(input.ownerId ? { ownerId: input.ownerId } : {}),
      ...(codeFilter ? { code: codeFilter } : {}),
    };
  }

  private static resolveLatestComentarios(input: {
    changedAt: Date;
    comentario: string | null;
    solicitudId: string;
  }[]) {
    const latestBySolicitudId = new Map<string, string>();
    const sorted = [...input].sort(
      (a, b) => b.changedAt.getTime() - a.changedAt.getTime(),
    );

    for (const item of sorted) {
      if (latestBySolicitudId.has(item.solicitudId)) {
        continue;
      }

      const comentario = item.comentario?.trim();

      if (!comentario) {
        continue;
      }

      latestBySolicitudId.set(item.solicitudId, comentario);
    }

    return latestBySolicitudId;
  }

  private async listUltimasNovedadesBySolicitudIds(solicitudIds: string[]) {
    if (solicitudIds.length === 0) {
      return new Map<string, string>();
    }

    const history = await this.prisma.solicitudEstadoHistorial.findMany({
      where: {
        comentario: {
          not: null,
        },
        solicitudId: {
          in: solicitudIds,
        },
      },
      select: {
        changedAt: true,
        comentario: true,
        solicitudId: true,
      },
      orderBy: {
        changedAt: "desc",
      },
    });

    return SolicitudesCorePrismaDatasource.resolveLatestComentarios(history);
  }

  async findById(id: string) {
    const solicitud = await this.prisma.solicitud.findUnique({
      where: {
        id,
      },
      include: solicitudDetailInclude,
    });

    return solicitud ? SolicitudCoreMapper.toDomain(solicitud) : null;
  }

  async findByLegacyOid(legacyOid: string) {
    const solicitud = await this.prisma.solicitud.findUnique({
      where: {
        legacyOid,
      },
      include: solicitudDetailInclude,
    });

    return solicitud ? SolicitudCoreMapper.toDomain(solicitud) : null;
  }

  async listByOwner(input: ListSolicitudesByOwnerInput) {
    const solicitudes = await this.prisma.solicitud.findMany({
      where: {
        archivedAt: null,
        estadoActual: SolicitudesCorePrismaDatasource.buildWorkflowStateFilter({
          ownerId: input.workflowOwnerId,
          estado: input.estado,
          excludeEstado: input.excludeEstado,
        }),
        createdAt: {
          gte: SolicitudesCorePrismaDatasource.toUtcBoundaryFromArgentinaDate(
            input.createdFrom,
            "start",
          ),
          lte: SolicitudesCorePrismaDatasource.toUtcBoundaryFromArgentinaDate(
            input.createdTo,
            "end",
          ),
        },
        titular: input.nroDocumento
          ? {
              nroDocumento: input.nroDocumento,
            }
          : undefined,
      },
      include: solicitudInclude,
      orderBy: {
        createdAt: "desc",
      },
      skip: input.offset,
      take: input.limit,
    });

    const ultimasNovedadesBySolicitudId =
      await this.listUltimasNovedadesBySolicitudIds(
        solicitudes.map((item) => item.id),
      );

    return solicitudes.map((item) => ({
      ...SolicitudCoreMapper.toDomain(item),
      ultimaNovedad: ultimasNovedadesBySolicitudId.get(item.id) ?? null,
    }));
  }

  async findUserById(id: string) {
    return this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        workflowOwnerId: true,
      },
    });
  }

  async findWorkflowOwnerCodeById(id: string) {
    const owner = await this.prisma.workflowOwner.findUnique({
      where: { id },
      select: { code: true },
    });

    return owner?.code ?? null;
  }

  async listUsersByWorkflowOwnerId(workflowOwnerId?: string) {
    const users = await this.prisma.user.findMany({
      where: {
        deletedAt: null,
        state: 1,
        ...(workflowOwnerId ? { workflowOwnerId } : {}),
      },
      select: {
        email: true,
        firstName: true,
        id: true,
        lastName: true,
      },
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }, { email: "asc" }],
    });

    return users.map((user) => {
      const fullName = [user.firstName?.trim(), user.lastName?.trim()]
        .filter(Boolean)
        .join(" ")
        .trim();

      return {
        email: user.email,
        fullName: fullName || null,
        id: user.id,
      };
    });
  }

  async assignToUserIfUnassigned(input: {
    actorUserId: string;
    allowReassignment?: boolean;
    solicitudId: string;
    assignedToUserId: string;
  }) {
    const solicitud = await this.prisma.$transaction(async (tx) => {
      const assignedUser = await tx.user.findUnique({
        where: {
          id: input.assignedToUserId,
        },
        select: {
          firstName: true,
          lastName: true,
          legacyUser: true,
        },
      });
      const ejecutivoSolicitud =
        SolicitudesCorePrismaDatasource.buildExecutiveName(assignedUser);
      const updated = await tx.solicitud.updateMany({
        where: {
          id: input.solicitudId,
          ...(input.allowReassignment ? {} : { assignedToUserId: null }),
        },
        data: {
          assignedToUserId: input.assignedToUserId,
          ...(ejecutivoSolicitud ? { ejecutivoSolicitud } : {}),
        },
      });

      if (updated.count === 0) {
        return null;
      }

      const updatedSolicitud = await tx.solicitud.findUnique({
        where: {
          id: input.solicitudId,
        },
        include: solicitudInclude,
      });

      if (!updatedSolicitud) {
        return null;
      }

      await tx.solicitudEstadoHistorial.create({
        data: {
          actionCode: "ASSIGNMENT_SET",
          actionLabel: "Asignación registrada",
          changedBy: input.actorUserId,
          comentario: null,
          estadoAnteriorId: updatedSolicitud.estadoActualId,
          estadoNuevoId: updatedSolicitud.estadoActualId,
          fromOwnerCodeSnapshot: updatedSolicitud.estadoActual.owner?.code ?? null,
          fromOwnerIdSnapshot: updatedSolicitud.estadoActual.ownerId ?? null,
          fromOwnerNameSnapshot: updatedSolicitud.estadoActual.owner?.name ?? null,
          fromStateCodeSnapshot: updatedSolicitud.estadoActual.code,
          fromStateNameSnapshot: updatedSolicitud.estadoActual.name,
          metadata: {
            assignedToUserId: input.assignedToUserId,
            event: "ASSIGNMENT_SET",
          },
          motivo: "ASSIGNMENT_SET",
          requiresComment: false,
          saveAndExit: false,
          solicitudId: updatedSolicitud.id,
          toOwnerCodeSnapshot: updatedSolicitud.estadoActual.owner?.code ?? null,
          toOwnerIdSnapshot: updatedSolicitud.estadoActual.ownerId ?? null,
          toOwnerNameSnapshot: updatedSolicitud.estadoActual.owner?.name ?? null,
          toStateCodeSnapshot: updatedSolicitud.estadoActual.code,
          toStateNameSnapshot: updatedSolicitud.estadoActual.name,
          transitionId: null,
        },
      });

      return updatedSolicitud;
    });

    return solicitud ? SolicitudCoreMapper.toDomain(solicitud) : null;
  }

  async listTracking(input: ListSolicitudesTrackingInput) {
    const solicitudes = await this.prisma.solicitud.findMany({
      where: {
        OR: [
          {
            createdBy: input.userId,
          },
          {
            participants: {
              some: {
                userId: input.userId,
              },
            },
          },
        ],
        archivedAt: null,
        ...((input.estado || input.excludeEstado)
          ? {
              estadoActual:
                SolicitudesCorePrismaDatasource.buildWorkflowStateFilter({
                  estado: input.estado,
                  excludeEstado: input.excludeEstado,
                }),
            }
          : {}),
        createdAt: {
          gte: SolicitudesCorePrismaDatasource.toUtcBoundaryFromArgentinaDate(
            input.createdFrom,
            "start",
          ),
          lte: SolicitudesCorePrismaDatasource.toUtcBoundaryFromArgentinaDate(
            input.createdTo,
            "end",
          ),
        },
        titular: input.nroDocumento
          ? {
              nroDocumento: input.nroDocumento,
            }
          : undefined,
      },
      include: solicitudDetailInclude,
      orderBy: {
        createdAt: "desc",
      },
      skip: input.offset,
      take: input.limit,
    });

    const ultimasNovedadesBySolicitudId =
      await this.listUltimasNovedadesBySolicitudIds(
        solicitudes.map((item) => item.id),
      );

    return solicitudes.map((item) => ({
      ...SolicitudCoreMapper.toDomain(item),
      ultimaNovedad: ultimasNovedadesBySolicitudId.get(item.id) ?? null,
    }));
  }

  async listRecientes(input: ListSolicitudesRecientesInput) {
    const solicitudes = await this.prisma.solicitud.findMany({
      where: {
        archivedAt: null,
        estadoActual: {
          code: {
            notIn: [...HISTORICAS_NEGATIVE_STATE_CODES, "CargaVendedor"],
            ...(input.estado ? { equals: input.estado } : {}),
          },
        },
        createdAt: {
          gte: SolicitudesCorePrismaDatasource.toUtcBoundaryFromArgentinaDate(
            input.createdFrom,
            "start",
          ),
          lte: SolicitudesCorePrismaDatasource.toUtcBoundaryFromArgentinaDate(
            input.createdTo,
            "end",
          ),
        },
        titular: input.nroDocumento
          ? {
              nroDocumento: input.nroDocumento,
            }
          : undefined,
      },
      include: solicitudDetailInclude,
      orderBy: {
        createdAt: "desc",
      },
      skip: input.offset,
      take: input.limit,
    });

    const ultimasNovedadesBySolicitudId =
      await this.listUltimasNovedadesBySolicitudIds(
        solicitudes.map((item) => item.id),
      );

    return solicitudes.map((item) => ({
      ...SolicitudCoreMapper.toDomain(item),
      ultimaNovedad: ultimasNovedadesBySolicitudId.get(item.id) ?? null,
    }));
  }

  async listHistoricas(input: { limit: number; nroDocumento?: string; offset: number }) {
    const recientesDateRangeStart = new Date();
    recientesDateRangeStart.setDate(
      recientesDateRangeStart.getDate() - RECIENTES_WINDOW_DAYS,
    );
    const recientesStartUtc =
      SolicitudesCorePrismaDatasource.toUtcBoundaryFromArgentinaDate(
        [
          recientesDateRangeStart.getFullYear(),
          String(recientesDateRangeStart.getMonth() + 1).padStart(2, "0"),
          String(recientesDateRangeStart.getDate()).padStart(2, "0"),
        ].join("-"),
        "start",
      );

    const solicitudes = await this.prisma.solicitud.findMany({
      where: {
        archivedAt: null,
        OR: [
          {
            estadoActual: {
              code: {
                in: [...HISTORICAS_NEGATIVE_STATE_CODES],
              },
            },
          },
          {
            AND: [
              {
                estadoActual: {
                  code: {
                    notIn: [...HISTORICAS_NEGATIVE_STATE_CODES, "CargaVendedor"],
                  },
                },
              },
              {
                createdAt: {
                  lt: recientesStartUtc,
                },
              },
            ],
          },
        ],
        titular: input.nroDocumento
          ? {
              nroDocumento: input.nroDocumento,
            }
          : undefined,
      },
      include: solicitudDetailInclude,
      orderBy: {
        createdAt: "desc",
      },
      skip: input.offset,
      take: input.limit,
    });

    const ultimasNovedadesBySolicitudId =
      await this.listUltimasNovedadesBySolicitudIds(
        solicitudes.map((item) => item.id),
      );

    return solicitudes.map((item) => ({
      ...SolicitudCoreMapper.toDomain(item),
      ultimaNovedad: ultimasNovedadesBySolicitudId.get(item.id) ?? null,
    }));
  }

  async update(id: string, patch: UpdateSolicitudCorePatch) {
    return this.prisma.$transaction(async (tx) => {
      const data = {
        cuotaResultante: patch.solicitud?.cuotaResultante,
        cuotas: patch.solicitud?.cuotas,
        cupoTitular: patch.solicitud?.cupoTitular,
        fechaPrimerVencimiento:
          SolicitudesCorePrismaDatasource.toDatePatchValue(
            patch.solicitud?.fechaPrimerVencimiento,
          ),
        ejecutivoSolicitud: patch.solicitud?.ejecutivoSolicitud,
        legacyOid: patch.solicitud?.legacyOid,
        linkFirmaDigital: patch.solicitud?.linkFirmaDigital,
        firmaDigitalmente: patch.solicitud?.firmaDigitalmente,
        lineaPrestamoDescripcion: patch.solicitud?.lineaPrestamoDescripcion,
        lineaPrestamoLegacyOid: patch.solicitud?.lineaPrestamoLegacyOid,
        montoAFinanciar: patch.solicitud?.montoAFinanciar,
        motivo: patch.solicitud?.motivo,
        nroOperacion: patch.solicitud?.nroOperacion,
        observaciones: patch.solicitud?.observaciones,
        vendedorSolicitud: patch.solicitud?.vendedorSolicitud,
        titular: patch.titular
          ? {
              update: {
                apellidoDenominacion: patch.titular.apellidoDenominacion,
                cbu: patch.titular.cbu,
                celular: patch.titular.celular,
                cuit: patch.titular.cuit,
                domicilioCalle: patch.titular.domicilioCalle,
                email: patch.titular.email,
                fechaNacimiento: SolicitudesCorePrismaDatasource.toDatePatchValue(
                  patch.titular.fechaNacimiento,
                ),
                localidad: patch.titular.localidad,
                nombre: patch.titular.nombre,
                personaExpuestaPoliticamente:
                  patch.titular.personaExpuestaPoliticamente,
                nroDocumento: patch.titular.nroDocumento,
                nroPuerta: patch.titular.nroPuerta,
                nroSocio: patch.titular.nroSocio,
                estadoCivil: patch.titular.estadoCivil,
                nacionalidad: patch.titular.nacionalidad,
                sexo: patch.titular.sexo,
                telefonoFijo: patch.titular.telefonoFijo,
                tipoDocumento: patch.titular.tipoDocumento,
              },
            }
          : undefined,
        datosLaborales: patch.datosLaborales
          ? {
              update: {
                actividadLaboral: patch.datosLaborales.actividadLaboral,
                antiguedadLaboralMeses:
                  patch.datosLaborales.antiguedadLaboralMeses,
                descuentosSueldo: patch.datosLaborales.descuentosSueldo,
                domicilioLaboralCalle:
                  patch.datosLaborales.domicilioLaboralCalle,
                domicilioLaboralLocalidad:
                  patch.datosLaborales.domicilioLaboralLocalidad,
                domicilioLaboralNroPuerta:
                  patch.datosLaborales.domicilioLaboralNroPuerta,
                domicilioLaboralPisoDepto:
                  patch.datosLaborales.domicilioLaboralPisoDepto,
                empleador: patch.datosLaborales.empleador,
                fechaIngresoLaboral:
                  patch.datosLaborales.fechaIngresoLaboral === undefined
                    ? undefined
                    : patch.datosLaborales.fechaIngresoLaboral === null
                      ? null
                      : new Date(
                          `${patch.datosLaborales.fechaIngresoLaboral}T00:00:00.000Z`,
                        ),
                montoRecibo: patch.datosLaborales.montoRecibo,
                relacionLaboral: patch.datosLaborales.relacionLaboral,
                tarjetas: patch.datosLaborales.tarjetas,
                vehiculo: patch.datosLaborales.vehiculo,
                vivienda: patch.datosLaborales.vivienda,
              },
            }
          : undefined,
        conyuge:
          patch.conyuge === undefined
            ? undefined
            : patch.conyuge === null
              ? {
                  delete: true,
                }
              : {
                  upsert: {
                    create: {
                      actividad: patch.conyuge.actividad ?? null,
                      apellido: patch.conyuge.apellido ?? null,
                      fechaNacimiento: patch.conyuge.fechaNacimiento
                        ? new Date(
                            `${patch.conyuge.fechaNacimiento}T00:00:00.000Z`,
                          )
                        : null,
                      ingresosMensuales: patch.conyuge.ingresosMensuales ?? null,
                      nacionalidad: patch.conyuge.nacionalidad ?? null,
                      nombre: patch.conyuge.nombre ?? null,
                      nroDocumento: patch.conyuge.nroDocumento ?? null,
                      sexo: patch.conyuge.sexo ?? null,
                      tipoDocumento: patch.conyuge.tipoDocumento ?? null,
                    },
                    update: {
                      actividad: patch.conyuge.actividad,
                      apellido: patch.conyuge.apellido,
                      fechaNacimiento:
                        patch.conyuge.fechaNacimiento === undefined
                          ? undefined
                          : patch.conyuge.fechaNacimiento === null
                            ? null
                            : new Date(
                                `${patch.conyuge.fechaNacimiento}T00:00:00.000Z`,
                              ),
                      ingresosMensuales: patch.conyuge.ingresosMensuales,
                      nacionalidad: patch.conyuge.nacionalidad,
                      nombre: patch.conyuge.nombre,
                      nroDocumento: patch.conyuge.nroDocumento,
                      sexo: patch.conyuge.sexo,
                      tipoDocumento: patch.conyuge.tipoDocumento,
                    },
                  },
                },
        garantias:
          patch.garantias === undefined
            ? undefined
            : {
                deleteMany: {},
                create: patch.garantias.map((garantia) =>
                  this.toGarantiaCreateInput(garantia),
                ),
              },
      };

      const solicitud = await tx.solicitud.update({
        where: {
          id,
        },
        data,
        include: solicitudInclude,
      });

      return SolicitudCoreMapper.toDomain(solicitud);
    });
  }

  private static buildStatsDateBoundary(isoDate: string, boundary: "start" | "end") {
    const [year, month, day] = isoDate.split("-").map(Number);
    const startUtc = Date.UTC(year, month - 1, day, ARGENTINA_UTC_OFFSET_HOURS, 0, 0, 0);
    if (boundary === "start") {
      return new Date(startUtc);
    }
    return new Date(startUtc + DAY_IN_MS - 1);
  }

  private static buildStatsWhere(
    input: GetSolicitudesStatsInput,
    overrideEstadoCode?: string,
  ): Prisma.SolicitudWhereInput {
    const where: Prisma.SolicitudWhereInput = {};

    if (input.fechaDesde || input.fechaHasta) {
      where.createdAt = {
        gte: input.fechaDesde
          ? SolicitudesCorePrismaDatasource.buildStatsDateBoundary(input.fechaDesde, "start")
          : undefined,
        lte: input.fechaHasta
          ? SolicitudesCorePrismaDatasource.buildStatsDateBoundary(input.fechaHasta, "end")
          : undefined,
      };
    }

    if (input.linea) {
      where.lineaPrestamoDescripcion = input.linea;
    }

    const estadoCode = overrideEstadoCode !== undefined ? overrideEstadoCode : input.estado;
    if (estadoCode || input.area) {
      where.estadoActual = {
        ...(estadoCode ? { code: estadoCode } : {}),
        ...(input.area ? { owner: { code: input.area } } : {}),
      };
    }

    if (input.vendedorId) {
      where.vendedorId = input.vendedorId;
    }

    if (input.asignadoId) {
      where.assignedToUserId = input.asignadoId;
    }

    return where;
  }

  async listSolicitudesSinAsignar(
    input: GetSolicitudesStatsInput,
  ): Promise<
    Array<{
      id: string;
      titular: string;
      linea: string;
      estado: string;
      diasActiva: number;
    }>
  > {
    const filterWhere = SolicitudesCorePrismaDatasource.buildStatsWhere(input);
    const now = Date.now();

    const solicitudes = await this.prisma.solicitud.findMany({
      where: {
        archivedAt: null,
        assignedToUserId: null,
        AND: [
          filterWhere,
          {
            estadoActual: {
              code: { not: ADMIN_DASHBOARD_EXCLUDED_ESTADO_CODE },
            },
          },
        ],
      },
      select: {
        id: true,
        createdAt: true,
        lineaPrestamoDescripcion: true,
        estadoActual: { select: { code: true } },
        titular: { select: { nombre: true, apellidoDenominacion: true } },
      },
      orderBy: { createdAt: "asc" },
      take: 8,
    });

    return solicitudes.map((s) => ({
      id: s.id,
      titular:
        [s.titular?.apellidoDenominacion, s.titular?.nombre]
          .filter(Boolean)
          .join(", ") || "Sin nombre",
      linea: s.lineaPrestamoDescripcion,
      estado: s.estadoActual.code,
      diasActiva: Math.floor((now - s.createdAt.getTime()) / DAY_IN_MS),
    }));
  }

  async getStats(input: GetSolicitudesStatsInput): Promise<SolicitudesStatsResult> {
    const baseFilterWhere = SolicitudesCorePrismaDatasource.buildStatsWhere(input);
    // El dashboard de administracion no muestra solicitudes en Carga
    // Vendedor (son borradores del vendedor, todavia no llegaron al flujo
    // que le interesa a admin) -- se excluyen de todos los conteos/listas.
    const filterWhere: Prisma.SolicitudWhereInput = {
      AND: [
        baseFilterWhere,
        { estadoActual: { code: { not: ADMIN_DASHBOARD_EXCLUDED_ESTADO_CODE } } },
      ],
    };
    const activeFilterWhere: Prisma.SolicitudWhereInput = { archivedAt: null, ...filterWhere };
    const sevenDaysAgo = new Date(Date.now() - 7 * DAY_IN_MS);

    const [
      creadasPeriodo,
      backlogActivo,
      sinAsignar,
      detenidas7dias,
      rechazadas,
      desestimadas,
      vencidas,
      calidadSinEjecutivo,
      activeSolicitudesForGroups,
      byLineaRaw,
      antiguas,
      vendedoresDistintos,
      allActiveStates,
      allActiveAreas,
      lineasDistintasRaw,
      funnelConfirmadas,
      funnelLiquidadas,
      funnelVerificacionFirma,
      funnelTransferidas,
      solicitudesSinAsignarList,
    ] = await Promise.all([
      this.prisma.solicitud.count({ where: filterWhere }),
      this.prisma.solicitud.count({ where: activeFilterWhere }),
      this.prisma.solicitud.count({ where: { ...activeFilterWhere, assignedToUserId: null } }),
      this.prisma.solicitud.count({ where: { ...activeFilterWhere, updatedAt: { lt: sevenDaysAgo } } }),
      this.prisma.solicitud.count({ where: SolicitudesCorePrismaDatasource.buildStatsWhere(input, "Rechazada") }),
      this.prisma.solicitud.count({ where: SolicitudesCorePrismaDatasource.buildStatsWhere(input, "Desestimada") }),
      this.prisma.solicitud.count({ where: SolicitudesCorePrismaDatasource.buildStatsWhere(input, "Vencida") }),
      this.prisma.solicitud.count({
        where: {
          archivedAt: null,
          ejecutivoSolicitud: null,
          estadoActual: { code: { not: ADMIN_DASHBOARD_EXCLUDED_ESTADO_CODE } },
        },
      }),
      this.prisma.solicitud.findMany({
        where: activeFilterWhere,
        select: {
          estadoActual: {
            select: {
              code: true,
              name: true,
              owner: { select: { name: true } },
            },
          },
        },
      }),
      this.prisma.solicitud.groupBy({
        by: ["lineaPrestamoDescripcion"],
        where: filterWhere,
        _count: { _all: true },
      }),
      this.prisma.solicitud.findMany({
        where: activeFilterWhere,
        select: {
          id: true,
          createdAt: true,
          lineaPrestamoDescripcion: true,
          estadoActual: { select: { code: true } },
          titular: { select: { nombre: true, apellidoDenominacion: true } },
        },
        orderBy: { createdAt: "asc" },
        take: 8,
      }),
      this.prisma.user.findMany({
        where: { workflowOwner: { code: "VENDEDORES" }, state: 1 },
        select: { id: true, firstName: true, lastName: true },
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      }),
      this.prisma.workflowState.findMany({
        where: {
          isActive: true,
          code: { not: ADMIN_DASHBOARD_EXCLUDED_ESTADO_CODE },
        },
        select: { code: true, name: true, owner: { select: { sortOrder: true } } },
        orderBy: [{ owner: { sortOrder: "asc" } }, { name: "asc" }],
      }),
      this.prisma.workflowOwner.findMany({
        where: { isActive: true },
        select: { code: true, name: true },
        orderBy: { sortOrder: "asc" },
      }),
      this.prisma.solicitud.findMany({
        where: { archivedAt: null },
        select: { lineaPrestamoDescripcion: true },
        distinct: ["lineaPrestamoDescripcion"],
        orderBy: { lineaPrestamoDescripcion: "asc" },
      }),
      this.prisma.solicitudEstadoHistorial.findMany({
        where: { toStateCodeSnapshot: "Confirmada", solicitud: filterWhere },
        select: { solicitudId: true },
        distinct: ["solicitudId"],
      }),
      this.prisma.solicitudEstadoHistorial.findMany({
        where: { toStateCodeSnapshot: "Liquidada", solicitud: filterWhere },
        select: { solicitudId: true },
        distinct: ["solicitudId"],
      }),
      this.prisma.solicitudEstadoHistorial.findMany({
        where: {
          toStateCodeSnapshot: {
            in: [
              "VerificacionDocumentacion",
              "VerificarFirma",
              "VerificarFirmaYDocumentacion",
            ],
          },
          solicitud: filterWhere,
        },
        select: { solicitudId: true },
        distinct: ["solicitudId"],
      }),
      this.prisma.solicitudEstadoHistorial.findMany({
        where: { toStateCodeSnapshot: "Transferir", solicitud: filterWhere },
        select: { solicitudId: true },
        distinct: ["solicitudId"],
      }),
      this.listSolicitudesSinAsignar(input),
    ]);

    const estadoCountMap = new Map<string, number>();
    const areaCountMap = new Map<string, number>();
    for (const s of activeSolicitudesForGroups) {
      const name = s.estadoActual.name;
      const area = s.estadoActual.owner.name;
      estadoCountMap.set(name, (estadoCountMap.get(name) ?? 0) + 1);
      areaCountMap.set(area, (areaCountMap.get(area) ?? 0) + 1);
    }

    const backlogPorEstado = allActiveStates
      .map((s) => ({ estado: s.name, count: estadoCountMap.get(s.name) ?? 0 }))
      .sort((a, b) => b.count - a.count);

    const backlogPorArea = Array.from(areaCountMap.entries())
      .map(([area, count]) => ({ area, count }))
      .sort((a, b) => b.count - a.count);

    const rendimientoPorLinea = byLineaRaw
      .map((g) => ({ linea: g.lineaPrestamoDescripcion, count: g._count._all }))
      .sort((a, b) => b.count - a.count);

    const now = Date.now();
    const solicitudesAntiguas = antiguas.map((s) => ({
      id: s.id,
      titular: [s.titular?.apellidoDenominacion, s.titular?.nombre]
        .filter(Boolean)
        .join(", ") || "Sin nombre",
      linea: s.lineaPrestamoDescripcion,
      estado: s.estadoActual.code,
      diasActiva: Math.floor((now - s.createdAt.getTime()) / DAY_IN_MS),
    }));

    return {
      kpis: {
        creadasPeriodo,
        backlogActivo,
        sinAsignar,
        detenidas7dias,
        rechazadas,
        desestimadas,
        vencidas,
      },
      backlogPorEstado,
      backlogPorArea,
      rendimientoPorLinea,
      calidadDatos: {
        sinEjecutivo: calidadSinEjecutivo,
      },
      solicitudesAntiguas,
      solicitudesSinAsignar: solicitudesSinAsignarList,
      funnelPeriodo: {
        confirmadas: funnelConfirmadas.length,
        liquidadas: funnelLiquidadas.length,
        verificacionFirma: funnelVerificacionFirma.length,
        transferidas: funnelTransferidas.length,
      },
      filterOptions: {
        vendedores: vendedoresDistintos.map((u) => ({
          id: u.id,
          fullName: [u.lastName, u.firstName].filter(Boolean).join(" "),
        })),
        estados: allActiveStates.map((s) => ({ code: s.code, name: s.name })),
        areas: allActiveAreas.map((a) => ({ code: a.code, name: a.name })),
        lineas: lineasDistintasRaw.map((l) => l.lineaPrestamoDescripcion),
      },
    };
  }

  async getVendedorStats(
    input: GetSolicitudesStatsInput,
  ): Promise<VendedorDashboardStatsResult> {
    const filterWhere = SolicitudesCorePrismaDatasource.buildStatsWhere(input);
    const activeFilterWhere: Prisma.SolicitudWhereInput = {
      archivedAt: null,
      ...filterWhere,
    };
    const liquidadaWhere = SolicitudesCorePrismaDatasource.buildStatsWhere(input, "Liquidada");
    const confirmadaWhere = SolicitudesCorePrismaDatasource.buildStatsWhere(input, "Confirmada");

    const [
      solicitudesIniciadas,
      montoLiquidadoAgg,
      aprobadoSinLiquidarAgg,
      porLineaRaw,
      estadoRows,
      pendientesRaw,
      liquidadaHistorial,
      funnelRevision,
      funnelPreAprobada,
      funnelConfirmada,
      funnelLiquidada,
      lineasDistintasRaw,
    ] = await Promise.all([
      this.prisma.solicitud.count({ where: { ...activeFilterWhere } }),
      this.prisma.solicitud.aggregate({
        where: { ...liquidadaWhere, archivedAt: null },
        _sum: { montoAFinanciar: true },
      }),
      this.prisma.solicitud.aggregate({
        where: { ...confirmadaWhere, archivedAt: null },
        _sum: { montoAFinanciar: true },
      }),
      this.prisma.solicitud.groupBy({
        by: ["lineaPrestamoDescripcion"],
        where: { ...liquidadaWhere, archivedAt: null },
        _count: { _all: true },
        _sum: { montoAFinanciar: true },
      }),
      this.prisma.solicitud.findMany({
        where: activeFilterWhere,
        select: { estadoActual: { select: { name: true } } },
      }),
      this.prisma.solicitud.findMany({
        where: {
          ...activeFilterWhere,
          estadoActual: { isActive: true, owner: { code: { not: "SISTEMA" } } },
        },
        select: {
          id: true,
          createdAt: true,
          montoAFinanciar: true,
          lineaPrestamoDescripcion: true,
          estadoActual: { select: { code: true } },
          titular: { select: { nombre: true, apellidoDenominacion: true } },
        },
        orderBy: { createdAt: "asc" },
        take: 8,
      }),
      this.prisma.solicitudEstadoHistorial.findMany({
        where: { toStateCodeSnapshot: "Liquidada", solicitud: filterWhere },
        select: { changedAt: true, solicitud: { select: { createdAt: true } } },
      }),
      this.prisma.solicitudEstadoHistorial.findMany({
        where: { toStateCodeSnapshot: "RevisionRiesgo", solicitud: filterWhere },
        select: { solicitudId: true },
        distinct: ["solicitudId"],
      }),
      this.prisma.solicitudEstadoHistorial.findMany({
        where: { toStateCodeSnapshot: "PreAprobada", solicitud: filterWhere },
        select: { solicitudId: true },
        distinct: ["solicitudId"],
      }),
      this.prisma.solicitudEstadoHistorial.findMany({
        where: { toStateCodeSnapshot: "Confirmada", solicitud: filterWhere },
        select: { solicitudId: true },
        distinct: ["solicitudId"],
      }),
      this.prisma.solicitudEstadoHistorial.findMany({
        where: { toStateCodeSnapshot: "Liquidada", solicitud: filterWhere },
        select: { solicitudId: true },
        distinct: ["solicitudId"],
      }),
      this.prisma.solicitud.findMany({
        where: { archivedAt: null },
        select: { lineaPrestamoDescripcion: true },
        distinct: ["lineaPrestamoDescripcion"],
        orderBy: { lineaPrestamoDescripcion: "asc" },
      }),
    ]);

    const estadoCountMap = new Map<string, number>();
    for (const row of estadoRows) {
      const name = row.estadoActual.name;
      estadoCountMap.set(name, (estadoCountMap.get(name) ?? 0) + 1);
    }
    const solicitudesPorEstado = Array.from(estadoCountMap.entries())
      .map(([estado, count]) => ({ estado, count }))
      .sort((a, b) => b.count - a.count);

    const montosPorLinea = porLineaRaw.map((g) => ({
      linea: g.lineaPrestamoDescripcion,
      monto: g._sum?.montoAFinanciar ? Number(g._sum.montoAFinanciar) : 0,
      count: g._count._all,
    }));

    const now = Date.now();
    const pendientes = pendientesRaw.map((s) => ({
      id: s.id,
      titular:
        [s.titular?.apellidoDenominacion, s.titular?.nombre]
          .filter(Boolean)
          .join(", ") || "Sin nombre",
      linea: s.lineaPrestamoDescripcion,
      estado: s.estadoActual.code,
      monto: s.montoAFinanciar ? Number(s.montoAFinanciar) : 0,
      diasActiva: Math.floor((now - s.createdAt.getTime()) / DAY_IN_MS),
    }));

    const tiempoPromedioDiasLiquidacion =
      liquidadaHistorial.length === 0
        ? null
        : liquidadaHistorial.reduce(
            (sum, row) =>
              sum +
              (row.changedAt.getTime() - row.solicitud.createdAt.getTime()) /
                DAY_IN_MS,
            0,
          ) / liquidadaHistorial.length;

    const evolucionMensual = await this.getEvolucionMensualLiquidada(
      input.vendedorId,
      input.linea,
    );

    return {
      kpis: {
        montoLiquidado: montoLiquidadoAgg._sum.montoAFinanciar
          ? Number(montoLiquidadoAgg._sum.montoAFinanciar)
          : 0,
        aprobadoSinLiquidar: aprobadoSinLiquidarAgg._sum.montoAFinanciar
          ? Number(aprobadoSinLiquidarAgg._sum.montoAFinanciar)
          : 0,
        solicitudesIniciadas,
        tiempoPromedioDiasLiquidacion,
      },
      evolucionMensual,
      solicitudesPorEstado,
      funnel: [
        { estado: "Iniciadas", count: solicitudesIniciadas },
        { estado: "En revisión", count: funnelRevision.length },
        { estado: "Pre-aprobadas", count: funnelPreAprobada.length },
        { estado: "Confirmadas", count: funnelConfirmada.length },
        { estado: "Liquidadas", count: funnelLiquidada.length },
      ],
      montosPorLinea,
      pendientes,
      filterOptions: {
        lineas: lineasDistintasRaw.map((l) => l.lineaPrestamoDescripcion),
      },
    };
  }

  async getAnalistaStats(
    input: GetAnalistaStatsInput,
  ): Promise<AnalistaDashboardStatsResult> {
    const currentStateInput: GetSolicitudesStatsInput = {
      ...input,
      fechaDesde: undefined,
      fechaHasta: undefined,
    };
    const currentStateFilterWhere =
      SolicitudesCorePrismaDatasource.buildStatsWhere(currentStateInput);
    const periodoRange =
      input.fechaDesde || input.fechaHasta
        ? {
            gte: input.fechaDesde
              ? SolicitudesCorePrismaDatasource.buildStatsDateBoundary(input.fechaDesde, "start")
              : undefined,
            lte: input.fechaHasta
              ? SolicitudesCorePrismaDatasource.buildStatsDateBoundary(input.fechaHasta, "end")
              : undefined,
          }
        : undefined;

    const misCasosWhere: Prisma.SolicitudWhereInput = {
      assignedToUserId: input.analistaId,
    };
    const sinAsignarWhere: Prisma.SolicitudWhereInput = {
      assignedToUserId: null,
      estadoActual: { owner: { code: input.areaOwnerCode } },
    };
    const universoWhere: Prisma.SolicitudWhereInput =
      input.vista === "sin_asignar"
        ? sinAsignarWhere
        : input.vista === "ambos"
          ? { OR: [misCasosWhere, sinAsignarWhere] }
          : misCasosWhere;

    const [
      asignadosAMi,
      sinAsignarEnMiArea,
      casosConRevision,
      universoActivoRaw,
      backlogStates,
      lineasDistintasRaw,
      vendedoresDistintos,
      evaluadosRechazadas,
      evaluadosConfirmadas,
      casosParaTomarRaw,
    ] = await Promise.all([
      this.prisma.solicitud.count({
        where: {
          archivedAt: null,
          AND: [
            currentStateFilterWhere,
            misCasosWhere,
            { estadoActual: { isActive: true } },
          ],
        },
      }),
      this.prisma.solicitud.count({
        where: {
          archivedAt: null,
          AND: [
            currentStateFilterWhere,
            sinAsignarWhere,
            { estadoActual: { isActive: true } },
          ],
        },
      }),
      this.prisma.solicitud.count({
        where: {
          archivedAt: null,
          assignedToUserId: input.analistaId,
          estadoActual: { code: "Revisar" },
        },
      }),
      this.prisma.solicitud.findMany({
        where: {
          archivedAt: null,
          AND: [
            currentStateFilterWhere,
            universoWhere,
            { estadoActual: { isActive: true } },
          ],
        },
        select: {
          id: true,
          createdAt: true,
          estadoActual: { select: { code: true, name: true } },
          titular: { select: { nombre: true, apellidoDenominacion: true } },
        },
        orderBy: { createdAt: "asc" },
      }),
      this.prisma.workflowState.findMany({
        where: { isActive: true, code: { in: ANALISTA_BACKLOG_ESTADO_CODES } },
        select: { code: true, name: true },
        orderBy: { name: "asc" },
      }),
      this.prisma.solicitud.findMany({
        where: { archivedAt: null },
        select: { lineaPrestamoDescripcion: true },
        distinct: ["lineaPrestamoDescripcion"],
        orderBy: { lineaPrestamoDescripcion: "asc" },
      }),
      this.prisma.user.findMany({
        where: { workflowOwner: { code: "VENDEDORES" }, state: 1 },
        select: { id: true, firstName: true, lastName: true },
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      }),
      this.prisma.solicitudEstadoHistorial.findMany({
        where: {
          changedBy: input.analistaId,
          changedAt: periodoRange,
          toStateCodeSnapshot: { in: ["Rechazada"] },
        },
        select: { solicitudId: true },
        distinct: ["solicitudId"],
      }),
      this.prisma.solicitudEstadoHistorial.findMany({
        where: {
          changedBy: input.analistaId,
          changedAt: periodoRange,
          toStateCodeSnapshot: { in: ["Confirmada"] },
        },
        select: { solicitudId: true },
        distinct: ["solicitudId"],
      }),
      this.prisma.solicitud.findMany({
        where: {
          archivedAt: null,
          AND: [currentStateFilterWhere, sinAsignarWhere],
        },
        select: {
          id: true,
          createdAt: true,
          lineaPrestamoDescripcion: true,
          vendedorSolicitud: true,
          estadoActual: { select: { code: true } },
          titular: { select: { nombre: true, apellidoDenominacion: true } },
        },
        orderBy: { createdAt: "asc" },
        take: 30,
      }),
    ]);

    const now = Date.now();
    const universoIds = universoActivoRaw.map((s) => s.id);
    const casosParaTomarIds = casosParaTomarRaw.map((s) => s.id);
    const antiguedadIds = Array.from(
      new Set([...universoIds, ...casosParaTomarIds]),
    );

    const [
      lastChangeRows,
      retrabajoRows,
      multiplesRevisionesRows,
      casosParaTomarRetrabajoRows,
    ] = await Promise.all([
      antiguedadIds.length === 0
        ? Promise.resolve([])
        : this.prisma.solicitudEstadoHistorial.findMany({
            where: { solicitudId: { in: antiguedadIds } },
            select: { changedAt: true, solicitudId: true },
          }),
      this.prisma.solicitudEstadoHistorial.findMany({
        where: {
          solicitudId: {
            in: Array.from(
              new Set([
                ...evaluadosRechazadas.map((r) => r.solicitudId),
                ...evaluadosConfirmadas.map((r) => r.solicitudId),
              ]),
            ),
          },
          changedAt: periodoRange,
          toStateCodeSnapshot: "Revisar",
        },
        select: { solicitudId: true },
      }),
      universoIds.length === 0
        ? Promise.resolve([])
        : this.prisma.solicitudEstadoHistorial.findMany({
            where: {
              solicitudId: { in: universoIds },
              changedAt: periodoRange,
              toStateCodeSnapshot: "Revisar",
            },
            select: { solicitudId: true },
          }),
      casosParaTomarIds.length === 0
        ? Promise.resolve([])
        : this.prisma.solicitudEstadoHistorial.findMany({
            where: {
              solicitudId: { in: casosParaTomarIds },
              toStateCodeSnapshot: "Revisar",
            },
            select: { solicitudId: true },
            distinct: ["solicitudId"],
          }),
    ]);

    const lastChangeMap = new Map<string, number>();
    for (const row of lastChangeRows) {
      const current = lastChangeMap.get(row.solicitudId) ?? 0;
      const rowTime = row.changedAt.getTime();
      if (rowTime > current) lastChangeMap.set(row.solicitudId, rowTime);
    }
    const antiguedadDias = (id: string, createdAt: Date) => {
      const lastChange = lastChangeMap.get(id) ?? createdAt.getTime();
      return Math.floor((now - lastChange) / DAY_IN_MS);
    };

    const detenidosMasDeNDias = universoActivoRaw.filter(
      (s) => antiguedadDias(s.id, s.createdAt) > input.umbralDias,
    ).length;

    const evaluadosIds = new Set([
      ...evaluadosRechazadas.map((r) => r.solicitudId),
      ...evaluadosConfirmadas.map((r) => r.solicitudId),
    ]);
    const denominador = evaluadosIds.size;
    const numerador = evaluadosRechazadas.length;
    const tasaDeRechazoPeriodo = denominador === 0 ? null : numerador / denominador;

    const backlogCountMap = new Map<string, number>();
    for (const s of universoActivoRaw) {
      const name = s.estadoActual.name;
      backlogCountMap.set(name, (backlogCountMap.get(name) ?? 0) + 1);
    }
    const backlogPorEstado = backlogStates.map((s) => ({
      estado: s.name,
      count: backlogCountMap.get(s.name) ?? 0,
    }));

    const revisionCountByEvaluado = new Map<string, number>();
    for (const row of retrabajoRows) {
      revisionCountByEvaluado.set(
        row.solicitudId,
        (revisionCountByEvaluado.get(row.solicitudId) ?? 0) + 1,
      );
    }
    const revisionCounts = Array.from(evaluadosIds).map(
      (id) => revisionCountByEvaluado.get(id) ?? 0,
    );
    const retrabajoYRevisiones = {
      conRetrabajo: revisionCounts.filter((c) => c > 0).length,
      promedioRevisionesPorCaso:
        evaluadosIds.size === 0
          ? 0
          : revisionCounts.reduce((sum, c) => sum + c, 0) / evaluadosIds.size,
      tresOMasRevisiones: revisionCounts.filter((c) => c >= 3).length,
    };

    const revisionCountByUniverso = new Map<string, number>();
    for (const row of multiplesRevisionesRows) {
      revisionCountByUniverso.set(
        row.solicitudId,
        (revisionCountByUniverso.get(row.solicitudId) ?? 0) + 1,
      );
    }
    const casosConMultiplesRevisiones = universoActivoRaw
      .map((s) => ({
        cantidadRevisiones: revisionCountByUniverso.get(s.id) ?? 0,
        estado: s.estadoActual.code,
        id: s.id,
        titular:
          [s.titular?.apellidoDenominacion, s.titular?.nombre]
            .filter(Boolean)
            .join(", ") || "Sin nombre",
      }))
      .filter((c) => c.cantidadRevisiones >= 3);

    const conRetrabajoIds = new Set(
      casosParaTomarRetrabajoRows.map((r) => r.solicitudId),
    );
    const casosParaTomarFiltered =
      input.conRetrabajo == null
        ? casosParaTomarRaw
        : casosParaTomarRaw.filter((s) =>
            input.conRetrabajo === "con"
              ? conRetrabajoIds.has(s.id)
              : !conRetrabajoIds.has(s.id),
          );
    const casosParaTomar = casosParaTomarFiltered.slice(0, 8).map((s) => ({
      diasEnCola: antiguedadDias(s.id, s.createdAt),
      id: s.id,
      linea: s.lineaPrestamoDescripcion,
      titular:
        [s.titular?.apellidoDenominacion, s.titular?.nombre]
          .filter(Boolean)
          .join(", ") || "Sin nombre",
      vendedor: s.vendedorSolicitud ?? "",
    }));

    const transicionesLentas = universoActivoRaw
      .filter((s) => antiguedadDias(s.id, s.createdAt) > input.umbralDias)
      .map((s) => ({
        diasAcumulados: antiguedadDias(s.id, s.createdAt),
        estadoActual: s.estadoActual.name,
        estadoDestinoEsperado:
          ANALISTA_TRANSICION_ESPERADA[s.estadoActual.code] ?? "—",
        id: s.id,
        titular:
          [s.titular?.apellidoDenominacion, s.titular?.nombre]
            .filter(Boolean)
            .join(", ") || "Sin nombre",
      }));

    return {
      kpis: {
        asignadosAMi,
        casosConRevision,
        detenidosMasDeNDias,
        sinAsignarEnMiArea,
        tasaDeRechazoPeriodo,
      },
      backlogPorEstado,
      casosConMultiplesRevisiones,
      casosParaTomar,
      filterOptions: {
        estados: backlogStates.map((s) => ({ code: s.code, name: s.name })),
        lineas: lineasDistintasRaw.map((l) => l.lineaPrestamoDescripcion),
        vendedores: vendedoresDistintos.map((u) => ({
          id: u.id,
          fullName: [u.lastName, u.firstName].filter(Boolean).join(" "),
        })),
      },
      retrabajoYRevisiones,
      transicionesLentas,
    };
  }

  async getAnalistaStatsV2(
    input: GetAnalistaStatsInput,
  ): Promise<AnalistaDashboardStatsV2Result> {
    const currentStateInput: GetSolicitudesStatsInput = {
      ...input,
      fechaDesde: undefined,
      fechaHasta: undefined,
    };
    const currentStateFilterWhere =
      SolicitudesCorePrismaDatasource.buildStatsWhere(currentStateInput);

    const misCasosWhere: Prisma.SolicitudWhereInput = {
      assignedToUserId: input.analistaId,
    };
    const sinAsignarWhere: Prisma.SolicitudWhereInput = {
      assignedToUserId: null,
      estadoActual: { owner: { code: input.areaOwnerCode } },
    };
    const universoWhere: Prisma.SolicitudWhereInput =
      input.vista === "sin_asignar"
        ? sinAsignarWhere
        : input.vista === "ambos"
          ? { OR: [misCasosWhere, sinAsignarWhere] }
          : misCasosWhere;

    const [
      asignadosAMi,
      sinAsignarEnMiArea,
      casosConRevision,
      universoActivoRaw,
      misCasosActivosRaw,
      casosParaTomarRaw,
      backlogStates,
      lineasDistintasRaw,
      vendedoresDistintos,
      historialTrabajoRaw,
    ] = await Promise.all([
      this.prisma.solicitud.count({
        where: {
          archivedAt: null,
          AND: [currentStateFilterWhere, misCasosWhere, { estadoActual: { isActive: true } }],
        },
      }),
      this.prisma.solicitud.count({
        where: {
          archivedAt: null,
          AND: [currentStateFilterWhere, sinAsignarWhere, { estadoActual: { isActive: true } }],
        },
      }),
      this.prisma.solicitud.count({
        where: {
          archivedAt: null,
          assignedToUserId: input.analistaId,
          estadoActual: { code: "Revisar" },
        },
      }),
      this.prisma.solicitud.findMany({
        where: {
          archivedAt: null,
          AND: [currentStateFilterWhere, universoWhere, { estadoActual: { isActive: true } }],
        },
        select: { id: true, createdAt: true },
      }),
      this.prisma.solicitud.findMany({
        where: {
          archivedAt: null,
          AND: [currentStateFilterWhere, misCasosWhere, { estadoActual: { isActive: true } }],
        },
        select: {
          id: true,
          createdAt: true,
          lineaPrestamoDescripcion: true,
          estadoActual: {
            select: { code: true, name: true, owner: { select: { code: true } } },
          },
          titular: { select: { nombre: true, apellidoDenominacion: true } },
        },
      }),
      this.prisma.solicitud.findMany({
        where: {
          archivedAt: null,
          AND: [currentStateFilterWhere, sinAsignarWhere],
        },
        select: {
          id: true,
          createdAt: true,
          lineaPrestamoDescripcion: true,
          vendedorSolicitud: true,
          estadoActual: { select: { code: true } },
          titular: { select: { nombre: true, apellidoDenominacion: true } },
        },
        orderBy: { createdAt: "asc" },
        take: 30,
      }),
      this.prisma.workflowState.findMany({
        where: { isActive: true, code: { in: ANALISTA_BACKLOG_ESTADO_CODES } },
        select: { code: true, name: true },
        orderBy: { name: "asc" },
      }),
      this.prisma.solicitud.findMany({
        where: { archivedAt: null },
        select: { lineaPrestamoDescripcion: true },
        distinct: ["lineaPrestamoDescripcion"],
        orderBy: { lineaPrestamoDescripcion: "asc" },
      }),
      this.prisma.user.findMany({
        where: { workflowOwner: { code: "VENDEDORES" }, state: 1 },
        select: { id: true, firstName: true, lastName: true },
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      }),
      this.prisma.solicitudEstadoHistorial.findMany({
        where: { changedBy: input.analistaId },
        select: {
          solicitudId: true,
          changedAt: true,
          actionLabel: true,
          toStateNameSnapshot: true,
          solicitud: {
            select: { titular: { select: { nombre: true, apellidoDenominacion: true } } },
          },
        },
        orderBy: { changedAt: "desc" },
        take: 15,
      }),
    ]);

    const now = Date.now();
    const misCasosIds = misCasosActivosRaw.map((s) => s.id);
    const casosParaTomarIds = casosParaTomarRaw.map((s) => s.id);
    const revisionRiesgoIds = misCasosActivosRaw
      .filter((s) => s.estadoActual.code === "RevisionRiesgo")
      .map((s) => s.id);
    const antiguedadIds = Array.from(
      new Set([
        ...universoActivoRaw.map((s) => s.id),
        ...misCasosIds,
        ...casosParaTomarIds,
      ]),
    );

    const [lastChangeRows, revisionCountRows, revisionRiesgoHistorial] =
      await Promise.all([
        antiguedadIds.length === 0
          ? Promise.resolve([])
          : this.prisma.solicitudEstadoHistorial.findMany({
              where: { solicitudId: { in: antiguedadIds } },
              select: { changedAt: true, solicitudId: true },
            }),
        misCasosIds.length === 0
          ? Promise.resolve([])
          : this.prisma.solicitudEstadoHistorial.findMany({
              where: { solicitudId: { in: misCasosIds }, toStateCodeSnapshot: "Revisar" },
              select: { solicitudId: true },
            }),
        revisionRiesgoIds.length === 0
          ? Promise.resolve([])
          : this.prisma.solicitudEstadoHistorial.findMany({
              where: { solicitudId: { in: revisionRiesgoIds } },
              select: { solicitudId: true, toStateCodeSnapshot: true, changedAt: true },
              orderBy: { changedAt: "asc" },
            }),
      ]);

    const lastChangeMap = new Map<string, number>();
    for (const row of lastChangeRows) {
      const current = lastChangeMap.get(row.solicitudId) ?? 0;
      const t = row.changedAt.getTime();
      if (t > current) lastChangeMap.set(row.solicitudId, t);
    }
    const antiguedadDias = (id: string, createdAt: Date) => {
      const lastChange = lastChangeMap.get(id) ?? createdAt.getTime();
      return Math.floor((now - lastChange) / DAY_IN_MS);
    };

    const detenidosMasDeNDias = universoActivoRaw.filter(
      (s) => antiguedadDias(s.id, s.createdAt) > input.umbralDias,
    ).length;

    const revisionCountMap = new Map<string, number>();
    for (const row of revisionCountRows) {
      revisionCountMap.set(
        row.solicitudId,
        (revisionCountMap.get(row.solicitudId) ?? 0) + 1,
      );
    }

    const revisionRiesgoBySolicitud = new Map<
      string,
      Array<{ toStateCodeSnapshot: string; changedAt: Date }>
    >();
    for (const row of revisionRiesgoHistorial) {
      const list = revisionRiesgoBySolicitud.get(row.solicitudId) ?? [];
      list.push({ changedAt: row.changedAt, toStateCodeSnapshot: row.toStateCodeSnapshot });
      revisionRiesgoBySolicitud.set(row.solicitudId, list);
    }
    const volvioCorregidoSet = new Set<string>();
    for (const [solicitudId, rows] of revisionRiesgoBySolicitud) {
      let entryIndex = -1;
      for (let i = rows.length - 1; i >= 0; i -= 1) {
        if (rows[i]!.toStateCodeSnapshot === "RevisionRiesgo") {
          entryIndex = i;
          break;
        }
      }
      if (entryIndex > 0) {
        const hasEarlierRevisar = rows
          .slice(0, entryIndex)
          .some((r) => r.toStateCodeSnapshot === "Revisar");
        if (hasEarlierRevisar) volvioCorregidoSet.add(solicitudId);
      }
    }

    const misCasosActivos = misCasosActivosRaw
      .map((s) => ({
        cantidadRevisiones: revisionCountMap.get(s.id) ?? 0,
        diasAcumulados: antiguedadDias(s.id, s.createdAt),
        estado: s.estadoActual.name,
        id: s.id,
        linea: s.lineaPrestamoDescripcion,
        titular:
          [s.titular?.apellidoDenominacion, s.titular?.nombre]
            .filter(Boolean)
            .join(", ") || "Sin nombre",
        turno: (s.estadoActual.owner.code === "RIESGO" ? "mia" : "otro") as
          | "mia"
          | "otro",
        volvioCorregido: volvioCorregidoSet.has(s.id),
      }))
      .sort((a, b) => {
        if (a.volvioCorregido !== b.volvioCorregido) {
          return a.volvioCorregido ? -1 : 1;
        }
        return b.diasAcumulados - a.diasAcumulados;
      })
      .slice(0, 20);

    const casosParaTomar = casosParaTomarRaw.slice(0, 8).map((s) => ({
      diasEnCola: antiguedadDias(s.id, s.createdAt),
      id: s.id,
      linea: s.lineaPrestamoDescripcion,
      titular:
        [s.titular?.apellidoDenominacion, s.titular?.nombre]
          .filter(Boolean)
          .join(", ") || "Sin nombre",
      vendedor: s.vendedorSolicitud ?? "",
    }));

    const historialTrabajo = historialTrabajoRaw.map((h) => ({
      accion: h.actionLabel ?? "—",
      fecha: h.changedAt.toISOString(),
      resultado: h.toStateNameSnapshot,
      solicitudId: h.solicitudId,
      titular:
        [h.solicitud.titular?.apellidoDenominacion, h.solicitud.titular?.nombre]
          .filter(Boolean)
          .join(", ") || "Sin nombre",
    }));

    return {
      kpis: { asignadosAMi, casosConRevision, detenidosMasDeNDias, sinAsignarEnMiArea },
      misCasosActivos,
      casosParaTomar,
      historialTrabajo,
      filterOptions: {
        estados: backlogStates.map((s) => ({ code: s.code, name: s.name })),
        lineas: lineasDistintasRaw.map((l) => l.lineaPrestamoDescripcion),
        vendedores: vendedoresDistintos.map((u) => ({
          id: u.id,
          fullName: [u.lastName, u.firstName].filter(Boolean).join(" "),
        })),
      },
    };
  }

  private async getEvolucionMensualLiquidada(
    vendedorId?: string,
    linea?: string,
  ): Promise<Array<{ periodo: string; monto: number }>> {
    const months: Array<{ label: string; year: number; month: number }> = [];
    const now = new Date();
    for (let i = 5; i >= 0; i -= 1) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({
        label: d.toLocaleDateString("es-AR", { month: "short", year: "2-digit" }),
        year: d.getFullYear(),
        month: d.getMonth() + 1,
      });
    }

    const results = await Promise.all(
      months.map(({ year, month }) => {
        const fechaDesde = `${year}-${String(month).padStart(2, "0")}-01`;
        const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
        const fechaHasta = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
        return this.prisma.solicitud.aggregate({
          where: {
            ...SolicitudesCorePrismaDatasource.buildStatsWhere(
              { fechaDesde, fechaHasta, vendedorId, linea, estado: "Liquidada" },
            ),
            archivedAt: null,
          },
          _sum: { montoAFinanciar: true },
        });
      }),
    );

    return months.map((m, i) => ({
      periodo: m.label,
      monto: results[i]?._sum.montoAFinanciar
        ? Number(results[i]?._sum.montoAFinanciar)
        : 0,
    }));
  }
}

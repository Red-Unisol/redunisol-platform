import type { Prisma } from "@prisma/client";

import type { SolicitudCore } from "../../domain/entities/SolicitudCore.entity";

type PrismaWorkflowStateWithOptionalOwner =
  Prisma.WorkflowStateGetPayload<Prisma.WorkflowStateDefaultArgs> & {
    owner?: Pick<
      Prisma.WorkflowOwnerGetPayload<Prisma.WorkflowOwnerDefaultArgs>,
      "code" | "id" | "name"
    >;
};

type PrismaSolicitudShape = Prisma.SolicitudGetPayload<{
  include: {
    assignedToUser: {
      select: {
        email: true;
        firstName: true;
        id: true;
        lastName: true;
      };
    };
    conyuge: true;
    datosLaborales: true;
    estadoActual: true;
    garantias: true;
    titular: true;
  };
}> & {
  estadoActual: PrismaWorkflowStateWithOptionalOwner;
  participants?: Array<{
    role: string;
    source: string;
    userId: string;
  }>;
};

export class SolicitudCoreMapper {
  static toDomain(record: PrismaSolicitudShape): SolicitudCore {
    const formatDate = (value: Date | null) =>
      value ? value.toISOString().slice(0, 10) : null;
    const assignedToUserFullName = [
      record.assignedToUser?.firstName,
      record.assignedToUser?.lastName,
    ]
      .filter((value) => typeof value === "string" && value.trim().length > 0)
      .join(" ")
      .trim();

    return {
      assignedToUser: record.assignedToUser
        ? {
            email: record.assignedToUser.email,
            fullName: assignedToUserFullName || null,
            id: record.assignedToUser.id,
          }
        : null,
      assignedToUserId: record.assignedToUserId,
      createdAt: record.createdAt,
      createdBy: record.createdBy,
      conyuge: record.conyuge
        ? {
            actividad: record.conyuge.actividad,
            apellido: record.conyuge.apellido,
            fechaNacimiento: formatDate(record.conyuge.fechaNacimiento),
            ingresosMensuales:
              record.conyuge.ingresosMensuales === null
                ? null
                : Number(record.conyuge.ingresosMensuales),
            nacionalidad: record.conyuge.nacionalidad,
            nombre: record.conyuge.nombre,
            nroDocumento: record.conyuge.nroDocumento,
            sexo: record.conyuge.sexo,
            tipoDocumento: record.conyuge.tipoDocumento,
          }
        : null,
      cuotaResultante: record.cuotaResultante,
      cuotas: record.cuotas,
      cupoTitular:
        record.cupoTitular === null ? null : Number(record.cupoTitular),
      datosLaborales: {
        actividadLaboral: record.datosLaborales?.actividadLaboral ?? null,
        antiguedadLaboralMeses:
          record.datosLaborales?.antiguedadLaboralMeses ?? null,
        descuentosSueldo:
          record.datosLaborales?.descuentosSueldo === null ||
          record.datosLaborales?.descuentosSueldo === undefined
            ? null
            : Number(record.datosLaborales.descuentosSueldo),
        domicilioLaboralCalle:
          record.datosLaborales?.domicilioLaboralCalle ?? null,
        domicilioLaboralLocalidad:
          record.datosLaborales?.domicilioLaboralLocalidad ?? null,
        domicilioLaboralNroPuerta:
          record.datosLaborales?.domicilioLaboralNroPuerta ?? null,
        domicilioLaboralPisoDepto:
          record.datosLaborales?.domicilioLaboralPisoDepto ?? null,
        empleador: record.datosLaborales?.empleador ?? null,
        fechaIngresoLaboral: formatDate(
          record.datosLaborales?.fechaIngresoLaboral ?? null,
        ),
        montoRecibo:
          record.datosLaborales?.montoRecibo === null ||
          record.datosLaborales?.montoRecibo === undefined
            ? null
            : Number(record.datosLaborales.montoRecibo),
        relacionLaboral: record.datosLaborales?.relacionLaboral ?? null,
        tarjetas: record.datosLaborales?.tarjetas ?? null,
        vehiculo: record.datosLaborales?.vehiculo ?? null,
        vivienda: record.datosLaborales?.vivienda ?? null,
      },
      ejecutivoSolicitud: record.ejecutivoSolicitud,
      linkFirmaDigital:
        ((record as unknown as Record<string, unknown>).linkFirmaDigital as
          | string
          | null
          | undefined) ?? null,
      estadoActual: {
        code: record.estadoActual.code,
        id: record.estadoActual.id,
        name: record.estadoActual.name,
        owner: record.estadoActual.owner
          ? {
              code: record.estadoActual.owner.code,
              id: record.estadoActual.owner.id,
              name: record.estadoActual.owner.name,
            }
          : undefined,
        ownerId: record.estadoActual.ownerId,
      },
      firmaDigitalmente: record.firmaDigitalmente,
      garantias: record.garantias.map((garantia) => ({
        antiguedadLaboralMeses: garantia.antiguedadLaboralMeses,
        casadoConTitular: garantia.casadoConTitular,
        celular: garantia.celular,
        cuit: garantia.cuit,
        denominacion: garantia.denominacion,
        domicilio: garantia.domicilio,
        edad: garantia.edad,
        email: garantia.email,
        estadoCivil: garantia.estadoCivil,
        fechaIngresoLaboral: formatDate(garantia.fechaIngresoLaboral),
        fechaNacimiento: formatDate(garantia.fechaNacimiento),
        ingresoMensual:
          garantia.ingresoMensual === null
            ? null
            : Number(garantia.ingresoMensual),
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
      })),
      id: record.id,
      legacyOid: record.legacyOid,
      lineaPrestamoDescripcion: record.lineaPrestamoDescripcion,
      lineaPrestamoLegacyOid: record.lineaPrestamoLegacyOid,
      fechaPrimerVencimiento: formatDate(record.fechaPrimerVencimiento),
      nroOperacion: record.nroOperacion,
      montoAFinanciar:
        record.montoAFinanciar === null ? null : Number(record.montoAFinanciar),
      motivo: record.motivo,
      nroSolicitud: record.nroSolicitud,
      observaciones: record.observaciones,
      participants: record.participants?.map((participant) => ({
        role: participant.role,
        source: participant.source,
        userId: participant.userId,
      })),
      titular: {
        apellidoDenominacion: record.titular?.apellidoDenominacion ?? null,
        cbu: record.titular?.cbu ?? null,
        celular: record.titular?.celular ?? null,
        cuit: record.titular?.cuit ?? null,
        domicilioCalle: record.titular?.domicilioCalle ?? null,
        email: record.titular?.email ?? null,
        fechaNacimiento: formatDate(record.titular?.fechaNacimiento ?? null),
        localidad: record.titular?.localidad ?? null,
        nombre: record.titular?.nombre ?? null,
        personaExpuestaPoliticamente:
          record.titular?.personaExpuestaPoliticamente ?? null,
        nroDocumento: record.titular?.nroDocumento ?? null,
        nroPuerta: record.titular?.nroPuerta ?? null,
        nroSocio: record.titular?.nroSocio ?? null,
        estadoCivil: record.titular?.estadoCivil ?? null,
        nacionalidad: record.titular?.nacionalidad ?? null,
        sexo: record.titular?.sexo ?? null,
        telefonoFijo: record.titular?.telefonoFijo ?? null,
        tipoDocumento: record.titular?.tipoDocumento ?? null,
      },
      updatedAt: record.updatedAt,
      vendedorSolicitud: record.vendedorSolicitud,
    };
  }
}

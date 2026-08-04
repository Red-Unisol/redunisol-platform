import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Prisma } from "@prisma/client";

import { SolicitudCoreMapper } from "./SolicitudCore.mapper";

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
}>;

describe("SolicitudCoreMapper", () => {
  it("maps canonical persisted fields into the domain model", () => {
    const record: PrismaSolicitudShape = {
      archivedAt: null,
      assignedToUser: null,
      assignedToUserId: null,
      conyuge: {
        actividad: "Docente",
        apellido: "Gomez",
        fechaNacimiento: new Date("1988-07-09T00:00:00.000Z"),
        ingresosMensuales: new Prisma.Decimal("180000.00"),
        nacionalidad: "Argentina",
        nombre: "Maria",
        nroDocumento: "32223334",
        sexo: "F",
        solicitudId: "sol-1",
        tipoDocumento: "DNI",
      },
      createdAt: new Date("2026-05-14T12:00:00.000Z"),
      createdBy: "user-1",
      cuotaResultante: "2500",
      cuotas: 12,
      cupoTitular: new Prisma.Decimal("150000.50"),
      datosLaborales: {
        actividadLaboral: null,
        antiguedadLaboralMeses: null,
        descuentosSueldo: new Prisma.Decimal("1200.75"),
        domicilioLaboralCalle: null,
        domicilioLaboralLocalidad: null,
        domicilioLaboralNroPuerta: null,
        domicilioLaboralPisoDepto: null,
        empleador: null,
        fechaIngresoLaboral: new Date("2025-03-10T00:00:00.000Z"),
        montoRecibo: new Prisma.Decimal("45000.25"),
        relacionLaboral: null,
        tarjetas: null,
        vehiculo: null,
        vivienda: null,
        solicitudId: "sol-1",
      },
      ejecutivoSolicitud: null,
      linkFirmaDigital: null,
      estadoActual: {
        code: "CargaVendedor",
        createdAt: new Date("2026-05-14T12:00:00.000Z"),
        description: null,
        id: "wf-1",
        isActive: true,
        isInitial: true,
        isTerminal: false,
        name: "Carga Vendedor",
        ownerId: "owner-1",
        updatedAt: new Date("2026-05-14T12:00:00.000Z"),
      },
      estadoActualId: "wf-1",
      firmaDigitalmente: false,
      garantias: [],
      fechaPrimerVencimiento: new Date("2026-06-01T00:00:00.000Z"),
      id: "sol-1",
      legacyOid: null,
      lineaPrestamoDescripcion: "Linea 1",
      lineaPrestamoLegacyOid: "LP-1",
      montoAFinanciar: new Prisma.Decimal("200000.00"),
      motivo: null,
      nroOperacion: "OP-123",
      nroSolicitud: "SOL-2026-001",
      observaciones: null,
      titular: {
        apellidoDenominacion: "Perez",
        cbu: null,
        celular: "1199999999",
        cuit: null,
        domicilioCalle: null,
        email: null,
        fechaNacimiento: null,
        estadoCivil: "Soltero",
        localidad: null,
        nacionalidad: "Argentina",
        nombre: "Juan",
        nroDocumento: "30111222",
        nroPuerta: null,
        nroSocio: null,
        personaExpuestaPoliticamente: true,
        sexo: "M",
        solicitudId: "sol-1",
        telefonoFijo: "1144444444",
        tipoDocumento: "DNI",
      },
      updatedAt: new Date("2026-05-14T12:30:00.000Z"),
      vendedorId: null,
      vendedorSolicitud: null,
    };

    const domain = SolicitudCoreMapper.toDomain(record);

    assert.equal(domain.fechaPrimerVencimiento, "2026-06-01");
    assert.equal(domain.nroOperacion, "OP-123");
    assert.equal(domain.cupoTitular, 150000.5);
    assert.equal(domain.conyuge?.nombre, "Maria");
    assert.equal(domain.titular.personaExpuestaPoliticamente, true);
    assert.equal(domain.titular.telefonoFijo, "1144444444");
    assert.equal(domain.titular.estadoCivil, "Soltero");
    assert.equal(domain.titular.nacionalidad, "Argentina");
    assert.equal(domain.titular.sexo, "M");
    assert.equal(domain.assignedToUser, null);
    assert.equal(domain.assignedToUserId, null);
  });

  it("maps assignedToUser fields when solicitud has individual assignee", () => {
    const record: PrismaSolicitudShape = {
      ...({
        archivedAt: null,
        assignedToUser: {
          email: "assignee@example.com",
          firstName: "Riesgo",
          id: "assignee-1",
          lastName: "Operador",
        },
        assignedToUserId: "assignee-1",
        conyuge: null,
        createdAt: new Date("2026-05-14T12:00:00.000Z"),
        createdBy: "user-1",
        cuotaResultante: null,
        cuotas: null,
        cupoTitular: null,
        datosLaborales: null,
        ejecutivoSolicitud: null,
        linkFirmaDigital: null,
        estadoActual: {
          code: "RevisionRiesgo",
          createdAt: new Date("2026-05-14T12:00:00.000Z"),
          description: null,
          id: "wf-2",
          isActive: true,
          isInitial: false,
          isTerminal: false,
          name: "Revision riesgo",
          ownerId: "owner-riesgo",
          updatedAt: new Date("2026-05-14T12:00:00.000Z"),
        },
        estadoActualId: "wf-2",
        fechaPrimerVencimiento: null,
        firmaDigitalmente: false,
        garantias: [],
        id: "sol-2",
        legacyOid: null,
        lineaPrestamoDescripcion: "Linea 2",
        lineaPrestamoLegacyOid: "LP-2",
        montoAFinanciar: null,
        motivo: null,
        nroOperacion: null,
        nroSolicitud: null,
        observaciones: null,
        titular: null,
        updatedAt: new Date("2026-05-14T12:30:00.000Z"),
        vendedorId: null,
        vendedorSolicitud: null,
      } as PrismaSolicitudShape),
    };

    const domain = SolicitudCoreMapper.toDomain(record);

    assert.deepEqual(domain.assignedToUser, {
      email: "assignee@example.com",
      fullName: "Riesgo Operador",
      id: "assignee-1",
    });
    assert.equal(domain.assignedToUserId, "assignee-1");
  });
});

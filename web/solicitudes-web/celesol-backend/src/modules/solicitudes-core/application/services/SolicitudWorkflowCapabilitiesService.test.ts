import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SolicitudWorkflowCapabilitiesService } from "./SolicitudWorkflowCapabilitiesService";

describe("SolicitudWorkflowCapabilitiesService", () => {
  it("keeps passthrough decorate behavior in phase 1", () => {
    const service = new SolicitudWorkflowCapabilitiesService();
    const result = workflowExecutionResult();

    const decorated = service.decorate(result);

    assert.equal(decorated, result);
  });
});

function workflowExecutionResult() {
  return {
    solicitud: {
      id: "sol-1",
      createdAt: new Date("2026-05-18T10:00:00.000Z"),
      createdBy: "user-1",
      cuotaResultante: null,
      cuotas: null,
      ejecutivoSolicitud: null,
      estadoActual: {
        code: "RevisionRiesgo",
        id: "state-2",
        name: "Revision riesgo",
        ownerId: "owner-2",
      },
      firmaDigitalmente: false,
      legacyOid: null,
      lineaPrestamoDescripcion: "Personal",
      lineaPrestamoLegacyOid: "LP-1",
      montoAFinanciar: null,
      motivo: null,
      nroSolicitud: null,
      observaciones: null,
      garantias: [],
      conyuge: null,
      datosLaborales: {
        actividadLaboral: null,
        antiguedadLaboralMeses: null,
        descuentosSueldo: null,
        domicilioLaboralCalle: null,
        domicilioLaboralLocalidad: null,
        domicilioLaboralNroPuerta: null,
        domicilioLaboralPisoDepto: null,
        empleador: null,
        fechaIngresoLaboral: null,
        montoRecibo: null,
        relacionLaboral: null,
        tarjetas: null,
        vehiculo: null,
        vivienda: null,
      },
      titular: {
        apellidoDenominacion: null,
        cbu: null,
        celular: null,
        cuit: null,
        domicilioCalle: null,
        email: null,
        localidad: null,
        nombre: null,
        nroDocumento: null,
        nroPuerta: null,
        nroSocio: null,
        tipoDocumento: null,
      },
      updatedAt: new Date("2026-05-18T10:00:00.000Z"),
      vendedorSolicitud: null,
    },
    transitions: [],
  };
}

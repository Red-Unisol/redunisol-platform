import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PDFDocument } from "pdf-lib";

import { ComprobanteRefinanciacionService } from "./ComprobanteRefinanciacion";
import { SolicitudRefinanciacionInvalidaError } from "../../domain/solicitudes-core-errors";
import {
  buildComprobanteRefinanciacionPdf,
  type ComprobanteRefinanciacion,
} from "../../infrastructure/services/ComprobanteRefinanciacionPdf";

// Titular inventado.
const TITULAR = {
  apellidoDenominacion: "Perez",
  cuit: null,
  domicilioCalle: "CALLE FALSA",
  localidad: "CORDOBA",
  nombre: "Juan Carlos",
  nroDocumento: "20000000",
  nroPuerta: "123",
  tipoDocumento: "DNI",
};

// Plan de Vimarx al momento de armar el comprobante. La cuota 11 ya tenia
// 3000 pagados (caso real de prod del 2/11/2026, prestamo 389291); la 20 esta
// vencida con punitorios y la 23 todavia no vence (FapiTest, prestamo 418720).
const PLAN = [
  { capital: 5373.91, fecha: "2022-09-30", montoTotal: 6743.45, nroCuota: 11, saldoCuota: 3743.45, saldoCuotaConPunitorios: 3743.45 },
  { capital: 5884.37, fecha: "2022-10-31", montoTotal: 6743.39, nroCuota: 12, saldoCuota: 6743.39, saldoCuotaConPunitorios: 6743.39 },
  { capital: 22794.34, fecha: "2026-09-30", montoTotal: 38409.77, nroCuota: 20, saldoCuota: 37409.77, saldoCuotaConPunitorios: 37821.28 },
  { capital: 31174.24, fecha: "2026-12-31", montoTotal: 38409.77, nroCuota: 23, saldoCuota: 38409.77, saldoCuotaConPunitorios: 31174.24 },
];

// Lo que devuelve Vimarx por cuota en el 389291: acumulado de toda la
// historia de la cuota (la 11 suma los 3000 de antes).
const COBRADAS_389291 = [
  { fechaVto: "2022-09-30T00:00:00", interesPagado: 1069.54, nroCuota: 11, otrosPagado: 300, punitoriosPagados: 658.1, totalPagado: 7401.55 },
  { fechaVto: "2022-10-31T00:00:00", interesPagado: 559.02, nroCuota: 12, otrosPagado: 562.17, punitoriosPagados: 0, totalPagado: 7005.56 },
];

describe("ComprobanteRefinanciacionService", () => {
  it("shows what is charged now when a cuota had earlier payments", async () => {
    let recibido: ComprobanteRefinanciacion[] = [];
    let simulacion: boolean | undefined;
    const servicio = build(async (comprobantes, options) => {
      recibido = [...comprobantes];
      simulacion = options.simulacion;
      return Buffer.from("pdf");
    });

    await servicio.armar({
      prestamos: [
        { cuotas: COBRADAS_389291, numero: "0", prestamoId: "389291", totalPago: 10749.01 },
      ],
      simulacion: true,
      solicitudId: "sol-1",
    });

    assert.equal(simulacion, true);
    assert.deepEqual(recibido[0], {
      cuotas: [
        { capital: 3743.45, creditoPagoAdelantado: 0, gastos: 0, interes: 0, nroCuota: 11, punitorios: 0, total: 3743.45, vencimiento: "30/09/2022" },
        // El cargo del 2,5 % (262,17) va en la ultima cuota, como en Vimarx.
        { capital: 5884.37, creditoPagoAdelantado: 0, gastos: 262.17, interes: 859.02, nroCuota: 12, punitorios: 0, total: 7005.56, vencimiento: "31/10/2022" },
      ],
      documento: "20000000",
      domicilio: "CALLE FALSA 123",
      fecha: "28/10/2026",
      linea: "AMEJUCA ESPECIAL",
      localidad: "CORDOBA",
      numero: "0",
      operacion: "998314",
      socio: "PEREZ JUAN CARLOS",
    });
    const total = recibido[0]!.cuotas.reduce((suma, cuota) => suma + cuota.total, 0);
    assert.equal(Math.round(total * 100) / 100, 10749.01);
  });

  it("adds punitorios to an overdue cuota and credits the interest of a future one", async () => {
    let recibido: ComprobanteRefinanciacion[] = [];
    const servicio = build(async (comprobantes) => {
      recibido = [...comprobantes];
      return Buffer.from("pdf");
    });

    await servicio.armar({
      prestamos: [
        {
          // Dos cobros de Vimarx: [20] = 38766,81 y [23] = 31953,60.
          cuotas: [
            { fechaVto: "2026-12-31T00:00:00", interesPagado: 0, nroCuota: 23, otrosPagado: 779.36, punitoriosPagados: 0, totalPagado: 31953.6 },
            { fechaVto: "2026-09-30T00:00:00", interesPagado: 15615.43, nroCuota: 20, otrosPagado: 945.53, punitoriosPagados: 1411.51, totalPagado: 40766.81 },
          ],
          numero: "Pendiente de cobro",
          prestamoId: "418720",
          totalPago: 70720.41,
        },
      ],
      simulacion: false,
      solicitudId: "sol-1",
    });

    assert.deepEqual(recibido[0]?.cuotas, [
      { capital: 22794.34, creditoPagoAdelantado: 0, gastos: 0, interes: 14615.43, nroCuota: 20, punitorios: 411.51, total: 37821.28, vencimiento: "30/09/2026" },
      { capital: 31174.24, creditoPagoAdelantado: 7235.53, gastos: 1724.89, interes: 7235.53, nroCuota: 23, punitorios: 0, total: 32899.13, vencimiento: "31/12/2026" },
    ]);
  });

  it("refuses a comprobante that does not add up to what Vimarx charges", async () => {
    const servicio = build(async () => {
      throw new Error("no deberia armar el PDF");
    });

    await assert.rejects(
      servicio.armar({
        prestamos: [
          // El total que daba el comprobante viejo: 3000 de mas.
          { cuotas: COBRADAS_389291, numero: "0", prestamoId: "389291", totalPago: 14407.11 },
        ],
        simulacion: true,
        solicitudId: "sol-1",
      }),
      SolicitudRefinanciacionInvalidaError,
    );
  });

  it("refuses a cuota that is not in the plan", async () => {
    const servicio = build(async () => {
      throw new Error("no deberia armar el PDF");
    });

    await assert.rejects(
      servicio.armar({
        prestamos: [
          {
            cuotas: [
              { fechaVto: null, interesPagado: 100, nroCuota: 99, otrosPagado: 25, punitoriosPagados: 10, totalPagado: 1135 },
            ],
            numero: "0",
            prestamoId: "389291",
            totalPago: 1135,
          },
        ],
        simulacion: true,
        solicitudId: "sol-1",
      }),
      SolicitudRefinanciacionInvalidaError,
    );
  });
});

describe("buildComprobanteRefinanciacionPdf", () => {
  it("makes one page per cobro", async () => {
    const comprobante: ComprobanteRefinanciacion = {
      cuotas: [{ capital: 1, creditoPagoAdelantado: 0, gastos: 0, interes: 0, nroCuota: 1, punitorios: 0, total: 1, vencimiento: "30/09/2026" }],
      documento: "20000000",
      domicilio: "CALLE FALSA 123",
      fecha: "28/10/2026",
      linea: "AMEJUCA ESPECIAL",
      localidad: "Córdoba",
      numero: "0",
      operacion: "998314",
      socio: "PEÑA JOSÉ",
    };

    const pdf = await buildComprobanteRefinanciacionPdf([comprobante, comprobante], {
      simulacion: true,
    });
    const leido = await PDFDocument.load(pdf);

    assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
    assert.equal(leido.getPageCount(), 2);
  });
});

function build(
  fake: (
    comprobantes: readonly ComprobanteRefinanciacion[],
    options: { simulacion: boolean },
  ) => Promise<Buffer>,
) {
  return new ComprobanteRefinanciacionService({
    build: fake,
    hoy: () => "2026-10-28",
    legacyGateway: {
      getPrestamoDelSocio: (async () => ({
        lineaPrestamoDescripcion: "AMEJUCA ESPECIAL",
        nroCuenta: "998314",
      })) as never,
      listCuotasDelPrestamo: (async () => PLAN) as never,
      lookupSocioRapido: async () => [{ id: "1" }],
    },
    repository: {
      findById: async () => ({ id: "sol-1", titular: TITULAR }),
    } as never,
  });
}

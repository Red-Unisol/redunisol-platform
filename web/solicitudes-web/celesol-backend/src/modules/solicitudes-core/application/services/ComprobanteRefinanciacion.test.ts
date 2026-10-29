import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PDFDocument } from "pdf-lib";

import { ComprobanteRefinanciacionService } from "./ComprobanteRefinanciacion";
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

// Importes de una simulacion de FapiTest (28/10/2026) que coincidio con la de
// la pantalla de Vimarx: cuota vencida, y dos futuras con el cargo en la ultima.
const PLAN = [
  { capital: 25835.23, fecha: "2026-09-30", montoTotal: 132231.88, nroCuota: 22 },
  { capital: 32119, fecha: "2026-11-30", montoTotal: 132231.88, nroCuota: 24 },
  { capital: 35812.69, fecha: "2026-12-31", montoTotal: 132231.88, nroCuota: 25 },
];

describe("ComprobanteRefinanciacionService", () => {
  it("builds the columns of the Vimarx report from the cobro and the plan", async () => {
    let recibido: ComprobanteRefinanciacion[] = [];
    let simulacion: boolean | undefined;
    const servicio = build(async (comprobantes, options) => {
      recibido = [...comprobantes];
      simulacion = options.simulacion;
      return Buffer.from("pdf");
    });

    await servicio.armar({
      prestamos: [
        {
          cuotas: [
            // Vencida, cobrada aparte: con punitorios y su cargo.
            { fechaVto: "2026-09-30T00:00:00", interesPagado: 106396.65, nroCuota: 22, otrosPagado: 3483.21, punitoriosPagados: 7096.44, totalPagado: 142811.53 },
            // Futuras: el interes no se cobra.
            { fechaVto: "2026-11-30T00:00:00", interesPagado: 0, nroCuota: 24, otrosPagado: 0, punitoriosPagados: 0, totalPagado: 32119 },
            { fechaVto: "2026-12-31T00:00:00", interesPagado: 0, nroCuota: 25, otrosPagado: 8309.89, punitoriosPagados: 0, totalPagado: 44122.58 },
          ],
          numero: "18868327",
          prestamoId: "416228",
        },
      ],
      simulacion: false,
      solicitudId: "sol-1",
    });

    assert.equal(simulacion, false);
    assert.deepEqual(recibido[0], {
      cuotas: [
        { capital: 25835.23, creditoPagoAdelantado: 0, gastos: 3483.21, interes: 106396.65, nroCuota: 22, punitorios: 7096.44, total: 142811.53, vencimiento: "30/09/2026" },
        { capital: 32119, creditoPagoAdelantado: 100112.88, gastos: 0, interes: 100112.88, nroCuota: 24, punitorios: 0, total: 32119, vencimiento: "30/11/2026" },
        { capital: 35812.69, creditoPagoAdelantado: 96419.19, gastos: 8309.89, interes: 96419.19, nroCuota: 25, punitorios: 0, total: 44122.58, vencimiento: "31/12/2026" },
      ],
      documento: "20000000",
      domicilio: "CALLE FALSA 123",
      fecha: "28/10/2026",
      linea: "AMEJUCA ESPECIAL",
      localidad: "CORDOBA",
      numero: "18868327",
      operacion: "998314",
      socio: "PEREZ JUAN CARLOS",
    });
  });

  it("rebuilds capital from the cobro when the plan does not have the cuota", async () => {
    let recibido: ComprobanteRefinanciacion[] = [];
    const servicio = build(async (comprobantes) => {
      recibido = [...comprobantes];
      return Buffer.from("pdf");
    });

    await servicio.armar({
      prestamos: [
        {
          cuotas: [
            { fechaVto: null, interesPagado: 100, nroCuota: 99, otrosPagado: 25, punitoriosPagados: 10, totalPagado: 1135 },
          ],
          numero: "0",
          prestamoId: "416228",
        },
      ],
      simulacion: true,
      solicitudId: "sol-1",
    });

    assert.deepEqual(recibido[0]?.cuotas[0], {
      capital: 1000,
      creditoPagoAdelantado: 0,
      gastos: 25,
      interes: 100,
      nroCuota: 99,
      punitorios: 10,
      total: 1135,
      vencimiento: "-",
    });
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

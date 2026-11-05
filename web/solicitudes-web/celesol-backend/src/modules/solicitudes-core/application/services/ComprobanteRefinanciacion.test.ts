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

  it("uses outstanding capital in the breakdown of a partially paid cuota", async () => {
    // Capital original 100; ya se pagaron 40 de capital y 10 de interes.
    // Quedan 60 de capital y 90 de interes. Si el periodo no empezo, se
    // bonifican esos 90 y el cobro es 60, tanto a hoy como a una fecha pasada.
    const plan = [
      { capital: 100, fecha: "2026-10-31", nroCuota: 1, saldoCuota: 0, saldoCuotaCapital: 0, saldoCuotaConPunitorios: 0 },
      { capital: 100, fecha: "2026-11-30", nroCuota: 2, saldoCuota: 150, saldoCuotaCapital: 60, saldoCuotaConPunitorios: 60, punitoriosPagos: 0 },
    ];

    for (const fecha of [undefined, "2026-10-27"]) {
      let recibido: ComprobanteRefinanciacion[] = [];
      const servicio = build(async (comprobantes) => {
        recibido = [...comprobantes];
        return Buffer.from("pdf");
      }, plan);

      await servicio.armar({
        fecha,
        prestamos: [{
          cuotas: [{ fechaVto: "2026-11-30", interesPagado: 10, nroCuota: 2, otrosPagado: 0, punitoriosPagados: 0, totalPagado: 110 }],
          numero: "0",
          prestamoId: "1",
          totalPago: 60,
        }],
        simulacion: true,
        solicitudId: "sol-1",
      });

      assert.deepEqual(recibido[0]?.cuotas, [{
        capital: 60,
        creditoPagoAdelantado: 90,
        gastos: 0,
        interes: 90,
        nroCuota: 2,
        punitorios: 0,
        total: 60,
        vencimiento: "30/11/2026",
      }], `fecha=${fecha ?? "hoy"}`);
    }
  });

  it("preserves a zero outstanding capital instead of falling back to the original", async () => {
    const plan = [{ capital: 100, fecha: "2026-09-30", nroCuota: 1,
      saldoCuota: 50, saldoCuotaCapital: 0, saldoCuotaConPunitorios: 50 }];
    let recibido: ComprobanteRefinanciacion[] = [];
    const servicio = build(async (comprobantes) => {
      recibido = [...comprobantes];
      return Buffer.from("pdf");
    }, plan);

    await servicio.armar({
      prestamos: [{
        cuotas: [{ fechaVto: "2026-09-30", interesPagado: 50, nroCuota: 1, otrosPagado: 0, punitoriosPagados: 0, totalPagado: 150 }],
        numero: "0", prestamoId: "1", totalPago: 50,
      }],
      simulacion: true,
      solicitudId: "sol-1",
    });

    assert.equal(recibido[0]?.cuotas[0]?.capital, 0);
    assert.equal(recibido[0]?.cuotas[0]?.interes, 50);
    assert.equal(recibido[0]?.cuotas[0]?.total, 50);
  });

  it("builds the rows at the fecha de calculo, not with the plan of today", async () => {
    // Caso real de prod (4/11/2026): solicitud 500098, prestamo 435844, cuotas
    // 6 a 12 al 31/10. A hoy la 6 (vence el 30/11) es del mes y el plan la trae
    // entera; al 31/10 es futura y Vimarx cobra solo su capital: 1108457,60 =
    // capital 1081422,05 + 2,5 %. Con el plan de hoy sumaba 1225791,89.
    const plan435844 = [
      [5, "2026-10-31", 0, 0, 0],
      [6, "2026-11-30", 102820.96, 247190.8, 247190.8],
      [7, "2026-12-31", 116547.55, 247190.8, 116547.55],
      [8, "2027-01-31", 132106.65, 247190.8, 132106.65],
      [9, "2027-02-28", 149742.89, 247190.8, 149742.89],
      [10, "2027-03-31", 169733.57, 247190.8, 169733.57],
      [11, "2027-04-30", 192393.0, 247190.8, 192393.0],
      [12, "2027-05-31", 218077.43, 247190.77, 218077.43],
    ].map(([nroCuota, fecha, capital, saldo, conPunitorios]) => ({
      capital: capital as number,
      fecha: fecha as string,
      montoTotal: saldo as number,
      nroCuota: nroCuota as number,
      punitoriosPagos: 0,
      saldoCuota: saldo as number,
      saldoCuotaCapital: capital as number,
      saldoCuotaConPunitorios: conPunitorios as number,
    }));
    let recibido: ComprobanteRefinanciacion[] = [];
    const servicio = build(async (comprobantes) => {
      recibido = [...comprobantes];
      return Buffer.from("pdf");
    }, plan435844);

    await servicio.armar({
      fecha: "2026-10-27",
      prestamos: [
        {
          cuotas: plan435844.filter((cuota) => cuota.nroCuota > 5).map((cuota) => ({
            fechaVto: `${cuota.fecha}T00:00:00`,
            interesPagado: 0,
            nroCuota: cuota.nroCuota,
            otrosPagado: 0,
            punitoriosPagados: 0,
            totalPagado: cuota.capital,
          })),
          numero: "Pendiente de cobro",
          prestamoId: "435844",
          totalPago: 1108457.6,
        },
      ],
      simulacion: false,
      solicitudId: "sol-1",
    });

    const cuotas = recibido[0]!.cuotas;
    assert.equal(recibido[0]?.fecha, "27/10/2026");
    assert.deepEqual(cuotas[0], {
      capital: 102820.96,
      creditoPagoAdelantado: 144369.84,
      gastos: 0,
      interes: 144369.84,
      nroCuota: 6,
      punitorios: 0,
      total: 102820.96,
      vencimiento: "30/11/2026",
    });
    assert.equal(cuotas.at(-1)?.gastos, 27035.55);
    const total = cuotas.reduce((suma, cuota) => suma + cuota.total, 0);
    assert.equal(Math.round(total * 100) / 100, 1108457.6);
  });

  it("charges the whole first cuota: its period starts with the prestamo", async () => {
    // FapiTest 4/11/2026, prestamo 441204 (AMEJUCA ESPECIAL): la cuota 1 vence
    // el 30/11 y Vimarx la cobra entera al 31/10; las siguientes, solo capital.
    const plan = [
      // La cuota 0 de gastos vence el 31/10: no cuenta como cuota anterior.
      { capital: 0, fecha: "2026-10-31", montoTotal: 600000, nroCuota: 0, punitoriosPagos: 0, saldoCuota: 600000, saldoCuotaCapital: 0, saldoCuotaConPunitorios: 600000 },
      { capital: 528763.9, fecha: "2026-11-30", montoTotal: 989976.38, nroCuota: 1, punitoriosPagos: 0, saldoCuota: 989976.38, saldoCuotaCapital: 528763.9, saldoCuotaConPunitorios: 989976.38 },
      { capital: 461312.48, fecha: "2026-12-31", montoTotal: 989976.38, nroCuota: 2, punitoriosPagos: 0, saldoCuota: 989976.38, saldoCuotaCapital: 461312.48, saldoCuotaConPunitorios: 461312.48 },
    ];
    let recibido: ComprobanteRefinanciacion[] = [];
    const servicio = build(async (comprobantes) => {
      recibido = [...comprobantes];
      return Buffer.from("pdf");
    }, plan);

    await servicio.armar({
      fecha: "2026-10-27",
      prestamos: [
        {
          cuotas: [
            { fechaVto: "2026-11-30T00:00:00", interesPagado: 0, nroCuota: 1, otrosPagado: 0, punitoriosPagados: 0, totalPagado: 0 },
            { fechaVto: "2026-12-31T00:00:00", interesPagado: 0, nroCuota: 2, otrosPagado: 0, punitoriosPagados: 0, totalPagado: 0 },
          ],
          numero: "0",
          prestamoId: "441204",
          // (989976,38 + 461312,48) + 2,5 %.
          totalPago: 1487571.08,
        },
      ],
      simulacion: true,
      solicitudId: "sol-1",
    });

    assert.deepEqual(
      recibido[0]?.cuotas.map((cuota) => [cuota.nroCuota, cuota.total - cuota.gastos]),
      [
        [1, 989976.38],
        [2, 461312.48],
      ],
    );
  });

  it("charges the whole saldo of a cuota whose period started, and punitorios to that date", async () => {
    // Fecha de calculo 15/10 (hoy = 28/10 en los tests): la 20 (vencio el
    // 30/9) lleva los punitorios al 15/10 que informa Vimarx menos los ya
    // pagados; una cuota que vence el 31/10 va entera, sin punitorios.
    const plan = [
      { capital: 22794.34, fecha: "2026-09-30", montoTotal: 38409.77, nroCuota: 20, punitoriosPagos: 1000, saldoCuota: 37409.77, saldoCuotaCapital: 22794.34, saldoCuotaConPunitorios: 37821.28 },
      { capital: 28084.9, fecha: "2026-10-31", montoTotal: 38409.77, nroCuota: 21, punitoriosPagos: 0, saldoCuota: 38409.77, saldoCuotaCapital: 28084.9, saldoCuotaConPunitorios: 38500 },
    ];
    let recibido: ComprobanteRefinanciacion[] = [];
    const servicio = build(async (comprobantes) => {
      recibido = [...comprobantes];
      return Buffer.from("pdf");
    }, plan);

    await servicio.armar({
      fecha: "2026-10-15",
      prestamos: [
        {
          cuotas: [
            { fechaVto: "2026-09-30T00:00:00", interesPagado: 0, nroCuota: 20, otrosPagado: 0, punitoriosPagados: 1200, totalPagado: 0 },
            { fechaVto: "2026-10-31T00:00:00", interesPagado: 0, nroCuota: 21, otrosPagado: 0, punitoriosPagados: 0, totalPagado: 0 },
          ],
          numero: "0",
          prestamoId: "418720",
          // 37609,77 + 38409,77, sin cargo.
          totalPago: 76019.54,
        },
      ],
      simulacion: true,
      solicitudId: "sol-1",
    });

    assert.deepEqual(
      recibido[0]?.cuotas.map((cuota) => [cuota.nroCuota, cuota.punitorios, cuota.total]),
      [
        [20, 200, 37609.77],
        [21, 0, 38409.77],
      ],
    );
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
  plan: readonly unknown[] = PLAN,
) {
  return new ComprobanteRefinanciacionService({
    build: fake,
    hoy: () => "2026-10-28",
    legacyGateway: {
      getPrestamoDelSocio: (async () => ({
        lineaPrestamoDescripcion: "AMEJUCA ESPECIAL",
        nroCuenta: "998314",
      })) as never,
      listCuotasDelPrestamo: (async () => plan) as never,
      lookupSocioRapido: async () => [{ id: "1" }],
    },
    repository: {
      findById: async () => ({ id: "sol-1", titular: TITULAR }),
    } as never,
  });
}

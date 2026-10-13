import assert from "node:assert/strict";
import { test } from "node:test";
import type { SimulacionPrestamo } from "../../../solicitudes/infrastructure/services/PrestamosSimulacionGateway";
import { calcularMontoPorCuota } from "./CalcularMontoPorCuota";

const response = (montoAFinanciar: number, cuotaResultante: number) =>
  ({ montoAFinanciar, cuotaResultante }) as SimulacionPrestamo;

test("calcula contra el simulador con gasto fijo, sin suponer proporcionalidad", async () => {
  const calls: number[] = [];
  const result = await calcularMontoPorCuota({
    cuotaObjetivo: 1100,
    montoMinimo: 100,
    montoMaximo: 20000,
    simular: async (amount) => {
      calls.push(amount);
      return response(amount, amount * 0.1 + 100);
    },
  });
  assert.equal(result.montoAFinanciar, 10000);
  assert.equal(result.cuotaResultante, 1100);
  assert.equal(calls.length, 3);
});
test("valida también una regla no lineal", async () => {
  const result = await calcularMontoPorCuota({
    cuotaObjetivo: 400,
    montoMinimo: 100,
    montoMaximo: 3000,
    simular: async (amount) => response(amount, Math.sqrt(amount) * 10),
  });
  assert(Math.abs(result.cuotaResultante - 400) <= 0.01);
  assert(Math.abs(result.montoAFinanciar - 1600) <= 0.1);
});
test("la cuota que supera el máximo usa el monto máximo y devuelve la cuota real", async () => {
  const result = await calcularMontoPorCuota({
    cuotaObjetivo: 5000,
    montoMinimo: 100,
    montoMaximo: 2000,
    simular: async (amount) => response(amount, amount / 10),
  });
  assert.equal(result.montoAFinanciar, 2000);
  assert.equal(result.cuotaResultante, 200);
});
test("no ajusta por debajo del mínimo ni inventa un resultado", async () => {
  await assert.rejects(
    calcularMontoPorCuota({
      cuotaObjetivo: 5,
      montoMinimo: 100,
      montoMaximo: 2000,
      simular: async (amount) => response(amount, amount / 10),
    }),
    /no corresponde/,
  );
});
test("un fallo de legacy interrumpe el cálculo", async () => {
  await assert.rejects(
    calcularMontoPorCuota({
      cuotaObjetivo: 100,
      montoMinimo: 100,
      montoMaximo: 2000,
      simular: async () => {
        throw new Error("legacy caído");
      },
    }),
    /legacy caído/,
  );
});
test("un salto sin solución termina con error y consultas limitadas", async () => {
  let calls = 0;
  await assert.rejects(
    calcularMontoPorCuota({
      cuotaObjetivo: 150,
      montoMinimo: 100,
      montoMaximo: 2000,
      simular: async (amount) => {
        calls++;
        return response(amount, amount < 1000 ? 100 : 200);
      },
    }),
    /No se pudo/,
  );
  assert(calls <= 12);
});
test("una cuota inválida no consulta legacy", async () => {
  for (const cuotaObjetivo of [0, -1, NaN, Infinity])
    await assert.rejects(
      calcularMontoPorCuota({
        cuotaObjetivo,
        montoMinimo: 100,
        montoMaximo: 2000,
        simular: async () => {
          assert.fail("no consultar");
        },
      }),
      /no es válido/,
    );
});

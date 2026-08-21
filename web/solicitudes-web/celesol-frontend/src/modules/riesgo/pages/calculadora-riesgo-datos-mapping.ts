import type { CalculadoraMutualDatos } from "../services/riesgo-api";

export const CALCULADORA_DATOS_SHEET_NAME = "Datos";

export type CalculadoraCellValue = string | number | boolean;

export type CalculadoraCellWrite = {
  cell: string;
  value: CalculadoraCellValue;
};

/**
 * Cada celda corresponde a lo que en la plantilla original era una fórmula
 * rota apuntando al legado (columna B para los campos simples, columna D
 * para los que la hoja Evaluacion deriva con una fórmula propia a partir de
 * ese valor crudo). Los campos excluidos (TEM, Cupo Interno, Registro de
 * Quiebras, Riesgo BCRA, Peor Situación 24 Meses, Adicional1/2) no tienen
 * entrada acá a propósito.
 */
export function buildCalculadoraDatosCellWrites(
  datos: CalculadoraMutualDatos,
): CalculadoraCellWrite[] {
  const writes: CalculadoraCellWrite[] = [];

  addWrite(writes, "B2", datos.nroSolicitud);
  addWrite(writes, "B3", datos.lineaDescripcion);
  addWrite(writes, "B4", datos.lineaId);
  addWrite(writes, "B5", datos.montoAFinanciar);
  addWrite(writes, "B6", datos.cuotas);
  addWrite(writes, "B7", datos.cuotaResultante);
  addWrite(writes, "B9", datos.vendedor);
  addWrite(writes, "B10", datos.convenio);
  addWrite(writes, "B11", datos.fechaSolicitud);
  addWrite(writes, "B12", datos.fechaPrimerVencimiento);
  addWrite(writes, "B14", datos.dniTitular);
  addWrite(writes, "B15", datos.cuitTitular);
  addWrite(writes, "B16", datos.nombreCompletoTitular);
  addWrite(writes, "B26", datos.ingresos);
  addWrite(writes, "B27", datos.antiguedadLaboral);

  addWrite(writes, "D13", datos.titularNuevo);
  addWrite(writes, "D18", datos.cupoDisponibleVendedor);
  addWrite(writes, "D19", datos.saldoPrestamosVigentes);
  addWrite(writes, "D20", datos.compromisoMensualVigente);
  addWrite(writes, "D22", datos.situacionSocio);
  addWrite(writes, "D23", datos.rechazosDelMes);

  return writes;
}

function addWrite(
  writes: CalculadoraCellWrite[],
  cell: string,
  value: string | number | boolean | null,
) {
  if (value === null) {
    return;
  }

  writes.push({ cell, value });
}

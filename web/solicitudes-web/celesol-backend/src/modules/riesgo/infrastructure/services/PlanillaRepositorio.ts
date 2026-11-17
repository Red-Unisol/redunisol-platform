import { readFile } from "node:fs/promises";
import path from "node:path";

import { CalculadoraFileNotFoundError } from "../../domain/riesgo-errors";

// La calculadora que viene con el codigo. Se usa mientras no haya versiones
// traidas de Vimarx en la base.
const CALCULADORA_FILE_PATH = path.join(
  process.cwd(),
  "docs",
  "calculadora-riesgo",
  "CALCULADORA MUTUAL.xlsx",
);

export async function leerPlanillaRepositorio(): Promise<Buffer> {
  try {
    return await readFile(CALCULADORA_FILE_PATH);
  } catch {
    throw new CalculadoraFileNotFoundError();
  }
}

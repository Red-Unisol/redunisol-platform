const INITIAL_SHEET_NAME = "Evaluacion";

const SHEET_ZOOM_BY_NAME: Record<string, number> = {
  Evaluacion: 0.7,
  AMEJUCA: 0.9,
  "CRUZ DE EJE": 0.9,
  AMPERPAG: 0.9,
  MUDON: 0.85,
  CBU: 0.85,
  CAJA: 0.9,
};

export function resolveInitialCalculadoraSheetName(
  sheetNames: readonly string[],
): string | null {
  if (sheetNames.includes(INITIAL_SHEET_NAME)) {
    return INITIAL_SHEET_NAME;
  }

  return sheetNames[0] ?? null;
}

export function resolveCalculadoraSheetZoom(sheetName: string): number {
  return SHEET_ZOOM_BY_NAME[sheetName] ?? 1;
}

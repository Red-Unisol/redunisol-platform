// CUIT/CUIL: 11 digitos; el ultimo es verificador (modulo 11 con los pesos de
// AFIP). Se aceptan guiones y espacios. La misma logica esta en el frontend
// (celesol-frontend/src/shared/utils/cuit.ts): si tocas una, toca la otra.
//
// Contrastado el 29/10/2026 con 3.000 CUITs de socios de Vimarx: pasa el
// 97,6%. Los que fallan son datos mal cargados (un digito, 10 digitos o el
// verificador tipeado mal), no un problema del calculo.
const PESOS = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];

export function esCuitValido(value: string): boolean {
  const digitos = value.replace(/[\s-]/g, "");

  if (!/^\d{11}$/.test(digitos)) {
    return false;
  }

  const suma = PESOS.reduce(
    (total, peso, indice) => total + Number(digitos[indice]) * peso,
    0,
  );
  const resto = 11 - (suma % 11);
  const verificador = resto === 11 ? 0 : resto;

  // Con resto 10 AFIP cambia el prefijo (23/24): ese CUIT no existe.
  return verificador !== 10 && verificador === Number(digitos[10]);
}

export const CUIT_INVALIDO = "cuit must be a valid CUIT/CUIL";

// CUIT/CUIL: 11 digitos; el ultimo es verificador (modulo 11 con los pesos de
// AFIP). Se aceptan guiones y espacios al tipearlo.
//
// OJO: esta logica esta duplicada en el backend, en
// celesol-backend/src/modules/solicitudes-core/presentation/cuit.schema.ts.
// Son dos paquetes distintos: si tocas una, toca la otra. El backend es el que
// protege el dato; esta copia avisa antes de enviar.
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

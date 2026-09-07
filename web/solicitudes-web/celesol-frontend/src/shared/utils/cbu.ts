// Un CBU/CVU son 22 digitos en dos bloques con digito verificador propio: el
// primero de 8 (banco + sucursal) y el segundo de 14 (la cuenta). El CVU usa
// el mismo formato y el mismo calculo, asi que esto sirve para los dos.
//
// OJO: esta logica esta duplicada en el backend, en
// celesol-backend/src/modules/solicitudes-core/presentation/cbu.schema.ts.
// Son dos paquetes distintos y no hay codigo compartido entre ellos. Si tocas
// una, tocá la otra: el backend es el que realmente protege el dato y esta
// copia solo existe para avisarle al vendedor antes de enviar.
function tieneDigitoVerificadorValido(
  bloque: string,
  pesos: readonly number[],
): boolean {
  const digitos = bloque.split("").map(Number);
  const verificador = digitos[digitos.length - 1];
  const suma = pesos.reduce(
    (total, peso, indice) => total + digitos[indice] * peso,
    0,
  );

  return (10 - (suma % 10)) % 10 === verificador;
}

export function esCbuValido(value: string): boolean {
  const normalizado = value.trim();

  if (!/^\d{22}$/.test(normalizado)) {
    return false;
  }

  return (
    tieneDigitoVerificadorValido(normalizado.slice(0, 8), [7, 1, 3, 9, 7, 1, 3]) &&
    tieneDigitoVerificadorValido(
      normalizado.slice(8),
      [3, 9, 7, 1, 3, 9, 7, 1, 3, 9, 7, 1, 3],
    )
  );
}

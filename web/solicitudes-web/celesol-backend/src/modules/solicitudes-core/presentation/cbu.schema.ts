import { z } from "zod";

// Un CBU/CVU son 22 digitos en dos bloques con digito verificador propio: el
// primero de 8 (banco + sucursal) y el segundo de 14 (la cuenta). El CVU usa
// el mismo formato y el mismo calculo, asi que esto sirve para los dos.
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
  return (
    tieneDigitoVerificadorValido(value.slice(0, 8), [7, 1, 3, 9, 7, 1, 3]) &&
    tieneDigitoVerificadorValido(
      value.slice(8),
      [3, 9, 7, 1, 3, 9, 7, 1, 3, 9, 7, 1, 3],
    )
  );
}

// El regex va antes del refine: asi esCbuValido recibe siempre 22 digitos y no
// tiene que defenderse de entradas con letras o de largo distinto.
export const cbuSchema = z
  .string()
  .trim()
  .regex(/^\d{22}$/)
  .refine(esCbuValido, { message: "cbu must be a valid CBU/CVU" });

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { cbuSchema, esCbuValido } from "./cbu.schema";

describe("esCbuValido", () => {
  it("accepts valid CBUs", () => {
    // El algoritmo se contrasto contra los CBUs reales de los socios en el
    // legado: sobre 4.990 con formato de 22 digitos, paso el 99,36%. Los 32
    // que no son datos mal cargados en Vimarx, no un problema del calculo
    // (pertenecen al mismo banco que otros 3.031 que si pasan, y fallan
    // repartidos entre los dos bloques).
    //
    // Aca van sinteticos a proposito: un CBU real es dato bancario de una
    // persona y no corresponde dejarlo en el repositorio.
    for (const cbu of [
      "2850590940090418135201", // el que ya usan otros tests del proyecto
      "1234567412345678901233", // sinteticos, armados con el algoritmo
      "9999999199999999999993",
      "0000000000000000000000",
    ]) {
      assert.equal(esCbuValido(cbu), true, cbu);
    }
  });

  it("rejects a CBU with a wrong check digit", () => {
    // Mismo CBU valido de arriba con el ultimo digito cambiado.
    assert.equal(esCbuValido("2850590940090418135200"), false);
  });

  it("validates each block separately", () => {
    // Primer bloque roto (banco + sucursal), segundo intacto.
    assert.equal(esCbuValido("2850590840090418135201"), false);
  });

  describe("cbuSchema", () => {
    it("accepts a valid CBU", () => {
      assert.equal(
        cbuSchema.parse("2850590940090418135201"),
        "2850590940090418135201",
      );
    });

    it("rejects anything that is not 22 digits", () => {
      for (const value of [
        "285059094009041813520", // 21 digitos
        "28505909400904181352011", // 23
        "2850-5909-4009-0418-1352-01", // con guiones
        "prueba de cbu comun",
        "",
      ]) {
        assert.equal(cbuSchema.safeParse(value).success, false, value);
      }
    });

    it("rejects 22 digits with an invalid check digit", () => {
      assert.equal(cbuSchema.safeParse("1234567890123456789012").success, false);
    });
  });
});

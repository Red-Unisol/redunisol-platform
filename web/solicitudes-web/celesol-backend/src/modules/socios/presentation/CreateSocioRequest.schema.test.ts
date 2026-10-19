import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createSocioBodySchema } from "./CreateSocioRequest.schema";

describe("createSocioBodySchema", () => {
  it("accepts and trims a valid persona fisica payload", () => {
    const parsed = createSocioBodySchema.parse({
      apellido: " Perez ",
      celular: " 11 4444 5555 ",
      cuit: " 20-12345678-3 ",
      domicilioCalle: " San Martin ",
      domicilioCodigoPostal: " 2300 ",
      domicilioLocalidad: " 12 ",
      domicilioNroPuerta: " 742 ",
      email: " USER@EXAMPLE.COM ",
      fechaDeNacimiento: "1990-02-28",
      nombre: " Juan ",
      nroDocumento: " 12.345.678 ",
      sexo: " M ",
      tipoDocumento: " dni ",
      tipoPersona: "FISICA",
    });

    assert.deepEqual(parsed, {
      apellido: "Perez",
      celular: "11 4444 5555",
      cuit: "20-12345678-3",
      domicilioCalle: "San Martin",
      domicilioCodigoPostal: "2300",
      domicilioLocalidad: "12",
      domicilioNroPuerta: "742",
      email: "user@example.com",
      fechaDeNacimiento: "1990-02-28",
      nombre: "Juan",
      nroDocumento: "12.345.678",
      sexo: "M",
      tipoDocumento: "dni",
      tipoPersona: "FISICA",
    });
  });

  it("rejects persona fisica without domicilioCalle", () => {
    assert.equal(
      createSocioBodySchema.safeParse({
        apellido: "Perez",
        cuit: "20123456783",
        domicilioCodigoPostal: "2300",
        domicilioLocalidad: "12",
        domicilioNroPuerta: "742",
        fechaDeNacimiento: "1990-02-28",
        nombre: "Juan",
        nroDocumento: "12345678",
        sexo: "M",
        tipoDocumento: "DNI",
        tipoPersona: "FISICA",
      }).success,
      false,
    );
  });

  it("rejects persona fisica with empty domicilioCalle", () => {
    assert.equal(
      createSocioBodySchema.safeParse({
        apellido: "Perez",
        cuit: "20123456783",
        domicilioCalle: "",
        domicilioCodigoPostal: "2300",
        domicilioLocalidad: "12",
        domicilioNroPuerta: "742",
        fechaDeNacimiento: "1990-02-28",
        nombre: "Juan",
        nroDocumento: "12345678",
        sexo: "M",
        tipoDocumento: "DNI",
        tipoPersona: "FISICA",
      }).success,
      false,
    );
  });

  it("accepts persona fisica with only calle and localidad as domicilio", () => {
    const parsed = createSocioBodySchema.parse({
      apellido: "Perez",
      cuit: "20123456783",
      domicilioCalle: "Artigas 143 Alberdi",
      domicilioCodigoPostal: "  ",
      domicilioLocalidad: "2715",
      fechaDeNacimiento: "1990-02-28",
      nombre: "Juan",
      nroDocumento: "12345678",
      sexo: "M",
      tipoDocumento: "DNI",
      tipoPersona: "FISICA",
    });

    assert.equal(parsed.domicilioCalle, "Artigas 143 Alberdi");
    assert.equal(parsed.domicilioLocalidad, "2715");
    assert.equal(parsed.domicilioNroPuerta, undefined);
    assert.equal(parsed.domicilioCodigoPostal, undefined);
  });

  it("rejects persona fisica without domicilioLocalidad", () => {
    assert.equal(
      createSocioBodySchema.safeParse({
        apellido: "Perez",
        cuit: "20123456783",
        domicilioCalle: "San Martin",
        domicilioCodigoPostal: "2300",
        domicilioNroPuerta: "742",
        fechaDeNacimiento: "1990-02-28",
        nombre: "Juan",
        nroDocumento: "12345678",
        sexo: "M",
        tipoDocumento: "DNI",
        tipoPersona: "FISICA",
      }).success,
      false,
    );
  });

  it("rejects persona fisica with a localidad that is not a Vimarx ID", () => {
    assert.equal(
      createSocioBodySchema.safeParse({
        apellido: "Perez",
        cuit: "20123456783",
        domicilioCalle: "San Martin",
        domicilioLocalidad: "Cordoba",
        fechaDeNacimiento: "1990-02-28",
        nombre: "Juan",
        nroDocumento: "12345678",
        sexo: "M",
        tipoDocumento: "DNI",
        tipoPersona: "FISICA",
      }).success,
      false,
    );
  });

  it("accepts a valid persona juridica payload", () => {
    const parsed = createSocioBodySchema.parse({
      celular: "11 4444 5555",
      cuit: "30-12345678-9",
      domicilioCalle: "Belgrano",
      domicilioCodigoPostal: "2300",
      domicilioLocalidad: "12",
      domicilioNroPuerta: "1500",
      email: "empresa@example.com",
      razonSocial: " ACME SA ",
      tipoPersona: "JURIDICA",
    });

    assert.deepEqual(parsed, {
      celular: "11 4444 5555",
      cuit: "30-12345678-9",
      domicilioCalle: "Belgrano",
      domicilioCodigoPostal: "2300",
      domicilioLocalidad: "12",
      domicilioNroPuerta: "1500",
      email: "empresa@example.com",
      razonSocial: "ACME SA",
      tipoPersona: "JURIDICA",
    });
  });

  it("rejects persona juridica without domicilioCalle", () => {
    assert.equal(
      createSocioBodySchema.safeParse({
        cuit: "30123456789",
        domicilioCodigoPostal: "2300",
        domicilioLocalidad: "12",
        domicilioNroPuerta: "1500",
        razonSocial: "ACME SA",
        tipoPersona: "JURIDICA",
      }).success,
      false,
    );
  });

  it("rejects persona fisica without apellido", () => {
    assert.equal(
      createSocioBodySchema.safeParse({
        cuit: "20123456783",
        fechaDeNacimiento: "1990-02-28",
        nombre: "Juan",
        nroDocumento: "12345678",
        sexo: "M",
        tipoDocumento: "DNI",
        tipoPersona: "FISICA",
      }).success,
      false,
    );
  });

  it("rejects persona fisica without nombre", () => {
    assert.equal(
      createSocioBodySchema.safeParse({
        apellido: "Perez",
        cuit: "20123456783",
        fechaDeNacimiento: "1990-02-28",
        nroDocumento: "12345678",
        sexo: "M",
        tipoDocumento: "DNI",
        tipoPersona: "FISICA",
      }).success,
      false,
    );
  });

  it("rejects persona fisica without nroDocumento", () => {
    assert.equal(
      createSocioBodySchema.safeParse({
        apellido: "Perez",
        cuit: "20123456783",
        fechaDeNacimiento: "1990-02-28",
        nombre: "Juan",
        sexo: "M",
        tipoDocumento: "DNI",
        tipoPersona: "FISICA",
      }).success,
      false,
    );
  });

  it("rejects persona fisica without tipoDocumento", () => {
    assert.equal(
      createSocioBodySchema.safeParse({
        apellido: "Perez",
        cuit: "20123456783",
        fechaDeNacimiento: "1990-02-28",
        nombre: "Juan",
        nroDocumento: "12345678",
        sexo: "M",
        tipoPersona: "FISICA",
      }).success,
      false,
    );
  });

  it("rejects persona fisica without sexo", () => {
    assert.equal(
      createSocioBodySchema.safeParse({
        apellido: "Perez",
        cuit: "20123456783",
        fechaDeNacimiento: "1990-02-28",
        nombre: "Juan",
        nroDocumento: "12345678",
        tipoDocumento: "DNI",
        tipoPersona: "FISICA",
      }).success,
      false,
    );
  });

  it("rejects persona fisica without fechaDeNacimiento", () => {
    assert.equal(
      createSocioBodySchema.safeParse({
        apellido: "Perez",
        cuit: "20123456783",
        nombre: "Juan",
        nroDocumento: "12345678",
        sexo: "M",
        tipoDocumento: "DNI",
        tipoPersona: "FISICA",
      }).success,
      false,
    );
  });

  it("rejects persona fisica without cuit", () => {
    assert.equal(
      createSocioBodySchema.safeParse({
        apellido: "Perez",
        fechaDeNacimiento: "1990-02-28",
        nombre: "Juan",
        nroDocumento: "12345678",
        sexo: "M",
        tipoDocumento: "DNI",
        tipoPersona: "FISICA",
      }).success,
      false,
    );
  });

  it("rejects persona fisica with razonSocial", () => {
    assert.equal(
      createSocioBodySchema.safeParse({
        apellido: "Perez",
        cuit: "20123456783",
        fechaDeNacimiento: "1990-02-28",
        nombre: "Juan",
        nroDocumento: "12345678",
        razonSocial: "No corresponde",
        sexo: "M",
        tipoDocumento: "DNI",
        tipoPersona: "FISICA",
      }).success,
      false,
    );
  });

  it("rejects persona juridica without razonSocial", () => {
    assert.equal(
      createSocioBodySchema.safeParse({
        cuit: "30123456789",
        tipoPersona: "JURIDICA",
      }).success,
      false,
    );
  });

  it("rejects persona juridica without cuit", () => {
    assert.equal(
      createSocioBodySchema.safeParse({
        razonSocial: "ACME SA",
        tipoPersona: "JURIDICA",
      }).success,
      false,
    );
  });

  it("rejects persona juridica with nroDocumento", () => {
    assert.equal(
      createSocioBodySchema.safeParse({
        cuit: "30123456789",
        nroDocumento: "12345678",
        razonSocial: "ACME SA",
        tipoPersona: "JURIDICA",
      }).success,
      false,
    );
  });

  it("rejects persona juridica with tipoDocumento", () => {
    assert.equal(
      createSocioBodySchema.safeParse({
        cuit: "30123456789",
        razonSocial: "ACME SA",
        tipoDocumento: "DNI",
        tipoPersona: "JURIDICA",
      }).success,
      false,
    );
  });

  it("rejects persona juridica with sexo", () => {
    assert.equal(
      createSocioBodySchema.safeParse({
        cuit: "30123456789",
        razonSocial: "ACME SA",
        sexo: "M",
        tipoPersona: "JURIDICA",
      }).success,
      false,
    );
  });

  it("rejects persona juridica with fechaDeNacimiento", () => {
    assert.equal(
      createSocioBodySchema.safeParse({
        cuit: "30123456789",
        fechaDeNacimiento: "1990-02-28",
        razonSocial: "ACME SA",
        tipoPersona: "JURIDICA",
      }).success,
      false,
    );
  });

  it("rejects nroSocioLegacy in create", () => {
    assert.equal(
      createSocioBodySchema.safeParse({
        apellido: "Perez",
        cuit: "20123456783",
        fechaDeNacimiento: "1990-02-28",
        nombre: "Juan",
        nroDocumento: "12345678",
        nroSocioLegacy: "LEG-1",
        sexo: "M",
        tipoDocumento: "DNI",
        tipoPersona: "FISICA",
      }).success,
      false,
    );
  });

  it("accepts socAux with numeric strings and drops empty fields", () => {
    const parsed = createSocioBodySchema.parse({
      cuit: "30123456789",
      domicilioCalle: "Belgrano",
      domicilioLocalidad: "12",
      razonSocial: "ACME SA",
      socAux: { beneficio: " 733767/0 ", caja40: " 50 ", convAux: "" },
      tipoPersona: "JURIDICA",
    });

    assert.deepEqual(parsed.socAux, {
      beneficio: "733767/0",
      caja40: 50,
      convAux: undefined,
    });
  });

  it("rejects socAux with a non integer caja40 or convAux", () => {
    for (const socAux of [
      { caja40: "50,5" },
      { caja40: "abc" },
      { convAux: -1 },
      { convAux: "2147483648" },
    ]) {
      assert.equal(
        createSocioBodySchema.safeParse({
          cuit: "30123456789",
          domicilioCalle: "Belgrano",
          domicilioLocalidad: "12",
          razonSocial: "ACME SA",
          socAux,
          tipoPersona: "JURIDICA",
        }).success,
        false,
        JSON.stringify(socAux),
      );
    }
  });

  it("trims observaciones and drops it when empty", () => {
    const base = {
      cuit: "30123456789",
      domicilioCalle: "Belgrano",
      domicilioLocalidad: "12",
      razonSocial: "ACME SA",
      tipoPersona: "JURIDICA",
    };

    assert.equal(
      createSocioBodySchema.parse({ ...base, observaciones: " DEPOSITO MP " })
        .observaciones,
      "DEPOSITO MP",
    );
    assert.equal(
      createSocioBodySchema.parse({ ...base, observaciones: "  " })
        .observaciones,
      undefined,
    );
    assert.equal(
      createSocioBodySchema.safeParse({
        ...base,
        observaciones: "x".repeat(501),
      }).success,
      false,
    );
  });

  it("rejects unknown socAux fields", () => {
    assert.equal(
      createSocioBodySchema.safeParse({
        cuit: "30123456789",
        domicilioCalle: "Belgrano",
        domicilioLocalidad: "12",
        razonSocial: "ACME SA",
        socAux: { Sicon: 1 },
        tipoPersona: "JURIDICA",
      }).success,
      false,
    );
  });
});

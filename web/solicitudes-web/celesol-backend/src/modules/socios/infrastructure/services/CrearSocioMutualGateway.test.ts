import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  SocioMutualLegacyRechazadoError,
  SocioMutualLegacyUnavailableError,
} from "../../domain/socios-errors";
import { CrearSocioMutualGateway } from "./CrearSocioMutualGateway";

describe("CrearSocioMutualGateway", () => {
  it("sends the expected body for persona fisica and returns the id on success", async () => {
    let capturedUrl: string | undefined;
    let capturedBody: unknown;
    const gateway = new CrearSocioMutualGateway(
      { baseUrl: "https://legacy.example.com", timeoutMs: 5000 },
      async (input, init) => {
        capturedUrl = String(input);
        capturedBody = JSON.parse(String(init?.body));

        return {
          json: async () => ({ Error: null, ID: 42, Ok: true }),
          ok: true,
        };
      },
    );

    const result = await gateway.crear({
      tipoPersona: "FISICA",
      apellido: "Fernandez",
      celular: "3492654322",
      cuit: "27398765430",
      domicilio: {
        calle: "San Martin",
        codigoPostal: "2300",
        localidad: "12",
        nroPuerta: "742",
      },
      email: "marina@email.com",
      fechaDeNacimiento: "1996-05-14",
      nombre: "Marina",
      nroDocumento: "39876543",
      observaciones: "DEPOSITO MP",
      sexo: "Femenino",
    });

    assert.equal(result.id, "42");
    assert.equal(
      capturedUrl,
      "https://legacy.example.com/api/Simulador/CrearSocioMutual",
    );
    assert.deepEqual(capturedBody, {
      campos: {
        Apellido: "Fernandez",
        Celular: "3492654322",
        CUIT: "27398765430",
        Domicilio: {
          Calle: "San Martin",
          CodigoPostal: "2300",
          Localidad: 12,
          NroPuerta: "742",
        },
        Email: "marina@email.com",
        FechaDeNacimiento: "1996-05-14",
        HistoriaCategorias: [{ Categoria: 2, Fecha: "2020-01-01" }],
        Nombre: "Marina",
        NroDoc: "39876543",
        Observaciones: "DEPOSITO MP",
        Sexo: "Femenino",
        TipoDoc: "96",
      },
      validar: false,
    });
  });

  it("sends the sexo name when Sol Web kept the Vimarx code", async () => {
    const sexos: unknown[] = [];
    const gateway = new CrearSocioMutualGateway(
      { baseUrl: "https://legacy.example.com", timeoutMs: 5000 },
      async (_input, init) => {
        sexos.push(JSON.parse(String(init?.body)).campos.Sexo);
        return {
          json: async () => ({ Error: null, ID: 42, Ok: true }),
          ok: true,
        };
      },
    );

    for (const sexo of ["0", "1", "3", "Masculino"]) {
      await gateway.crear({
        tipoPersona: "FISICA",
        apellido: "Fernandez",
        cuit: "27398765430",
        domicilio: { calle: "San Martin", codigoPostal: "", localidad: "12", nroPuerta: "" },
        fechaDeNacimiento: "1996-05-14",
        nombre: "Marina",
        nroDocumento: "39876543",
        sexo,
      });
    }

    assert.deepEqual(sexos, ["Masculino", "Femenino", "Otro", "Masculino"]);
  });

  it("sends the expected body for persona juridica and returns the id on success", async () => {
    let capturedBody: unknown;
    const gateway = new CrearSocioMutualGateway(
      { baseUrl: "https://legacy.example.com", timeoutMs: 5000 },
      async (_input, init) => {
        capturedBody = JSON.parse(String(init?.body));

        return {
          json: async () => ({ Error: null, ID: 152199, Ok: true }),
          ok: true,
        };
      },
    );

    const result = await gateway.crear({
      tipoPersona: "JURIDICA",
      celular: "3492987654",
      cuit: "30712345671",
      domicilio: {
        calle: "Belgrano",
        codigoPostal: "2300",
        localidad: "12",
        nroPuerta: "1500",
      },
      email: "contacto@elalba.com.ar",
      razonSocial: "Constructora El Alba S.A.",
    });

    assert.equal(result.id, "152199");
    assert.deepEqual(capturedBody, {
      campos: {
        Apellido: "Constructora El Alba S.A.",
        Celular: "3492987654",
        CUIT: "30712345671",
        Domicilio: {
          Calle: "Belgrano",
          CodigoPostal: "2300",
          Localidad: 12,
          NroPuerta: "1500",
        },
        Email: "contacto@elalba.com.ar",
        HistoriaCategorias: [{ Categoria: 2, Fecha: "2020-01-01" }],
        Nombre: "",
        Sexo: "PersonaJuridica",
      },
      validar: false,
    });
  });

  it("omits NroPuerta and CodigoPostal when they were not loaded", async () => {
    let capturedBody: { campos: { Domicilio: unknown } } | undefined;
    const gateway = new CrearSocioMutualGateway(
      { baseUrl: "https://legacy.example.com", timeoutMs: 5000 },
      async (_input, init) => {
        capturedBody = JSON.parse(String(init?.body));

        return {
          json: async () => ({ Error: null, ID: 43, Ok: true }),
          ok: true,
        };
      },
    );

    await gateway.crear({
      tipoPersona: "JURIDICA",
      cuit: "30712345671",
      domicilio: {
        calle: "Artigas 143 Alberdi",
        codigoPostal: null,
        localidad: "2715",
        nroPuerta: null,
      },
      razonSocial: "ACME SA",
    });

    assert.deepEqual(capturedBody?.campos.Domicilio, {
      Calle: "Artigas 143 Alberdi",
      Localidad: 2715,
    });
  });

  it("sends SocAux with only the loaded fields", async () => {
    const capturedBodies: { campos: Record<string, unknown> }[] = [];
    const gateway = new CrearSocioMutualGateway(
      { baseUrl: "https://legacy.example.com", timeoutMs: 5000 },
      async (_input, init) => {
        capturedBodies.push(JSON.parse(String(init?.body)));

        return {
          json: async () => ({ Error: null, ID: 44, Ok: true }),
          ok: true,
        };
      },
    );
    const base = {
      tipoPersona: "JURIDICA" as const,
      cuit: "30712345671",
      domicilio: {
        calle: "Belgrano",
        codigoPostal: null,
        localidad: "12",
        nroPuerta: null,
      },
      razonSocial: "ACME SA",
    };

    await gateway.crear({
      ...base,
      socAux: { beneficio: "733767/0", caja40: 50, convAux: 80 },
    });
    await gateway.crear({ ...base, socAux: { caja40: 0 } });
    await gateway.crear({ ...base, socAux: {} });
    await gateway.crear({ ...base, socAux: null });

    assert.deepEqual(capturedBodies[0]?.campos.SocAux, {
      Beneficio: "733767/0",
      Caja40: 50,
      ConvAux: 80,
    });
    assert.deepEqual(capturedBodies[1]?.campos.SocAux, { Caja40: 0 });
    assert.equal("SocAux" in (capturedBodies[2]?.campos ?? {}), false);
    assert.equal("SocAux" in (capturedBodies[3]?.campos ?? {}), false);
  });

  it("throws SocioMutualLegacyRechazadoError with the legacy message when Ok is false", async () => {
    const gateway = new CrearSocioMutualGateway(
      { baseUrl: "https://legacy.example.com", timeoutMs: 5000 },
      async () => ({
        json: async () => ({
          Error: "Errores de validacion: Se requiere Domicilio para un socio",
          ID: null,
          Ok: false,
        }),
        ok: true,
      }),
    );

    await assert.rejects(
      () =>
        gateway.crear({
          tipoPersona: "FISICA",
          apellido: "Fernandez",
          cuit: "27398765430",
          domicilio: {
            calle: "San Martin",
            codigoPostal: "2300",
            localidad: "12",
            nroPuerta: "742",
          },
          fechaDeNacimiento: "1996-05-14",
          nombre: "Marina",
          nroDocumento: "39876543",
          sexo: "Femenino",
        }),
      (error) => {
        assert.ok(error instanceof SocioMutualLegacyRechazadoError);
        assert.equal(
          error.message,
          "Errores de validacion: Se requiere Domicilio para un socio",
        );
        return true;
      },
    );
  });

  it("throws SocioMutualLegacyUnavailableError when the request fails", async () => {
    const gateway = new CrearSocioMutualGateway(
      { baseUrl: "https://legacy.example.com", timeoutMs: 5000 },
      async () => {
        throw new Error("network down");
      },
    );

    await assert.rejects(
      () =>
        gateway.crear({
          tipoPersona: "FISICA",
          apellido: "Fernandez",
          cuit: "27398765430",
          domicilio: {
            calle: "San Martin",
            codigoPostal: "2300",
            localidad: "12",
            nroPuerta: "742",
          },
          fechaDeNacimiento: "1996-05-14",
          nombre: "Marina",
          nroDocumento: "39876543",
          sexo: "Femenino",
        }),
      SocioMutualLegacyUnavailableError,
    );
  });
});

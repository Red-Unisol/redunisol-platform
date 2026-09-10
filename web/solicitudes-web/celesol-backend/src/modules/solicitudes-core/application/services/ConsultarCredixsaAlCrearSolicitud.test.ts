import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ConsultarCredixsaAlCrearSolicitud } from "./ConsultarCredixsaAlCrearSolicitud";

describe("ConsultarCredixsaAlCrearSolicitud", () => {
  it("prefiere el CUIL cuando el titular lo tiene", async () => {
    // La cache de CredixSA se indexa por CUIL de 11 digitos: consultar con el
    // documento guardaria el informe solo bajo la clave por nombre.
    const { enviado, servicio } = build();

    await servicio.execute("sol-1", {
      apellidoDenominacion: "SALLITTO",
      cuit: "20-35966130-5",
      nombre: "NICOLAS",
      nroDocumento: "35966130",
    });

    assert.equal(enviado()?.cuit, "20359661305");
    assert.equal(enviado()?.nombre, "SALLITTO NICOLAS");
    assert.equal(enviado()?.solicitudId, "sol-1");
  });

  it("usa el documento cuando no hay CUIL", async () => {
    const { enviado, servicio } = build();

    await servicio.execute("sol-1", {
      apellidoDenominacion: "SALLITTO",
      cuit: null,
      nombre: "NICOLAS",
      nroDocumento: "35.966.130",
    });

    assert.equal(enviado()?.cuit, "35966130");
  });

  it("manda solo el nombre cuando no hay ningun numero", async () => {
    const { enviado, servicio } = build();

    await servicio.execute("sol-1", {
      apellidoDenominacion: "SALLITTO",
      cuit: null,
      nombre: "NICOLAS",
      nroDocumento: null,
    });

    assert.equal(enviado()?.cuit, "");
    assert.equal(enviado()?.nombre, "SALLITTO NICOLAS");
  });

  it("descarta un CUIL que no tiene 11 digitos y cae al documento", async () => {
    const { enviado, servicio } = build();

    await servicio.execute("sol-1", {
      apellidoDenominacion: "SALLITTO",
      cuit: "2035966",
      nombre: "NICOLAS",
      nroDocumento: "35966130",
    });

    assert.equal(enviado()?.cuit, "35966130");
  });

  it("arma el nombre aunque falte el nombre de pila", async () => {
    const { enviado, servicio } = build();

    await servicio.execute("sol-1", {
      apellidoDenominacion: "MUTUAL CELESOL",
      cuit: null,
      nombre: null,
      nroDocumento: null,
    });

    assert.equal(enviado()?.nombre, "MUTUAL CELESOL");
  });
});

function build() {
  let recibido: { cuit: string; nombre: string; solicitudId: string } | undefined;

  return {
    enviado: () => recibido,
    servicio: new ConsultarCredixsaAlCrearSolicitud({
      gateway: {
        consultar: async (input) => {
          recibido = input;
        },
      },
    }),
  };
}

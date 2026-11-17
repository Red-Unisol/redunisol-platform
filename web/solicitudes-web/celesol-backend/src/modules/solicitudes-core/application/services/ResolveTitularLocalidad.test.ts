import assert from "node:assert/strict";
import { it } from "node:test";
import { resolveTitularLocalidad } from "./ResolveTitularLocalidad";
import { InvalidSolicitudesCoreRequestError } from "../../domain/solicitudes-core-errors";
import { extractSolicitudPatchAccessTargets } from "./SolicitudFieldAccess";
import type { UpdateSolicitudInput } from "../dtos/UpdateSolicitud.dto";

const catalog = {
  findById: async (id: string) =>
    id === "19853" ? { id: "19853", nombre: "VILLA MARIA" } : null,
};

it("toma el nombre de Vimarx para el ID elegido", async () => {
  assert.deepEqual(await resolveTitularLocalidad(catalog, "19853"), {
    localidad: "VILLA MARIA",
    localidadId: "19853",
  });
});

it("no toca la localidad si el pedido no la trae", async () => {
  assert.equal(await resolveTitularLocalidad(catalog, undefined), undefined);
});

it("null quita el ID y el nombre", async () => {
  assert.deepEqual(await resolveTitularLocalidad(catalog, null), {
    localidad: null,
    localidadId: null,
  });
});

it("rechaza un ID que no existe en Vimarx", async () => {
  await assert.rejects(
    resolveTitularLocalidad(catalog, "999999"),
    InvalidSolicitudesCoreRequestError,
  );
});

it("sin catalogo configurado falla en vez de guardar sin nombre", async () => {
  await assert.rejects(resolveTitularLocalidad(undefined, "19853"));
});

it("editar localidadId pide el permiso del campo Localidad", () => {
  const targets = extractSolicitudPatchAccessTargets({
    titular: { localidadId: "19853" },
  } as unknown as UpdateSolicitudInput);

  assert.deepEqual(targets.fields, ["titular.localidad"]);
});

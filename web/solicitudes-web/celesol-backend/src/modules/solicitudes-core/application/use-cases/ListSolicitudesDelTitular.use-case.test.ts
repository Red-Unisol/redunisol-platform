import assert from "node:assert/strict";
import { it } from "node:test";
import type { AuthUser } from "../../../auth/domain/entities/User.entity";
import type { SolicitudCore } from "../../domain/entities/SolicitudCore.entity";
import { ListSolicitudesDelTitularUseCase } from "./ListSolicitudesDelTitular.use-case";
import {
  ForbiddenSolicitudAccessError,
  SolicitudCoreNotFoundError,
} from "../../domain/solicitudes-core-errors";
const user = {
  id: "riesgo",
  workflowOwnerId: "risk",
  workflowOwner: { code: "RIESGO" },
  isSystemAdmin: false,
} as AuthUser;
it("usa el documento persistido y separa historiales al cambiar la solicitud", async () => {
  const docs: string[] = [];
  const uc = new ListSolicitudesDelTitularUseCase({
    repository: {
      findById: async (id) =>
        ({
          titular: { nroDocumento: id === "a" ? "12345678" : "87654321" },
        }) as SolicitudCore,
    },
    legacyGateway: {
      listSolicitudesDelTitular: async (doc) => {
        docs.push(doc);
        return [];
      },
    },
  });
  assert.equal(
    (await uc.execute({ solicitudId: "a", currentUser: user })).status,
    "ok",
  );
  await uc.execute({ solicitudId: "b", currentUser: user });
  assert.deepEqual(docs, ["12345678", "87654321"]);
});
it("no consulta por documento inválido ni por solicitudes inexistentes", async () => {
  let calls = 0;
  for (const doc of [null, "", " ", "ABC", "0", "123 OR 1=1"]) {
    const uc = new ListSolicitudesDelTitularUseCase({
      repository: {
        findById: async () =>
          ({ titular: { nroDocumento: doc } }) as SolicitudCore,
      },
      legacyGateway: {
        listSolicitudesDelTitular: async () => {
          calls++;
          return [];
        },
      },
    });
    assert.equal(
      (await uc.execute({ solicitudId: "a", currentUser: user })).status,
      "documento_invalido",
    );
  }
  const uc = new ListSolicitudesDelTitularUseCase({
    repository: { findById: async () => null },
    legacyGateway: {
      listSolicitudesDelTitular: async () => {
        calls++;
        return [];
      },
    },
  });
  await assert.rejects(
    () => uc.execute({ solicitudId: "missing", currentUser: user }),
    SolicitudCoreNotFoundError,
  );
  assert.equal(calls, 0);
});
it("rechaza vendedores y conserva la excepción de administradores", async () => {
  let calls = 0;
  const uc = new ListSolicitudesDelTitularUseCase({
    repository: {
      findById: async () =>
        ({ titular: { nroDocumento: "12345678" } }) as SolicitudCore,
    },
    legacyGateway: {
      listSolicitudesDelTitular: async () => {
        calls++;
        return [];
      },
    },
  });
  const seller = {
    ...user,
    workflowOwner: { ...user.workflowOwner!, code: "VENDEDORES" },
  };
  await assert.rejects(
    () => uc.execute({ solicitudId: "a", currentUser: seller }),
    ForbiddenSolicitudAccessError,
  );
  assert.equal(calls, 0);
  await uc.execute({
    solicitudId: "a",
    currentUser: { ...seller, isSystemAdmin: true },
  });
  assert.equal(calls, 1);
});

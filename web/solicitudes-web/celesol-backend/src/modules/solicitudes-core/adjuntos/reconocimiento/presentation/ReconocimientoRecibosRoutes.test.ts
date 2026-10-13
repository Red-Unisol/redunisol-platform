import assert from "node:assert/strict";
import { it } from "node:test";
import express from "express";
import { createServer } from "node:http";
import { createReconocimientoRecibosRoutes } from "./ReconocimientoRecibosRoutes";
import { AnalizarReciboUseCase } from "../application/AnalizarRecibo.use-case";
import { crearVisibilidadVendedorGuard } from "../../../presentation/VisibilidadVendedorGuard";
const id = "56468097-e11d-4b6f-a16d-65be8b2f7e8c";
it("HTTP authentication, admin configuration, draft/existing authorization, size and disabled setting enforced before provider", async () => {
  let user = {
    id: "u",
    firstName: "Test",
    lastName: "User",
    isSystemAdmin: false,
    workflowOwnerId: "risk",
    workflowOwner: { code: "RIESGO" },
    legacyUser: "seller",
  };
  let authenticated = true;
  let config = { habilitado: true, version: 1 };
  let calls = 0;
  const settings = {
    get: async () => config,
    update: async (habilitado: boolean) =>
      (config = { habilitado, version: config.version + 1 }),
  };
  const auth = {
    execute: async () => {
      if (!authenticated)
        throw Object.assign(new Error("Unauthorized"), { statusCode: 401 });
      return user as never;
    },
  };
  const repository = {
    findById: async () => ({ estadoActual: { id: "state", ownerId: "other" } }),
    findWorkflowOwnerCodeById: async (owner: string) =>
      owner === "risk" ? "RIESGO" : "OTHER",
    findCreadorById: async () => "different-seller",
  } as never;
  const app = express();
  app.use(express.json());
  app.use(
    createReconocimientoRecibosRoutes({
      getCurrentUserUseCase: auth,
      solicitudesRepository: repository,
      fieldAccessRulesRepository: {
        findByWorkflowStateId: async () => null,
      } as never,
      configuracion: settings,
      maxFileSizeBytes: 20,
      analizar: new AnalizarReciboUseCase({
        configuracion: settings,
        gateway: {
          reconocer: async () => {
            calls++;
            return { resultado: "recibo" };
          },
        },
        allowedExtensions: [".png"],
        allowedMimeTypes: ["image/png"],
        maxFileSizeBytes: 20,
      }),
      visibilidadGuard: crearVisibilidadVendedorGuard({
        getCurrentUserUseCase: auth,
        repository,
        visibilidadVendedorResolver: {
          creadoresVisibles: async () => ["u"],
        } as never,
      }),
    }),
  );
  app.use(
    (
      error: { statusCode?: number },
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      res.status(error.statusCode ?? 500).json({ error: "sanitized" });
    },
  );
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const file = (size = 8) => {
    const body = new FormData();
    body.append(
      "file",
      new Blob([new Uint8Array(size)], { type: "image/png" }),
      "test.png",
    );
    return body;
  };
  try {
    assert.equal((await fetch(`${base}/configuracion`)).status, 200);
    const patch = () =>
      fetch(`${base}/configuracion`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ habilitado: false }),
      });
    assert.equal((await patch()).status, 403);
    assert.equal(config.habilitado, true);
    assert.equal(
      (await fetch(`${base}/alta`, { method: "POST", body: file() })).status,
      200,
    );
    assert.equal(calls, 1);
    assert.equal(
      (await fetch(`${base}/${id}/analizar`, { method: "POST", body: file() }))
        .status,
      200,
    );
    assert.equal(calls, 2);
    user = {
      ...user,
      workflowOwnerId: "other",
      workflowOwner: { code: "OTHER" },
    };
    assert.equal(
      (await fetch(`${base}/${id}/analizar`, { method: "POST", body: file() }))
        .status,
      403,
    );
    assert.equal(calls, 2);
    user = { ...user, workflowOwner: { code: "VENDEDORES" } };
    assert.equal(
      (await fetch(`${base}/${id}/analizar`, { method: "POST", body: file() }))
        .status,
      404,
    );
    assert.equal(calls, 2);
    user = {
      ...user,
      workflowOwnerId: "",
      legacyUser: "",
      isSystemAdmin: true,
    };
    assert.equal(
      (await fetch(`${base}/alta`, { method: "POST", body: file() })).status,
      403,
    );
    assert.equal(calls, 2);
    assert.equal((await patch()).status, 200);
    assert.equal(config.habilitado, false);
    user = { ...user, workflowOwnerId: "risk", legacyUser: "seller" };
    const disabled = await fetch(`${base}/alta`, {
      method: "POST",
      body: file(),
    });
    assert.equal((await disabled.json()).resultado, "deshabilitado");
    assert.equal(calls, 2);
    assert.equal(
      (await fetch(`${base}/alta`, { method: "POST", body: file(21) })).status,
      400,
    );
    assert.equal(calls, 2);
    authenticated = false;
    assert.equal((await fetch(`${base}/configuracion`)).status, 401);
    assert.equal(
      (await fetch(`${base}/alta`, { method: "POST", body: file() })).status,
      401,
    );
    assert.equal(calls, 2);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

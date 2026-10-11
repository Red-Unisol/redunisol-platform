import assert from "node:assert/strict";
import { once } from "node:events";
import { describe, it } from "node:test";
import express, { Router, type ErrorRequestHandler } from "express";
import { GetDatosRapidosUseCase } from "../application/use-cases/GetDatosRapidos.use-case";
import { addDatosRapidosRoutes } from "./DatosRapidosRoutes";
import { crearVisibilidadVendedorGuard } from "./VisibilidadVendedorGuard";

const id = "b3b3b3b3-1111-4222-8333-444444444444";

async function request(
  parte: string,
  options: {
    role?: string;
    authenticated?: boolean;
    visible?: boolean;
    accessible?: boolean;
  } = {},
) {
  let legacyCalls = 0;
  let solicitudCalls = 0;
  const user = {
    id: "owner",
    isSystemAdmin: options.role === "ADMIN",
    workflowOwnerId: "area",
    workflowOwner: {
      id: "area",
      code: options.role ?? "VENDEDORES",
      name: "Area",
    },
  };
  const getCurrentUserUseCase = {
    execute: async () => {
      if (options.authenticated === false) throw new Error("unauthorized");
      return user as never;
    },
  };
  const router = Router();
  router.use(
    "/:id",
    crearVisibilidadVendedorGuard({
      getCurrentUserUseCase,
      repository: { findCreadorById: async () => "owner" },
      visibilidadVendedorResolver: {
        creadoresVisibles: async () =>
          options.visible === false ? [] : ["owner"],
      },
    }),
  );
  addDatosRapidosRoutes(router, {
    getCurrentUserUseCase: getCurrentUserUseCase as never,
    getSolicitudByIdUseCase: {
      execute: async (input: { id: string; currentUser: unknown }) => {
        solicitudCalls++;
        assert.equal(input.id, id);
        assert.deepEqual(input.currentUser, {
          id: "owner",
          workflowOwnerId: "area",
          isSystemAdmin: user.isSystemAdmin,
        });
        if (options.accessible === false) throw new Error("forbidden");
        return {
          lineaPrestamoLegacyOid: "12",
          titular: { nroDocumento: "12345678", tipoDocumento: "DNI" },
        };
      },
    } as never,
    datosRapidos: new GetDatosRapidosUseCase({
      lookupSocioRapido: async () => {
        legacyCalls++;
        return [{ id: "71" }];
      },
      getMoraRapido: async () => true,
      getCreditosActivosRapido: async () => {
        legacyCalls++;
        return true;
      },
      getConvenioRapido: async () => {
        legacyCalls++;
        return "Superior";
      },
    }),
  });
  const app = express();
  app.use("/solicitudes", router);
  app.use(((error, _req, res, _next) => {
    res
      .status(error.message === "unauthorized" ? 401 : 403)
      .json({ error: "denied" });
  }) as ErrorRequestHandler);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const address = server.address();
    assert(address && typeof address !== "string");
    const response = await fetch(
      `http://127.0.0.1:${address.port}/solicitudes/${id}/datos-rapidos/${parte}`,
    );
    return {
      status: response.status,
      cache: response.headers.get("cache-control"),
      body: await response.json(),
      legacyCalls,
      solicitudCalls,
    };
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

describe("Datos rápidos: autorización HTTP", () => {
  for (const role of ["VENDEDORES", "RIESGO", "ADMIN"]) {
    it(`permite el resumen a ${role} autorizado y no expone detalles`, async () => {
      const result = await request("creditos", { role });
      assert.equal(result.status, 200);
      assert.equal(result.cache, "no-store");
      assert.deepEqual(result.body, { activos: true });
      assert.equal(result.solicitudCalls, 1);
    });
  }
  for (const parte of ["socio", "convenio", "creditos", "mora"]) {
    it(`protege ${parte} antes de consultar legacy`, async () => {
      for (const options of [
        { authenticated: false },
        { visible: false },
        { role: "RIESGO", accessible: false },
      ]) {
        const result = await request(parte, options);
        assert(result.status >= 400);
        assert.equal(result.legacyCalls, 0);
      }
    });
  }
});

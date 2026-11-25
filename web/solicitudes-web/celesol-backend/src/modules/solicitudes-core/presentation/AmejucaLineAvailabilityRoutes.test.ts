import assert from "node:assert/strict";
import { it } from "node:test";
import type { AddressInfo } from "node:net";
import type { Prisma } from "@prisma/client";
import express, { Router, type ErrorRequestHandler } from "express";
import cookieParser from "cookie-parser";
import type { DbClient } from "../../../db/prisma";
import type { AuthUser } from "../../auth/domain/entities/User.entity";
import { ACCESS_TOKEN_COOKIE } from "../../auth/presentation/AuthCookies";
import type { LineaPrestamoPresolicitud } from "../../solicitudes/domain/entities/Solicitud.entity";
import type { AmejucaVariant } from "../domain/services/AmejucaLineAvailability";
import { assertAmejucaLineAvailable } from "../infrastructure/services/AmejucaLineAvailabilityStore";
import {
  addLineasPrestamoParaAltaRoute,
  createAmejucaLineAvailabilityAdminRouter,
} from "./AmejucaLineAvailabilityRoutes";

it("reserves the variant switch for admins and filters only the new application catalog", async () => {
  let current: { variant: AmejucaVariant; version: number } = {
    variant: "CELESOL",
    version: 1,
  };
  const db = {
    amejucaLineAvailability: {
      findUniqueOrThrow: async () => ({ ...current }),
      updateMany: async (input: {
        where: { version: number };
        data: { variant: AmejucaVariant; updatedBy: string };
      }) => {
        if (
          input.where.version !== current.version ||
          input.data.variant === current.variant
        )
          return { count: 0 };
        assert.equal(input.data.updatedBy, "admin");
        current = { variant: input.data.variant, version: current.version + 1 };
        return { count: 1 };
      },
    },
    $transaction: async (operation: (tx: unknown) => Promise<unknown>) =>
      operation(db),
  } as unknown as DbClient;
  const auth = {
    execute: async (token?: string): Promise<AuthUser> => {
      if (!token)
        throw Object.assign(new Error("Sesión inválida"), { statusCode: 401 });
      return {
        id: token,
        email: "ejemplo@example.invalid",
        emailVerified: true,
        firstName: "Ejemplo",
        lastName: null,
        legacyUser: "usuario-vimarx",
        isSystemAdmin: token === "admin",
        state: 1,
        recibeAsignacionAutomatica: false,
        workflowOwnerId: "owner",
        workflowOwner: { id: "owner", code: "RIESGO", name: "Riesgo" },
      };
    },
  };

  const line = (oid: string): LineaPrestamoPresolicitud => ({
    oid,
    descripcion: "Línea de prueba",
    vigente: true,
    cantidadMaximaCuotas: null,
    cantidadMinimaCuotas: null,
    montoMaximo: null,
    montoMinimo: null,
    tasa: null,
  });
  const celesol = ["2519", "2657", "2664", "2770", "2771"];
  const redUnisol = ["2772", "2773", "2774", "2775", "2776", "2787"];
  const other = "4000";
  const catalog = {
    listVigentesByLegacyUser: async (user: string) => {
      assert.equal(user, "usuario-vimarx");
      return [...celesol, ...redUnisol, other].map(line);
    },
  };

  const app = express();
  const router = Router();
  addLineasPrestamoParaAltaRoute(router, auth, catalog, db);
  app.use(express.json(), cookieParser());
  app.use("/solicitudes", router);
  app.use(
    "/admin/solicitudes",
    createAmejucaLineAvailabilityAdminRouter(auth, db),
  );
  app.use(((error, _req, res, _next) => {
    res.status(error.statusCode ?? 500).json({ message: error.message });
  }) as ErrorRequestHandler);

  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const base = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
  const settings = "/admin/solicitudes/amejuca-line-availability";
  const request = (path: string, token?: string, body?: unknown) =>
    fetch(base + path, {
      method: body ? "PUT" : "GET",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Cookie: ACCESS_TOKEN_COOKIE + "=" + token } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

  async function list() {
    const response = await request(
      "/solicitudes/lineas-prestamo-para-alta",
      "analyst",
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    return ((await response.json()) as LineaPrestamoPresolicitud[]).map(
      (entry) => entry.oid,
    );
  }

  try {
    assert.equal((await request(settings)).status, 401);
    assert.equal((await request(settings, "analyst")).status, 403);
    const change = { variant: "RED_UNISOL", expectedVersion: 1 };
    assert.equal((await request(settings, "analyst", change)).status, 403);
    assert.equal(
      (await request(settings, "admin", { ...change, variant: "BOTH" })).status,
      400,
    );
    assert.deepEqual(await list(), [...celesol, other]);
    assert.deepEqual(await (await request(settings, "admin")).json(), {
      variant: "CELESOL",
      version: 1,
    });

    const saved = await request(settings, "admin", change);
    assert.equal(saved.status, 200);
    assert.deepEqual(await saved.json(), { variant: "RED_UNISOL", version: 2 });
    assert.deepEqual(await list(), [...redUnisol, other]);

    const replay = await request(settings, "admin", change);
    assert.equal(replay.status, 200);
    assert.deepEqual(await replay.json(), {
      variant: "RED_UNISOL",
      version: 2,
    });
    assert.equal(
      (
        await request(settings, "admin", {
          variant: "CELESOL",
          expectedVersion: 1,
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await request(settings, "admin", {
          variant: "CELESOL",
          expectedVersion: 2,
        })
      ).status,
      200,
    );
    assert.deepEqual(await list(), [...celesol, other]);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

it("checks the active variant under a shared lock at insert time", async () => {
  let queries = 0;
  const tx = {
    $queryRaw: async (parts: TemplateStringsArray, id: number) => {
      queries++;
      assert.match(parts.join(""), /FOR SHARE/);
      assert.equal(id, 1);
      return [{ variant: "RED_UNISOL" }];
    },
  } as Pick<Prisma.TransactionClient, "$queryRaw">;
  await assertAmejucaLineAvailable(tx, "4000");
  assert.equal(queries, 0);
  await assertAmejucaLineAvailable(tx, "2773");
  await assert.rejects(assertAmejucaLineAvailable(tx, "2519"), {
    name: "AmejucaLineUnavailableError",
    statusCode: 409,
  });
  assert.equal(queries, 2);
});

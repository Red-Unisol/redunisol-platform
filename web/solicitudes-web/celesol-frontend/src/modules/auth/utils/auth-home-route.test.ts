/// <reference types="node" />

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AuthUser } from "@/modules/auth/services/auth-api";

import * as authUserModule from "./auth-user.ts";

function buildUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    email: "admin@example.com",
    emailVerified: true,
    firstName: "Ada",
    id: "user-1",
    isSystemAdmin: false,
    lastName: "Lovelace",
    legacyUser: "ada.lovelace",
    state: 1,
    workflowOwnerId: "owner-1",
    workflowOwner: {
      code: "VENTAS",
      id: "owner-1",
      name: "Vendedores",
    },
    ...overrides,
  };
}

describe("getDefaultAuthenticatedRoute", () => {
  it("routes pending users to pending-area", () => {
    const routeResolver = (authUserModule as Record<string, unknown>)[
      "getDefaultAuthenticatedRoute"
    ];

    assert.equal(typeof routeResolver, "function");
    assert.equal(
      (routeResolver as (user: AuthUser) => string)(
        buildUser({ workflowOwnerId: null, workflowOwner: null }),
      ),
      "/pending-area",
    );
  });

  it("routes admins to precarga", () => {
    const routeResolver = (authUserModule as Record<string, unknown>)[
      "getDefaultAuthenticatedRoute"
    ];

    assert.equal(typeof routeResolver, "function");
    assert.equal(
      (routeResolver as (user: AuthUser) => string)(
        buildUser({ isSystemAdmin: true }),
      ),
      "/solicitudes/core/precarga",
    );
  });

  it("routes admins to precarga even without a workflow owner", () => {
    const routeResolver = (authUserModule as Record<string, unknown>)[
      "getDefaultAuthenticatedRoute"
    ];

    assert.equal(typeof routeResolver, "function");
    assert.equal(
      (routeResolver as (user: AuthUser) => string)(
        buildUser({
          isSystemAdmin: true,
          workflowOwner: null,
          workflowOwnerId: null,
        }),
      ),
      "/solicitudes/core/precarga",
    );
  });

  it("routes regular users to precarga", () => {
    const routeResolver = (authUserModule as Record<string, unknown>)[
      "getDefaultAuthenticatedRoute"
    ];

    assert.equal(typeof routeResolver, "function");
    assert.equal(
      (routeResolver as (user: AuthUser) => string)(buildUser()),
      "/solicitudes/core/precarga",
    );
  });
});

describe("resolveDashboardVariant", () => {
  const variantResolver = (authUserModule as Record<string, unknown>)[
    "resolveDashboardVariant"
  ] as (user: AuthUser) => string;

  it("chooses admin for system admins", () => {
    assert.equal(variantResolver(buildUser({ isSystemAdmin: true })), "admin");
  });

  it("chooses analista when the owner code indicates riesgo", () => {
    assert.equal(
      variantResolver(
        buildUser({
          workflowOwner: { code: "RIESGO", id: "owner-1", name: "Área Riesgo" },
        }),
      ),
      "analista",
    );
  });

  it("chooses analista when the owner name indicates analysis", () => {
    assert.equal(
      variantResolver(
        buildUser({
          workflowOwner: {
            code: "OPERACIONES",
            id: "owner-1",
            name: "Analistas",
          },
        }),
      ),
      "analista",
    );
  });

  it("falls back to vendedor for operational users", () => {
    assert.equal(variantResolver(buildUser()), "vendedor");
  });
});

describe("áreas internas combinadas", () => {
  const tesoreria = { id: "tes", code: "TESORERIA", name: "Tesorería" };
  const legajos = {
    id: "leg",
    code: "LEGAJOS_DIGITALES",
    name: "Legajos Digitales",
  };
  const riesgo = { id: "riesgo", code: "RIESGO", name: "Riesgo" };

  it("Tesorería y Legajos abren la bandeja combinada y revisan firmas sin permisos de administración", () => {
    const user = buildUser({
      workflowOwner: tesoreria,
      workflowOwnerId: tesoreria.id,
      workflowOwners: [tesoreria, legajos],
    });
    assert.equal(
      authUserModule.getDefaultAuthenticatedRoute(user),
      "/solicitudes/core/recientes",
    );
    assert.equal(authUserModule.canReviewSignatures(user), true);
    assert.equal(authUserModule.canAccessRiesgoTools(user), false);
    assert.equal(authUserModule.canManageUsers(user), false);
  });

  it("Análisis junto a Legajos conserva las herramientas de ambos y la carga permitida por Legajos", () => {
    for (const workflowOwners of [
      [riesgo, legajos],
      [legajos, riesgo],
    ]) {
      const user = buildUser({
        workflowOwner: workflowOwners[0],
        workflowOwnerId: workflowOwners[0].id,
        workflowOwners,
      });
      assert.equal(
        authUserModule.getDefaultAuthenticatedRoute(user),
        "/solicitudes/core/recientes",
      );
      assert.equal(authUserModule.canReviewSignatures(user), true);
      assert.equal(authUserModule.canAccessRiesgoTools(user), true);
      assert.equal(authUserModule.canCreateSolicitud(user), true);
    }
    assert.equal(
      authUserModule.canCreateSolicitud(buildUser({ workflowOwner: riesgo })),
      false,
    );
  });
});

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

  it("routes admins to the admin dashboard", () => {
    const routeResolver = (authUserModule as Record<string, unknown>)[
      "getDefaultAuthenticatedRoute"
    ];

    assert.equal(typeof routeResolver, "function");
    assert.equal(
      (routeResolver as (user: AuthUser) => string)(
        buildUser({ isSystemAdmin: true }),
      ),
      "/dashboard",
    );
  });

  it("routes admins to the admin dashboard even without a workflow owner", () => {
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
      "/dashboard",
    );
  });

  it("routes regular users to the dashboard home", () => {
    const routeResolver = (authUserModule as Record<string, unknown>)[
      "getDefaultAuthenticatedRoute"
    ];

    assert.equal(typeof routeResolver, "function");
    assert.equal(
      (routeResolver as (user: AuthUser) => string)(buildUser()),
      "/dashboard",
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

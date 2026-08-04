/// <reference types="node" />

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { canManageSolicitudAssignment } from "./solicitud-assignment";

describe("solicitud-assignment", () => {
  it("allows assignment without visible workflow transitions when assignment conditions are met", () => {
    assert.equal(
      canManageSolicitudAssignment({
        canEditSolicitud: true,
        hasAssignmentOptions: true,
        isAssigningToSelf: false,
        isAssigningToUser: false,
        isEditing: true,
        isLoadingAssignableAgents: false,
      }),
      true,
    );
  });

  it("blocks assignment when there are no assignable options", () => {
    assert.equal(
      canManageSolicitudAssignment({
        canEditSolicitud: true,
        hasAssignmentOptions: false,
        isAssigningToSelf: false,
        isAssigningToUser: false,
        isEditing: true,
        isLoadingAssignableAgents: false,
      }),
      false,
    );
  });

  it("blocks assignment outside edit mode", () => {
    assert.equal(
      canManageSolicitudAssignment({
        canEditSolicitud: true,
        hasAssignmentOptions: true,
        isAssigningToSelf: false,
        isAssigningToUser: false,
        isEditing: false,
        isLoadingAssignableAgents: false,
      }),
      false,
    );
  });
});

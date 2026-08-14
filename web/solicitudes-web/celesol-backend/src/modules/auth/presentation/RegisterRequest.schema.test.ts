import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { registerRequestSchema } from "./RegisterRequest.schema";

describe("registerRequestSchema", () => {
  it("normalizes valid register input", () => {
    const parsed = registerRequestSchema.parse({
      email: "  USER@EXAMPLE.COM ",
      firstName: " New ",
      lastName: " User ",
      legacyUser: " new.user ",
      password: "Password1!",
    });

    assert.deepEqual(parsed, {
      email: "user@example.com",
      firstName: "New",
      lastName: "User",
      legacyUser: "new.user",
      password: "Password1!",
    });
  });

  it("rejects weak passwords", () => {
    assert.equal(
      registerRequestSchema.safeParse({
        email: "user@example.com",
        firstName: "New",
        lastName: "User",
        legacyUser: "new.user",
        password: "password",
      }).success,
      false,
    );
  });

  it("rejects empty names", () => {
    assert.equal(
      registerRequestSchema.safeParse({
        email: "user@example.com",
        firstName: " ",
        lastName: "User",
        legacyUser: "new.user",
        password: "Password1!",
      }).success,
      false,
    );
  });

  it("rejects invalid email", () => {
    assert.equal(
      registerRequestSchema.safeParse({
        email: "invalid-email",
        firstName: "New",
        lastName: "User",
        legacyUser: "new.user",
        password: "Password1!",
      }).success,
      false,
    );
  });
});

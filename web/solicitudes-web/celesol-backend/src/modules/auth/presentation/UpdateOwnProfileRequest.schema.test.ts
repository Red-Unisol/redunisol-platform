import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { updateOwnProfileRequestSchema } from "./UpdateOwnProfileRequest.schema";

describe("updateOwnProfileRequestSchema", () => {
  it("accepts firstName only", () => {
    const parsed = updateOwnProfileRequestSchema.parse({ firstName: "Ana" });

    assert.deepEqual(parsed, { firstName: "Ana" });
  });

  it("normalizes email to trimmed lowercase", () => {
    const parsed = updateOwnProfileRequestSchema.parse({
      email: "  USER@Example.com ",
    });

    assert.deepEqual(parsed, { email: "user@example.com" });
  });

  it("rejects an invalid email", () => {
    assert.equal(
      updateOwnProfileRequestSchema.safeParse({ email: "not-an-email" }).success,
      false,
    );
  });

  it("rejects an empty payload", () => {
    assert.equal(updateOwnProfileRequestSchema.safeParse({}).success, false);
  });

  it("rejects unknown fields", () => {
    assert.equal(
      updateOwnProfileRequestSchema.safeParse({ isSystemAdmin: true }).success,
      false,
    );
  });
});

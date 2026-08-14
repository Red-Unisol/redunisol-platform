import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { changeOwnPasswordRequestSchema } from "./ChangeOwnPasswordRequest.schema";

describe("changeOwnPasswordRequestSchema", () => {
  it("accepts a valid payload", () => {
    const parsed = changeOwnPasswordRequestSchema.parse({
      currentPassword: "anything",
      newPassword: "NewPass1!",
    });

    assert.deepEqual(parsed, {
      currentPassword: "anything",
      newPassword: "NewPass1!",
    });
  });

  it("rejects an empty currentPassword", () => {
    assert.equal(
      changeOwnPasswordRequestSchema.safeParse({
        currentPassword: "",
        newPassword: "NewPass1!",
      }).success,
      false,
    );
  });

  it("rejects a newPassword that does not meet the strength policy", () => {
    assert.equal(
      changeOwnPasswordRequestSchema.safeParse({
        currentPassword: "anything",
        newPassword: "weak",
      }).success,
      false,
    );
  });

  it("rejects unknown fields", () => {
    assert.equal(
      changeOwnPasswordRequestSchema.safeParse({
        currentPassword: "anything",
        newPassword: "NewPass1!",
        extra: true,
      }).success,
      false,
    );
  });
});

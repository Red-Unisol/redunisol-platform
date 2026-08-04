import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resendVerificationCodeRequestSchema } from "./ResendVerificationCodeRequest.schema";

describe("resendVerificationCodeRequestSchema", () => {
  it("accepts a legacy user identifier", () => {
    const parsed = resendVerificationCodeRequestSchema.parse({
      identifier: " legacy.user ",
    });

    assert.deepEqual(parsed, {
      identifier: "legacy.user",
    });
  });

  it("accepts an email for backwards compatibility", () => {
    const parsed = resendVerificationCodeRequestSchema.parse({
      email: " USER@EXAMPLE.COM ",
    });

    assert.deepEqual(parsed, {
      email: "user@example.com",
    });
  });

  it("rejects an empty payload", () => {
    assert.equal(resendVerificationCodeRequestSchema.safeParse({}).success, false);
  });

  it("treats blank strings as missing values", () => {
    assert.equal(
      resendVerificationCodeRequestSchema.safeParse({
        email: " ",
        identifier: "",
      }).success,
      false,
    );
  });
});

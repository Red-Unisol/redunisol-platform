import assert from "node:assert/strict";
import { it } from "node:test";
import { OpaqueRefreshTokenService } from "./OpaqueRefreshTokenService";

it("reproduces the successor across instances without exposing it from the stored hash", () => {
  const first = new OpaqueRefreshTokenService(
    "test-key-with-at-least-32-characters",
  );
  const second = new OpaqueRefreshTokenService(
    "test-key-with-at-least-32-characters",
  );
  const raw = first.generate();
  assert.equal(first.successor(raw), second.successor(raw));
  assert.notEqual(first.successor(raw), raw);
  assert.notEqual(first.successor(first.hash(raw)), first.successor(raw));
  assert.notEqual(
    new OpaqueRefreshTokenService("another-test-key").successor(raw),
    first.successor(raw),
  );
});

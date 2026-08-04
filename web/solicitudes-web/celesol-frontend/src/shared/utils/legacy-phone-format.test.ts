import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { toDisplayPhone, toLegacyPhone } from "./legacy-phone-format.ts";

describe("toDisplayPhone", () => {
  it("strips the trunk 0 and the mobile 15 marker, prefixing +54", () => {
    assert.equal(toDisplayPhone("0341157204225"), "+543417204225");
  });

  it("strips only the trunk 0 for a landline without a 15 marker", () => {
    assert.equal(toDisplayPhone("03414931234"), "+543414931234");
  });

  it("does not strip a false-positive 15 that leaves a too-short subscriber number", () => {
    assert.equal(toDisplayPhone("03411512345"), "+543411512345");
  });

  it("returns an empty string for empty input", () => {
    assert.equal(toDisplayPhone(""), "");
    assert.equal(toDisplayPhone(null), "");
    assert.equal(toDisplayPhone(undefined), "");
  });
});

describe("toLegacyPhone", () => {
  it("converts a +54 display number back to the legacy local format", () => {
    assert.equal(toLegacyPhone("+543417204225"), "03417204225");
  });

  it("returns an empty string for empty input", () => {
    assert.equal(toLegacyPhone(""), "");
    assert.equal(toLegacyPhone(null), "");
    assert.equal(toLegacyPhone(undefined), "");
  });
});

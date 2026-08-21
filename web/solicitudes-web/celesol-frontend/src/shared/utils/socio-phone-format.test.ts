import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  toDisplaySocioPhone,
  toStoredSocioPhone,
} from "./socio-phone-format.ts";

describe("toDisplaySocioPhone", () => {
  it("prefixes bare local digits with +54", () => {
    assert.equal(toDisplaySocioPhone("3512692519"), "+543512692519");
  });

  it("strips spaces and other formatting before prefixing", () => {
    assert.equal(toDisplaySocioPhone("11 4444 5555"), "+541144445555");
  });

  it("does not double-prefix a value that already includes the country code", () => {
    assert.equal(toDisplaySocioPhone("543512692519"), "+543512692519");
  });

  it("returns an empty string for empty input", () => {
    assert.equal(toDisplaySocioPhone(""), "");
    assert.equal(toDisplaySocioPhone(null), "");
    assert.equal(toDisplaySocioPhone(undefined), "");
  });
});

describe("toStoredSocioPhone", () => {
  it("strips the +54 prefix back to bare local digits", () => {
    assert.equal(toStoredSocioPhone("+543512692519"), "3512692519");
  });

  it("strips formatting characters added by the phone input", () => {
    assert.equal(toStoredSocioPhone("+54 351 269 2519"), "3512692519");
  });

  it("returns an empty string for empty input", () => {
    assert.equal(toStoredSocioPhone(""), "");
    assert.equal(toStoredSocioPhone(null), "");
    assert.equal(toStoredSocioPhone(undefined), "");
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  normalizeCuit,
  normalizeDocumento,
} from "./SocioInputNormalizer";

describe("SocioInputNormalizer", () => {
  it("normalizes cuit removing spaces, dots and dashes", () => {
    assert.equal(normalizeCuit(" 20.1234 567-83 "), "20123456783");
  });

  it("rejects cuit shorter than 11 digits", () => {
    assert.throws(() => normalizeCuit("2012345678"), /cuit invalido/i);
  });

  it("rejects cuit longer than 11 digits", () => {
    assert.throws(() => normalizeCuit("201234567890"), /cuit invalido/i);
  });

  it("rejects cuit with non-digit characters after normalization", () => {
    assert.throws(() => normalizeCuit("20A12345678"), /cuit invalido/i);
  });

  it("normalizes document removing separators and uppercasing letters", () => {
    assert.equal(normalizeDocumento(" ab-12.345 c "), "AB12345C");
  });
});

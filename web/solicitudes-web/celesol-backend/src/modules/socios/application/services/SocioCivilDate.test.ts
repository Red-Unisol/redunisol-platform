import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formatCivilDate, parseCivilDate } from "./SocioCivilDate";

describe("SocioCivilDate", () => {
  it("parses a valid civil date without shifting the day", () => {
    const date = parseCivilDate("1990-02-28");

    assert.equal(date.toISOString(), "1990-02-28T00:00:00.000Z");
    assert.equal(formatCivilDate(date), "1990-02-28");
  });

  it("rejects a non-existent civil date", () => {
    assert.throws(
      () => parseCivilDate("1990-02-31"),
      /fecha de nacimiento invalida/i,
    );
  });

  it("rejects an invalid date format", () => {
    assert.throws(
      () => parseCivilDate("31-02-1990"),
      /fecha de nacimiento invalida/i,
    );
  });
});

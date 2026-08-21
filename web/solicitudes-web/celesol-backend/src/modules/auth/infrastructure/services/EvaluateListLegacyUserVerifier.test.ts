import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { LegacyServiceUnavailableError } from "../../domain/auth-errors";
import { EvaluateListLegacyUserVerifier } from "./EvaluateListLegacyUserVerifier";

type CapturedRequest = {
  body: unknown;
  input: string | URL;
  init: RequestInit | undefined;
};

function createFetcher(response: unknown, ok = true) {
  const requests: CapturedRequest[] = [];
  const fetcher = async (input: string | URL, init?: RequestInit) => {
    requests.push({
      body:
        typeof init?.body === "string"
          ? JSON.parse(init.body)
          : init?.body ?? null,
      init,
      input,
    });

    return {
      json: async () => response,
      ok,
    };
  };

  return {
    fetcher,
    requests,
  };
}

function createVerifier(response: unknown, ok = true) {
  const { fetcher, requests } = createFetcher(response, ok);
  const verifier = new EvaluateListLegacyUserVerifier(
    {
      baseUrl: "https://legacy.example.com",
      timeoutMs: 1000,
    },
    fetcher,
  );

  return {
    requests,
    verifier,
  };
}

describe("EvaluateListLegacyUserVerifier", () => {
  it("builds EvaluateList request body and maps active legacy user", async () => {
    const { requests, verifier } = createVerifier([[10, true, "hpajon"]]);
    const legacyUser = await verifier.verifyByUserName("hpajon");

    assert.deepEqual(legacyUser, {
      active: true,
      id: 10,
      userName: "hpajon",
    });
    assert.equal(
      String(requests[0]?.input),
      "https://legacy.example.com/api/Empresa/EvaluateList",
    );
    assert.deepEqual(requests[0]?.body, {
      campos: "ID;Activo;UserName",
      cmd: "UserName = 'hpajon'",
      max: 500,
      tipo: "ClasesBase.Usuario",
    });
  });

  it("escapes single quotes in legacy user names", async () => {
    const { requests, verifier } = createVerifier([[10, true, "h'pajon"]]);
    await verifier.verifyByUserName("h'pajon");

    assert.deepEqual(requests[0]?.body, {
      campos: "ID;Activo;UserName",
      cmd: "UserName = 'h''pajon'",
      max: 500,
      tipo: "ClasesBase.Usuario",
    });
  });

  it("matches user names case-insensitively", async () => {
    const { verifier } = createVerifier([[10, true, "HPAJON"]]);
    const legacyUser = await verifier.verifyByUserName("hpajon");

    assert.equal(legacyUser?.userName, "HPAJON");
  });

  it("supports numeric and string active values", async () => {
    const numeric = createVerifier([[10, 1, "hpajon"]]);
    const truthyString = createVerifier([[10, "true", "hpajon"]]);
    const oneString = createVerifier([[10, "1", "hpajon"]]);

    assert.equal((await numeric.verifier.verifyByUserName("hpajon"))?.active, true);
    assert.equal(
      (await truthyString.verifier.verifyByUserName("hpajon"))?.active,
      true,
    );
    assert.equal(
      (await oneString.verifier.verifyByUserName("hpajon"))?.active,
      true,
    );
  });

  it("returns inactive legacy user when active value is false", async () => {
    const { verifier } = createVerifier([[10, false, "hpajon"]]);
    const legacyUser = await verifier.verifyByUserName("hpajon");

    assert.equal(legacyUser?.active, false);
  });

  it("returns null when no matching row exists", async () => {
    const { verifier } = createVerifier([[10, true, "other"]]);
    const legacyUser = await verifier.verifyByUserName("hpajon");

    assert.equal(legacyUser, null);
  });

  it("maps invalid responses and HTTP errors to service unavailable", async () => {
    const invalidResponse = createVerifier({ unexpected: true });
    const httpError = createVerifier([], false);

    await assert.rejects(
      () => invalidResponse.verifier.verifyByUserName("hpajon"),
      LegacyServiceUnavailableError,
    );
    await assert.rejects(
      () => httpError.verifier.verifyByUserName("hpajon"),
      LegacyServiceUnavailableError,
    );
  });
});

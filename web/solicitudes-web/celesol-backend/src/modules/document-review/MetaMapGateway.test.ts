import assert from "node:assert/strict";
import test from "node:test";
import { MetaMapGateway } from "./MetaMapGateway";
import { candidateFixture } from "./fixtures";

const config = {
  serverBaseUrl: "https://index.example.invalid",
  serverClientId: "client",
  serverClientSecret: "test-only",
  clientId: "client",
  clientSecret: "test-only",
  timeoutMs: 1000,
};
test("discovery includes all attempts and reads current resources instead of stale completed payloads", async () => {
  const calls: string[] = [];
  const request: typeof fetch = async (url, init) => {
    calls.push(String(url));
    if (String(url).includes("/oauth/"))
      return Response.json({
        access_token: "test-only-token",
        expires_in: 300,
      });
    if (String(url).includes("index.example.invalid"))
      return Response.json({
        items: ["first", "second"].map((id) => ({
          verification_id: id,
          resource_url: `https://api.prod.metamap.com/v2/verifications/${id}`,
          completed_at: "2026-10-13T12:00:00Z",
          latest_payload: { status: "verified", identityStatus: "verified" },
        })),
        pagination: { total: 2 },
      });
    assert.equal(
      (init?.headers as Record<string, string>).Authorization,
      "Bearer test-only-token",
    );
    const id = String(url).split("/").at(-1)!;
    const c = candidateFixture(id);
    c.resource!.identity = { status: id === "first" ? "rejected" : "verified" };
    return Response.json(c.resource);
  };
  const result = await new MetaMapGateway(config, request).candidates("101");
  assert.equal(result.length, 2);
  assert.equal(
    (result[0].resource?.identity as { status: string }).status,
    "rejected",
  );
  assert.equal(calls.filter((c) => c.includes("/oauth/")).length, 1);
});
test("provider resources and media cannot send credentials to arbitrary hosts or redirects", async () => {
  let calls = 0;
  const gateway = new MetaMapGateway(config, async () => {
    calls++;
    return Response.json({});
  });
  await assert.rejects(() => gateway.download("http://127.0.0.1/secrets"));
  await assert.rejects(() =>
    gateway.download("https://evil.example/media.pdf"),
  );
  assert.equal(calls, 0);
});
test("wrong resource identity is recorded as an unavailable attempt", async () => {
  const request: typeof fetch = async (url) =>
    String(url).includes("oauth")
      ? Response.json({ access_token: "test" })
      : String(url).includes("index.example.invalid")
        ? Response.json({
            items: [
              {
                verification_id: "first",
                resource_url:
                  "https://api.prod.metamap.com/v2/verifications/first",
              },
            ],
            pagination: { total: 1 },
          })
        : Response.json(candidateFixture("other-person").resource);
  const [result] = await new MetaMapGateway(config, request).candidates("101");
  assert.equal(result.resource, null);
  assert(result.error);
});

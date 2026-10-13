import {
  array,
  object,
  text,
  type JsonObject,
  type ProviderCandidate,
} from "./domain";

export type MetaMapConfig = {
  serverBaseUrl: string;
  serverClientId: string;
  serverClientSecret: string;
  clientId: string;
  clientSecret: string;
  timeoutMs: number;
};
export type EvidenceGateway = {
  candidates(requestNumber: string): Promise<ProviderCandidate[]>;
  download(url: string): Promise<Buffer>;
};
const RESOURCE_HOSTS = new Set(["api.prod.metamap.com", "api.getmati.com"]);
const MEDIA_HOSTS = new Set([
  ...RESOURCE_HOSTS,
  "media.prod.metamap.com",
  "media.getmati.com",
  "media-cdn.prod.metamap.com",
]);

export class MetaMapGateway implements EvidenceGateway {
  private accessToken: string | null = null;
  private expiresAt = 0;
  private authenticating: Promise<string> | null = null;
  constructor(
    private config: MetaMapConfig,
    private request: typeof fetch = fetch,
  ) {}

  private async bounded(response: Response, maxBytes: number): Promise<Buffer> {
    if (!response.ok || !response.body)
      throw new Error("MetaMap no entregó la evidencia solicitada.");
    if (Number(response.headers.get("content-length")) > maxBytes)
      throw new Error("La evidencia supera el tamaño admitido.");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > maxBytes)
          throw new Error("La evidencia supera el tamaño admitido.");
        chunks.push(value);
      }
    } finally {
      await reader.cancel();
    }
    return Buffer.concat(chunks);
  }
  private async json(
    url: string,
    headers: Record<string, string>,
  ): Promise<JsonObject> {
    const r = await this.request(url, {
      headers,
      redirect: "error",
      signal: AbortSignal.timeout(this.config.timeoutMs),
    });
    return object(
      JSON.parse((await this.bounded(r, 8 * 1024 * 1024)).toString("utf8")),
    );
  }
  private async token(): Promise<string> {
    if (this.accessToken && Date.now() < this.expiresAt)
      return this.accessToken;
    if (!this.authenticating)
      this.authenticating = (async () => {
        const response = await this.request(
          "https://api.prod.metamap.com/oauth/",
          {
            method: "POST",
            redirect: "error",
            signal: AbortSignal.timeout(this.config.timeoutMs),
            headers: {
              Authorization: `Basic ${Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString("base64")}`,
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: "grant_type=client_credentials",
          },
        );
        const payload = object(
          JSON.parse(
            (await this.bounded(response, 64 * 1024)).toString("utf8"),
          ),
        );
        const token = text(payload.access_token);
        if (!token) throw new Error("No se pudo autenticar con MetaMap.");
        this.accessToken = token;
        this.expiresAt =
          Date.now() +
          Math.max(1, Number(payload.expires_in) || 300) * 1000 -
          30000;
        return token;
      })().finally(() => {
        this.authenticating = null;
      });
    return this.authenticating;
  }
  private providerUrl(value: string, media: boolean): string {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      !(media ? MEDIA_HOSTS : RESOURCE_HOSTS).has(url.hostname)
    ) {
      throw new Error(
        "El proveedor devolvió una dirección de evidencia no admitida.",
      );
    }
    return url.toString();
  }
  private async providerResponse(
    url: string,
    media = false,
  ): Promise<Response> {
    const target = this.providerUrl(url, media);
    let response = await this.request(target, {
      redirect: "error",
      headers: { Authorization: `Bearer ${await this.token()}` },
      signal: AbortSignal.timeout(this.config.timeoutMs),
    });
    if (response.status === 401) {
      this.accessToken = null;
      response = await this.request(target, {
        redirect: "error",
        headers: { Authorization: `Bearer ${await this.token()}` },
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
    }
    return response;
  }
  async download(url: string): Promise<Buffer> {
    return this.bounded(
      await this.providerResponse(url, true),
      32 * 1024 * 1024,
    );
  }
  async candidates(requestNumber: string): Promise<ProviderCandidate[]> {
    if (!/^\d+$/.test(requestNumber))
      throw new Error("El préstamo no tiene una referencia válida.");
    const headers = {
      "X-Client-Id": this.config.serverClientId,
      "X-Client-Secret": this.config.serverClientSecret,
    };
    const records = new Map<string, JsonObject>();
    for (let offset = 0; offset <= 10000; offset += 200) {
      const url = new URL(
        `${this.config.serverBaseUrl.replace(/\/$/, "")}/api/v1/validations`,
      );
      url.search = new URLSearchParams({
        request_number: requestNumber,
        limit: "200",
        offset: String(offset),
        include_payload: "true",
      }).toString();
      const result = await this.json(url.toString(), headers);
      const items = array(result.items).map(object);
      for (const item of items) {
        const id = text(item.verification_id);
        if (id) records.set(id, item);
      }
      if (
        items.length < 200 ||
        offset + items.length >= Number(object(result.pagination).total)
      )
        break;
      if (offset === 10000)
        throw new Error(
          "No se pudieron recuperar todos los intentos de firma.",
        );
    }
    const candidates: ProviderCandidate[] = [];
    // Sequential provider reads bound pressure on MetaMap and preserve each
    // attempt, including rejected/updated ones. The index is only discovery.
    for (const [verificationId, item] of records) {
      const payload = object(item.latest_payload);
      let resource: JsonObject | null;
      let error: string | null = null;
      try {
        const response = await this.providerResponse(
          text(item.resource_url) ?? "",
        );
        resource = object(
          JSON.parse(
            (await this.bounded(response, 8 * 1024 * 1024)).toString("utf8"),
          ),
        );
        if (text(resource.id) !== verificationId)
          throw new Error("Verification identity mismatch");
      } catch {
        resource = null;
        error = "No se pudo obtener la evidencia vigente de este intento.";
      }
      const dashboard = text(payload.matiDashboardUrl);
      candidates.push({
        verificationId,
        resource,
        error,
        completedAt: text(item.completed_at),
        originalStatus: text(payload.status),
        dashboardUrl:
          dashboard &&
          /^https:\/\/dashboard\.(?:getmati|metamap)\.com\//.test(dashboard)
            ? dashboard
            : null,
      });
    }
    return candidates;
  }
}

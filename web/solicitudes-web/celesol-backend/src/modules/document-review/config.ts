import { z } from "zod";

export const documentReviewConfigSchema = z
  .object({
    enabled: z.boolean(),
    serverBaseUrl: z.string(),
    serverClientId: z.string(),
    serverClientSecret: z.string(),
    clientId: z.string(),
    clientSecret: z.string(),
  })
  .superRefine((c, ctx) => {
    if (!c.enabled) return;
    for (const key of [
      "serverClientId",
      "serverClientSecret",
      "clientId",
      "clientSecret",
    ] as const) {
      if (!c[key].trim())
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: "La revisión documental habilitada requiere este acceso.",
        });
    }
    try {
      const url = new URL(c.serverBaseUrl);
      if (url.protocol !== "https:" || url.username || url.password)
        throw new Error();
    } catch {
      ctx.addIssue({
        code: "custom",
        path: ["serverBaseUrl"],
        message: "Se requiere una URL HTTPS sin credenciales en la dirección.",
      });
    }
  });
